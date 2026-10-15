// Home, built from the user's layout as in the app: each section is Off,
// a shortcut Icon on top, or a Grid / List card, in the chosen order
// (prefs `home`). Customize home (#/customize) edits it. A grid card shows
// one row of tiles (as many as fit), a list card four rows and "+N";
// list cards next to each other pair up.
import { html, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { app, useStore, href, go, setPref } from '../store.js';
import * as lib from '../library.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import { useSort, useSorted } from '../sort.js';
import {
  Icon, Btn, Cover, Plate, Header, SearchField, Spinner, AlbumTile, useAsync,
} from '../ui.js';
import {
  fmtCount, fmtTime, plural, clockLabel, greeting, trackTitle, trackArtist, trackCover,
} from '../util.js';
import { djSummaryChips, djAhead } from './dj.js';
import { DownloadsCard } from './downloads.js';
import { useArtistRows, ArtistTile, artistDetail } from './library.js';
import { Mosaic } from './playlists.js';

// `card`: which card modes a section has (none = shortcut only, like the app's Settings).
// `when`: only while the server offers the feature.
export const HOME_SECTIONS = [
  { id: 'dj', label: 'Auto DJ', icon: 'auto_awesome', to: 'dj', card: ['list'] },
  { id: 'downloads', label: 'Downloads', icon: 'download', to: 'dl', card: ['list'], when: (f) => f.torrent },
  { id: 'recent', label: 'Recently played', icon: 'history', to: 'recent', card: ['grid', 'list'] },
  { id: 'added', label: 'Recently added', icon: 'new_releases', card: ['grid', 'list'] },
  { id: 'albums', label: 'Albums', icon: 'album', to: 'albums', card: ['grid', 'list'] },
  { id: 'artists', label: 'Artists', icon: 'person', to: 'artists', card: ['grid', 'list'] },
  { id: 'tracks', label: 'All tracks', icon: 'music_note', to: 'tracks', card: ['grid', 'list'] },
  { id: 'genres', label: 'Genres', icon: 'category', to: 'genres', card: ['grid', 'list'] },
  { id: 'folders', label: 'Folders', icon: 'folder', to: 'folders', card: ['grid', 'list'] },
  { id: 'favorites', label: 'Favorites', icon: 'favorite_border', to: 'fav', card: ['grid', 'list'] },
  { id: 'playlists', label: 'Playlists', icon: 'queue_music', to: 'pl', card: ['grid', 'list'] },
  { id: 'sonic', label: 'Sonic Path', icon: 'route', to: 'sonic', card: [], when: (f) => f.sonicPath },
  { id: 'discover', label: 'Discover', icon: 'explore', to: 'discover', card: [], when: (f) => f.discover },
  { id: 'stats', label: 'Stats', icon: 'insights', to: 'stats', card: [], when: (f) => f.stats },
  { id: 'guests', label: 'Guests', icon: 'qr_code_2', to: 'guests', card: [], when: (f) => f.account },
  { id: 'viz', label: 'Visualizer', icon: 'equalizer', to: 'viz', card: [] },
  { id: 'settings', label: 'Settings', icon: 'settings', to: 'settings', card: [] },
];
const SECTION = Object.fromEntries(HOME_SECTIONS.map((s) => [s.id, s]));

// The Home this player had before it was customizable.
export const DEFAULT_HOME = [
  { id: 'dj', mode: 'list' }, { id: 'downloads', mode: 'list' }, { id: 'recent', mode: 'grid' },
  { id: 'added', mode: 'list' }, { id: 'playlists', mode: 'list' },
];
export const HOME_MODES = [
  { value: 'off', label: 'Off' }, { value: 'icon', label: 'Icon' }, { value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' },
];
export const modeAllowed = (sec, mode) => mode === 'off' || mode === 'icon' || sec.card.includes(mode);

// Every section in the stored order, missing ones appended (off); unknown ids dropped.
export function completeHome(stored) {
  const known = (stored || DEFAULT_HOME).filter((x, i, a) => SECTION[x.id] && a.findIndex((y) => y.id === x.id) === i)
    .map((x) => ({ id: x.id, mode: modeAllowed(SECTION[x.id], x.mode) ? x.mode : 'off' }));
  return [...known, ...HOME_SECTIONS.filter((s) => !known.some((k) => k.id === s.id)).map((s) => ({ id: s.id, mode: 'off' }))];
}

const LIST_ROWS = 4;
const TILES = 14;

// Album list → unique albums in order (for "recently played / added").
function uniqueAlbums(tracks, n) {
  const seen = new Map();
  for (const t of tracks) {
    const m = t.metadata || {};
    const key = (m.album || '') + '|' + (m['album-art'] || '');
    if (!m.album || seen.has(key)) { continue; }
    seen.set(key, { name: m.album, album_artist: m['album-artist'] || '', artist: trackArtist(t), album_art_file: m['album-art'], year: m.year, first: t });
    if (seen.size >= n) { break; }
  }
  return [...seen.values()];
}

// ── Card frame and rows ─────────────────────────────────────────────────

function HomeCard({ sec, caption, count, grid, children }) {
  const head = html`<${Plate} icon=${sec.icon} /><span class="hc-titles"><span class="card-title">${sec.label}</span>
    ${caption ? html`<span class="micro">${caption}</span>` : null}</span>
    ${count != null ? html`<span class="micro-n">${fmtCount(count)}</span>` : null}
    ${sec.to ? html`<${Icon} name="chevron_right" size=${17} class="hc-chev" />` : null}`;
  return html`<section class=${`card home-card ${grid ? 'grid-card' : 'list-card'}`}>
    ${sec.to ? html`<a class="hc-head" href=${href(sec.to)}>${head}</a>` : html`<div class="hc-head">${head}</div>`}
    ${children}
  </section>`;
}

const Hint = ({ children }) => html`<div class="hint pad">${children}</div>`;
const More = ({ rest, what }) => (rest > 0 ? html`<div class="hc-more micro-n">+${fmtCount(rest)} ${what}</div>` : null);

function Row({ href: to, onClick, cover, round, icon, title, sub, trail, hl }) {
  const inner = html`${icon ? html`<div class="mini-cover plate-chip"><${Icon} name=${icon} size=${16} /></div>`
    : html`<${Cover} file=${cover} class=${`mini-cover ${round ? 'round' : ''}`} />`}
    <div class="mini-text"><span class=${hl ? 'hl' : ''}>${title}</span>${sub ? html`<small>${sub}</small>` : null}</div>
    ${trail ? html`<span class="micro-n">${trail}</span>` : null}`;
  return to ? html`<a class="mini-row" href=${to}>${inner}</a>` : html`<button type="button" class="mini-row" onClick=${onClick}>${inner}</button>`;
}

function TrackTile({ track, onPlay, hl }) {
  return html`<button type="button" class=${`tile ${hl ? 'hl' : ''}`} onClick=${onPlay}>
    <${Cover} file=${trackCover(track)} size="l" ring=${hl} />
    <span class="tile-t">${trackTitle(track)}</span><span class="tile-s">${trackArtist(track)}</span>
  </button>`;
}

function IconTile({ to, icon, title, sub }) {
  return html`<a class="tile" href=${to}>
    <div class="cover icon-cover"><${Icon} name=${icon} size=${30} /></div>
    <span class="tile-t">${title}</span>${sub ? html`<span class="tile-s">${sub}</span>` : null}
  </a>`;
}

const Tiles = ({ children }) => html`<div class="grid g6 home-row">${children}</div>`;

// ── Sections ────────────────────────────────────────────────────────────

function DjCard() {
  const dj = useStore(playback, (s) => ({ on: s.autoDJ, ahead: djAhead(s) }));
  return html`<section class=${`card dj-card ${dj.on ? 'on' : ''}`}>
    <div class="card-head"><${Plate} icon="auto_awesome" /><span class="card-title">Auto DJ</span>
      <span class="micro accent">${dj.on ? `RUNNING · ${dj.ahead} AHEAD` : 'OFF'}</span></div>
    <p class="card-text">Picks random tracks from the chosen folders and keeps the queue filled. Recently picked tracks are skipped.</p>
    <div class="chips">${djSummaryChips().map((c) => html`<span class="chip static">${c}</span>`)}</div>
    <div class="card-actions">
      <${Btn} kind="primary" icon=${dj.on ? 'stop' : 'play_arrow'} onClick=${P.toggleAutoDJ}>${dj.on ? 'Stop Auto DJ' : 'Start Auto DJ'}</${Btn}>
      <a class="btn btn-outline" href=${href('dj')}>Sources and filters</a>
    </div>
  </section>`;
}

function RecentCard({ sec, grid }) {
  const state = useAsync(() => lib.recentlyPlayed(60), []);
  const currentPath = useStore(playback, (s) => s.currentPath);
  const tracks = state.data || [];
  const body = state.loading && !state.data ? html`<${Spinner} />`
    : !tracks.length ? html`<${Hint}>Nothing played yet.</${Hint}>`
    : grid ? html`<${Tiles}>${uniqueAlbums(tracks, TILES).map((a) => html`<${AlbumTile} album=${a} meta=${a.artist} highlight=${a.first.filepath === currentPath} />`)}</${Tiles}>`
    : html`${tracks.slice(0, LIST_ROWS).map((t, i) => html`<${Row} onClick=${() => P.playTracks(tracks, i)} cover=${trackCover(t)}
        title=${trackTitle(t)} sub=${trackArtist(t)} hl=${t.filepath === currentPath}
        trail=${t.metadata?.['last-played'] ? clockLabel(Date.parse(String(t.metadata['last-played']).replace(' ', 'T') + 'Z')) : ''} />`)}
      <${More} rest=${tracks.length - LIST_ROWS} what="tracks" />`;
  return html`<${HomeCard} sec=${sec} caption=${grid ? 'ALBUMS' : 'NEWEST FIRST'} grid=${grid}>${body}</${HomeCard}>`;
}

function AddedCard({ sec, grid }) {
  const state = useAsync(() => lib.recentlyAdded(80), []);
  const albums = uniqueAlbums(state.data || [], grid ? TILES : LIST_ROWS + 1);
  const added = (a) => (a.first.metadata?.['created-at'] ? clockLabel(Date.parse(a.first.metadata['created-at'].replace(' ', 'T') + 'Z')) : '');
  const body = state.loading && !state.data ? html`<${Spinner} />`
    : !albums.length ? html`<${Hint}>No new albums.</${Hint}>`
    : grid ? html`<${Tiles}>${albums.map((a) => html`<${AlbumTile} album=${a} meta=${a.artist} />`)}</${Tiles}>`
    : albums.slice(0, LIST_ROWS).map((a) => html`<${Row} href=${href('album', a.name, { artist: a.album_artist })}
        cover=${a.album_art_file} title=${a.name} sub=${a.artist} trail=${added(a)} />`);
  const n = state.data?.length;
  return html`<${HomeCard} sec=${sec} caption="ALBUMS" count=${n != null ? (n >= 80 ? null : n) : null} grid=${grid}>${body}</${HomeCard}>`;
}

function AlbumsCard({ sec, grid }) {
  const state = useAsync(() => lib.albums(), []);
  const sort = useSort('albums');
  const list = useSorted(state.data, sort);
  const body = state.loading && !state.data ? html`<${Spinner} />`
    : !list.length ? html`<${Hint}>No albums yet.</${Hint}>`
    : grid ? html`<${Tiles}>${list.slice(0, TILES).map((a) => html`<${AlbumTile} album=${a} />`)}</${Tiles}>`
    : html`${list.slice(0, LIST_ROWS).map((a) => html`<${Row} href=${href('album', a.name, { artist: a.album_artist || '' })}
        cover=${a.album_art_file} title=${a.name || 'Unknown album'} sub=${a.album_artist || (a.artists || []).join(', ')} trail=${a.year || ''} />`)}
      <${More} rest=${list.length - LIST_ROWS} what="albums" />`;
  return html`<${HomeCard} sec=${sec} caption=${sort.label} count=${state.data?.length} grid=${grid}>${body}</${HomeCard}>`;
}

function ArtistsCard({ sec, grid }) {
  const { state, rows } = useArtistRows();
  const sort = useSort('artists');
  const list = useSorted(rows, sort);
  const body = state.loading && !state.data ? html`<${Spinner} />`
    : !list.length ? html`<${Hint}>No artists yet.</${Hint}>`
    : grid ? html`<${Tiles}>${list.slice(0, TILES).map((a) => html`<${ArtistTile} artist=${a} />`)}</${Tiles}>`
    : html`${list.slice(0, LIST_ROWS).map((a) => html`<${Row} href=${href('artist', a.name)} cover=${a.art} round title=${a.name} sub=${artistDetail(a)} />`)}
      <${More} rest=${list.length - LIST_ROWS} what="artists" />`;
  return html`<${HomeCard} sec=${sec} caption=${sort.label} count=${state.data?.length} grid=${grid}>${body}</${HomeCard}>`;
}

function TrackCard({ sec, grid, state, list, caption, what, empty }) {
  const currentPath = useStore(playback, (s) => s.currentPath);
  const body = state.loading && !state.data ? html`<${Spinner} />`
    : !list.length ? html`<${Hint}>${empty}</${Hint}>`
    : grid ? html`<${Tiles}>${list.slice(0, TILES).map((t, i) => html`<${TrackTile} track=${t} hl=${t.filepath === currentPath} onPlay=${() => P.playTracks(list, i)} />`)}</${Tiles}>`
    : html`${list.slice(0, LIST_ROWS).map((t, i) => html`<${Row} onClick=${() => P.playTracks(list, i)} cover=${trackCover(t)}
        title=${trackTitle(t)} sub=${trackArtist(t)} hl=${t.filepath === currentPath} trail=${fmtTime(t.metadata?.duration)} />`)}
      <${More} rest=${list.length - LIST_ROWS} what=${what} />`;
  return html`<${HomeCard} sec=${sec} caption=${caption} count=${state.data?.length} grid=${grid}>${body}</${HomeCard}>`;
}

function TracksCard({ sec, grid }) {
  const state = useAsync(() => lib.allSongs(), []);
  const sort = useSort('tracks');
  const list = useSorted(state.data, sort);
  return html`<${TrackCard} sec=${sec} grid=${grid} state=${state} list=${list} caption=${sort.label} what="tracks" empty="No tracks yet." />`;
}

function FavoritesCard({ sec, grid }) {
  const state = useAsync(() => lib.liked(), []);
  const sort = useSort('favorites');
  const list = useSorted(state.data, sort);
  return html`<${TrackCard} sec=${sec} grid=${grid} state=${state} list=${list} caption=${sort.label} what="favorites" empty="No favorites yet." />`;
}

function GenresCard({ sec, grid }) {
  const state = useAsync(() => lib.genres(), []);
  const sort = useSort('genres');
  const list = useSorted(state.data, sort);
  const body = state.loading && !state.data ? html`<${Spinner} />`
    : !list.length ? html`<${Hint}>No genres yet.</${Hint}>`
    : grid ? html`<${Tiles}>${list.slice(0, TILES).map((g) => html`<${IconTile} to=${href('genre', g.name)} icon="category" title=${g.name} sub=${plural(g.track_count || 0, 'track')} />`)}</${Tiles}>`
    : html`${list.slice(0, LIST_ROWS).map((g) => html`<${Row} href=${href('genre', g.name)} icon="category" title=${g.name} trail=${plural(g.track_count || 0, 'track')} />`)}
      <${More} rest=${list.length - LIST_ROWS} what="genres" />`;
  return html`<${HomeCard} sec=${sec} caption=${sort.label} count=${state.data?.length} grid=${grid}>${body}</${HomeCard}>`;
}

// The home folder's sub-folders (the libraries when no home folder is set).
function FoldersCard({ sec, grid }) {
  const home = useStore(app, (s) => s.homeFolder);
  const parts = home ? home.split('/') : [];
  const state = useAsync(() => lib.dir(parts.length ? '/' + home : ''), [home]);
  const dirs = state.data?.directories || [];
  const to = (d) => href('folders', ...parts, d.name);
  const body = state.loading && !state.data ? html`<${Spinner} />`
    : !dirs.length ? html`<${Hint}>No folders in ${parts.length ? parts[parts.length - 1] : 'the libraries'}.</${Hint}>`
    : grid ? html`<${Tiles}>${dirs.slice(0, TILES).map((d) => html`<${IconTile} to=${to(d)} icon=${parts.length ? 'folder' : 'library_music'} title=${d.name} />`)}</${Tiles}>`
    : html`${dirs.slice(0, LIST_ROWS).map((d) => html`<${Row} href=${to(d)} icon=${parts.length ? 'folder' : 'library_music'} title=${d.name} />`)}
      <${More} rest=${dirs.length - LIST_ROWS} what="folders" />`;
  return html`<${HomeCard} sec=${sec} caption=${(parts.length ? parts[parts.length - 1] : 'LIBRARIES').toUpperCase()} count=${state.data ? dirs.length : null} grid=${grid}>${body}</${HomeCard}>`;
}

function PlaylistsCard({ sec, grid }) {
  const playlists = useStore(app, (s) => s.playlists);
  const body = !playlists.length ? html`<${Hint}>No playlists yet.</${Hint}>`
    : grid ? html`<${Tiles}>${playlists.slice(0, TILES).map((name) => html`<a class="tile" href=${href('playlist', name)}>
        <${Mosaic} name=${name} /><span class="tile-t">${name}</span></a>`)}</${Tiles}>`
    : html`${playlists.slice(0, LIST_ROWS).map((name) => html`<${Row} href=${href('playlist', name)} icon="queue_music" title=${name} sub="Playlist" />`)}
      <${More} rest=${playlists.length - LIST_ROWS} what="playlists" />`;
  return html`<${HomeCard} sec=${sec} count=${playlists.length} grid=${grid}>${body}</${HomeCard}>`;
}

const CARDS = {
  dj: DjCard, downloads: DownloadsCard, recent: RecentCard, added: AddedCard, albums: AlbumsCard, artists: ArtistsCard,
  tracks: TracksCard, genres: GenresCard, folders: FoldersCard, favorites: FavoritesCard, playlists: PlaylistsCard,
};

// ── Home ────────────────────────────────────────────────────────────────

export function Home() {
  const features = useStore(app, (s) => s.features);
  const counts = useStore(app, (s) => s.counts);
  const stored = useStore(app, (s) => s.home);
  const [q, setQ] = useState('');
  const searchRef = useRef();

  useEffect(() => {
    const key = (e) => {
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  const submit = (v) => { setQ(v); if (v.trim()) { go('search', { q: v }); } };
  const statLine = [
    counts.albums != null && `${fmtCount(counts.albums)} ALBUMS`,
    counts.artists != null && `${fmtCount(counts.artists)} ARTISTS`,
    counts.tracks != null && `${fmtCount(counts.tracks)} TRACKS`,
  ].filter(Boolean).join(' · ');

  const layout = useMemo(() => completeHome(stored).filter((x) => x.mode !== 'off' && (!SECTION[x.id].when || SECTION[x.id].when(features))), [stored, features]);
  const shortcuts = layout.filter((x) => x.mode === 'icon');
  // Cards in order; list cards next to each other share a row.
  const blocks = [];
  layout.filter((x) => x.mode === 'grid' || x.mode === 'list').forEach((x) => {
    const last = blocks[blocks.length - 1];
    if (x.mode === 'list' && last && last.list && last.items.length < 2) { last.items.push(x); } else { blocks.push({ list: x.mode === 'list', items: [x] }); }
  });
  const card = (x) => {
    const C = CARDS[x.id];
    return C ? html`<${C} key=${x.id} sec=${SECTION[x.id]} grid=${x.mode === 'grid'} />` : null;
  };

  return html`<div class="scroll home">
    <header class="screen-head flat">
      <div class="titles"><h1>${greeting()}</h1><span class="micro">${statLine}</span></div>
      <${SearchField} value=${q} onInput=${submit} width=${300} hotkey="/" inputRef=${searchRef} />
      <a class="btn btn-outline" href=${href('customize')} title="Customize home"><${Icon} name="tune" size=${15} />Customize</a>
    </header>
    ${shortcuts.length ? html`<nav class="home-shortcuts">${shortcuts.map((x) => {
      const sec = SECTION[x.id];
      return html`<a class="shortcut" href=${href(sec.to || 'home')}><${Plate} icon=${sec.icon} size=${32} iconSize=${17} /><span>${sec.label}</span></a>`;
    })}</nav>` : null}
    ${blocks.map((b) => (b.list
      ? html`<div class=${`home-lists ${b.items.length === 1 ? 'solo' : ''}`} key=${b.items.map((x) => x.id).join()}>${b.items.map(card)}</div>`
      : html`<div key=${b.items[0].id}>${card(b.items[0])}</div>`))}
    ${!layout.length ? html`<div class="empty"><${Plate} icon="tune" size=${40} iconSize=${20} tone="muted" />
      <div class="empty-title">Home is empty.</div>
      <div class="empty-text"><a href=${href('customize')}>Customize home</a> to add sections.</div></div>` : null}
  </div>`;
}

// ── Customize home ──────────────────────────────────────────────────────

export function CustomizeHome() {
  const stored = useStore(app, (s) => s.home);
  const features = useStore(app, (s) => s.features);
  const items = completeHome(stored).filter((x) => !SECTION[x.id].when || SECTION[x.id].when(features));
  const [drag, setDrag] = useState(null);   // { from, over }
  // Sections the server doesn't offer keep their place (they come back with the feature).
  const save = (visible) => {
    const all = completeHome(stored);
    const hidden = all.filter((x) => !visible.some((v) => v.id === x.id));
    setPref({ home: [...visible, ...hidden] });
  };
  const setMode = (id, mode) => save(items.map((x) => (x.id === id ? { ...x, mode } : x)));
  const move = (from, to) => {
    if (from === to || to < 0 || to >= items.length) { return; }
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    save(next);
  };
  return html`<div class="screen">
    <${Header} back title="Customize home" sub="SECTIONS · ORDER">
      <${Btn} icon="restart_alt" onClick=${() => setPref({ home: null })}>Reset</${Btn}>
    </${Header}>
    <div class="scroll pad">
      <p class="hint ch-hint">Icon adds a shortcut to the top row. Grid and List add a card. Drag to reorder.</p>
      <div class="card table-card ch-list">
        <div class="ch-row ch-head micro"><span></span><span>SECTION</span><span>SHOW AS</span></div>
        ${items.map((x, i) => {
          const sec = SECTION[x.id];
          return html`<div key=${x.id} class=${`ch-row ${drag?.from === i ? 'dragging' : ''} ${drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'drop-after' : 'drop-before') : ''}`}
            draggable="true"
            onDragStart=${(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.id); setDrag({ from: i, over: i }); }}
            onDragOver=${(e) => { if (drag) { e.preventDefault(); if (drag.over !== i) { setDrag({ ...drag, over: i }); } } }}
            onDrop=${(e) => { e.preventDefault(); if (drag) { move(drag.from, i); } setDrag(null); }}
            onDragEnd=${() => setDrag(null)}>
            <span class="ch-handle" title="Drag to reorder"><${Icon} name="drag_indicator" size=${18} /></span>
            <span class="ch-name"><${Plate} icon=${sec.icon} size=${26} iconSize=${14} tone=${x.mode === 'off' ? 'muted' : 'accent'} />${sec.label}</span>
            <span class="ch-mode">
              <div class="seg">${HOME_MODES.map((m) => html`<button type="button" class=${x.mode === m.value ? 'on' : ''}
                disabled=${!modeAllowed(sec, m.value)} title=${!modeAllowed(sec, m.value) ? 'Not for this section' : ''}
                onClick=${() => setMode(x.id, m.value)}>${m.label}</button>`)}</div>
              <span class="ch-move">
                <button type="button" title="Move up" disabled=${i === 0} onClick=${() => move(i, i - 1)}><${Icon} name="arrow_upward" size=${14} /></button>
                <button type="button" title="Move down" disabled=${i === items.length - 1} onClick=${() => move(i, i + 1)}><${Icon} name="arrow_downward" size=${14} /></button>
              </span>
            </span>
          </div>`;
        })}
      </div>
    </div>
  </div>`;
}
