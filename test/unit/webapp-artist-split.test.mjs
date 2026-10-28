/**
 * webapp/app/artist-split.js — the web player's artists, counted as the Zenelo app
 * counts them (its ArtistSplitterTest has the same cases).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitArtists, artistIndex, albumsOf, artistTrackOrder } from '../../webapp/app/artist-split.js';

test('splits on the default separators', () => {
  assert.deepEqual(splitArtists('A; B / C,D'), ['A', 'B', 'C', 'D']);
});

test('one artist, blank values', () => {
  assert.deepEqual(splitArtists('  Radiohead '), ['Radiohead']);
  assert.deepEqual(splitArtists(null), []);
  assert.deepEqual(splitArtists(' ; '), []);
});

test('the names never split stay whole', () => {
  assert.deepEqual(splitArtists('AC/DC; Ozzy'), ['AC/DC', 'Ozzy']);
  assert.deepEqual(splitArtists('earth, wind & fire'), ['earth, wind & fire']);
  assert.deepEqual(splitArtists('Tyler, the Creator / Frank Ocean'), ['Tyler, the Creator', 'Frank Ocean']);
});

test('no separators, no split', () => {
  assert.deepEqual(splitArtists('A; B', [], []), ['A; B']);
});

test('word separators match whole words, ignoring case', () => {
  const s = (v) => splitArtists(v, ['feat.', 'x', '&'], []);
  assert.deepEqual(s('A Feat. B'), ['A', 'B']);
  assert.deepEqual(s('Defeat. B'), ['Defeat. B']);
  assert.deepEqual(s('Xzibit x Dr. Dre'), ['Xzibit', 'Dr. Dre']);
  assert.deepEqual(s('A&B'), ['A', 'B']);
  assert.deepEqual(splitArtists('Святослав x Вера', ['x'], []), ['Святослав', 'Вера']);
});

test('the longer separator wins', () => {
  assert.deepEqual(splitArtists('A // B', ['/', '//'], []), ['A', 'B']);
});

test('duplicates ignoring case', () => {
  assert.deepEqual(splitArtists('A; a; B'), ['A', 'B']);
});

const track = (filepath, m) => ({ filepath, metadata: m });

test('each name of a tag counts; the album artist tag comes first', () => {
  const rows = artistIndex([
    track('1', { 'artist-display': 'A; B', artist: 'A', album: 'x', 'album-art': 'a.jpg' }),
    track('2', { artist: 'b', album: 'y' }),
    track('3', { artist: 'ignored', 'album-artist': 'C', album: 'z' }),
  ]);
  assert.deepEqual([...rows.keys()].sort(), ['a', 'b', 'c']);
  assert.equal(rows.get('b').tracks.length, 2);
  assert.equal(rows.get('b').albums.size, 2);
  assert.equal(rows.get('b').name, 'b');
  assert.equal(rows.get('a').art, 'a.jpg');
  assert.equal(rows.has('ignored'), false);
});

test('albums of an artist, and its tracks in album order', () => {
  const tracks = [
    track('m/b2', { album: 'Beta', artist: 'A', track: 2, year: 2020 }),
    track('m/s', { artist: 'A' }),
    track('m/a1', { album: 'Alpha', 'album-artist': 'A', artist: 'A', track: 1, 'album-art': 'al.jpg' }),
    track('m/b1', { album: 'Beta', 'album-artist': 'A', artist: 'A feat. B', track: 1 }),
  ];
  assert.deepEqual(albumsOf(tracks), [
    { name: 'Alpha', album_artist: 'A', year: null, album_art_file: 'al.jpg', track_count: 1 },
    { name: 'Beta', album_artist: 'A', year: 2020, album_art_file: null, track_count: 2 },
  ]);
  assert.deepEqual([...tracks].sort(artistTrackOrder).map((t) => t.filepath), ['m/a1', 'm/b1', 'm/b2', 'm/s']);
});
