// Shared building blocks for the screens.
import { html, useEffect, useMemo, useRef, useState } from './vendor/preact-htm.js';
import { ICONS } from './icons.js';
import { app, useStore, href, go } from './store.js';
import { playback, playTracks, playNext, addToQueue, toggleLike, isLiked, playSimilar } from './player.js';
import { sonicPathAdd } from './screens/sonicpath.js';
import * as lib from './library.js';
import {
  coverUrl, trackTitle, trackArtist, trackAlbum, formatLabel, gainLabel, fmtTime,
} from './util.js';

// ── Primitives ──────────────────────────────────────────────────────────

// The spinner is the one stroked shape: an open arc that .spin rotates.
const PROGRESS = '<path d="M21 12a9 9 0 1 1-6.22-8.56" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>';

// `fill` picks the filled variant where the app has one (the heart of a favorite).
export function Icon({ name, size = 16, fill = false, class: cls = '' }) {
  const glyph = name === 'progress' ? PROGRESS : ICONS[fill && FILLED[name] ? FILLED[name] : name] || '';
  return html`<svg class=${'icon ' + cls} width=${size} height=${size} viewBox="0 0 24 24"
    fill="currentColor" aria-hidden="true" dangerouslySetInnerHTML=${{ __html: glyph }}></svg>`;
}
const FILLED = { favorite_border: 'favorite' };

// Square cover with the striped placeholder from the design.
export function Cover({ file, size = 's', round = false, class: cls = '', children, ring = false }) {
  const [failed, setFailed] = useState(false);
  const url = file && !failed ? coverUrl(file, size) : null;
  return html`<div class=${`cover ${round ? 'round' : ''} ${ring ? 'ring' : ''} ${cls}`}>
    ${url ? html`<img src=${url} loading="lazy" alt="" onError=${() => setFailed(true)} />` : null}
    ${children}
  </div>`;
}

export function Btn({ icon, children, onClick, kind = 'outline', title, disabled, class: cls = '', iconSize = 15 }) {
  return html`<button type="button" class=${`btn btn-${kind} ${cls}`} onClick=${onClick} title=${title} disabled=${disabled}>
    ${icon ? html`<${Icon} name=${icon} size=${iconSize} />` : null}${children}
  </button>`;
}

export function IconBtn({ icon, onClick, title, active = false, size = 16, class: cls = '', fill = false }) {
  return html`<button type="button" class=${`icon-btn ${active ? 'on' : ''} ${cls}`} onClick=${onClick} title=${title} aria-label=${title}>
    <${Icon} name=${icon} size=${size} fill=${fill} />
  </button>`;
}

export function Plate({ icon, tone = 'accent', size = 26, iconSize = 15 }) {
  return html`<div class=${'plate plate-' + tone} style=${{ width: size + 'px', height: size + 'px' }}>
    <${Icon} name=${icon} size=${iconSize} />
  </div>`;
}

export function Toggle({ on, onChange, title }) {
  return html`<button type="button" role="switch" aria-checked=${on} title=${title}
    class=${`toggle ${on ? 'on' : ''}`} onClick=${(e) => { e.stopPropagation(); onChange(!on); }}>
    <span></span>
  </button>`;
}

export function Seg({ options, value, onChange, class: cls = '' }) {
  return html`<div class=${'seg ' + cls}>
    ${options.map((o) => {
      const v = typeof o === 'object' ? o.value : o;
      const label = typeof o === 'object' ? o.label : o;
      return html`<button type="button" class=${v === value ? 'on' : ''} title=${o.title}
        onClick=${() => onChange(v)}>${o.icon ? html`<${Icon} name=${o.icon} size=${15} />` : label}</button>`;
    })}
  </div>`;
}

export function Chip({ on, onClick, children, icon }) {
  return html`<button type="button" class=${`chip ${on ? 'on' : ''}`} onClick=${onClick}>
    ${icon ? html`<${Icon} name=${icon} size=${13} />` : null}${children}
  </button>`;
}

export function SearchField({ value, onInput, placeholder, width, hotkey, autoFocus, inputRef }) {
  const own = useRef();
  const ref = inputRef || own;
  useEffect(() => { if (autoFocus && ref.current) { ref.current.focus(); } }, []);
  return html`<label class="search-field" style=${width ? { width: width + 'px' } : null}>
    <${Icon} name="search" size=${16} />
    <input ref=${ref} value=${value} placeholder=${placeholder}
      onInput=${(e) => onInput(e.currentTarget.value)} />
    ${hotkey && !value ? html`<kbd>${hotkey}</kbd>` : null}
    ${value ? html`<button type="button" class="clear" onClick=${() => onInput('')} aria-label="Clear"><${Icon} name="close" size=${14} /></button>` : null}
  </label>`;
}

// Screen header: big title over a mono caption, actions on the right.
export function Header({ title, sub, back, children, crumbs }) {
  return html`<header class="screen-head">
    ${back ? html`<${IconBtn} icon="arrow_back" size=${18} title="Back" onClick=${() => history.back()} class="back" />` : null}
    ${crumbs ? html`<div class="crumbs">${crumbs}</div>` : html`<div class="titles">
      <h1>${title}</h1>${sub ? html`<span class="micro">${sub}</span>` : null}
    </div>`}
    ${children}
  </header>`;
}

export function Micro({ children, class: cls = '' }) { return html`<span class=${'micro ' + cls}>${children}</span>`; }

export function Empty({ icon = 'music', title, children }) {
  return html`<div class="empty">
    <${Plate} icon=${icon} size=${40} iconSize=${20} tone="muted" />
    <div class="empty-title">${title}</div>
    ${children ? html`<div class="empty-text">${children}</div>` : null}
  </div>`;
}

export function Spinner({ label }) {
  return html`<div class="loading"><${Icon} name="progress" size=${20} class="spin" />${label ? html`<span>${label}</span>` : null}</div>`;
}

// ── Async data ──────────────────────────────────────────────────────────

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => { if (alive) { setState({ loading: false, data, error: null }); } },
      (error) => { if (alive) { setState({ loading: false, data: null, error }); } },
    );
    return () => { alive = false; };
  }, deps);
  return state;
}

// ── Context menu ────────────────────────────────────────────────────────
// items: [{ label, icon, onClick, danger, sub: [...] } | 'sep']

export function openMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  const r = e.currentTarget?.getBoundingClientRect?.();
  const fromButton = e.type === 'click' && r;
  app.set({ menu: { x: fromButton ? r.right : e.clientX, y: fromButton ? r.bottom + 4 : e.clientY, alignRight: !!fromButton, items } });
}
export const closeMenu = () => app.set({ menu: null });

export function MenuLayer() {
  const menu = useStore(app, (s) => s.menu);
  const ref = useRef();
  const [pos, setPos] = useState(null);
  const [sub, setSub] = useState(null);
  useEffect(() => {
    setSub(null);
    if (!menu) { setPos(null); return; }
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = menu.alignRight ? menu.x - w : menu.x;
    let y = menu.y;
    x = Math.max(8, Math.min(x, innerWidth - w - 8));
    if (y + h > innerHeight - 8) { y = Math.max(8, menu.alignRight ? menu.y - h - 40 : innerHeight - h - 8); }
    setPos({ x, y });
  }, [menu]);
  useEffect(() => {
    if (!menu) { return undefined; }
    const close = (e) => { if (!ref.current?.contains(e.target)) { closeMenu(); } };
    const key = (e) => { if (e.key === 'Escape') { closeMenu(); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [menu]);
  if (!menu) { return null; }
  const items = sub || menu.items;
  return html`<div class="menu" ref=${ref} style=${pos ? { left: pos.x + 'px', top: pos.y + 'px' } : { visibility: 'hidden' }}>
    ${sub ? html`<button type="button" class="menu-item muted" onClick=${() => setSub(null)}><${Icon} name="chevron_left" size=${15} />Back</button><div class="menu-sep"></div>` : null}
    ${items.map((it) => it === 'sep' ? html`<div class="menu-sep"></div>`
      : it.header ? html`<div class="menu-head micro">${it.header}</div>`
      : html`<button type="button" class=${`menu-item ${it.danger ? 'danger' : ''}`} disabled=${it.disabled}
          onClick=${() => { if (it.sub) { setSub(it.sub); return; } closeMenu(); it.onClick && it.onClick(); }}>
          ${it.icon ? html`<${Icon} name=${it.icon} size=${15} fill=${it.fill} class=${it.tone ? 'tone-' + it.tone : ''} />` : html`<span class="menu-gap"></span>`}
          <span class="menu-label">${it.label}</span>
          ${it.sub ? html`<${Icon} name="chevron_right" size=${14} class="menu-chev" />` : null}
        </button>`)}
  </div>`;
}

// ── Prompt / confirm dialog ─────────────────────────────────────────────

export function prompt({ title, label, value = '', okLabel = 'Save', note }) {
  return new Promise((resolve) => app.set({ dialog: { kind: 'prompt', title, label, value, okLabel, note, resolve } }));
}
export function confirm({ title, text, okLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => app.set({ dialog: { kind: 'confirm', title, text, okLabel, danger, resolve } }));
}
export function showInfo({ title, text, value }) {
  return new Promise((resolve) => app.set({ dialog: { kind: 'info', title, text, value, okLabel: 'Done', resolve } }));
}

export function DialogLayer() {
  const d = useStore(app, (s) => s.dialog);
  const [value, setValue] = useState('');
  const input = useRef();
  useEffect(() => {
    if (!d) { return undefined; }
    setValue(d.value || '');
    setTimeout(() => { input.current?.focus(); input.current?.select(); }, 30);
    const key = (e) => { if (e.key === 'Escape') { finish(null); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [d]);
  if (!d) { return null; }
  function finish(result) { app.set({ dialog: null }); d.resolve(result); }
  const submit = (e) => {
    e.preventDefault();
    if (d.kind === 'prompt') { if (value.trim()) { finish(value.trim()); } } else { finish(true); }
  };
  return html`<div class="scrim" onMouseDown=${(e) => { if (e.target === e.currentTarget) { finish(null); } }}>
    <form class="dialog" onSubmit=${submit}>
      <div class="dialog-title">${d.title}</div>
      ${d.text ? html`<div class="dialog-text">${d.text}</div>` : null}
      ${d.kind === 'prompt' ? html`<label class="field">
        ${d.label ? html`<span class="micro">${d.label}</span>` : null}
        <input ref=${input} value=${value} onInput=${(e) => setValue(e.currentTarget.value)} />
      </label>` : null}
      ${d.kind === 'info' && d.value ? html`<input class="copy-field" ref=${input} readonly value=${d.value} />` : null}
      ${d.note ? html`<div class="dialog-note">${d.note}</div>` : null}
      <div class="dialog-actions">
        ${d.kind !== 'info' ? html`<${Btn} kind="ghost" onClick=${() => finish(null)}>Cancel</${Btn}>` : null}
        ${d.kind === 'info' && d.value ? html`<${Btn} kind="outline" icon="link" onClick=${() => { navigator.clipboard?.writeText(d.value); input.current?.select(); }}>Copy</${Btn}>` : null}
        <button type="submit" class=${`btn ${d.danger ? 'btn-danger' : 'btn-primary'}`}>${d.okLabel}</button>
      </div>
    </form>
  </div>`;
}

export function ToastLayer() {
  const toasts = useStore(app, (s) => s.toasts);
  return html`<div class="toasts">${toasts.map((t) => html`<div class=${'toast toast-' + t.kind} key=${t.id}>
    ${t.title ? html`<b>${t.title}</b>` : null}<span>${t.message}</span>
  </div>`)}</div>`;
}

// ── Track actions ───────────────────────────────────────────────────────

// The app's track ⋮ menu: same items, order, icons and tints (mustard for the
// queue and playlists, blue for favorites, celadon for downloads).
export function trackMenuItems(tracks, extra = []) {
  const one = tracks.length === 1 ? tracks[0] : null;
  const playlists = app.get().playlists;
  const items = [
    { label: 'Add to queue', icon: 'queue_music', tone: 'accent', onClick: () => addToQueue(tracks) },
    { label: 'Play next', icon: 'playlist_play', tone: 'accent', onClick: () => playNext(tracks) },
  ];
  if (one) {
    const liked = isLiked(one);
    items.push({ label: liked ? 'Remove from favorites' : 'Add to favorites', icon: 'favorite_border', tone: 'info', onClick: () => toggleLike(one) });
  }
  items.push({
    label: 'Add to playlist…', icon: 'playlist_add', tone: 'accent', sub: [
      { label: 'New playlist…', icon: 'add', tone: 'accent', onClick: () => newPlaylistWith(tracks) },
      ...(playlists.length ? ['sep'] : []),
      ...playlists.map((name) => ({ label: name, icon: 'queue_music', onClick: () => addTo(name, tracks) })),
    ],
  });
  items.push({ label: tracks.length > 1 ? `Download ${tracks.length} tracks` : 'Download', icon: 'download', tone: 'state', onClick: () => lib.downloadTracks(tracks) });
  // The server's sound analysis (the app offers these for server tracks too).
  const features = app.get().features;
  if (one && !one.federation && features.discover) {
    items.push({ label: 'Play similar', icon: 'radar', tone: 'state', onClick: () => playSimilar(one) });
  }
  if (one && !one.federation && features.sonicPath) {
    items.push({ label: 'Sonic path', icon: 'route', tone: 'state', onClick: () => sonicPathAdd(one) });
  }
  if (one) {
    items.push('sep');
    const folder = one.filepath.split('/').slice(0, -1).join('/');
    items.push({ label: 'Go to folder', icon: 'folder', tone: 'accent', onClick: () => go('folders', folder) });
    if (one.metadata?.album) {
      items.push({ label: 'Go to album', icon: 'album', tone: 'accent', onClick: () => go('album', one.metadata.album, { artist: one.metadata['album-artist'] || '' }) });
    }
    if (trackArtist(one)) {
      items.push({ label: 'Go to artist', icon: 'person', tone: 'accent', onClick: () => go('artist', one.metadata?.artist || trackArtist(one)) });
    }
  }
  return [...items, ...extra];
}

async function newPlaylistWith(tracks) {
  const name = await prompt({ title: 'New playlist', label: 'NAME', okLabel: 'Create' });
  if (!name) { return; }
  try {
    await lib.createPlaylist(name, tracks);
    window.APP_TOAST({ kind: 'success', message: `Created “${name}”` });
  } catch (_) { window.APP_TOAST({ kind: 'error', message: 'Could not create the playlist' }); }
}

async function addTo(name, tracks) {
  try {
    await lib.addToPlaylist(name, tracks);
    window.APP_TOAST({ kind: 'success', message: `Added to “${name}”` });
  } catch (_) { window.APP_TOAST({ kind: 'error', message: 'Could not add to the playlist' }); }
}

export function LikeButton({ track, size = 16, always = false }) {
  const liked = useStore(app, (s) => {
    const o = s.likes[track?.filepath || track?.rawFilePath];
    return o !== undefined ? o : Number(track?.metadata?.rating) > 0;
  });
  return html`<button type="button" class=${`like ${liked ? 'on' : ''} ${always ? 'always' : ''}`}
    title=${liked ? 'Remove from favorites' : 'Add to favorites'}
    onClick=${(e) => { e.stopPropagation(); toggleLike(track); }}>
    <${Icon} name="favorite_border" size=${size} fill=${liked} />
  </button>`;
}

// ── Track table ─────────────────────────────────────────────────────────
// groups: [{ label, tracks }] (label optional). Clicking a row plays the
// whole list from that row. Long lists are windowed.

const ROW_H = 44;
const HEAD_H = 36;

export function TrackTable({ groups, firstCol = '#', firstValue, rail = false, rowMenu, empty, hideAlbum = false }) {
  const currentPath = useStore(playback, (s) => s.currentPath);
  const playing = useStore(playback, (s) => s.playing);
  const flat = useMemo(() => groups.flatMap((g) => g.tracks), [groups]);
  const items = useMemo(() => {
    const out = [];
    let i = 0;
    groups.forEach((g, gi) => {
      if (g.label) { out.push({ head: true, label: g.label, key: 'h' + gi }); }
      g.tracks.forEach((t) => { out.push({ track: t, index: i, key: 'r' + i }); i++; });
    });
    let y = 0;
    out.forEach((it) => { it.top = y; y += it.head ? HEAD_H : ROW_H; });
    return out;
  }, [groups]);
  const height = items.length ? items[items.length - 1].top + (items[items.length - 1].head ? HEAD_H : ROW_H) : 0;

  const scroller = useRef();
  const [view, setView] = useState({ top: 0, h: 800 });
  useEffect(() => {
    const el = scroller.current;
    if (!el) { return undefined; }
    const onScroll = () => setView({ top: el.scrollTop, h: el.clientHeight });
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);

  const windowed = items.length > 200;
  const visible = windowed
    ? items.filter((it) => it.top + ROW_H >= view.top - 600 && it.top <= view.top + view.h + 600)
    : items;

  const letters = useMemo(() => {
    if (!rail) { return []; }
    const seen = new Map();
    items.forEach((it) => { if (it.head && !seen.has(it.label)) { seen.set(it.label, it.top); } });
    // A–Z always (as in the design), plus any other alphabet's letters the
    // library actually has (Cyrillic, Greek…), with "#" last.
    const latin = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const other = [...seen.keys()].filter((l) => l !== '#' && !latin.includes(l));
    return [...latin, ...other, '#'].map((l) => ({ l, top: seen.get(l) }));
  }, [items, rail]);
  const activeLetter = rail ? [...items].reverse().find((it) => it.head && it.top <= view.top + 4)?.label : null;

  if (!flat.length && empty) { return empty; }

  const row = (it) => {
    const t = it.track;
    const cur = t.filepath === currentPath;
    const meta = t.metadata || {};
    const menu = (e) => openMenu(e, rowMenu ? rowMenu(t, it.index) : trackMenuItems([t]));
    return html`<div key=${it.key} class=${`tr ${cur ? 'cur' : ''}`}
      style=${windowed ? { position: 'absolute', top: it.top + 'px', left: 0, right: 0 } : null}
      onClick=${() => playTracks(flat, it.index)} onContextMenu=${menu}>
      <span class="c-n">${cur ? html`<${Icon} name=${playing ? 'graphic_eq' : 'pause'} size=${14} />`
        : firstValue ? firstValue(t, it.index) : it.index + 1}</span>
      <span class="c-t">${trackTitle(t)}</span>
      <span class="c-a">${trackArtist(t)}</span>
      ${hideAlbum ? null : html`<span class="c-al">${trackAlbum(t)}</span>`}
      <span class="c-like"><${LikeButton} track=${t} size=${15} /></span>
      <span class="c-f">${formatLabel(meta)}</span>
      <span class="c-rg">${gainLabel(meta)}</span>
      <span class="c-d">${fmtTime(meta.duration)}</span>
      <span class="c-m"><button type="button" class="row-more" title="More" onClick=${menu}><${Icon} name="more_vert" size=${16} /></button></span>
    </div>`;
  };

  return html`<div class=${`track-table ${hideAlbum ? 'no-album' : ''}`}>
    <div class="tt-scroll" ref=${scroller}>
      <div class="tr th">
        <span class="c-n">${firstCol}</span><span class="c-t">TITLE</span><span class="c-a">ARTIST</span>
        ${hideAlbum ? null : html`<span class="c-al">ALBUM</span>`}
        <span class="c-like"></span><span class="c-f">FORMAT</span><span class="c-rg">RG</span><span class="c-d">TIME</span><span class="c-m"></span>
      </div>
      <div class="tt-body" style=${windowed ? { height: height + 'px', position: 'relative' } : null}>
        ${visible.map((it) => it.head
          ? html`<div key=${it.key} class="tg" style=${windowed ? { position: 'absolute', top: it.top + 'px', left: 0, right: 0 } : null}>${it.label}</div>`
          : row(it))}
      </div>
    </div>
    ${rail ? html`<nav class="rail">${letters.map(({ l, top }) => html`<button type="button"
      class=${`${top === undefined ? 'off' : ''} ${l === activeLetter ? 'on' : ''}`}
      onClick=${() => { if (top !== undefined) { scroller.current.scrollTop = top + 34; } }}>${l}</button>`)}</nav>` : null}
  </div>`;
}

// ── Album tile ──────────────────────────────────────────────────────────

export function AlbumTile({ album, meta, highlight }) {
  const target = href('album', album.name || '', { artist: album.album_artist || '' });
  const play = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const songs = await lib.albumSongs(album.name, album.album_artist);
    playTracks(songs);
  };
  const menu = async (e) => {
    e.preventDefault();
    const ev = { type: e.type, clientX: e.clientX, clientY: e.clientY, currentTarget: e.currentTarget, preventDefault() {}, stopPropagation() {} };
    const songs = await lib.albumSongs(album.name, album.album_artist);
    openMenu(ev, trackMenuItems(songs));
  };
  return html`<a class=${`tile ${highlight ? 'hl' : ''}`} href=${target} onContextMenu=${menu}>
    <${Cover} file=${album.album_art_file} size="l" ring=${highlight}>
      <button type="button" class="tile-play" title="Play" onClick=${play}><${Icon} name="play_arrow" size=${18} fill /></button>
    </${Cover}>
    <span class="tile-t">${album.name || 'Unknown album'}</span>
    <span class="tile-s">${meta ?? [album.album_artist, album.year].filter(Boolean).join(' · ')}</span>
  </a>`;
}
