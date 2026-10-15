/**
 * src/state/server-device.js — the server's speakers as a playback device,
 * driven against a fake engine and the real devices hub: who sees it, what
 * it reports, and the devices' commands (a transfer to it included) turned
 * into engine calls.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../../src/state/devices.js';
import { createServerDevice, SERVER_DEVICE_ID } from '../../src/state/server-device.js';

// The engine: absolute paths ("/disk/<library path>"), a cycling loop mode.
function fakeEngine() {
  const e = { up: true, queue: [], index: -1, playing: false, position: 0, volume: 0.8, shuffle: false, loop: 'none', calls: [] };
  e.status = () => Promise.resolve({
    playing: e.playing, position: e.position, duration: 200, volume: e.volume, shuffle: e.shuffle,
    loop_mode: e.loop, queue_index: e.index, file: e.queue[e.index]?.slice('/disk/'.length) ?? null,
  });
  e.list = () => Promise.resolve(e.queue.map((p) => p.slice('/disk/'.length)));
  e.post = (path, body) => Promise.resolve(run(path, body));
  const run = (path, body) => {
    e.calls.push([path, body]);
    switch (path) {
      case '/pause': e.playing = false; break;
      case '/resume': if (e.queue.length) { e.playing = true; } break;
      case '/next': e.index = Math.min(e.index + 1, e.queue.length - 1); break;
      case '/seek': e.position = body.position; break;
      case '/volume': e.volume = body.volume; break;
      case '/loop': e.loop = { none: 'all', all: 'one', one: 'none' }[e.loop]; return { loop_mode: e.loop };
      case '/queue/clear': e.queue = []; e.index = -1; e.playing = false; break;
      case '/queue/add-many': e.queue.push(...body.files); break;
      case '/queue/play-index': e.index = body.index; e.playing = true; e.position = 0; break;
      case '/queue/remove': e.queue.splice(body.index, 1); break;
      default: break;
    }
    return {};
  };
  return e;
}

const ann = { key: '1', user: { username: 'ann', vpaths: ['music'] } };
const bob = { key: '2', user: { username: 'bob', vpaths: ['music', 'private'] } };
const flush = () => new Promise((r) => setTimeout(r, 5));

function setup(allowed = [ann, bob]) {
  const hub = createHub();
  const e = fakeEngine();
  const dev = createServerDevice({
    hub, isUp: () => e.up, users: () => allowed, status: e.status, queue: e.list, post: e.post,
    enginePath: (p, user) => (user.vpaths.includes(p.split('/')[0]) ? `/disk/${p}` : null),
    describe: (paths) => new Map(paths.map((p) => [p, { title: `T ${p.split('/').pop()}`, artist: 'A' }])),
  });
  return { hub, e, dev, server: (key) => hub.list(key).find((d) => d.id === SERVER_DEVICE_ID) };
}

test('the allowed users see it while the engine runs; it goes offline when the engine stops', async () => {
  const { hub, e, dev, server } = setup([ann]);
  e.up = false;
  await dev.tick();
  assert.equal(server('1'), undefined);
  e.up = true;
  await dev.tick();
  assert.equal(server('1').online, true);
  assert.equal(server('1').type, 'server');
  assert.equal(server('2'), undefined, 'not for a user without server audio');
  e.up = false;
  await dev.tick();
  assert.equal(server('1').online, false);
  assert.equal(hub.list('2').length, 0);
});

test('it reports the engine: track (described), queue, volume, repeat', async () => {
  const { hub, e, dev, server } = setup();
  e.queue = ['/disk/music/a.mp3', '/disk/music/b.mp3'];
  e.index = 1; e.playing = true; e.position = 12.5; e.loop = 'one';
  await dev.tick();
  const s = server('2');
  assert.equal(s.playing, true);
  assert.equal(s.index, 1);
  assert.equal(s.track.filepath, 'music/b.mp3');
  assert.equal(s.track.title, 'T b.mp3');
  assert.equal(s.track.durationMs, 200000);
  assert.equal(s.volume, 80);
  assert.equal(s.repeat, 'one');
  assert.deepEqual(hub.queue('1', SERVER_DEVICE_ID).queue, ['music/a.mp3', 'music/b.mp3'], 'library paths, never the disk');
  dev.stop();
});

test('commands become engine calls', async () => {
  const { hub, e, dev } = setup();
  e.queue = ['/disk/music/a.mp3', '/disk/music/b.mp3', '/disk/music/c.mp3'];
  e.index = 0; e.playing = true;
  await dev.tick();
  const send = async (cmd, args) => { assert.ok(hub.command('1', 'phone-1', SERVER_DEVICE_ID, cmd, args)); await flush(); };
  await send('pause');
  assert.equal(e.playing, false);
  await send('playPause');
  assert.equal(e.playing, true);
  await send('next');
  assert.equal(e.index, 1);
  await send('seek', { positionMs: 30000 });
  assert.equal(e.position, 30);
  await send('setVolume', { volume: 40 });
  assert.equal(e.volume, 0.4);
  await send('setRepeat', { mode: 'one' });
  assert.equal(e.loop, 'one', 'the loop cycled to the mode asked for');
  await send('setRepeat', { mode: 'off' });
  assert.equal(e.loop, 'none');
  await send('remove', { index: 2, path: 'music/WRONG.mp3' });
  assert.equal(e.queue.length, 3, 'not that path at that index: nothing removed');
  await send('remove', { index: 2, path: 'music/c.mp3' });
  assert.equal(e.queue.length, 2);
  dev.stop();
});

test('a transfer to it loads the queue at the track and position; tracks the user lacks are left out', async () => {
  const { hub, e, dev } = setup();
  await dev.tick();
  hub.connect('1', { id: 'phone-1', name: 'Phone', type: 'android' }, () => {});
  hub.report('1', 'phone-1', {
    status: { index: 2, positionMs: 61000, playing: true, track: { filepath: 'music/c.mp3' } },
    queue: ['music/a.mp3', 'private/x.mp3', 'music/c.mp3', 'music/d.mp3'],
  });
  assert.deepEqual(hub.transfer('1', { from: 'phone-1', to: SERVER_DEVICE_ID, caller: 'phone-1' }), { ok: true });
  await flush();
  assert.deepEqual(e.queue, ['/disk/music/a.mp3', '/disk/music/c.mp3', '/disk/music/d.mp3'], 'ann has no "private"');
  assert.equal(e.index, 1, 'the same track, at its new place');
  assert.ok(Math.abs(e.position - 61) < 1, `the position too (${e.position})`);
  assert.equal(e.playing, true);
  dev.stop();
});

test('moving the music away pauses it; queueing into an empty engine starts it', async () => {
  const { hub, e, dev } = setup();
  await dev.tick();
  hub.command('2', 'guest-x', SERVER_DEVICE_ID, 'enqueue', { paths: ['private/x.mp3', 'music/b.mp3'], next: true });
  await flush();
  assert.deepEqual(e.queue, ['/disk/private/x.mp3', '/disk/music/b.mp3']);
  assert.equal(e.playing, true);
  await dev.tick();
  hub.connect('2', { id: 'web-1', name: 'Browser', type: 'web' }, () => {});
  hub.transfer('2', { from: SERVER_DEVICE_ID, to: 'web-1', caller: 'web-1' });
  await flush();
  assert.equal(e.playing, false);
  dev.stop();
});
