/**
 * An upload goes into the library at once (src/api/file-explorer.js): the
 * answer waits until the file is written, and the folder it landed in is
 * scanned, so the new track can be liked (ratings key on the indexed track)
 * and found right away — before, it had no row until the next full scan,
 * and a like was a 404.
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../helpers/server.mjs';

const ADMIN = { username: 'admin', password: 'pw-admin-1' };
let server;
let token;
const json = (p, body) => fetch(`${server.baseUrl}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-access-token': token }, body: JSON.stringify(body),
});

before(async () => {
  server = await startServer({ dlnaMode: 'disabled', users: [{ ...ADMIN, admin: true }] });
  token = (await (await json('/api/v1/auth/login', ADMIN)).json()).token;
});
after(async () => { if (server) { await server.stop(); } });

function anyTrack(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const f = anyTrack(p); if (f) { return f; } } else if (/\.(mp3|flac|ogg|m4a)$/i.test(e.name)) { return p; }
  }
  return null;
}

describe('uploads', () => {
  test('an uploaded track is indexed at once: it can be liked', async () => {
    const src = anyTrack(server.musicDir);
    assert.ok(src, 'a fixture track to upload');
    const name = `uploaded${path.extname(src)}`;
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(src)]), name);
    const up = await fetch(`${server.baseUrl}/api/v1/file-explorer/upload`, {
      method: 'POST', headers: { 'x-access-token': token, 'data-location': 'testlib/Uploads' }, body: form,
    });
    assert.equal(up.status, 200, await up.text());
    assert.equal(fs.statSync(path.join(server.musicDir, 'Uploads', name)).size, fs.statSync(src).size, 'written whole before the answer');

    const filepath = `testlib/Uploads/${name}`;
    let status = 0;
    for (let i = 0; i < 40 && status !== 200; i++) {
      status = (await json('/api/v1/db/rate-song', { filepath, rating: 10 })).status;
      if (status !== 200) { await new Promise((r) => setTimeout(r, 250)); }
    }
    assert.equal(status, 200, 'liked within 10 s of the upload');
    const meta = await (await json('/api/v1/db/metadata', { filepath })).json();
    assert.equal(meta.metadata.rating, 10);
  });
});
