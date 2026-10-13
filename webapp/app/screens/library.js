// Recently played, Albums, Artists, All tracks, Genres, Favorites, Search —
// and the album / artist / genre detail lists. Home is in home.js.
import { html, useEffect, useMemo, useState } from '../vendor/preact-htm.js';
import { app, useStore, href, setPref } from '../store.js';
import { useSort, useSorted, SortButton, letterGroups } from '../sort.js';
import * as lib from '../library.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import {
  Icon, Btn, Cover, Header, SearchField, Seg, Empty, Spinner, TrackTable, AlbumTile, useAsync,
} from '../ui.js';
import {
  fmtCount, fmtTime, plural, sumDuration, dayBucket, clockLabel, trackTitle,
  trackArtist, trackCover,
} from '../util.js';

function Loading({ state, children }) {
  if (state.loading && !state.data) { return html`<${Spinner} />`; }
  if (state.error) { return html`<${Empty} icon="error_outline" title="Could not load this">${String(state.error.message || state.error)}</${Empty}>`; }
  return children(state.data);
}

// ── Recently played ─────────────────────────────────────────────────────

const parseTs = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ+]/.test(s) ? '' : 'Z')) : NaN);

export function Recent() {
  const state = useAsync(() => lib.recentlyPlayed(200), []);
  return html`<div class="screen">
    <${Header} title="Recently played" sub=${state.data ? `${fmtCount(state.data.length)} TRACKS · NEWEST FIRST` : ''} >
      ${state.data?.length ? html`<${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => P.playTracks(state.data)}>Play all</${Btn}>` : null}
    </${Header}>
    <${Loading} state=${state}>${(tracks) => {
      const groups = [];
      tracks.forEach((t) => {
        const label = dayBucket(parseTs(t.metadata?.['last-played']));
        const g = groups[groups.length - 1];
        if (g && g.label === label) { g.tracks.push(t); } else { groups.push({ label, tracks: [t] }); }
      });
      return html`<${TrackTable} groups=${groups} firstCol="TIME"
        firstValue=${(t) => clockLabel(parseTs(t.metadata?.['last-played']))}
        empty=${html`<${Empty} icon="history" title="Nothing played yet.">Tracks you listen to show up here.</${Empty}>`} />`;
    }}</${Loading}>
  </div>`;
}

// ── Albums ──────────────────────────────────────────────────────────────

export function Albums() {
  const view = useStore(app, (s) => s.albumView);
  const sort = useSort('albums');
  const [q, setQ] = useState('');
  const state = useAsync(() => lib.albums(), []);
  const filtered = useMemo(() => {
    const a = state.data || [];
    if (!q) { return a; }
    const n = q.toLowerCase();
    return a.filter((x) => (x.name || '').toLowerCase().includes(n) || (x.album_artist || '').toLowerCase().includes(n));
  }, [state.data, q]);
  const list = useSorted(filtered, sort);
  const key = sort.value.key;
  const metaFor = (a) => [a.album_artist || (a.artists || []).join(', '), key === 'duration' ? fmtTime(a.duration) : key === 'count' ? plural(a.track_count || 0, 'track') : (a.year || '')].filter(Boolean).join(' · ');

  return html`<div class="screen">
    <${Header} title="Albums" sub=${`${fmtCount(list.length)} · ${sort.label}`}>
      <${SearchField} value=${q} onInput=${setQ} width=${240} />
      <${SortButton} sort=${sort} />
      <${ViewSeg} value=${view} onChange=${(v) => setPref({ albumView: v })} />
    </${Header}>
    <div class="scroll pad">
      <${Loading} state=${state}>${() => !list.length ? html`<${Empty} icon="album" title=${q ? 'Nothing found' : 'No albums yet.'}>${q ? 'Try other search terms.' : 'Albums come from the tags of your files once the library is scanned.'}</${Empty}>`
        : view === 'list' ? html`<div class="card table-card">
          ${list.map((a) => html`<a class="alb-row" href=${href('album', a.name, { artist: a.album_artist || '' })}>
            <${Cover} file=${a.album_art_file} class="alb-cover" />
            <span class="alb-t">${a.name || 'Unknown album'}</span>
            <span class="alb-a">${a.album_artist || (a.artists || []).join(', ')}</span>
            <span class="alb-y">${a.year || ''}</span>
            <span class="alb-n">${plural(a.track_count || 0, 'track')}</span>
            <span class="alb-d">${fmtTime(a.duration)}</span>
          </a>`)}
        </div>`
        : html`<div class=${`grid ${view === 'grid-lg' ? 'g4' : 'g6'}`}>${list.map((a) => html`<${AlbumTile} album=${a} meta=${metaFor(a)} />`)}</div>`}
      </${Loading}>
    </div>
  </div>`;
}

// Small tiles / large tiles / list, as on Albums and Artists.
function ViewSeg({ value, onChange }) {
  return html`<${Seg} class="icons" value=${value} onChange=${onChange} options=${[
    { value: 'grid', icon: 'apps', title: 'Small tiles' },
    { value: 'grid-lg', icon: 'grid_view', title: 'Large tiles' },
    { value: 'list', icon: 'view_list', title: 'List' }]} />`;
}

export function Album({ args, params }) {
  const name = args[0] || '';
  const artist = params.artist || '';
  const state = useAsync(() => lib.albumSongs(name, artist), [name, artist]);
  const tracks = state.data || [];
  const first = tracks[0];
  const year = first?.metadata?.year;
  const who = artist || (first ? trackArtist(first) : '');
  const discs = new Set(tracks.map((t) => t.metadata?.disk || 1));
  const groups = discs.size > 1
    ? [...discs].sort((a, b) => a - b).map((d) => ({ label: `DISC ${d}`, tracks: tracks.filter((t) => (t.metadata?.disk || 1) === d) }))
    : [{ tracks }];
  return html`<div class="screen">
    <${Header} back title=${name || 'Unknown album'}
      sub=${[who, year, tracks.length && plural(tracks.length, 'track'), tracks.length && fmtTime(sumDuration(tracks))].filter(Boolean).join(' · ').toUpperCase()}>
      ${first ? html`<${Cover} file=${trackCover(first)} class="head-cover" />` : null}
      ${who ? html`<a class="btn btn-outline" href=${href('artist', who)} title="Artist"><${Icon} name="person" size=${15} />Artist</a>` : null}
      <${Btn} icon="download" onClick=${() => lib.downloadTracks(tracks)} disabled=${!tracks.length}>.zip</${Btn}>
      <${Btn} icon="shuffle" onClick=${() => P.shufflePlay(tracks)} disabled=${!tracks.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => P.playTracks(tracks)} disabled=${!tracks.length}>Play all</${Btn}>
    </${Header}>
    <${Loading} state=${state}>${() => html`<${TrackTable} groups=${groups} hideAlbum
      firstValue=${(t, i) => t.metadata?.track || i + 1}
      empty=${html`<${Empty} icon="album" title="This album has no tracks" />`} />`}</${Loading}>
  </div>`;
}

// ── Artists ─────────────────────────────────────────────────────────────

// Art and counts come from the album list: an artist's first album cover.
function useArtistFacts() {
  const albums = useAsync(() => lib.albums(), []);
  return useMemo(() => {
    const m = new Map();
    (albums.data || []).forEach((a) => {
      const names = new Set([a.album_artist, ...(a.artists || [])].filter(Boolean));
      names.forEach((n) => {
        const k = n.toLowerCase();
        const f = m.get(k) || { albums: 0, tracks: 0, art: null };
        f.albums++;
        f.tracks += a.track_count || 0;
        f.art = f.art || a.album_art_file;
        m.set(k, f);
      });
    });
    return m;
  }, [albums.data]);
}

// Artist rows for lists, Home and sorting: { name, albums, tracks, art }.
export function useArtistRows() {
  const state = useAsync(() => lib.artists(), []);
  const facts = useArtistFacts();
  const rows = useMemo(() => (state.data || []).map((name) => {
    const f = facts.get(name.toLowerCase());
    return { name, albums: f?.albums || 0, tracks: f?.tracks || 0, art: f?.art || null };
  }), [state.data, facts]);
  return { state, rows };
}

export const artistDetail = (a) => (a.albums || a.tracks ? `${plural(a.albums, 'album')} · ${plural(a.tracks, 'track')}` : '');

export function ArtistTile({ artist, highlight }) {
  return html`<a class=${`tile artist ${highlight ? 'hl' : ''}`} href=${href('artist', artist.name)}>
    <${Cover} file=${artist.art} size="l" round ring=${highlight}>${!artist.art ? html`<span class="initials">${artist.name.trim().charAt(0).toUpperCase()}</span>` : null}</${Cover}>
    <span class="tile-t">${artist.name}</span>
    <span class="tile-s mono">${artistDetail(artist)}</span>
  </a>`;
}

export function Artists() {
  const [q, setQ] = useState('');
  const view = useStore(app, (s) => s.artistView);
  const sort = useSort('artists');
  const { state, rows } = useArtistRows();
  const currentArtist = useStore(playback, (s) => (s.current?.metadata?.artist || '').toLowerCase());
  const filtered = useMemo(() => rows.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  const list = useSorted(filtered, sort);
  return html`<div class="screen">
    <${Header} title="Artists" sub=${`${fmtCount(list.length)} · ${sort.label}`}>
      <${SearchField} value=${q} onInput=${setQ} width=${240} />
      <${SortButton} sort=${sort} />
      <${ViewSeg} value=${view} onChange=${(v) => setPref({ artistView: v })} />
    </${Header}>
    <div class="scroll pad">
      <${Loading} state=${state}>${() => !list.length ? html`<${Empty} icon="person" title=${q ? 'Nothing found' : 'No artists yet.'}>${q ? 'Try other search terms.' : 'Artists come from the tags of your files once the library is scanned.'}</${Empty}>`
        : view === 'list' ? html`<div class="card table-card">
          ${list.map((a) => html`<a class=${`alb-row ${a.name.toLowerCase() === currentArtist ? 'hl' : ''}`} href=${href('artist', a.name)}>
            <${Cover} file=${a.art} round class="alb-cover">${!a.art ? html`<span class="initials">${a.name.trim().charAt(0).toUpperCase()}</span>` : null}</${Cover}>
            <span class="alb-t">${a.name}</span>
            <span class="alb-n">${plural(a.albums, 'album')}</span>
            <span class="alb-d">${plural(a.tracks, 'track')}</span>
          </a>`)}
        </div>`
        : html`<div class=${`grid ${view === 'grid-lg' ? 'g4' : 'g6'} artists`}>${list.map((a) => html`<${ArtistTile} artist=${a} highlight=${a.name.toLowerCase() === currentArtist} />`)}</div>`}
      </${Loading}>
    </div>
  </div>`;
}

export function Artist({ args }) {
  const name = args[0] || '';
  const state = useAsync(() => lib.artistAlbums(name), [name]);
  const sort = useSort('artistAlbums');
  const albums = useSorted(state.data, sort);
  const playAll = async (shuffle) => {
    const lists = await Promise.all(albums.map((a) => lib.albumSongs(a.name, a.album_artist)));
    const all = lists.flat();
    if (shuffle) { P.shufflePlay(all); } else { P.playTracks(all); }
  };
  return html`<div class="screen">
    <${Header} back title=${name} sub=${state.data ? `${plural(albums.length, 'album').toUpperCase()} · ${sort.label}` : ''}>
      <${SortButton} sort=${sort} />
      <${Btn} icon="shuffle" onClick=${() => playAll(true)} disabled=${!albums.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => playAll(false)} disabled=${!albums.length}>Play all</${Btn}>
    </${Header}>
    <div class="scroll pad">
      <${Loading} state=${state}>${() => albums.length
        ? html`<div class="grid g6">${albums.map((a) => html`<${AlbumTile} album=${a} meta=${[a.year, a.track_count && plural(a.track_count, 'track')].filter(Boolean).join(' · ')} />`)}</div>`
        : html`<${Empty} icon="album" title="No albums for this artist" />`}
      </${Loading}>
    </div>
  </div>`;
}

// ── All tracks ──────────────────────────────────────────────────────────

export function Tracks() {
  const [q, setQ] = useState('');
  const sort = useSort('tracks');
  const state = useAsync(() => lib.allSongs(), []);
  const filtered = useMemo(() => {
    const tracks = state.data || [];
    if (!q) { return tracks; }
    const n = q.toLowerCase();
    return tracks.filter((t) => trackTitle(t).toLowerCase().includes(n) || trackArtist(t).toLowerCase().includes(n)
      || (t.metadata?.album || '').toLowerCase().includes(n));
  }, [state.data, q]);
  const all = useSorted(filtered, sort);
  // A–Z headers and the rail for a text sort, one plain list otherwise.
  const groups = useMemo(() => letterGroups(all, sort.field, sort.value.dir), [all]);
  return html`<div class="screen">
    <${Header} title="All tracks" sub=${state.data ? `${fmtCount(all.length)} · ${sort.label}` : ''}>
      <${SearchField} value=${q} onInput=${setQ} width=${200} />
      <${SortButton} sort=${sort} />
      <${Btn} icon="shuffle" onClick=${() => P.shufflePlay(all)} disabled=${!all.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => P.playTracks(all)} disabled=${!all.length}>Play all</${Btn}>
    </${Header}>
    <${Loading} state=${state}>${() => html`<${TrackTable} groups=${groups} rail=${!sort.field.num && !q}
      empty=${html`<${Empty} icon="music_note" title=${q ? 'Nothing found' : 'No tracks yet.'}>${q ? 'Try other search terms.' : 'The library fills in as your folders are scanned.'}</${Empty}>`} />`}</${Loading}>
  </div>`;
}

// ── Genres ──────────────────────────────────────────────────────────────

export function Genres() {
  const state = useAsync(() => lib.genres(), []);
  const sort = useSort('genres');
  const list = useSorted(state.data, sort);
  const max = Math.max(1, ...list.map((g) => g.track_count || 0));
  const djGenre = (e, g) => {
    e.preventDefault();
    e.stopPropagation();
    AUTODJ.setState({ djGenreEnabled: true, djGenreMode: 'whitelist', djGenres: [g.name] });
    if (!MSTREAMPLAYER.playerStats.autoDJ) { P.toggleAutoDJ(); }
    P.toast(`Auto DJ: ${g.name}`);
  };
  return html`<div class="screen">
    <${Header} title="Genres" sub=${`${fmtCount(list.length)} · ${sort.label}`}>
      <${SortButton} sort=${sort} />
    </${Header}>
    <div class="scroll pad">
      <${Loading} state=${state}>${() => list.length ? html`
        <div class="grid g4 genres">${list.map((g) => html`<a class="card genre-tile" href=${href('genre', g.name)}>
          <div class="gt-top"><span>${g.name}</span>
            <button type="button" class="round-btn" title=${`Auto DJ: ${g.name}`} onClick=${(e) => djGenre(e, g)}><${Icon} name="auto_awesome" size=${14} /></button></div>
          <div class="gt-bottom"><span class="micro-n">${plural(g.track_count || 0, 'track')}</span>
            <div class="meter"><div style=${{ width: Math.max(2, Math.round((g.track_count || 0) / max * 100)) + '%' }}></div></div></div>
        </a>`)}</div>
        <div class="hint top">The round button starts Auto DJ limited to that genre.</div>`
        : html`<${Empty} icon="category" title="No genres yet.">They come from the genre tags of your files.</${Empty}>`}
      </${Loading}>
    </div>
  </div>`;
}

export function Genre({ args }) {
  const name = args[0] || '';
  const state = useAsync(() => lib.genreSongs(name), [name]);
  const sort = useSort('genre');
  const tracks = useSorted(state.data, sort);
  return html`<div class="screen">
    <${Header} back title=${name} sub=${state.data ? `GENRE · ${plural(tracks.length, 'track').toUpperCase()} · ${sort.label}` : ''}>
      <${SortButton} sort=${sort} />
      <${Btn} icon="shuffle" onClick=${() => P.shufflePlay(tracks)} disabled=${!tracks.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => P.playTracks(tracks)} disabled=${!tracks.length}>Play all</${Btn}>
    </${Header}>
    <${Loading} state=${state}>${() => html`<${TrackTable} groups=${[{ tracks }]} />`}</${Loading}>
  </div>`;
}

// ── Favorites ───────────────────────────────────────────────────────────

export function Favorites() {
  const likes = useStore(app, (s) => s.likes);
  const state = useAsync(() => { lib.invalidate('liked'); return lib.liked(); }, []);
  // Tracks unliked on this screen stay until the next visit, dimmed by
  // their heart, so an accidental click is easy to undo.
  const sort = useSort('favorites');
  const tracks = useSorted(state.data, sort);
  const count = tracks.filter((t) => likes[t.filepath] !== false).length;
  useEffect(() => { if (state.data) { app.set({ counts: { ...app.get().counts, liked: count } }); } }, [count, state.data]);
  return html`<div class="screen">
    <${Header} title="Favorites" sub=${state.data ? `${fmtCount(count)} LIKED · ${sort.label}` : ''}>
      <${SortButton} sort=${sort} />
      <${Btn} icon="shuffle" onClick=${() => P.shufflePlay(tracks)} disabled=${!tracks.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => P.playTracks(tracks)} disabled=${!tracks.length}>Play all</${Btn}>
    </${Header}>
    <${Loading} state=${state}>${() => html`<${TrackTable} groups=${[{ tracks }]}
      empty=${html`<${Empty} icon="favorite_border" title="No favorites yet.">Tap the heart on a track, or use its ⋮ menu → Add to favorites.</${Empty}>`} />`}</${Loading}>
  </div>`;
}

// ── Search ──────────────────────────────────────────────────────────────

export function Search({ params }) {
  const [q, setQ] = useState(params.q || '');
  const [query, setQuery] = useState(params.q || '');
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q);
      history.replaceState(null, '', href('search', { q }));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const state = useAsync(() => (query.trim() ? lib.search(query.trim()) : Promise.resolve(null)), [query]);
  const r = state.data;
  const tracks = r ? [...(r.title || []), ...(r.files || [])].filter((x, i, a) => a.findIndex((y) => y.filepath === x.filepath) === i)
    .map((x) => ({ filepath: x.filepath, metadata: x.metadata || {} })) : [];
  const albums = r?.albums || [];
  const artists = r?.artists || [];
  const nothing = r && !tracks.length && !albums.length && !artists.length;
  return html`<div class="screen">
    <${Header} title="Search" sub=${r ? `${artists.length} ARTISTS · ${albums.length} ALBUMS · ${tracks.length} TRACKS` : 'TRACKS · ALBUMS · ARTISTS'}>
      <${SearchField} value=${q} onInput=${setQ} width=${320} autoFocus />
    </${Header}>
    <div class="scroll pad search-results">
      ${!query.trim() ? html`<${Empty} icon="search" title="Search the library">Type a title, an album or an artist.</${Empty}>` : null}
      ${state.loading && !r && query.trim() ? html`<${Spinner} />` : null}
      ${nothing ? html`<${Empty} icon="search" title="Nothing found">Try other search terms.</${Empty}>` : null}
      ${artists.length ? html`<section class="block"><div class="block-head"><span class="block-title">Artists</span></div>
        <div class="grid g6 artists">${artists.slice(0, 12).map((a) => html`<a class="tile artist" href=${href('artist', a.name)}>
          <${Cover} file=${a.album_art_file} round>${!a.album_art_file ? html`<span class="initials">${a.name.charAt(0)}</span>` : null}</${Cover}>
          <span class="tile-t">${a.name}</span></a>`)}</div></section>` : null}
      ${albums.length ? html`<section class="block"><div class="block-head"><span class="block-title">Albums</span></div>
        <div class="grid g6">${albums.slice(0, 12).map((a) => html`<${AlbumTile} album=${{ name: a.name, album_art_file: a.album_art_file, album_artist: '' }} meta="" />`)}</div></section>` : null}
      ${tracks.length ? html`<section class="block tracks-block"><div class="block-head"><span class="block-title">Tracks</span></div>
        <${TrackTable} groups=${[{ tracks }]} /></section>` : null}
    </div>
  </div>`;
}
