/**
 * webapp/app/m3u.js — M3U playlists in and out of the web player: parsing,
 * matching entries written elsewhere to library tracks, writing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseM3u, entrySegments, resolveM3u, toM3u } from '../../webapp/app/m3u.js';

const lib = [
  { filepath: 'music/Pink Floyd/Wish You Were Here/01 Shine On.flac', metadata: { artist: 'Pink Floyd', title: 'Shine On You Crazy Diamond', duration: 811.4 } },
  { filepath: 'music/Pink Floyd/Animals/01.flac', metadata: { artist: 'Pink Floyd', title: 'Pigs on the Wing 1' } },
  { filepath: 'music/Low Tide/Signals/01.flac', metadata: { artist: 'Low Tide', title: 'Signals' } },
  { filepath: 'music1/Свидригайлов/292. Тыдыды.mp3', metadata: { artist: 'Святослав', title: 'Тыдыды' } },
];

test('parses #EXTINF and paths, skips comments, BOM and blank lines', () => {
  const e = parseM3u('\uFEFF#EXTM3U\r\n#EXTINF:811,Pink Floyd - Shine On\r\nD:\\Music\\a.flac\r\n\r\n# a note\r\n/x/b.mp3\r\n');
  assert.deepEqual(e, [
    { path: 'D:\\Music\\a.flac', artist: 'Pink Floyd', title: 'Shine On', duration: 811 },
    { path: '/x/b.mp3', artist: '', title: '', duration: null },
  ]);
});

test('entry paths: URLs cut to the library path, Windows and relative paths cleaned', () => {
  assert.deepEqual(entrySegments('https://m.example/media/music/Low%20Tide/Signals/01.flac?token=x'), ['music', 'Low Tide', 'Signals', '01.flac']);
  assert.deepEqual(entrySegments('C:\\Users\\me\\Music\\Low Tide\\01.flac'), ['Users', 'me', 'Music', 'Low Tide', '01.flac']);
  assert.deepEqual(entrySegments('../Signals/./01.flac'), ['Signals', '01.flac']);
  assert.deepEqual(entrySegments('file:///home/me/x.mp3'), ['home', 'me', 'x.mp3']);
});

test('matches by library path, by the shortest unique tail, then by artist and title', () => {
  const entries = parseM3u([
    '#EXTM3U',
    'music/Pink Floyd/Animals/01.flac',                    // exact
    '/storage/emulated/0/Music/Low Tide/Signals/01.flac',  // tail: 01.flac alone is ambiguous, Signals/01.flac is not
    'D:\\Rips\\Wish You Were Here\\01 Shine On.flac',       // unique file name
    '#EXTINF:120,Святослав - Тыдыды',
    'somewhere/else/renamed.mp3',                          // by EXTINF
    '#EXTINF:-1,Nobody - Nothing',
    'gone/01.flac',                                        // ambiguous and no label match
  ].join('\n'));
  const r = resolveM3u(entries, lib);
  assert.deepEqual(r.tracks.map((t) => t.filepath), [
    'music/Pink Floyd/Animals/01.flac',
    'music/Low Tide/Signals/01.flac',
    'music/Pink Floyd/Wish You Were Here/01 Shine On.flac',
    'music1/Свидригайлов/292. Тыдыды.mp3',
  ]);
  assert.deepEqual(r.missing.map((e) => e.path), ['gone/01.flac']);
});

test('case-insensitive, duplicates kept in order', () => {
  const r = resolveM3u(parseM3u('MUSIC/low tide/signals/01.FLAC\nmusic/Low Tide/Signals/01.flac\n'), lib);
  assert.equal(r.tracks.length, 2);
  assert.equal(r.tracks[0], r.tracks[1]);
});

test('writes M3U8 that reads back to the same tracks', () => {
  const text = toM3u(lib);
  assert.ok(text.startsWith('#EXTM3U\n#EXTINF:811,Pink Floyd - Shine On You Crazy Diamond\nmusic/Pink Floyd/Wish You Were Here/01 Shine On.flac\n'));
  assert.ok(text.includes('#EXTINF:-1,Pink Floyd - Pigs on the Wing 1\n'), 'unknown length is -1');
  const back = resolveM3u(parseM3u(text), lib);
  assert.deepEqual(back.tracks, lib);
  assert.equal(back.missing.length, 0);
});
