import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, PREFIX, MAX_KEYS_PER_USER } from '../../src/state/api-keys.js';
import { isApiKeyRouteAllowed } from '../../src/api/api-keys.js';
import { currentDevice } from '../../src/state/devices.js';

test('a key works until revoked, and only its hash is stored', () => {
  let saved = [];
  const s = createStore({ save: (l) => { saved = JSON.parse(JSON.stringify(l)); } });
  const made = s.create({ userId: 1, user: 'ann', label: 'Home page' });
  assert.ok(made.key.startsWith(PREFIX));
  assert.ok(!JSON.stringify(saved).includes(made.key));
  assert.deepEqual(createStore({ load: () => saved }).use(made.key), { id: made.id, userId: 1, user: 'ann' });
  assert.equal(s.use(`${made.key}x`), null);
  assert.equal(s.list(1, 'ann')[0].hash, undefined);
  assert.equal(s.revoke(2, 'bob', made.id), false, 'not someone else\'s');
  assert.equal(s.revoke(1, 'ann', made.id), true);
  assert.equal(s.use(made.key), null);
});

test('keys per user are capped', () => {
  const s = createStore();
  for (let i = 0; i < MAX_KEYS_PER_USER; i++) { assert.ok(s.create({ userId: 1, user: 'ann' })); }
  assert.equal(s.create({ userId: 1, user: 'ann' }), null);
  assert.ok(s.create({ userId: 2, user: 'bob' }));
});

test('a key reaches reads only', () => {
  for (const [m, p] of [['GET', '/api/v1/devices/now'], ['GET', '/api/v1/devices/abcd-1/queue'], ['GET', '/media/lib/a.mp3'],
    ['HEAD', '/media/lib/a.mp3'], ['GET', '/album-art/x.jpg'], ['POST', '/api/v1/db/random-songs']]) {
    assert.ok(isApiKeyRouteAllowed(m, p), `${m} ${p}`);
  }
  for (const [m, p] of [['GET', '/api/v1/api-keys'], ['POST', '/api/v1/api-keys'], ['POST', '/api/v1/devices/command'],
    ['GET', '/api/v1/devices/poll'], ['GET', '/api/v1/devices/guests'], ['DELETE', '/api/v1/devices/abcd-1'],
    ['GET', '/api/v1/admin/users'], ['POST', '/media/lib/a.mp3'], ['POST', '/api/v1/file-explorer/upload']]) {
    assert.ok(!isApiKeyRouteAllowed(m, p), `${m} ${p}`);
  }
});

test('the current device is the one playing, else the last that played', () => {
  const d = (id, lastPlayedAt, playing = false, queueLength = 1) => ({ id, lastPlayedAt, playing, queueLength });
  assert.equal(currentDevice([]), null);
  assert.equal(currentDevice([d('a', null), d('b', '2026-01-01', false, 0)]), null);
  assert.equal(currentDevice([d('a', '2026-01-01'), d('b', '2026-01-02')]).id, 'b');
  assert.equal(currentDevice([d('a', '2026-01-01', true), d('b', '2026-01-02')]).id, 'a');
});
