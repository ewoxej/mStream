// Artists of the library as the Zenelo app counts them (its library/ArtistSplitter.kt
// and Library.artistsOf): each track by its album artist, else its artist tag, and a
// tag naming several artists ("A; B", "A / B", "A, B") counts for each name. The
// server splits on fewer delimiters (" / ", "feat.", "; "), so the pages build their
// artists here from the All tracks list. Separators and the names never cut
// ("AC/DC") are settings (store.js `artistSeparators` / `artistExceptions`).

export const DEFAULT_SEPARATORS = [';', '/', ','];
export const DEFAULT_EXCEPTIONS = ['AC/DC', 'Earth, Wind & Fire', 'Tyler, the Creator'];

/** An artist's key (route, grouping): the name, trimmed and lowercased. */
export const artistKey = (name) => String(name || '').trim().toLowerCase();

const isWord = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/**
 * Splits an artist tag into names. Separators match ignoring case; one that starts
 * or ends with a letter or digit ("feat.", "x") only matches as a whole word, so
 * "x" doesn't cut "Xzibit". [exceptions] are never cut.
 */
export function splitArtists(value, separators = DEFAULT_SEPARATORS, exceptions = DEFAULT_EXCEPTIONS) {
  const text = String(value || '').trim();
  if (!text) { return []; }
  const seps = [...new Set(separators.map((s) => s.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!seps.length) { return [text]; }
  const lower = text.toLowerCase();
  const keep = new Array(text.length).fill(false);
  for (const name of exceptions.map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + name.length)) {
      for (let i = at; i < at + name.length; i++) { keep[i] = true; }
    }
  }
  const matchesAt = (at, sep) => {
    if (lower.substr(at, sep.length) !== sep.toLowerCase()) { return false; }
    if (isWord(sep[0]) && isWord(text[at - 1])) { return false; }
    if (isWord(sep[sep.length - 1]) && isWord(text[at + sep.length])) { return false; }
    for (let i = at; i < at + sep.length; i++) { if (keep[i]) { return false; } }
    return true;
  };
  const parts = [];
  let start = 0;
  for (let i = 0; i < text.length;) {
    const sep = keep[i] ? null : seps.find((s) => matchesAt(i, s));
    if (!sep) { i++; continue; }
    parts.push(text.slice(start, i));
    i += sep.length;
    start = i;
  }
  parts.push(text.slice(start));
  const seen = new Set();
  return parts.map((p) => p.trim()).filter((p) => {
    const k = artistKey(p);
    if (!p || seen.has(k)) { return false; }
    seen.add(k);
    return true;
  });
}

/** The tag a track counts under: its album artist, else its artist as written. */
export function artistTag(track) {
  const m = track?.metadata || {};
  const albumArtist = String(m['album-artist'] || '').trim();
  return albumArtist || m['artist-display'] || m.artist || '';
}

/**
 * Artists of [tracks]: key → { key, name, tracks, albums (album keys), art }. The name
 * shown is one spelling of the key (the same one whatever the order).
 */
export function artistIndex(tracks, separators, exceptions) {
  const byKey = new Map();
  for (const t of tracks || []) {
    for (const name of splitArtists(artistTag(t), separators, exceptions)) {
      const key = artistKey(name);
      let a = byKey.get(key);
      if (!a) { a = { key, name, tracks: [], albums: new Set(), art: null }; byKey.set(key, a); }
      if (name > a.name) { a.name = name; }
      a.tracks.push(t);
      if (t.metadata?.album) { a.albums.add(albumKey(t)); }
      if (!a.art && t.metadata?.['album-art']) { a.art = t.metadata['album-art']; }
    }
  }
  return byKey;
}

/** One album of the library: its name with its album artist, else its (primary) artist. */
const albumArtistOf = (t) => t.metadata?.['album-artist'] || t.metadata?.artist || null;
export const albumKey = (t) => `${artistKey(t.metadata?.album)}|${artistKey(albumArtistOf(t))}`;

/**
 * An artist's albums from its tracks: { name, album_artist, year, album_art_file,
 * track_count } (the server's album shape, so AlbumTile takes them), by name. An
 * album without an album artist tag is opened by its first track's artist (the
 * server narrows a named album by it).
 */
export function albumsOf(tracks) {
  const byKey = new Map();
  for (const t of tracks || []) {
    const m = t.metadata || {};
    if (!m.album) { continue; }
    const k = albumKey(t);
    let a = byKey.get(k);
    if (!a) { a = { name: m.album, album_artist: albumArtistOf(t), year: null, album_art_file: null, track_count: 0 }; byKey.set(k, a); }
    a.track_count++;
    a.year = a.year || m.year || null;
    a.album_art_file = a.album_art_file || m['album-art'] || null;
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** An artist's tracks in album order: by album, disc, track number, then path. */
export function artistTrackOrder(a, b) {
  const ma = a.metadata || {};
  const mb = b.metadata || {};
  return (!ma.album - !mb.album)
    || String(ma.album || '').localeCompare(String(mb.album || ''), undefined, { sensitivity: 'base' })
    || (ma.disk || 1) - (mb.disk || 1)
    || (ma.track ?? Infinity) - (mb.track ?? Infinity)
    || String(a.filepath).localeCompare(String(b.filepath));
}
