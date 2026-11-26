/**
 * Personal API keys (src/api/api-keys.js): one credential for an own app —
 * making / listing / revoking, what the key reads (the library, media, the
 * device last listened on) and what it is kept off.
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers/server.mjs';

const OWNER = { username: 'owner', password: 'pw-owner-1' };
const OTHER = { username: 'other', password: 'pw-other-1' };

let server;
let ownerJwt;
let otherJwt;
let key;
let keyId;
const call = (method, p, auth, body) => fetch(`${server.baseUrl}${p}`, {
  method,
  headers: {
    'Content-Type': 'application/json',
    ...(auth?.jwt ? { 'x-access-token': auth.jwt } : {}),
    ...(auth?.key ? { 'x-api-key': auth.key } : {}),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const json = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const login = async (u) => (await json(await call('POST', '/api/v1/auth/login', null, u))).body.token;

before(async () => {
  server = await startServer({ dlnaMode: 'disabled', users: [{ ...OWNER, admin: true }, { ...OTHER, admin: false }] });
  ownerJwt = await login(OWNER);
  otherJwt = await login(OTHER);
  const made = await json(await call('POST', '/api/v1/api-keys', { jwt: ownerJwt }, { label: 'Home page' }));
  assert.equal(made.status, 200, JSON.stringify(made.body));
  ({ key, id: keyId } = made.body);
});

after(async () => { if (server) { await server.stop(); } });

describe('API keys', () => {
  test('listed without the secret, and only to their owner', async () => {
    const mine = await json(await call('GET', '/api/v1/api-keys', { jwt: ownerJwt }));
    assert.equal(mine.body.keys.length, 1);
    assert.ok(!JSON.stringify(mine.body).includes(key));
    assert.deepEqual((await json(await call('GET', '/api/v1/api-keys', { jwt: otherJwt }))).body.keys, []);
    assert.equal((await call('DELETE', `/api/v1/api-keys/${keyId}`, { jwt: otherJwt })).status, 404);
  });

  test('reads the library, the media and the device last listened on', async () => {
    const empty = await json(await call('GET', '/api/v1/devices/now', { key }));
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.equal(empty.body.device, null);

    const random = await json(await call('POST', '/api/v1/db/random-songs', { key }, { limit: 1 }));
    assert.equal(random.status, 200, JSON.stringify(random.body));
    const fp = random.body.songs[0].filepath;
    const media = await call('GET', `/media/${fp.split('/').map(encodeURIComponent).join('/')}`, { key });
    assert.equal(media.status, 200);
    await media.arrayBuffer();

    // The owner's phone registers by its first poll, then says what it plays.
    await call('GET', '/api/v1/devices/poll?id=phone-1&name=Phone&type=android&session=sess-1&ack=0', { jwt: ownerJwt });
    await call('POST', '/api/v1/devices/state', { jwt: ownerJwt }, { id: 'phone-1', status: { index: 0, positionMs: 5000, playing: true }, queue: [fp] });
    const now = await json(await call('GET', '/api/v1/devices/now', { key }));
    assert.equal(now.body.device.name, 'Phone');
    assert.equal(now.body.queue.items[0].filepath, fp);
    assert.ok(now.body.device.positionMs >= 5000);
  });

  test('writes nothing and manages nothing', async () => {
    for (const [m, p, body] of [
      ['GET', '/api/v1/api-keys'], ['POST', '/api/v1/api-keys', {}], ['GET', '/api/v1/admin/users'],
      ['POST', '/api/v1/devices/command', { from: 'aaaa', to: 'phone-1', command: 'pause' }],
      ['GET', '/api/v1/devices/guests'], ['POST', '/api/v1/db/rate-song', { filepath: 'x', rating: 1 }],
    ]) {
      assert.equal((await call(m, p, { key }, body)).status, 403, `${m} ${p}`);
    }
  });

  test('an unknown or revoked key is refused', async () => {
    assert.equal((await call('GET', '/api/v1/devices/now', { key: 'mskey_nope' })).status, 401);
    assert.equal((await call('DELETE', `/api/v1/api-keys/${keyId}`, { jwt: ownerJwt })).status, 200);
    assert.equal((await call('GET', '/api/v1/devices/now', { key })).status, 401);
  });
});
