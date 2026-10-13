// Library reads, cached for the session. Screens call these; a scan or a
// playlist edit invalidates the relevant cache.
import { app } from './store.js';
import { server } from './util.js';

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) {
    const p = fn().catch((err) => { cache.delete(key); throw err; });
    cache.set(key, p);
  }
  return cache.get(key);
}
export function invalidate(prefix) {
  [...cache.keys()].forEach((k) => { if (k.startsWith(prefix)) { cache.delete(k); } });
}

async function post(path, body) {
  const s = server();
  const res = await fetch(s.host + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-access-token': s.token },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) { const e = new Error(`${path} ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

export const albums = () => cached('albums', async () => (await MSTREAMAPI.albums({})).albums || []);
export const artists = () => cached('artists', async () => (await MSTREAMAPI.artists({})).artists || []);
export const genres = () => cached('genres', async () => (await MSTREAMAPI.genres({})).genres || []);

export const albumSongs = (album, albumArtist) => cached(`album:${album}|${albumArtist}`, () => {
  const body = { album };
  if (albumArtist) { body.album_artist = albumArtist; }
  return MSTREAMAPI.albumSongs(body);
});
export const artistAlbums = (artist) => cached(`artist:${artist}`, async () => (await MSTREAMAPI.artistAlbums({ artist })).albums || []);
export const genreSongs = (genre) => cached(`genre:${genre}`, () => MSTREAMAPI.genreSongs({ genre }));

export const liked = () => cached('liked', () => MSTREAMAPI.getRated());
export const recentlyPlayed = (limit = 200) => cached(`recent:${limit}`, () => MSTREAMAPI.getRecentlyPlayed(limit));
export const recentlyAdded = (limit = 60) => cached(`added:${limit}`, () => MSTREAMAPI.getRecentlyAdded(limit));

// Every track, paged by the server (POST /api/v1/db/songs).
export const songsPage = (opts) => post('api/v1/db/songs', opts);
export const allSongs = () => cached('songs:all', async () => {
  const out = [];
  let offset = 0;
  for (;;) {
    const page = await songsPage({ sort: 'title', dir: 'asc', offset, limit: 1000 });
    out.push(...page.songs);
    offset += page.songs.length;
    if (!page.songs.length || offset >= page.total) { return out; }
  }
});

export const search = (q) => MSTREAMAPI.search({ search: q });
// File-path matches only (the folder browser's search over sub-folders).
export const searchFiles = async (q) => (await MSTREAMAPI.search({ search: q, noArtists: true, noAlbums: true, noTitles: true })).files || [];

// ── Playlists ───────────────────────────────────────────────────────────

export async function refreshPlaylists() {
  invalidate('playlists');
  const list = await cached('playlists', () => MSTREAMAPI.getAllPlaylists());
  app.set({ playlists: list.map((p) => p.name) });
  return list;
}
export const playlistSongs = (name) => cached(`pl:${name}`, () => MSTREAMAPI.loadPlaylist(name));

export async function addToPlaylist(name, tracks) {
  for (const t of tracks) { await MSTREAMAPI.addToPlaylist(name, t.filepath); }
  invalidate(`pl:${name}`);
}
export async function createPlaylist(name, tracks = []) {
  await MSTREAMAPI.savePlaylist(name, tracks.map((t) => t.filepath));
  invalidate(`pl:${name}`);
  await refreshPlaylists();
}
export async function deletePlaylist(name) {
  await MSTREAMAPI.deletePlaylist(name);
  invalidate(`pl:${name}`);
  await refreshPlaylists();
}
export async function renamePlaylist(from, to) {
  await MSTREAMAPI.renamePlaylist(from, to);
  invalidate(`pl:${from}`);
  await refreshPlaylists();
}
export async function removeFromPlaylist(name, entry) {
  await MSTREAMAPI.removePlaylistSong(entry.id ?? entry.lokiId);
  invalidate(`pl:${name}`);
}

export async function shareTracks(tracks, days = 14) {
  const res = await MSTREAMAPI.makeShared(tracks.map((t) => t.filepath), days);
  return new URL('shared/' + res.playlistId, location.href.split('#')[0]).href;
}

// ── Folders ─────────────────────────────────────────────────────────────

export const dir = (path) => MSTREAMAPI.dirparser(path);
export const dirRecursive = (path) => MSTREAMAPI.recursiveScan(path);
export const metadataBatch = (paths) => post('api/v1/db/metadata/batch', paths);

// Downloads go through a hidden form, like the classic UI: the server
// answers with a zip attachment.
export function downloadForm(action, fields) {
  const s = server();
  let frame = document.getElementById('dl-frame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'dl-frame';
    frame.name = 'dl-frame';
    frame.hidden = true;
    document.body.appendChild(frame);
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.target = 'dl-frame';
  form.action = `${s.host}${action}?token=${encodeURIComponent(s.token || '')}`;
  Object.entries(fields).forEach(([k, v]) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
export const downloadTracks = (tracks) => downloadForm('api/v1/download/zip', { fileArray: JSON.stringify(tracks.map((t) => t.filepath)) });
export const downloadDirectory = (directory) => downloadForm('api/v1/download/directory', { directory });

// ── Server ──────────────────────────────────────────────────────────────

export const dbStatus = () => fetch(server().host + 'api/v1/db/status', { headers: { 'x-access-token': server().token } }).then((r) => r.json());
export const scanProgress = () => fetch(server().host + 'api/v1/scan/progress', { headers: { 'x-access-token': server().token } }).then((r) => r.json());
export async function startScan() {
  return post('api/v1/admin/db/scan/all', {});
}

export async function loadCounts() {
  const [al, ar, ge, st] = await Promise.allSettled([albums(), artists(), genres(), dbStatus()]);
  const counts = {
    albums: al.value?.length,
    artists: ar.value?.length,
    genres: ge.value?.length,
    tracks: st.value?.totalFileCount,
  };
  app.set({ counts: { ...app.get().counts, ...counts } });
}

export async function loadLikedCount() {
  const l = await liked().catch(() => []);
  app.set({ counts: { ...app.get().counts, liked: l.length } });
}
