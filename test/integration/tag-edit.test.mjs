/**
 * Editing tags (src/api/tags.js): the file gets the new tags, the rest stays
 * (the audio, other tags), the library shows them after its rescan, a rating
 * survives (the scanner moves it to the new hash), and a user without file
 * modification can't.
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../helpers/server.mjs';
import { metadataArgs } from '../../src/api/tags.js';

const FORMATS = [['.mp3', ''], ['.flac', 'flac'], ['.m4a', 'aac'], ['.ogg', 'libvorbis'], ['.opus', 'libopus']];
const ADMIN = { username: 'admin', password: 'pw-admin-1' };
const GUEST = { username: 'reader', password: 'pw-reader-1' };
let server;
let lib;
let token;
let readerToken;
const call = (p, body, t = token) => fetch(`${server.baseUrl}${p}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-access-token': t }, body: JSON.stringify(body),
});

function firstTrack(dir, ext) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const f = firstTrack(p, ext); if (f) { return f; } } else if (e.name.toLowerCase().endsWith(ext)) { return p; }
  }
  return null;
}

async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) { return v; }
    if (Date.now() > end) { return v; }
    await new Promise((r) => setTimeout(r, 250));
  }
}

before(async () => {
  // A copy to edit: the shared fixtures stay as they are.
  lib = fs.mkdtempSync(path.join(os.tmpdir(), 'mstream-tags-'));
  const { ensureFixtures } = await import('../helpers/fixtures.mjs');
  const music = await ensureFixtures();
  fs.copyFileSync(firstTrack(music, '.mp3'), path.join(lib, 'song.mp3'));
  // The other formats made from it (3 s, tagged), with the pinned ffmpeg.
  const ffmpeg = path.resolve('bin/ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  for (const [ext, codec] of FORMATS) {
    if (ext === '.mp3' || !fs.existsSync(ffmpeg)) { continue; }
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', path.join(lib, 'song.mp3'), '-t', '3', '-vn', '-c:a', codec,
      '-metadata', 'artist=Fixture Artist', '-metadata', 'album=Fixture Album', path.join(lib, `song${ext}`)]);
  }
  server = await startServer({
    dlnaMode: 'disabled',
    extraFolders: { edit: lib },
    users: [{ ...ADMIN, admin: true, vpaths: ['testlib', 'edit'] }, { ...GUEST, vpaths: ['edit'] }],
  });
  token = (await (await call('/api/v1/auth/login', ADMIN, '')).json()).token;
  readerToken = (await (await call('/api/v1/auth/login', GUEST, '')).json()).token;
  // The library has the copies.
  await until(async () => (await (await call('/api/v1/db/metadata', { filepath: 'edit/song.mp3' })).json()).metadata);
});
after(async () => {
  if (server) { await server.stop(); }
  fs.rmSync(lib, { recursive: true, force: true });
});

describe('tag editing', () => {
  test('metadataArgs: only the given keys, mapped, one line each', () => {
    assert.deepEqual(metadataArgs({ title: 'A\nB', albumArtist: 'X', year: '', track: '3/12' }), [
      '-metadata', 'title=A B', '-metadata', 'album_artist=X', '-metadata', 'track=3/12', '-metadata', 'date=',
    ]);
    assert.deepEqual(metadataArgs({ title: 'T' }, '.opus'), ['-metadata:s:a:0', 'title=T']);
  });

  test('ping says the user may edit tags', async () => {
    const ping = await (await fetch(`${server.baseUrl}/api/v1/ping`, { headers: { 'x-access-token': token } })).json();
    assert.equal(ping.tagEdit, true);
  });

  for (const [ext] of FORMATS) {
    test(`${ext}: written, read back, other tags and the length kept, in the library, rating kept`, async (t) => {
      const filepath = `edit/song${ext}`;
      if (!fs.existsSync(path.join(lib, `song${ext}`))) { t.skip(`no ${ext} (no ffmpeg)`); return; }
      const before = await (await call('/api/v1/tags/read', { filepath })).json();
      assert.equal(before.editable, true);
      const rated = await call('/api/v1/db/rate-song', { filepath, rating: 8 });
      assert.equal(rated.status, 200, await rated.text());
      const size = fs.statSync(path.join(lib, `song${ext}`)).size;

      const res = await call('/api/v1/tags/write', { filepath, tags: { title: 'Edited Title', albumArtist: 'Some Band', track: '7/9', year: '1999' } });
      assert.equal(res.status, 200, await res.clone().text());
      const after = (await res.json()).tags;
      assert.equal(after.title, 'Edited Title');
      assert.equal(after.albumArtist, 'Some Band');
      assert.equal(after.track, '7/9');
      assert.equal(after.year, '1999');
      // Untouched ones stay.
      assert.equal(after.artist, before.tags.artist);
      assert.equal(after.album, before.tags.album);
      assert.ok(Math.abs(fs.statSync(path.join(lib, `song${ext}`)).size - size) < 64 * 1024, 'the audio is copied, not re-encoded');
      assert.deepEqual(fs.readdirSync(lib).filter((f) => f.includes('.tmp_tags')), [], 'no temp file left');

      const meta = await until(async () => {
        const m = (await (await call('/api/v1/db/metadata', { filepath })).json()).metadata;
        return m && m.title === 'Edited Title' ? m : null;
      });
      assert.ok(meta, 'the library has the new title');
      assert.equal(meta.rating, 8, 'the rating followed the file');
    });
  }

  test('a removed tag goes', async () => {
    const res = await call('/api/v1/tags/write', { filepath: 'edit/song.mp3', tags: { albumArtist: '' } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).tags.albumArtist, '');
  });

  test('bad values and unknown files are refused', async () => {
    assert.equal((await call('/api/v1/tags/write', { filepath: 'edit/song.mp3', tags: { track: 'seven' } })).status, 400);
    assert.equal((await call('/api/v1/tags/write', { filepath: 'edit/song.mp3', tags: {} })).status, 400);
    assert.equal((await call('/api/v1/tags/write', { filepath: 'edit/missing.mp3', tags: { title: 'x' } })).status, 404);
  });

  test('without file modification: no editing', async () => {
    const off = await fetch(`${server.baseUrl}/api/v1/admin/users/access`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-access-token': token },
      body: JSON.stringify({ username: GUEST.username, admin: false, allowMkdir: true, allowUpload: true, allowFileModify: false }),
    });
    assert.equal(off.status, 200, await off.text());
    const ping = await (await fetch(`${server.baseUrl}/api/v1/ping`, { headers: { 'x-access-token': readerToken } })).json();
    assert.equal(ping.tagEdit, false);
    const res = await call('/api/v1/tags/write', { filepath: 'edit/song.mp3', tags: { title: 'Nope' } }, readerToken);
    assert.equal(res.status, 403);
  });
});
