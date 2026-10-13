// Playlists (stored on the server) and one playlist's tracks.
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { app, useStore, href, go } from '../store.js';
import * as lib from '../library.js';
import * as P from '../player.js';
import { Btn, Header, Cover, Empty, Spinner, TrackTable, useAsync, prompt, confirm, showInfo, openMenu, trackMenuItems } from '../ui.js';
import { fmtTime, plural, sumDuration, trackCover } from '../util.js';

// 2×2 mosaic of the first distinct covers.
function Mosaic({ name }) {
  const state = useAsync(() => lib.playlistSongs(name), [name]);
  const covers = [...new Set((state.data || []).map((t) => trackCover(t)).filter(Boolean))].slice(0, 4);
  const n = state.data?.length;
  return html`<div class="mosaic">
    ${[0, 1, 2, 3].map((i) => html`<${Cover} file=${covers.length === 1 ? covers[0] : covers[i]} class=${'m' + i} size="s" />`)}
    <span class="mosaic-n">${n != null ? plural(n, 'track') + ' · ' + fmtTime(sumDuration(state.data)) : ''}</span>
  </div>`;
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
        : html`<${Empty} icon="queue_music" title="No playlists yet.">Create a playlist with New playlist, then add tracks from the ⋮ menu (Add to playlist…), or save the queue.</${Empty}>`}
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
