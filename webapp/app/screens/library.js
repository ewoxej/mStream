// Home, Recently played, Albums, Artists, All tracks, Genres, Favorites,
// Search — and the album / artist / genre detail lists.
import { html, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { app, useStore, href, go, savePrefs } from '../store.js';
import * as lib from '../library.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import {
  Icon, Btn, Cover, Plate, Header, SearchField, Seg, Empty, Spinner, TrackTable, AlbumTile, useAsync,
} from '../ui.js';
import {
  fmtCount, fmtTime, plural, groupLetter, sumDuration, dayBucket, clockLabel, greeting, trackTitle,
  trackArtist, trackCover,
} from '../util.js';
import { djSummaryChips, djAhead } from './dj.js';
import { DownloadsCard } from './downloads.js';

const by = (f) => (a, b) => String(f(a) ?? '').localeCompare(String(f(b) ?? ''), undefined, { sensitivity: 'base', numeric: true });

function Loading({ state, children }) {
  if (state.loading && !state.data) { return html`<${Spinner} />`; }
  if (state.error) { return html`<${Empty} icon="circle-alert" title="Could not load this">${String(state.error.message || state.error)}</${Empty}>`; }
  return children(state.data);
}

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

// ── Home ────────────────────────────────────────────────────────────────

export function Home() {
  const counts = useStore(app, (s) => s.counts);
  const playlists = useStore(app, (s) => s.playlists);
  const dj = useStore(playback, (s) => ({ on: s.autoDJ, ahead: djAhead(s) }));
  const [q, setQ] = useState('');
  const recent = useAsync(() => lib.recentlyPlayed(60), []);
  const added = useAsync(() => lib.recentlyAdded(80), []);
  const currentPath = useStore(playback, (s) => s.currentPath);
  const searchRef = useRef();

  useEffect(() => {
    const key = (e) => {
      if (e.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

  const submit = (v) => { setQ(v); if (v.trim()) { go('search', { q: v }); } };
  const recentAlbums = uniqueAlbums(recent.data || [], 6);
  const addedAlbums = uniqueAlbums(added.data || [], 4);
  const statLine = [
    counts.albums != null && `${fmtCount(counts.albums)} ALBUMS`,
    counts.artists != null && `${fmtCount(counts.artists)} ARTISTS`,
    counts.tracks != null && `${fmtCount(counts.tracks)} TRACKS`,
  ].filter(Boolean).join(' · ');

  return html`<div class="scroll home">
    <header class="screen-head flat">
      <div class="titles"><h1>${greeting()}</h1><span class="micro">${statLine}</span></div>
      <${SearchField} value=${q} onInput=${submit} placeholder="Search tracks, albums, artists" width=${300} hotkey="/" inputRef=${searchRef} />
    </header>

    <div class="home-hero">
      <section class=${`card dj-card ${dj.on ? 'on' : ''}`}>
        <div class="card-head"><${Plate} icon="radio" /><span class="card-title">Auto DJ</span>
          <span class="micro accent">${dj.on ? `RUNNING · ${dj.ahead} AHEAD` : 'OFF'}</span></div>
        <p class="card-text">Picks random tracks from the chosen folders and keeps the queue filled. Recently picked tracks are skipped.</p>
        <div class="chips">${djSummaryChips().map((c) => html`<span class="chip static">${c}</span>`)}</div>
        <div class="card-actions">
          <${Btn} kind="primary" icon=${dj.on ? 'square' : 'play'} onClick=${P.toggleAutoDJ}>${dj.on ? 'Stop Auto DJ' : 'Start Auto DJ'}</${Btn}>
          <a class="btn btn-outline" href=${href('dj')}>Sources and filters</a>
        </div>
      </section>
      <${DownloadsCard} />
    </div>

    <section class="block">
      <div class="block-head"><span class="block-title">Recently played</span><a href=${href('recent')} class="see-all">See all</a></div>
      ${recent.loading && !recent.data ? html`<${Spinner} />` : recentAlbums.length ? html`<div class="grid g6">
        ${recentAlbums.map((a) => html`<${AlbumTile} album=${a} meta=${a.artist} highlight=${a.first.filepath === currentPath} />`)}
      </div>` : html`<div class="hint">Nothing played yet. Start with an album or switch on Auto DJ.</div>`}
    </section>

    <div class="home-lists">
      <section class="card list-card">
        <div class="card-head pad"><${Plate} icon="sparkle" /><span class="card-title">Recently added</span>
          <span class="micro-n">${added.data ? `${fmtCount(added.data.length)}${added.data.length >= 80 ? '+' : ''} TRACKS` : ''}</span></div>
        ${addedAlbums.map((a) => html`<a class="mini-row" href=${href('album', a.name, { artist: a.album_artist })}>
          <${Cover} file=${a.album_art_file} class="mini-cover" />
          <div class="mini-text"><span>${a.name}</span><small>${a.artist}</small></div>
          <span class="micro-n">${a.first.metadata?.['created-at'] ? clockLabel(Date.parse(a.first.metadata['created-at'].replace(' ', 'T') + 'Z')) : ''}</span>
        </a>`)}
        ${added.data && !addedAlbums.length ? html`<div class="hint pad">No new albums.</div>` : null}
      </section>
      <section class="card list-card">
        <div class="card-head pad"><${Plate} icon="list-music" /><span class="card-title">Playlists</span>
          <span class="micro-n">${playlists.length}</span></div>
        ${playlists.slice(0, 4).map((name) => html`<a class="mini-row" href=${href('playlist', name)}>
          <div class="mini-cover plate-chip"><${Icon} name="list-music" size=${15} /></div>
          <div class="mini-text"><span>${name}</span><small>Playlist</small></div>
        </a>`)}
        ${!playlists.length ? html`<div class="hint pad">No playlists yet. Save the queue or use “Add to playlist” on any track.</div>` : null}
      </section>
    </div>
  </div>`;
}

// ── Recently played ─────────────────────────────────────────────────────

const parseTs = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ+]/.test(s) ? '' : 'Z')) : NaN);

export function Recent() {
  const state = useAsync(() => lib.recentlyPlayed(200), []);
  return html`<div class="screen">
    <${Header} title="Recently played" sub=${state.data ? `${fmtCount(state.data.length)} TRACKS · NEWEST FIRST` : ''} >
      ${state.data?.length ? html`<${Btn} kind="primary" icon="play" iconSize=${14} onClick=${() => P.playTracks(state.data)}>Play all</${Btn}>` : null}
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
        empty=${html`<${Empty} icon="history" title="Nothing played yet">Tracks you finish show up here.</${Empty}>`} />`;
    }}</${Loading}>
  </div>`;
}

// ── Albums ──────────────────────────────────────────────────────────────

const ALBUM_SORTS = [
  { key: 'name', label: 'Name', asc: 'A → Z', desc: 'Z → A', f: (a) => a.name },
  { key: 'artist', label: 'Artist', asc: 'A → Z', desc: 'Z → A', f: (a) => a.album_artist || (a.artists || [])[0] },
  { key: 'year', label: 'Year', asc: 'Oldest', desc: 'Newest', f: (a) => a.year_min || a.year || 0, num: true },
  { key: 'tracks', label: 'Length', asc: 'Shortest', desc: 'Longest', f: (a) => a.duration || 0, num: true },
];

function SortPopover({ sorts, value, onChange, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) { onClose(); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return html`<div class="popover sort-pop" ref=${ref}>
    <div class="sort-grid micro"><span>SORT BY</span><span>ASCENDING</span><span>DESCENDING</span></div>
    ${sorts.map((s) => html`<div class="sort-grid">
      <span class="sort-label">${s.label}</span>
      ${['asc', 'desc'].map((d) => html`<button type="button" class=${`cell ${value.key === s.key && value.dir === d ? 'on' : ''}`}
        onClick=${() => { onChange({ key: s.key, dir: d }); onClose(); }}>${s[d]}</button>`)}
    </div>`)}
  </div>`;
}

export function Albums() {
  const view = useStore(app, (s) => s.albumView);
  const sort = useStore(app, (s) => s.albumSort);
  const [q, setQ] = useState('');
  const [sortOpen, setSortOpen] = useState(false);
  const state = useAsync(() => lib.albums(), []);
  const def = ALBUM_SORTS.find((s) => s.key === sort.key) || ALBUM_SORTS[0];

  const list = useMemo(() => {
    let a = state.data || [];
    if (q) {
      const n = q.toLowerCase();
      a = a.filter((x) => (x.name || '').toLowerCase().includes(n) || (x.album_artist || '').toLowerCase().includes(n));
    }
    const cmp = def.num ? (x, y) => (def.f(x) - def.f(y)) : by(def.f);
    a = [...a].sort(cmp);
    return sort.dir === 'desc' ? a.reverse() : a;
  }, [state.data, q, sort.key, sort.dir]);

  const setView = (v) => { app.set({ albumView: v }); savePrefs(); };
  const setSort = (v) => { app.set({ albumSort: v }); savePrefs(); };
  const metaFor = (a) => [a.album_artist || (a.artists || []).join(', '), sort.key === 'tracks' ? fmtTime(a.duration) : (a.year || '')].filter(Boolean).join(' · ');

  return html`<div class="screen">
    <${Header} title="Albums" sub=${`${fmtCount(list.length)} · BY ${def.label.toUpperCase()} · ${def[sort.dir].toUpperCase()}`}>
      <${SearchField} value=${q} onInput=${setQ} placeholder="Filter albums" width=${240} />
      <div class="pop-anchor">
        <${Btn} icon="arrow-up-down" class=${sortOpen ? 'on' : ''} onClick=${() => setSortOpen(!sortOpen)}>Sort</${Btn}>
        ${sortOpen ? html`<${SortPopover} sorts=${ALBUM_SORTS} value=${sort} onChange=${setSort} onClose=${() => setSortOpen(false)} />` : null}
      </div>
      <${Seg} class="icons" value=${view} onChange=${setView} options=${[
        { value: 'grid', icon: 'layout-grid', title: 'Small tiles' },
        { value: 'grid-lg', icon: 'grid-2x2', title: 'Large tiles' },
        { value: 'list', icon: 'list', title: 'List' }]} />
    </${Header}>
    <div class="scroll pad">
      <${Loading} state=${state}>${() => !list.length ? html`<${Empty} icon="disc-3" title=${q ? 'No albums match' : 'No albums yet'} />`
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
      ${who ? html`<a class="btn btn-outline" href=${href('artist', who)}><${Icon} name="mic-vocal" size=${15} />Artist</a>` : null}
      <${Btn} icon="download" onClick=${() => lib.downloadTracks(tracks)} disabled=${!tracks.length}>.zip</${Btn}>
      <${Btn} icon="shuffle" onClick=${() => P.shufflePlay(tracks)} disabled=${!tracks.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play" iconSize=${14} onClick=${() => P.playTracks(tracks)} disabled=${!tracks.length}>Play all</${Btn}>
    </${Header}>
    <${Loading} state=${state}>${() => html`<${TrackTable} groups=${groups} hideAlbum
      firstValue=${(t, i) => t.metadata?.track || i + 1}
      empty=${html`<${Empty} icon="disc-3" title="This album has no tracks" />`} />`}</${Loading}>
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

export function Artists() {
  const [q, setQ] = useState('');
  const state = useAsync(() => lib.artists(), []);
  const facts = useArtistFacts();
  const currentArtist = useStore(playback, (s) => (s.current?.metadata?.artist || '').toLowerCase());
  const list = (state.data || []).filter((n) => !q || n.toLowerCase().includes(q.toLowerCase()));
  return html`<div class="screen">
    <${Header} title="Artists" sub=${`${fmtCount(list.length)} · BY NAME · A → Z`}>
      <${SearchField} value=${q} onInput=${setQ} placeholder="Filter artists" width=${240} />
    </${Header}>
    <div class="scroll pad">
      <${Loading} state=${state}>${() => !list.length ? html`<${Empty} icon="mic-vocal" title=${q ? 'No artists match' : 'No artists yet'} />`
        : html`<div class="grid g6 artists">${list.map((n) => {
          const f = facts.get(n.toLowerCase());
          const hl = n.toLowerCase() === currentArtist;
          return html`<a class=${`tile artist ${hl ? 'hl' : ''}`} href=${href('artist', n)}>
            <${Cover} file=${f?.art} round ring=${hl}>${!f?.art ? html`<span class="initials">${n.trim().charAt(0).toUpperCase()}</span>` : null}</${Cover}>
            <span class="tile-t">${n}</span>
            <span class="tile-s mono">${f ? `${plural(f.albums, 'album')} · ${plural(f.tracks, 'track')}` : ''}</span>
          </a>`;
        })}</div>`}
      </${Loading}>
    </div>
  </div>`;
}

export function Artist({ args }) {
  const name = args[0] || '';
  const state = useAsync(() => lib.artistAlbums(name), [name]);
  const albums = state.data || [];
  const playAll = async (shuffle) => {
    const lists = await Promise.all(albums.map((a) => lib.albumSongs(a.name, a.album_artist)));
    const all = lists.flat();
    if (shuffle) { P.shufflePlay(all); } else { P.playTracks(all); }
  };
  return html`<div class="screen">
    <${Header} back title=${name} sub=${state.data ? plural(albums.length, 'album').toUpperCase() : ''}>
      <${Btn} icon="shuffle" onClick=${() => playAll(true)} disabled=${!albums.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play" iconSize=${14} onClick=${() => playAll(false)} disabled=${!albums.length}>Play all</${Btn}>
    </${Header}>
    <div class="scroll pad">
      <${Loading} state=${state}>${() => albums.length
        ? html`<div class="grid g6">${albums.map((a) => html`<${AlbumTile} album=${a} meta=${[a.year, a.track_count && plural(a.track_count, 'track')].filter(Boolean).join(' · ')} />`)}</div>`
        : html`<${Empty} icon="disc-3" title="No albums for this artist" />`}
      </${Loading}>
    </div>
  </div>`;
}

// ── All tracks ──────────────────────────────────────────────────────────

export function Tracks() {
  const [q, setQ] = useState('');
  const state = useAsync(() => lib.allSongs(), []);
  const groups = useMemo(() => {
    let tracks = state.data || [];
    if (q) {
      const n = q.toLowerCase();
      tracks = tracks.filter((t) => trackTitle(t).toLowerCase().includes(n) || trackArtist(t).toLowerCase().includes(n)
        || (t.metadata?.album || '').toLowerCase().includes(n));
    }
    const out = [];
    tracks.forEach((t) => {
      const l = groupLetter(trackTitle(t));
      const g = out[out.length - 1];
      if (g && g.label === l) { g.tracks.push(t); } else { out.push({ label: l, tracks: [t] }); }
    });
    // The server sorts with SQLite NOCASE; regroup so "#" lands last.
    out.sort((a, b) => (a.label === '#') - (b.label === '#') || a.label.localeCompare(b.label));
    const merged = [];
    out.forEach((g) => {
      const m = merged.find((x) => x.label === g.label);
      if (m) { m.tracks.push(...g.tracks); } else { merged.push(g); }
    });
    return merged;
  }, [state.data, q]);
  const all = groups.flatMap((g) => g.tracks);
  return html`<div class="screen">
    <${Header} title="All tracks" sub=${state.data ? `${fmtCount(all.length)} · BY NAME · A → Z` : ''}>
      <${SearchField} value=${q} onInput=${setQ} placeholder="Filter" width=${200} />
      <${Btn} icon="shuffle" onClick=${() => P.shufflePlay(all)} disabled=${!all.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play" iconSize=${14} onClick=${() => P.playTracks(all)} disabled=${!all.length}>Play all</${Btn}>
    </${Header}>
    <${Loading} state=${state}>${() => html`<${TrackTable} groups=${groups} rail
      empty=${html`<${Empty} icon="music" title=${q ? 'No tracks match' : 'No tracks yet'} />`} />`}</${Loading}>
  </div>`;
}

// ── Genres ──────────────────────────────────────────────────────────────

export function Genres() {
  const state = useAsync(() => lib.genres(), []);
  const list = [...(state.data || [])].sort((a, b) => (b.track_count || 0) - (a.track_count || 0));
  const max = list[0]?.track_count || 1;
  const djGenre = (e, g) => {
    e.preventDefault();
    e.stopPropagation();
    AUTODJ.setState({ djGenreEnabled: true, djGenreMode: 'whitelist', djGenres: [g.name] });
    if (!MSTREAMPLAYER.playerStats.autoDJ) { P.toggleAutoDJ(); }
    P.toast(`Auto DJ: ${g.name}`);
  };
  return html`<div class="screen">
    <${Header} title="Genres" sub=${`${fmtCount(list.length)} · BY NUMBER OF TRACKS`} />
    <div class="scroll pad">
      <${Loading} state=${state}>${() => list.length ? html`
        <div class="grid g4 genres">${list.map((g) => html`<a class="card genre-tile" href=${href('genre', g.name)}>
          <div class="gt-top"><span>${g.name}</span>
            <button type="button" class="round-btn" title=${`Auto DJ: ${g.name}`} onClick=${(e) => djGenre(e, g)}><${Icon} name="radio" size=${14} /></button></div>
          <div class="gt-bottom"><span class="micro-n">${plural(g.track_count || 0, 'track')}</span>
            <div class="meter"><div style=${{ width: Math.max(2, Math.round((g.track_count || 0) / max * 100)) + '%' }}></div></div></div>
        </a>`)}</div>
        <div class="hint top">The round button starts Auto DJ limited to that genre.</div>`
        : html`<${Empty} icon="tags" title="No genres">Tracks without genre tags don't show here.</${Empty}>`}
      </${Loading}>
    </div>
  </div>`;
}

export function Genre({ args }) {
  const name = args[0] || '';
  const state = useAsync(() => lib.genreSongs(name), [name]);
  const tracks = state.data || [];
  return html`<div class="screen">
    <${Header} back title=${name} sub=${state.data ? `GENRE · ${plural(tracks.length, 'track').toUpperCase()}` : ''}>
      <${Btn} icon="shuffle" onClick=${() => P.shufflePlay(tracks)} disabled=${!tracks.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play" iconSize=${14} onClick=${() => P.playTracks(tracks)} disabled=${!tracks.length}>Play all</${Btn}>
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
  const tracks = state.data || [];
  const count = tracks.filter((t) => likes[t.filepath] !== false).length;
  useEffect(() => { if (state.data) { app.set({ counts: { ...app.get().counts, liked: count } }); } }, [count, state.data]);
  return html`<div class="screen">
    <${Header} title="Favorites" sub=${state.data ? `${fmtCount(count)} LIKED` : ''}>
      <${Btn} icon="shuffle" onClick=${() => P.shufflePlay(tracks)} disabled=${!tracks.length}>Shuffle</${Btn}>
      <${Btn} kind="primary" icon="play" iconSize=${14} onClick=${() => P.playTracks(tracks)} disabled=${!tracks.length}>Play all</${Btn}>
    </${Header}>
    <${Loading} state=${state}>${() => html`<${TrackTable} groups=${[{ tracks }]}
      empty=${html`<${Empty} icon="heart" title="No favorites yet">Tap the heart on any track to keep it here.</${Empty}>`} />`}</${Loading}>
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
      <${SearchField} value=${q} onInput=${setQ} placeholder="Search the library" width=${320} autoFocus />
    </${Header}>
    <div class="scroll pad search-results">
      ${!query.trim() ? html`<${Empty} icon="search" title="Search the library">Type a title, an album or an artist.</${Empty}>` : null}
      ${state.loading && !r && query.trim() ? html`<${Spinner} />` : null}
      ${nothing ? html`<${Empty} icon="search" title=${`Nothing for “${query}”`} />` : null}
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
