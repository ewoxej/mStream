// Peers: the libraries of the servers this one is paired with (federation),
// read through this server's browse proxy (api/federation-browse.js) — their
// albums, artists, folders and a search, played through the stream proxy. The
// app has the same as folder roots. Their tracks carry `federation` (library.js
// asPeerTracks), so the player, the queue and the track menu know them.
import { html, useEffect, useMemo, useState } from '../vendor/preact-htm.js';
import { app, href, go, useStore } from '../store.js';
import * as lib from '../library.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import { useSort, useSorted, SortButton } from '../sort.js';
import {
  Btn, Icon, Cover, Header, Seg, Empty, Spinner, SearchField, TrackTable, useAsync, openMenu, trackMenuItems,
} from '../ui.js';
import { fmtCount, fmtTime, plural, sumDuration, peerCover, formatLabel, trackTitle } from '../util.js';

const AUDIO = /\.(mp3|flac|wav|ogg|oga|aac|m4a|m4b|opus|alac|aiff?|wma|ape|wv|dsf|dff)$/i;

function Loading({ state, children }) {
  if (state.loading && !state.data) { return html`<${Spinner} />`; }
  if (state.error) {
    return html`<${Empty} icon="cloud" title="The peer didn’t answer">${state.error.status === 502 || state.error.status === 504
      ? 'It may be offline. Try again later.' : String(state.error.message || state.error)}</${Empty}>`;
  }
  return children(state.data);
}

const statusText = (p) => (p.lastStatus === 'ok' ? 'Online' : p.lastStatus ? String(p.lastStatus) : 'Not reached yet');

export function Peers() {
  const state = useAsync(() => { lib.invalidate('peers'); return lib.peers(); }, []);
  const list = state.data || [];
  return html`<div class="screen">
    <${Header} title="Peers" sub=${state.data ? `${plural(list.length, 'server').toUpperCase()} · PAIRED WITH THIS ONE` : ''} />
    <div class="scroll pad">
      <${Loading} state=${state}>${() => (list.length ? html`<div class="card table-card">
        ${list.map((p) => html`<a class="alb-row" href=${href('peer', p.id)} key=${p.id}>
          <div class="cover alb-cover round peer-plate"><${Icon} name="lan" size=${20} /></div>
          <span class="alb-t">${p.name || `Peer ${p.id}`}</span>
          <span class="alb-n">${statusText(p)}</span>
          <span class="alb-d">${p.lastSeen ? `seen ${new Date(p.lastSeen).toLocaleDateString()}` : ''}</span>
        </a>`)}
      </div>
      <div class="hint top">What a peer shares is up to it: you see the libraries it granted to this server.</div>`
        : html`<${Empty} icon="lan" title="No paired servers">An admin pairs this server with others under Admin → Federation.</${Empty}>`)}</${Loading}>
    </div>
  </div>`;
}

function PeerAlbumTile({ peer, album, meta }) {
  const play = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    P.playTracks(lib.asPeerTracks(peer, await lib.peerAlbumSongs(peer.id, album.name, album.album_artist)));
  };
  return html`<a class="tile" href=${href('peer', peer.id, 'album', album.name || '', { artist: album.album_artist || '' })}>
    <${Cover} file=${peerCover(peer.id, album.album_art_file)} size="l">
      <button type="button" class="tile-play" title="Play" onClick=${play}><${Icon} name="play_arrow" size=${18} fill /></button>
    </${Cover}>
    <span class="tile-t">${album.name || 'Unknown album'}</span>
    <span class="tile-s">${meta ?? [album.album_artist, album.year].filter(Boolean).join(' · ')}</span>
  </a>`;
}

const albumGrid = (peer, albums, meta) => html`<div class="grid g6">${albums.map((a) => html`<${PeerAlbumTile} peer=${peer} album=${a} meta=${meta?.(a)} key=${a.name + '|' + (a.album_artist || '')} />`)}</div>`;

function Albums({ peer }) {
  const state = useAsync(() => lib.peerAlbums(peer.id), [peer.id]);
  const sort = useSort('albums');
  const albums = useSorted(state.data, sort);
  return html`<div class="peer-bar"><span class="micro">${state.data ? `${fmtCount(albums.length)} albums · ${sort.label}` : ''}</span><${SortButton} sort=${sort} /></div>
    <${Loading} state=${state}>${() => (albums.length ? albumGrid(peer, albums) : html`<${Empty} icon="album" title="No albums shared" />`)}</${Loading}>`;
}

function Artists({ peer }) {
  const state = useAsync(() => lib.peerArtists(peer.id), [peer.id]);
  const names = useMemo(() => [...(state.data || [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })), [state.data]);
  return html`<${Loading} state=${state}>${() => (names.length ? html`<div class="card table-card">
    ${names.map((n) => html`<a class="alb-row" href=${href('peer', peer.id, 'artist', n)} key=${n}>
      <div class="cover alb-cover round"><span class="initials">${n.trim().charAt(0).toUpperCase()}</span></div>
      <span class="alb-t">${n}</span><span class="alb-n"></span><span class="alb-d"></span>
    </a>`)}</div>` : html`<${Empty} icon="person" title="No artists shared" />`)}</${Loading}>`;
}

function Folders({ peer, parts }) {
  const path = parts.length ? '/' + parts.join('/') : '';
  const state = useAsync(() => lib.peerDir(peer.id, path), [peer.id, path]);
  const currentPath = useStore(playback, (s) => s.currentPath);
  const dirs = state.data?.directories || [];
  const files = (state.data?.files || []).filter((f) => AUDIO.test(f.name));
  const tracks = useMemo(() => lib.asPeerTracks(peer, files.map((f) => {
    const meta = f.metadata?.metadata || f.metadata || {};
    return { filepath: [...parts, f.name].join('/'), metadata: meta };
  })), [state.data]);
  const playFolder = async (how, at) => {
    try {
      const list = lib.asPeerTracks(peer, await lib.peerDirRecursive(peer.id, at));
      if (!list.length) { P.toast('No audio in this folder'); return; }
      if (how === 'queue') { P.addToQueue(list); } else { P.playTracks(list); }
    } catch (_) { P.toast('Could not read the folder', 'error'); }
  };
  const dirMenu = (e, d) => openMenu(e, [
    { label: 'Play folder', icon: 'play_arrow', tone: 'accent', onClick: () => playFolder('play', `${path}/${d.name}`) },
    { label: 'Add to queue', icon: 'queue_music', tone: 'accent', onClick: () => playFolder('queue', `${path}/${d.name}`) },
  ]);
  return html`
    ${parts.length ? html`<nav class="path-bar">
      <a class="crumb" href=${href('peer', peer.id, 'folders')}>${peer.name}</a>
      ${parts.map((p, i) => html`<${Icon} name="chevron_right" size=${13} />${i === parts.length - 1
        ? html`<span class="crumb last">${p}</span>` : html`<a class="crumb" href=${href('peer', peer.id, 'folders', ...parts.slice(0, i + 1))}>${p}</a>`}`)}
      <span class="peer-bar-gap"></span>
      <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => playFolder('play', path)}>Play folder</${Btn}>
    </nav>` : null}
    <${Loading} state=${state}>${() => (!dirs.length && !files.length ? html`<${Empty} icon="folder" title="This folder is empty" />` : html`<div class="card table-card files">
      ${dirs.map((d) => html`<a class="f-row" key=${'d:' + d.name} href=${href('peer', peer.id, 'folders', ...parts, d.name)} onContextMenu=${(e) => dirMenu(e, d)}>
        <span class="f-plate accent"><${Icon} name=${parts.length ? 'folder' : 'library_music'} size=${15} /></span>
        <span class="f-name">${d.name}</span><span class="micro-n"></span><span class="micro-n r"></span>
        <span>${parts.length || dirs.length ? html`<button type="button" class="row-more" title="More" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); dirMenu(e, d); }}><${Icon} name="more_vert" size=${16} /></button>` : null}</span>
      </a>`)}
      ${tracks.map((t, i) => html`<div class=${`f-row audio ${t.filepath === currentPath ? 'cur' : ''}`} key=${t.filepath}
        onClick=${() => P.playTracks(tracks, i)} onContextMenu=${(e) => openMenu(e, trackMenuItems([t]))}>
        <span class="f-plate"><${Icon} name=${t.filepath === currentPath ? 'graphic_eq' : 'music_note'} size=${15} /></span>
        <span class="f-name">${t.metadata.title ? trackTitle(t) : t.filepath.split('/').pop()}</span>
        <span class="micro-n">${formatLabel(t.metadata) || (t.filepath.split('.').pop() || '').toUpperCase()}</span><span class="micro-n r"></span>
        <span><button type="button" class="row-more" title="More" onClick=${(e) => { e.stopPropagation(); openMenu(e, trackMenuItems([t])); }}><${Icon} name="more_vert" size=${16} /></button></span>
      </div>`)}
    </div>`)}</${Loading}>`;
}

function Album({ peer, name, artist }) {
  const state = useAsync(async () => lib.asPeerTracks(peer, await lib.peerAlbumSongs(peer.id, name, artist)), [peer.id, name, artist]);
  const tracks = state.data || [];
  return html`<${PeerHead} peer=${peer} title=${name || 'Unknown album'} cover=${tracks[0]?.metadata?.['album-art']}
      sub=${[artist, tracks[0]?.metadata?.year, tracks.length && plural(tracks.length, 'track'), tracks.length && fmtTime(sumDuration(tracks))].filter(Boolean).join(' · ')}
      tracks=${tracks} copy=${tracks[0]} />
    <${Loading} state=${state}>${() => html`<${TrackTable} groups=${[{ tracks }]} hideAlbum firstValue=${(t, i) => t.metadata?.track || i + 1}
      empty=${html`<${Empty} icon="album" title="This album has no tracks" />`} />`}</${Loading}>`;
}

function Artist({ peer, name }) {
  const state = useAsync(() => lib.peerArtistAlbums(peer.id, name), [peer.id, name]);
  const albums = state.data || [];
  const playAll = async (shuffle) => {
    const lists = await Promise.all(albums.map((a) => lib.peerAlbumSongs(peer.id, a.name, a.album_artist)));
    const all = lib.asPeerTracks(peer, lists.flat());
    if (shuffle) { P.shufflePlay(all); } else { P.playTracks(all); }
  };
  return html`<header class="screen-head peer-sub">
      <div class="titles"><h1>${name}</h1><span class="micro">${state.data ? `${plural(albums.length, 'album').toUpperCase()} · ON ${String(peer.name).toUpperCase()}` : ''}</span></div>
      <${Btn} icon="shuffle" onClick=${() => playAll(true)} disabled=${!albums.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => playAll(false)} disabled=${!albums.length}>Play all</${Btn}>
    </header>
    <div class="scroll pad"><${Loading} state=${state}>${() => (albums.length
      ? albumGrid(peer, albums, (a) => [a.year, a.track_count && plural(a.track_count, 'track')].filter(Boolean).join(' · '))
      : html`<${Empty} icon="album" title="No albums for this artist" />`)}</${Loading}></div>`;
}

// An album's or a search's head: play, shuffle, and "Add to my library" (the
// server's copy job, the same window as Discover's).
function PeerHead({ peer, title, sub, cover, tracks, copy }) {
  const features = useStore(app, (s) => s.features);
  return html`<header class="screen-head peer-sub">
    ${cover ? html`<${Cover} file=${cover} class="head-cover" />` : null}
    <div class="titles"><h1>${title}</h1>${sub ? html`<span class="micro">${String(sub).toUpperCase()}</span>` : null}</div>
    ${copy && features.plugins ? html`<${Btn} icon="add" onClick=${() => app.set({ peerGet: { track: copy, scope: 'album' } })}>Add to my library</${Btn}>` : null}
    <${Btn} icon="shuffle" onClick=${() => P.shufflePlay(tracks)} disabled=${!tracks.length}>Shuffle</${Btn}>
    <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => P.playTracks(tracks)} disabled=${!tracks.length}>Play all</${Btn}>
  </header>`;
}

function Search({ peer, q }) {
  const state = useAsync(() => (q.trim() ? lib.peerSearch(peer.id, q.trim()) : Promise.resolve(null)), [peer.id, q]);
  const r = state.data;
  const tracks = r ? lib.asPeerTracks(peer, [...(r.title || []), ...(r.files || [])].filter((x, i, a) => a.findIndex((y) => y.filepath === x.filepath) === i)) : [];
  const albums = r?.albums || [];
  const artists = r?.artists || [];
  if (!q.trim()) { return html`<${Empty} icon="search" title=${`Search ${peer.name}`}>Type a title, an album or an artist.</${Empty}>`; }
  return html`<${Loading} state=${state}>${() => (!tracks.length && !albums.length && !artists.length
    ? html`<${Empty} icon="search" title="Nothing found">Try other search terms.</${Empty}>`
    : html`<div class="search-results">
      ${artists.length ? html`<section class="block"><div class="block-head"><span class="block-title">Artists</span></div>
        <div class="grid g6 artists">${artists.slice(0, 12).map((a) => html`<a class="tile artist" href=${href('peer', peer.id, 'artist', a.name)}>
          <${Cover} file=${peerCover(peer.id, a.album_art_file)} round>${!a.album_art_file ? html`<span class="initials">${a.name.charAt(0)}</span>` : null}</${Cover}>
          <span class="tile-t">${a.name}</span></a>`)}</div></section>` : null}
      ${albums.length ? html`<section class="block"><div class="block-head"><span class="block-title">Albums</span></div>
        ${albumGrid(peer, albums.slice(0, 12).map((a) => ({ name: a.name, album_art_file: a.album_art_file, album_artist: '' })), () => '')}</section>` : null}
      ${tracks.length ? html`<section class="block tracks-block"><div class="block-head"><span class="block-title">Tracks</span></div>
        <${TrackTable} groups=${[{ tracks }]} /></section>` : null}
    </div>`)}</${Loading}>`;
}

const TABS = [
  { value: 'albums', label: 'Albums' },
  { value: 'artists', label: 'Artists' },
  { value: 'folders', label: 'Folders' },
];

// #/peer/<id>[/albums | /artists | /folders/<path…> | /album/<name>?artist= | /artist/<name> | /search?q=]
export function Peer({ args, params }) {
  const id = Number(args[0]);
  const view = args[1] || 'albums';
  const rest = args.slice(2);
  const list = useAsync(() => lib.peers(), []);
  const peer = (list.data || []).find((p) => p.id === id);
  const [q, setQ] = useState(params.q || '');
  useEffect(() => {
    if (q === (params.q || '')) { return undefined; }
    const t = setTimeout(() => { location.replace(href('peer', id, q.trim() ? 'search' : 'albums', q.trim() ? { q } : undefined)); }, 350);
    return () => clearTimeout(t);
  }, [q]);
  if (!peer) {
    return html`<div class="screen"><${Header} back title="Peer" />
      ${list.loading ? html`<${Spinner} />` : html`<${Empty} icon="lan" title="This peer isn’t paired with this server" />`}</div>`;
  }
  const tab = TABS.some((t) => t.value === view) ? view : null;
  return html`<div class="screen">
    <${Header} back title=${peer.name || `Peer ${peer.id}`} sub=${`PEER · ${statusText(peer).toUpperCase()}`}>
      <${SearchField} value=${q} onInput=${setQ} width=${220} />
      <${Seg} value=${tab} options=${TABS} onChange=${(v) => go('peer', id, v)} />
    </${Header}>
    ${view === 'album' ? html`<${Album} peer=${peer} name=${rest[0] || ''} artist=${params.artist || ''} />`
      : view === 'artist' ? html`<${Artist} peer=${peer} name=${rest[0] || ''} />`
      : html`<div class="scroll pad col">
        ${view === 'artists' ? html`<${Artists} peer=${peer} />`
          : view === 'folders' ? html`<${Folders} peer=${peer} parts=${rest} />`
          : view === 'search' ? html`<${Search} peer=${peer} q=${params.q || ''} />`
          : html`<${Albums} peer=${peer} />`}
      </div>`}
  </div>`;
}
