// Sorting, as the app's sort menu: each page has its fields, each field an
// ascending and a descending order, and the page keeps its choice (prefs
// `sorts`). Albums had it first; every list page has it now.
import { html, useEffect, useMemo, useRef, useState } from './vendor/preact-htm.js';
import { app, useStore, setPref } from './store.js';
import { Btn } from './ui.js';
import { trackTitle, trackArtist, trackAlbum, groupLetter } from './util.js';

const text = (f) => ({ asc: 'A → Z', desc: 'Z → A', f });
const num = (f, asc, desc) => ({ asc, desc, f, num: true });
const ts = (s) => (s ? Date.parse(String(s).replace(' ', 'T') + (/[zZ+]/.test(s) ? '' : 'Z')) || 0 : 0);
const m = (t) => t.metadata || {};

// Track fields, shared by every page that lists tracks.
const TRACK = {
  name: { label: 'Name', ...text(trackTitle) },
  artist: { label: 'Artist', ...text(trackArtist) },
  album: { label: 'Album', ...text(trackAlbum) },
  year: { label: 'Year', ...num((t) => Number(m(t).year) || 0, 'Oldest first', 'Newest first') },
  added: { label: 'Date added', ...num((t) => ts(m(t)['created-at']), 'Oldest first', 'Newest first') },
  duration: { label: 'Duration', ...num((t) => Number(m(t).duration) || 0, 'Shortest first', 'Longest first') },
  plays: { label: 'Plays', ...num((t) => Number(m(t)['play-count']) || 0, 'Fewest first', 'Most first') },
};
const pick = (o, keys) => keys.map((k) => ({ key: k, ...o[k] }));

export const SORTS = {
  albums: {
    def: { key: 'name', dir: 'asc' },
    fields: [
      { key: 'name', label: 'Name', ...text((a) => a.name) },
      { key: 'artist', label: 'Artist', ...text((a) => a.album_artist || (a.artists || [])[0]) },
      { key: 'year', label: 'Year', ...num((a) => a.year_min || a.year || 0, 'Oldest first', 'Newest first') },
      { key: 'count', label: 'Number of tracks', ...num((a) => a.track_count || 0, 'Fewest first', 'Most first') },
      { key: 'duration', label: 'Duration', ...num((a) => a.duration || 0, 'Shortest first', 'Longest first') },
    ],
  },
  // An artist's own albums.
  artistAlbums: {
    def: { key: 'year', dir: 'desc' },
    fields: [
      { key: 'name', label: 'Name', ...text((a) => a.name) },
      { key: 'year', label: 'Year', ...num((a) => a.year_min || a.year || 0, 'Oldest first', 'Newest first') },
      { key: 'count', label: 'Number of tracks', ...num((a) => a.track_count || 0, 'Fewest first', 'Most first') },
    ],
  },
  // Artist rows are { name, albums, tracks } (counts from the album list).
  artists: {
    def: { key: 'name', dir: 'asc' },
    fields: [
      { key: 'name', label: 'Name', ...text((a) => a.name) },
      { key: 'albums', label: 'Number of albums', ...num((a) => a.albums || 0, 'Fewest first', 'Most first') },
      { key: 'tracks', label: 'Number of tracks', ...num((a) => a.tracks || 0, 'Fewest first', 'Most first') },
    ],
  },
  genres: {
    def: { key: 'tracks', dir: 'desc' },
    fields: [
      { key: 'name', label: 'Name', ...text((g) => g.name) },
      { key: 'tracks', label: 'Number of tracks', ...num((g) => g.track_count || 0, 'Fewest first', 'Most first') },
    ],
  },
  tracks: { def: { key: 'name', dir: 'asc' }, fields: pick(TRACK, ['name', 'artist', 'album', 'year', 'added', 'duration', 'plays']) },
  // Newest like first: likes from before the date was kept (likedAt null) go last.
  favorites: {
    def: { key: 'liked', dir: 'desc' },
    fields: [
      { key: 'liked', label: 'Date liked', ...num((t) => ts(t.likedAt), 'Oldest first', 'Newest first') },
      ...pick(TRACK, ['name', 'artist', 'album', 'year', 'added', 'duration', 'plays']),
    ],
  },
  genre: { def: { key: 'artist', dir: 'asc' }, fields: pick(TRACK, ['name', 'artist', 'album', 'year', 'added', 'duration', 'plays']) },
  // Folder entries: sub-folders by name (they have nothing else); files as tracks.
  folders: {
    def: { key: 'name', dir: 'asc' },
    fields: [
      { key: 'name', label: 'Name', ...text((t) => t.name) },
      { key: 'artist', ...TRACK.artist },
      { key: 'album', ...TRACK.album },
      { key: 'added', ...TRACK.added },
      { key: 'duration', ...TRACK.duration },
      { key: 'size', label: 'Size', ...num((t) => Number(m(t)['file-size']) || 0, 'Smallest first', 'Largest first') },
    ],
  },
};

const cmpText = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base', numeric: true });

// The page's sort ({ key, dir }), its field definition and a setter.
export function useSort(page) {
  const conf = SORTS[page];
  const stored = useStore(app, (s) => s.sorts[page]);
  const value = stored && conf.fields.some((f) => f.key === stored.key) ? stored : conf.def;
  const field = conf.fields.find((f) => f.key === value.key);
  const set = (v) => setPref({ sorts: { ...app.get().sorts, [page]: v } });
  return { value, field, set, fields: conf.fields, label: `BY ${field.label.toUpperCase()} · ${field[value.dir].toUpperCase()}` };
}

export function sortBy(list, field, dir) {
  const f = field.f;
  // Missing values (no year, never played) go last either way.
  const missing = (v) => v === null || v === undefined || v === '' || (field.num && !v);
  const out = [...list].sort((a, b) => {
    const x = f(a);
    const y = f(b);
    if (missing(x) !== missing(y)) { return missing(x) ? 1 : -1; }
    const c = field.num ? x - y : cmpText(x, y);
    return dir === 'desc' ? -c : c;
  });
  return out;
}

// Letter groups for a text sort ("A", "B", … "#" last), else one group.
export function letterGroups(list, field, dir) {
  if (field.num) { return [{ tracks: list }]; }
  const groups = [];
  list.forEach((t) => {
    const l = groupLetter(field.f(t));
    const g = groups[groups.length - 1];
    if (g && g.label === l) { g.tracks.push(t); } else { groups.push({ label: l, tracks: [t] }); }
  });
  // Merge split runs ("#" sorts among letters by code point) and keep "#" at the end.
  const merged = [];
  groups.forEach((g) => {
    const x = merged.find((y) => y.label === g.label);
    if (x) { x.tracks.push(...g.tracks); } else { merged.push(g); }
  });
  const hash = merged.filter((g) => g.label === '#');
  const letters = merged.filter((g) => g.label !== '#');
  return dir === 'desc' ? [...hash, ...letters] : [...letters, ...hash];
}

// The sorted list, memoized on the inputs.
export function useSorted(list, sort) {
  return useMemo(() => sortBy(list || [], sort.field, sort.value.dir), [list, sort.value.key, sort.value.dir]);
}

function SortPopover({ fields, value, onChange, onClose, anchor }) {
  const ref = useRef();
  useEffect(() => {
    // The Sort button toggles it itself.
    const close = (e) => { if (!ref.current?.contains(e.target) && !anchor?.current?.contains(e.target)) { onClose(); } };
    const key = (e) => { if (e.key === 'Escape') { onClose(); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, []);
  return html`<div class="popover sort-pop" ref=${ref}>
    <div class="sort-grid micro"><span>SORT BY</span><span>ASCENDING ↑</span><span>DESCENDING ↓</span></div>
    ${fields.map((s) => html`<div class="sort-grid">
      <span class="sort-label">${s.label}</span>
      ${['asc', 'desc'].map((d) => html`<button type="button" class=${`cell ${value.key === s.key && value.dir === d ? 'on' : ''}`}
        onClick=${() => { onChange({ key: s.key, dir: d }); onClose(); }}>${s[d]}</button>`)}
    </div>`)}
  </div>`;
}

// The header's "Sort" button with its menu.
export function SortButton({ sort }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef();
  return html`<div class="pop-anchor" ref=${anchor}>
    <${Btn} icon="swap_vert" class=${open ? 'on' : ''} onClick=${() => setOpen(!open)} title=${sort.label}>Sort</${Btn}>
    ${open ? html`<${SortPopover} fields=${sort.fields} value=${sort.value} onChange=${sort.set} onClose=${() => setOpen(false)} anchor=${anchor} />` : null}
  </div>`;
}
