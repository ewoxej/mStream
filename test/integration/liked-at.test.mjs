/**
 * When a track was liked (user_metadata.liked_at, src/db/fork-schema.js):
 * set by rate-song when the rating becomes > 0, kept across re-rates,
 * cleared with the like; db/rated lists the newest like first and carries
 * `likedAt` per row.
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from '../helpers/server.mjs';

const ADMIN = { username: 'admin', password: 'pw-admin-1' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server;
let jwt;
let dbPath;
let vpath;

function withDb(fn) {
  const db = new DatabaseSync(dbPath);
  try { return fn(db); } finally { db.close(); }
}

before(async () => {
  server = await startServer({ dlnaMode: 'disabled', users: [{ ...ADMIN, admin: true }] });
  const loginR = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN),
  });
  jwt = (await loginR.json()).token;
  const found = fs.readdirSync(server.tmpDir, { recursive: true })
    .find((f) => String(f).endsWith('.db') && !String(f).includes('-wal'));
  dbPath = path.join(server.tmpDir, String(found));
  vpath = withDb((db) => db.prepare('SELECT name FROM libraries LIMIT 1').get().name);
});

after(async () => { if (server) { await server.stop(); } });

const post = (p, body) => fetch(`${server.baseUrl}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-access-token': jwt }, body: JSON.stringify(body),
});
const rate = async (t, rating) => {
  const r = await post('/api/v1/db/rate-song', { filepath: `${vpath}/${t.filepath}`, rating });
  assert.equal(r.status, 200, await r.text());
};
const likedAt = (t) => withDb((db) => db.prepare('SELECT liked_at FROM user_metadata WHERE track_hash = ?')
  .get(t.audio_hash || t.file_hash)?.liked_at ?? null);
const rated = async () => (await (await post('/api/v1/db/rated', {})).json());

describe('liked_at', () => {
  test('a like is dated, a re-rate keeps the date, an unlike clears it; db/rated is newest first', async () => {
    const [a, b] = withDb((db) => db.prepare(
      'SELECT filepath, file_hash, audio_hash FROM tracks WHERE file_hash IS NOT NULL ORDER BY id LIMIT 2').all());
    assert.ok(a && b, 'two tracks in the fixture library');

    await rate(a, 10);
    const first = likedAt(a);
    assert.match(first || '', /^\d{4}-\d\d-\d\dT/, 'liked_at set on the like');
    await sleep(20);
    await rate(b, 10);

    let list = await rated();
    assert.deepEqual(list.slice(0, 2).map((r) => r.filepath), [`${vpath}/${b.filepath}`, `${vpath}/${a.filepath}`], 'newest like first');
    assert.equal(list.find((r) => r.filepath === `${vpath}/${a.filepath}`).likedAt, first, 'rows carry likedAt');

    await sleep(20);
    await rate(a, 8);
    assert.equal(likedAt(a), first, 'a re-rate is not a new like');

    await rate(a, null);
    assert.equal(likedAt(a), null, 'cleared with the like');
    list = await rated();
    assert.ok(!list.some((r) => r.filepath === `${vpath}/${a.filepath}`));

    await rate(a, 10);
    assert.ok(likedAt(a) > first, 'liked again: a new date');
  });
});
