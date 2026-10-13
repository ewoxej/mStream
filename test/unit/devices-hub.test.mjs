import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../../src/state/devices.js';

function setup() {
  let t = 1_000_000;
  const hub = createHub(() => t);
  const streams = {};
  const open = (user, id, name = id) => {
    const got = [];
    streams[id] = got;
    const close = hub.connect(user, { id, name, type: 'web' }, (event, data) => got.push({ event, data }));
    return close;
  };
  return { hub, streams, open, tick: (ms) => { t += ms; } };
}

const status = (o = {}) => ({ index: 0, positionMs: 0, playing: true, volume: 80, track: { filepath: 'm/a.mp3', title: 'A', durationMs: 200000 }, ...o });

test('a device sees the list on connect, the others hear about it', () => {
  const { streams, open } = setup();
  open('u1', 'pc');
  open('u1', 'phone');
  assert.equal(streams.phone[0].event, 'devices');
  assert.deepEqual(streams.phone[0].data.devices.map((d) => d.id).sort(), ['pc', 'phone']);
  assert.equal(streams.pc.at(-1).event, 'device');
  assert.equal(streams.pc.at(-1).data.id, 'phone');
});

test('users do not see each other', () => {
  const { streams, open } = setup();
  open('u1', 'pc');
  open('u2', 'other');
  assert.equal(streams.pc.length, 1);
  assert.deepEqual(streams.other[0].data.devices.map((d) => d.id), ['other']);
});

test('status and queue reach the other devices; a playing position moves on', () => {
  const { hub, streams, open, tick } = setup();
  open('u1', 'pc');
  open('u1', 'phone');
  hub.report('u1', 'pc', { status: status({ positionMs: 10000 }), queue: ['m/a.mp3', 'm/b.mp3'] });
  const ev = streams.phone.at(-1);
  assert.equal(ev.event, 'device');
  assert.equal(ev.data.queueLength, 2);
  assert.ok(ev.data.lastPlayedAt);
  assert.equal(streams.pc.at(-1).data.id, 'pc', 'the reporter hears its own summary too');
  tick(5000);
  assert.equal(hub.list('u1').find((d) => d.id === 'pc').positionMs, 15000);
  assert.deepEqual(hub.queue('u1', 'pc').queue, ['m/a.mp3', 'm/b.mp3']);
});

test('commands go to the target only, and fail when it is offline', () => {
  const { hub, streams, open } = setup();
  open('u1', 'pc');
  const closePhone = open('u1', 'phone');
  assert.equal(hub.command('u1', 'phone', 'pc', 'next'), true);
  assert.deepEqual(streams.pc.at(-1), { event: 'command', data: { from: 'phone', command: 'next', args: null } });
  closePhone();
  assert.equal(hub.command('u1', 'pc', 'phone', 'next'), false);
});

test('transfer to the caller pauses the source and answers with its state', () => {
  const { hub, streams, open, tick } = setup();
  open('u1', 'pc');
  open('u1', 'phone');
  hub.report('u1', 'pc', { status: status({ index: 1, positionMs: 30000 }), queue: ['m/a.mp3', 'm/b.mp3'] });
  tick(2000);
  const r = hub.transfer('u1', { from: 'pc', to: 'phone', caller: 'phone' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.state.queue, ['m/a.mp3', 'm/b.mp3']);
  assert.equal(r.state.index, 1);
  assert.equal(r.state.positionMs, 32000);
  assert.ok(streams.pc.some((e) => e.event === 'command' && e.data.command === 'pause'));
  assert.equal(hub.list('u1').find((d) => d.id === 'pc').playing, false);
});

test('transfer to another device sends it a takeover', () => {
  const { hub, streams, open } = setup();
  open('u1', 'pc');
  open('u1', 'phone');
  open('u1', 'tv');
  hub.report('u1', 'pc', { status: status(), queue: ['m/a.mp3'] });
  const r = hub.transfer('u1', { from: 'pc', to: 'tv', caller: 'phone' });
  assert.equal(r.ok, true);
  const cmd = streams.tv.at(-1);
  assert.equal(cmd.data.command, 'takeover');
  assert.deepEqual(cmd.data.args.queue, ['m/a.mp3']);
});

test('a device that goes away keeps its paused state for a pick-up', () => {
  const { hub, open, tick } = setup();
  const close = open('u1', 'pc');
  open('u1', 'phone');
  hub.report('u1', 'pc', { status: status({ positionMs: 1000 }), queue: ['m/a.mp3'] });
  tick(4000);
  close();
  const pc = hub.list('u1').find((d) => d.id === 'pc');
  assert.equal(pc.online, false);
  assert.equal(pc.playing, false);
  assert.equal(pc.positionMs, 5000);
  const r = hub.transfer('u1', { from: 'pc', to: 'phone', caller: 'phone' });
  assert.equal(r.ok, true);
  assert.equal(r.state.positionMs, 5000);
});

test('a second stream of the same device replaces the first', () => {
  const { hub, streams, open } = setup();
  const closeOld = open('u1', 'pc');
  const old = streams.pc;
  open('u1', 'pc');
  assert.equal(old.at(-1).event, 'replaced');
  closeOld();   // the old tab's stream ending must not take the new one offline
  assert.equal(hub.list('u1').find((d) => d.id === 'pc').online, true);
});

test('only playing moves lastPlayedAt', () => {
  const { hub, open, tick } = setup();
  open('u1', 'pc');
  hub.report('u1', 'pc', { status: status({ playing: false }), queue: ['m/a.mp3'] });
  assert.equal(hub.list('u1')[0].lastPlayedAt, null);
  hub.report('u1', 'pc', { status: status({ playing: true }) });
  const first = hub.list('u1')[0].lastPlayedAt;
  tick(1000);
  hub.report('u1', 'pc', { status: status({ playing: false }) });
  assert.equal(hub.list('u1')[0].lastPlayedAt, first);
});
