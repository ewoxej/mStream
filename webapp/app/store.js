// A small observable store and the hash router. Components read with
// useStore(store, selector) and re-render only when the selected value
// changes (shallow compare).
import { useEffect, useRef, useState } from './vendor/preact-htm.js';

export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((fn) => fn(state));
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) { return true; }
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) { return false; }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) { return false; }
  return ka.every((k) => Object.is(a[k], b[k]));
}

export function useStore(store, selector = (s) => s) {
  const [, force] = useState(0);
  const sel = useRef(selector);
  sel.current = selector;
  const value = selector(store.get());
  const last = useRef(value);
  last.current = value;
  useEffect(() => {
    const check = (s) => {
      const next = sel.current(s);
      if (!shallowEqual(next, last.current)) { force((n) => n + 1); }
    };
    const off = store.subscribe(check);
    // Effects run after paint: catch an update that landed in between.
    check(store.get());
    return off;
  }, [store]);
  return value;
}

// ── App state ───────────────────────────────────────────────────────────

const LS_KEY = 'zenelo.ui';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { return {}; }
}
const prefs = loadPrefs();

// Small windows (not phones — those have the app): below this width the
// queue is a drawer over the page instead of a column, closed by default.
// The wide-window choice (open / closed) is kept apart and comes back when
// the window grows again.
const narrowQuery = window.matchMedia('(max-width: 1180px)');
let wideQueueOpen = prefs.queueOpen !== false;

export const app = createStore({
  route: parseHash(),
  narrow: narrowQuery.matches,
  queueOpen: narrowQuery.matches ? false : prefs.queueOpen !== false,
  albumView: prefs.albumView || 'grid',
  albumSort: prefs.albumSort || { key: 'name', dir: 'asc' },
  // Library facts filled in after boot (server/ping + counts).
  server: null,
  // What the server offers (its ping): Discover, Sonic Path, Stats, …
  features: {},
  counts: {},
  playlists: [],
  likes: {},            // filepath → true/false, overrides fetched metadata
  menu: null,           // open context menu: { x, y, items }
  dialog: null,         // open prompt dialog
  toasts: [],
});

narrowQuery.addEventListener('change', (e) => {
  app.set({ narrow: e.matches, queueOpen: e.matches ? false : wideQueueOpen });
});

export function savePrefs() {
  const s = app.get();
  // The drawer opening and closing in a small window isn't a preference.
  if (!s.narrow) { wideQueueOpen = s.queueOpen; }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      queueOpen: wideQueueOpen, albumView: s.albumView, albumSort: s.albumSort,
    }));
  } catch (_) { /* private mode */ }
}

// ── Router ──────────────────────────────────────────────────────────────
// #/albums, #/album/<name>?artist=…, #/folders/music/a/b, #/settings/playback

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const params = Object.fromEntries(new URLSearchParams(query));
  return { screen: parts[0] || 'home', args: parts.slice(1), params };
}

export function href(screen, ...args) {
  let params = null;
  if (args.length && typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null) {
    params = args.pop();
  }
  const path = [screen, ...args.filter((a) => a !== undefined && a !== null && a !== '')]
    .map((p) => String(p).split('/').map(encodeURIComponent).join('/')).join('/');
  const q = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString() : '';
  return '#/' + path + (q ? '?' + q : '');
}

export function go(screen, ...args) { location.hash = href(screen, ...args).slice(1); }

window.addEventListener('hashchange', () => {
  // Going somewhere closes the queue drawer of a small window.
  app.set({ route: parseHash(), menu: null, ...(app.get().narrow ? { queueOpen: false } : {}) });
});
