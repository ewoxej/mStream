/**
 * src/state/guest-links.js — Play on's guest links: made for a while or
 * until revoked, per user, kept across restarts (the save / load callbacks).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, MAX_LINKS_PER_USER } from '../../src/state/guest-links.js';

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('a link lives for its duration; "never" until revoked', () => {
  const c = clock();
  const s = createStore({ now: c.now });
  const hour = s.create({ user: 'ann', device: 'dev-1', duration: '1h' });
  const forever = s.create({ user: 'ann', device: 'dev-1', duration: 'never' });
  assert.equal(forever.expiresAt, null);
  assert.ok(s.get(hour.id));
  c.advance(3600e3 + 1);
  assert.equal(s.get(hour.id), null, 'expired');
  assert.deepEqual(s.list('ann').map((l) => l.id), [forever.id], 'and gone from the list');
  c.advance(365 * 24 * 3600e3);
  assert.ok(s.get(forever.id));
  assert.throws(() => s.create({ user: 'ann', device: 'dev-1', duration: '3d' }));
});

test('revoking is the owner\'s; lists are per user', () => {
  const s = createStore();
  const a = s.create({ user: 'ann', device: 'dev-1' });
  s.create({ user: 'bob', device: 'dev-2' });
  assert.equal(s.revoke('bob', a.id), false);
  assert.ok(s.get(a.id));
  assert.equal(s.revoke('ann', a.id), true);
  assert.equal(s.get(a.id), null);
  assert.equal(s.list('ann').length, 0);
  assert.equal(s.list('bob').length, 1);
});

test('too many: the oldest goes', () => {
  const c = clock();
  const s = createStore({ now: c.now });
  const first = s.create({ user: 'ann', device: 'dev-1', duration: 'never' });
  for (let i = 1; i < MAX_LINKS_PER_USER; i++) { c.advance(1); s.create({ user: 'ann', device: 'dev-1', duration: 'never' }); }
  c.advance(1);
  s.create({ user: 'ann', device: 'dev-1', duration: 'never' });
  assert.equal(s.list('ann').length, MAX_LINKS_PER_USER);
  assert.equal(s.get(first.id), null);
});

test('kept across restarts; a damaged file starts empty', () => {
  let saved = null;
  const s = createStore({ save: (l) => { saved = JSON.parse(JSON.stringify(l)); } });
  const a = s.create({ user: 'ann', device: 'dev-1', label: 'Party' });
  const again = createStore({ load: () => saved });
  assert.equal(again.get(a.id).label, 'Party');
  assert.equal(createStore({ load: () => { throw new Error('bad json'); } }).list('ann').length, 0);
  assert.equal(createStore({ load: () => [{ nope: 1 }, null] }).list('ann').length, 0);
});
