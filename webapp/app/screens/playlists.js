// Playlists (stored on the server) and one playlist's tracks.
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { app, useStore, href, go } from '../store.js';
import * as lib from '../library.js';
import * as P from '../player.js';
import { Btn, Header, Cover, Empty, Spinner, TrackTable, useAsync, prompt, confirm, showInfo, openMenu, trackMenuItems } from '../ui.js';
import { fmtTime, plural, sumDuration, trackCover } from '../util.js';
import { parseM3u, resolveM3u, toM3u } from '../m3u.js';

// 2×2 mosaic of the first distinct covers.
export function Mosaic({ name }) {
  const state = useAsync(() => lib.playlistSongs(name), [name]);
  const covers = [...new Set((state.data || []).map((t) => trackCover(t)).filter(Boolean))].slice(0, 4);
  const n = state.data?.length;
  return html`<div class="mosaic">
    ${[0, 1, 2, 3].map((i) => html`<${Cover} file=${covers.length === 1 ? covers[0] : covers[i]} class=${'m' + i} size="s" />`)}
    <span class="mosaic-n">${n != null ? plural(n, 'track') + ' · ' + fmtTime(sumDuration(state.data)) : ''}</span>
  </div>`;
}

// ── M3U ─────────────────────────────────────────────────────────────────
// A file read in the browser and matched to the library (m3u.js), and
// tracks written out as a download. Nothing goes through the server but
// the playlist (or the likes) it becomes.

function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.m3u,.m3u8,audio/x-mpegurl,audio/mpegurl';
    input.onchange = async () => {
      const f = input.files[0];
      resolve(f ? { name: f.name.replace(/\.m3u8?$/i, ''), text: await f.text() } : null);
    };
    input.click();
  });
}

// Pick an M3U and match it: { name, entries, tracks, missing }, or null.
export async function readM3u() {
  const f = await pickFile();
  if (!f) { return null; }
  const entries = parseM3u(f.text);
  if (!entries.length) { P.toast('There are no tracks in that file', 'error'); return null; }
  const songs = await lib.allSongs();
  return { name: f.name, entries, ...resolveM3u(entries, songs) };
}

export const foundNote = (r) => `${r.tracks.length} of ${r.entries.length} tracks are in the library.`
  + (r.missing.length ? ` Not found: ${r.missing.slice(0, 3).map((e) => (e.title ? [e.artist, e.title].filter(Boolean).join(' - ') : e.path.split(/[\\/]/).pop())).join(', ')}${r.missing.length > 3 ? ` and ${r.missing.length - 3} more` : ''}.` : '');

export function saveM3u(name, tracks) {
  const url = URL.createObjectURL(new Blob([toM3u(tracks)], { type: 'audio/x-mpegurl;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(name).replace(/[\\/:*?"<>|]+/g, '-')}.m3u8`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function importPlaylist() {
  const r = await readM3u();
  if (!r) { return; }
  if (!r.tracks.length) { showInfo({ title: 'Nothing to import', text: foundNote(r) }); return; }
  const taken = app.get().playlists;
  let value = r.name;
  for (let n = 2; taken.includes(value); n++) { value = `${r.name} (${n})`; }
  const name = await prompt({ title: 'Import playlist', label: 'NAME', value, okLabel: 'Import', note: foundNote(r) });
  if (!name) { return; }
  if (app.get().playlists.includes(name)) { P.toast(`There is a playlist called “${name}” already`, 'error'); return; }
  try {
    await lib.createPlaylist(name, r.tracks);
    P.toast(`Imported ${plural(r.tracks.length, 'track')}`, 'success');
    go('playlist', name);
  } catch (_) { P.toast('Could not create the playlist', 'error'); }
}

async function newPlaylist() {
  const name = await prompt({ title: 'New playlist', label: 'NAME', okLabel: 'Create' });
  if (!name) { return; }
  try { await lib.createPlaylist(name, []); go('playlist', name); } catch (_) { P.toast('Could not create the playlist', 'error'); }
}

export async function renamePlaylist(name) {
  const to = await prompt({ title: 'Rename playlist', label: 'NAME', value: name, okLabel: 'Rename' });
  if (!to || to === name) { return; }
  try { await lib.renamePlaylist(name, to); go('playlist', to); } catch (_) { P.toast('Could not rename the playlist', 'error'); }
}

export async function deletePlaylist(name, after) {
  const ok = await confirm({ title: 'Delete playlist?', text: `“${name}” is removed from the server. The tracks stay in the library.` });
  if (!ok) { return; }
  try { await lib.deletePlaylist(name); P.toast(`Deleted “${name}”`); if (after) { after(); } } catch (_) { P.toast('Could not delete the playlist', 'error'); }
}

async function share(tracks) {
  if (!tracks.length) { return; }
  try {
    const url = await lib.shareTracks(tracks);
    showInfo({ title: 'Share link', text: 'Anyone with the link can listen for 14 days.', value: url });
  } catch (_) { P.toast('Could not create a share link', 'error'); }
}

export function Playlists() {
  const playlists = useStore(app, (s) => s.playlists);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { lib.refreshPlaylists().finally(() => setLoaded(true)); }, []);
  return html`<div class="screen">
    <${Header} title="Playlists" sub=${`${playlists.length} · STORED ON SERVER`}>
      <${Btn} icon="upload" onClick=${importPlaylist} title="Import a playlist from an .m3u / .m3u8 file">Import M3U</${Btn}>
      <${Btn} kind="primary" icon="add" onClick=${newPlaylist}>New playlist</${Btn}>
    </${Header}>
    <div class="scroll pad">
      ${!loaded && !playlists.length ? html`<${Spinner} />`
        : playlists.length ? html`<div class="grid g5">${playlists.map((name) => html`<a class="tile" href=${href('playlist', name)}
            onContextMenu=${(e) => openMenu(e, [
              { label: 'Rename…', icon: 'edit', onClick: () => renamePlaylist(name) },
              { label: 'Delete', icon: 'delete_outline', danger: true, onClick: () => deletePlaylist(name) }])}>
            <${Mosaic} name=${name} />
            <span class="tile-t">${name}</span>
          </a>`)}</div>`
        : html`<${Empty} icon="queue_music" title="No playlists yet.">Create a playlist with New playlist, then add tracks from the ⋮ menu (Add to playlist…), save the queue, or import an M3U.</${Empty}>`}
    </div>
  </div>`;
}

export function Playlist({ args }) {
  const name = args[0] || '';
  const [rev, setRev] = useState(0);
  const state = useAsync(() => lib.playlistSongs(name), [name, rev]);
  const entries = state.data || [];
  const tracks = entries.map((e) => ({ filepath: e.filepath, metadata: e.metadata || {}, entry: e }));
  const remove = async (t) => {
    try { await lib.removeFromPlaylist(name, t.entry); setRev((n) => n + 1); } catch (_) { P.toast('Could not remove the track', 'error'); }
  };
  const more = (e) => openMenu(e, [
    { label: 'Add all to queue', icon: 'queue_music', onClick: () => P.addToQueue(tracks) },
    { label: 'Export M3U', icon: 'download', onClick: () => saveM3u(name, tracks) },
    { label: 'Rename…', icon: 'edit', onClick: () => renamePlaylist(name) },
    'sep',
    { label: 'Delete playlist', icon: 'delete_outline', danger: true, onClick: () => deletePlaylist(name, () => go('pl')) },
  ]);
  return html`<div class="screen">
    <${Header} back title=${name}
      sub=${state.data ? `PLAYLIST · ${plural(tracks.length, 'track').toUpperCase()} · ${fmtTime(sumDuration(tracks))}` : 'PLAYLIST'}>
      <${Btn} icon="share" onClick=${() => share(tracks)} disabled=${!tracks.length}>Share link</${Btn}>
      <${Btn} icon="download" onClick=${() => lib.downloadTracks(tracks)} disabled=${!tracks.length}>.zip</${Btn}>
      <${Btn} icon="more_vert" onClick=${more} title="More" />
      <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => P.playTracks(tracks)} disabled=${!tracks.length}>Play all</${Btn}>
    </${Header}>
    ${state.loading && !state.data ? html`<${Spinner} />` : html`<${TrackTable} groups=${[{ tracks }]}
      rowMenu=${(t) => trackMenuItems([t], ['sep', { label: 'Remove from playlist', icon: 'remove_circle_outline', tone: 'danger', onClick: () => remove(t) }])}
      empty=${html`<${Empty} icon="queue_music" title="Nothing here yet.">Add tracks from their ⋮ menu: Add to playlist….</${Empty}>`} />`}
  </div>`;
}
