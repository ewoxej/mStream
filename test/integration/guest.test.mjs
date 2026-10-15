/**
 * Play on's guest access (src/api/guest.js): a link the owner makes for one
 * of their devices lets someone without an account see what plays and the
 * queue, search the owner's libraries and send the device commands — and
 * nothing else. Covered: making / listing / revoking links, the guest's
 * view, search, commands reaching the device (queueing checked against the
 * library), the guest kept off every other route, revoked and unknown links.
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/server.mjs';

const OWNER = { username: 'owner', password: 'pw-owner-1' };
const OTHER = { username: 'other', password: 'pw-other-1' };

let server;
let ownerJwt;
let otherJwt;
const call = (method, p, token, body) => fetch(`${server.baseUrl}${p}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { 'x-access-token': token } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const json = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });

// A device of the owner's: registered by its first poll; `next()` reads its events.
function device(token, id, name) {
  let cursor = 0;
  const poll = async () => {
    const r = await json(await call('GET', `/api/v1/devices/poll?id=${id}&name=${encodeURIComponent(name)}&type=web&session=s-${id}&ack=${cursor}`, token));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    cursor = r.body.cursor;
    return r.body.events;
  };
  return {
    id,
    poll,
    // The next command the device is sent.
    async command() {
      for (let i = 0; i < 5; i++) {
        const c = (await poll()).find((e) => e.event === 'command');
        if (c) { return c.data; }
      }
      throw new Error('no command');
    },
    report: (status, queue) => call('POST', '/api/v1/devices/state', token, { id, status, queue }),
  };
}

let speaker;
let link;
let paths;

before(async () => {
  server = await startServer({ dlnaMode: 'disabled', users: [{ ...OWNER, admin: true }, { ...OTHER, admin: false }] });
  ownerJwt = (await json(await call('POST', '/api/v1/auth/login', null, OWNER))).body.token;
  otherJwt = (await json(await call('POST', '/api/v1/auth/login', null, OTHER))).body.token;
  speaker = device(ownerJwt, 'speaker-1', 'Living room');
  await speaker.poll();
  const found = await json(await call('POST', '/api/v1/db/search', ownerJwt, { search: 'Icarus', noArtists: true, noAlbums: true, noTitles: true, noLyrics: true }));
  paths = found.body.files.map((t) => t.filepath).sort();
  assert.ok(paths.length >= 3, JSON.stringify(found.body));
  await speaker.report({ index: 1, positionMs: 1000, playing: true, volume: 70, track: { filepath: paths[1], title: 'Rise' } }, paths);
});

after(async () => { if (server) { await server.stop(); } });

describe('guest links', () => {
  test('the owner makes one for a device; it is listed with its token; others don\'t see it', async () => {
    assert.equal((await call('POST', '/api/v1/devices/guests', ownerJwt, { device: 'nope-1' })).status, 404, 'an unknown device');
    assert.equal((await call('POST', '/api/v1/devices/guests', ownerJwt, { device: speaker.id, duration: '2w' })).status, 400);
    const made = await json(await call('POST', '/api/v1/devices/guests', ownerJwt, { device: speaker.id, duration: '12h', label: 'Party' }));
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.ok(made.body.token && made.body.expiresAt);
    link = made.body;
    const listed = (await json(await call('GET', '/api/v1/devices/guests', ownerJwt))).body.links;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].deviceName, 'Living room');
    assert.equal(listed[0].label, 'Party');
    assert.equal(listed[0].token, link.token, 'the same token every time: the owner can show the code again');
    assert.deepEqual((await json(await call('GET', '/api/v1/devices/guests', otherJwt))).body.links, []);
  });

  test('the owner gets the QR code of a link (for apps without an encoder)', async () => {
    const r = await json(await call('POST', '/api/v1/devices/guests/qr', ownerJwt, { text: `http://example.test/guest/#${link.token}` }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.size >= 21);
    assert.equal(r.body.modules.length, r.body.size * r.body.size);
    assert.match(r.body.modules, /^[01]+$/);
    assert.equal(r.body.modules.slice(0, 7), '1111111', 'a finder pattern in the corner');
    assert.equal((await call('POST', '/api/v1/devices/guests/qr', link.token, { text: 'x' })).status, 403, 'not for guests');
  });

  test('the guest sees the device and the queue around the playing track', async () => {
    const r = await json(await call('GET', '/api/v1/guest', link.token));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.device.name, 'Living room');
    assert.equal(r.body.device.online, true);
    assert.equal(r.body.device.playing, true);
    assert.equal(r.body.queue.total, paths.length);
    assert.equal(r.body.queue.index, 1);
    assert.equal(r.body.queue.items[1].filepath, paths[1]);
    assert.equal(r.body.queue.items[1].artist, 'Icarus', 'with the tags');
  });

  test('search covers the owner\'s libraries', async () => {
    const r = await json(await call('POST', '/api/v1/guest/search', link.token, { search: 'Highway' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.tracks[0].title, 'Highway');
    assert.equal(r.body.tracks[0].artist, 'Vosto');
  });

  test('commands reach the device as from a device; queueing only takes library tracks', async () => {
    const send = (command, args) => call('POST', '/api/v1/guest/command', link.token, { command, args });
    assert.equal((await send('next')).status, 200);
    assert.deepEqual(await speaker.command(), { from: `guest-${link.id}`, command: 'next', args: null });

    assert.equal((await send('enqueue', { paths: [paths[0], 'testlib/../../etc/passwd'], next: true })).status, 200);
    assert.deepEqual((await speaker.command()).args, { paths: [paths[0]], next: true }, 'the stranger path dropped');
    assert.equal((await send('enqueue', { paths: ['testlib/nope.mp3'] })).status, 404);

    assert.equal((await send('remove', { index: 2, path: paths[2] })).status, 200);
    assert.deepEqual((await speaker.command()).args, { index: 2, path: paths[2] });
    assert.equal((await send('setVolume', { volume: 140 })).status, 400);
    assert.equal((await send('setShuffle', { shuffle: true })).status, 400, 'not a guest command');
    assert.equal((await send('takeover', {})).status, 400);
  });

  test('the guest reaches nothing else', async () => {
    for (const [method, p, body] of [
      ['GET', '/api/v1/devices'], ['POST', '/api/v1/db/search', { search: 'x' }], ['GET', '/api/v1/devices/guests'],
      ['POST', '/api/v1/devices/guests', { device: speaker.id }], ['GET', '/api/'], ['POST', '/api/v1/playlist/getall', {}],
      ['GET', `/media/${paths[0]}`], ['POST', '/api/v1/devices/command', { from: 'x-1234', to: speaker.id, command: 'next' }],
    ]) {
      const r = await call(method, p, link.token, body);
      assert.equal(r.status, 403, `${method} ${p} answered ${r.status}`);
    }
  });

  test('an offline device: the guest is told', async () => {
    const other = device(ownerJwt, 'phone-1', 'Phone');
    await other.poll();
    const l = (await json(await call('POST', '/api/v1/devices/guests', ownerJwt, { device: other.id, duration: '1h' }))).body;
    const st = (await json(await call('GET', '/api/v1/guest', l.token))).body;
    assert.equal(st.device.name, 'Phone');
    assert.equal(st.queue.total, 0);
    await call('DELETE', `/api/v1/devices/guests/${l.id}`, ownerJwt);
  });

  test('revoked or unknown, the link is over', async () => {
    assert.equal((await call('DELETE', `/api/v1/devices/guests/${link.id}`, otherJwt)).status, 404, 'not theirs to revoke');
    assert.equal((await call('DELETE', `/api/v1/devices/guests/${link.id}`, ownerJwt)).status, 200);
    assert.equal((await call('GET', '/api/v1/guest', link.token)).status, 401);
    assert.equal((await call('GET', '/api/v1/guest', ownerJwt)).status, 403, 'and the guest routes are for guests');
  });
});
