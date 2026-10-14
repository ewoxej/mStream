// Playback devices, Spotify Connect–like (server: src/api/devices.js). This
// browser is one device: it reports what it plays, runs the commands other
// devices send, and sees them. The player bar and the queue follow the
// device the music is on (`followed`): one playing while this one doesn't,
// else the one that played last — paused there, it stays followed, so play /
// pause / next / a pick in the queue go to it. The playback moves only when
// something new is started from a list here (the device playing so far
// pauses) or through the devices menu / "Play here" (queue and position move).
//
// Pick-up: a device that played last and has gone offline (a closed tab)
// leaves its queue here, paused where it stopped. The same on load, which
// brings back this browser's own last queue.
import { createStore } from './store.js';
import * as P from './player.js';
import { playback } from './player.js';
import * as lib from './library.js';
import { server } from './util.js';

// Per tab (sessionStorage: a reload keeps it, a new tab is a new device).
const ID_KEY = 'zenelo.device.id';
const NAME_KEY = 'zenelo.device.name';
const POSITION_EVERY_MS = 10000;

const store = (k, v, where = localStorage) => { try { if (v === undefined) { return where.getItem(k); } where.setItem(k, v); } catch (_) { /* private mode */ } return null; };

function newId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  const id = 'web-' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  store(ID_KEY, id, sessionStorage);
  return id;
}

// "Chrome on macOS"
export function defaultName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

const selfId = store(ID_KEY, undefined, sessionStorage) || newId();

export const devices = createStore({
  self: selfId,
  name: store(NAME_KEY) || defaultName(),
  list: [],            // summaries from the server, each with receivedAt (local clock)
  connected: false,
  available: true,     // false: the server has no devices API, or this login can't use it
});

const byId = (id) => devices.get().list.find((d) => d.id === id);

// Where a device's playhead is now, from its last report.
export function positionOf(d) {
  if (!d) { return 0; }
  const p = d.positionMs + (d.playing ? Date.now() - d.receivedAt : 0);
  const dur = d.track?.durationMs || 0;
  return dur > 0 ? Math.min(p, dur) : p;
}

const byLastPlayed = (a, b) => String(b.lastPlayedAt || '').localeCompare(String(a.lastPlayedAt || ''));

// Right after the playback was moved to another device, until it reports playing.
let followHint = { id: null, until: 0 };

// The other device the player follows (null: this one). Nothing while this
// one plays; else one playing (the latest to start); else the one that played
// last, when that isn't this one and it's still online.
export function followed(list, self, localPlaying) {
  if (localPlaying) { return null; }
  const hinted = followHint.id && Date.now() < followHint.until && list.find((d) => d.id === followHint.id && d.online);
  if (hinted) { return hinted; }
  const playing = list.filter((d) => d.id !== self && d.online && d.playing).sort(byLastPlayed)[0];
  if (playing) { return playing; }
  const last = list.filter((d) => d.lastPlayedAt && d.queueLength > 0).sort(byLastPlayed)[0];
  return last && last.id !== self && last.online ? last : null;
}
// Any other device playing (for the "Playing on …" strip even while this one plays too).
export const playingElsewhere = (list, self) => list.filter((d) => d.id !== self && d.online && d.playing);

// ── Requests ────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const s = server();
  const res = await fetch(s.host + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-access-token': s.token || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = new Error(`${path} ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

// ── What this device plays ──────────────────────────────────────────────
// The queue as library paths; a peer's track (federation) can't move to
// another device, so it is left out and the index maps around it.

function localQueue() {
  const list = MSTREAMPLAYER.playlist;
  const pos = MSTREAMPLAYER.positionCache.val;
  const paths = [];
  let index = -1;
  list.forEach((s, i) => {
    if (s.federation) { return; }
    if (i === pos) { index = paths.length; }
    paths.push(String(s.rawFilePath || '').replace(/^\/+/, ''));
  });
  if (index < 0 && paths.length) { index = Math.min(paths.length - 1, Math.max(0, pos)); }
  return { paths, index };
}

function localStatus() {
  const st = MSTREAMPLAYER.playerStats;
  const song = MSTREAMPLAYER.playlist[MSTREAMPLAYER.positionCache.val];
  const m = song?.metadata || {};
  const { index } = localQueue();
  return {
    index,
    positionMs: Math.round((st.currentTime || 0) * 1000),
    playing: !!st.playing,
    volume: Math.round(st.volume ?? 100),
    shuffle: !!st.shuffle,
    repeat: P.repeatOf(st),
    track: song && !song.federation ? {
      filepath: String(song.rawFilePath || '').replace(/^\/+/, ''),
      title: m.title || String(song.rawFilePath || '').split('/').pop(),
      artist: m['artist-display'] || m.artist || '',
      album: m.album || '',
      art: m['album-art'] || '',
      durationMs: Math.round((st.duration || m.duration || 0) * 1000),
    } : null,
  };
}

let sentQueue = null;
let lastStatusSig = '';
let lastSentAt = 0;
let sending = null;

async function report(force = false) {
  const d = devices.get();
  if (!d.connected) { return; }
  const status = localStatus();
  const { paths } = localQueue();
  // On load, until this tab's own last queue is back: an empty one would replace it on the server.
  if (!startupDone && !paths.length) { return; }
  const qSig = paths.join('\n');
  const sig = [status.index, status.playing, status.track?.filepath, status.volume, status.shuffle, status.repeat, Math.round(status.positionMs / 2000)].join('|');
  const queueChanged = qSig !== sentQueue;
  if (!force && !queueChanged && sig === lastStatusSig && !(status.playing && Date.now() - lastSentAt > POSITION_EVERY_MS)) { return; }
  lastStatusSig = sig;
  lastSentAt = Date.now();
  const body = { id: d.self, status };
  if (queueChanged) { body.queue = paths; }
  sending = api('POST', 'api/v1/devices/state', body)
    .then(() => { if (queueChanged) { sentQueue = qSig; } })
    .catch(() => { /* the next change retries */ });
  return sending;
}

// Report changes as they happen (the playback store is polled at 4 Hz) and
// the position while playing.
let reportTimer = null;
let wasPlaying = false;
// When a command (another device's control, a transfer) last came in: the
// playback it starts isn't this device taking over.
let commandedAt = 0;
playback.subscribe((st) => {
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => report(), 300);
  // Started here: the music moves here, the devices playing so far pause.
  if (st.playing && !wasPlaying && Date.now() - commandedAt > 3000) {
    const { list, self } = devices.get();
    list.filter((d) => d.id !== self && d.online && d.playing).forEach((d) => command(d.id, 'pause'));
  }
  wasPlaying = st.playing;
});
setInterval(() => { if (MSTREAMPLAYER.playerStats.playing) { report(); } }, POSITION_EVERY_MS);

// ── Taking a queue over ─────────────────────────────────────────────────

async function withMetadata(paths) {
  const meta = {};
  for (let i = 0; i < paths.length; i += 500) {
    try { Object.assign(meta, await lib.metadataBatch(paths.slice(i, i + 500))); } catch (_) { /* rows keep their file names */ }
  }
  return paths.map((p) => ({ filepath: p, metadata: meta[p]?.metadata || {} }));
}

async function adopt(state, play) {
  if (!state?.queue?.length) { return false; }
  const tracks = await withMetadata(state.queue);
  P.loadQueue(tracks, state.index || 0, (state.positionMs || 0) / 1000, play);
  // What we now hold is what the server already has: report it as ours.
  sentQueue = null;
  report(true);
  return true;
}

// ── Commands from other devices ─────────────────────────────────────────

function mapIndex(index) {
  // The reported queue skips peers' tracks: find the engine position for `index`.
  let n = -1;
  return MSTREAMPLAYER.playlist.findIndex((s) => !s.federation && ++n === index);
}

function run({ command, args }) {
  const st = MSTREAMPLAYER.playerStats;
  commandedAt = Date.now();
  switch (command) {
    case 'play': if (!st.playing) { P.playPause(); } break;
    case 'pause': if (st.playing) { P.playPause(); } break;
    case 'playPause': P.playPause(); break;
    case 'next': P.next(); break;
    case 'previous': P.prev(); break;
    case 'seek': if (Number.isFinite(args?.positionMs)) { MSTREAMPLAYER.seek(args.positionMs / 1000); } break;
    case 'goTo': { const i = mapIndex(args?.index); if (i >= 0) { P.playAt(i); } break; }
    case 'setVolume': if (Number.isFinite(args?.volume)) { P.setVolume(args.volume); } break;
    case 'setShuffle': if (typeof args?.shuffle === 'boolean') { P.setShuffle(args.shuffle); } break;
    case 'setRepeat': P.setRepeat(args?.mode); break;
    case 'takeover': transferringUntil = Date.now() + 5000; adopt(args, args?.play !== false); break;
    default: break;
  }
  setTimeout(() => report(true), 400);
}

// ── Pick-up ─────────────────────────────────────────────────────────────

let pickedKey = '';
let startedUp = false;
let startupDone = false;
// While a transfer runs (and a moment after), the source's pause must not
// read as something to pick up — it would pause what the transfer starts.
let transferringUntil = 0;

function maybePickUp() {
  const { list, self } = devices.get();
  if (MSTREAMPLAYER.playerStats.playing || Date.now() < transferringUntil) { return; }
  if (list.some((d) => d.id !== self && d.online && d.playing)) { return; }   // follow it instead
  const empty = MSTREAMPLAYER.playlist.length === 0;
  // Who played last: a device still online is followed, not emptied; this
  // device itself only when its queue is empty (a reload).
  const best = list.filter((d) => d.lastPlayedAt && d.queueLength > 0).sort(byLastPlayed)[0];
  if (!best || (best.id === self ? !empty : best.online)) { return; }
  const key = `${best.id}|${best.lastPlayedAt}`;
  if (key === pickedKey) { return; }
  pickedKey = key;
  return api('POST', 'api/v1/devices/transfer', { from: best.id, to: self, caller: self, play: false })
    .then((r) => (r.ok && !MSTREAMPLAYER.playerStats.playing ? adopt(r.state, false) : false))
    .catch(() => {});
}

// ── Actions for the UI ──────────────────────────────────────────────────

export function command(to, cmd, args) {
  const { self } = devices.get();
  // Show it at once; the device's report confirms.
  if (cmd === 'playPause' || cmd === 'play' || cmd === 'pause') {
    devices.set((s) => ({ list: s.list.map((d) => (d.id === to ? {
      ...d, positionMs: positionOf(d), receivedAt: Date.now(), playing: cmd === 'play' ? true : cmd === 'pause' ? false : !d.playing,
    } : d)) }));
  }
  if (cmd === 'setShuffle' || cmd === 'setRepeat') {
    devices.set((s) => ({ list: s.list.map((d) => (d.id === to ? (cmd === 'setShuffle' ? { ...d, shuffle: args.shuffle } : { ...d, repeat: args.mode }) : d)) }));
  }
  if (cmd === 'seek') {
    devices.set((s) => ({ list: s.list.map((d) => (d.id === to ? { ...d, positionMs: args.positionMs, receivedAt: Date.now() } : d)) }));
  }
  return api('POST', 'api/v1/devices/command', { from: self, to, command: cmd, args }).catch(() => P.toast('That device is offline', 'error'));
}

// The device whose playback a transfer moves: the one followed, else this
// one while it holds a queue, else whoever played last.
function source() {
  const { list, self } = devices.get();
  const f = followed(list, self, MSTREAMPLAYER.playerStats.playing);
  if (f) { return f.id; }
  if (MSTREAMPLAYER.playlist.length) { return self; }
  return list.filter((d) => d.lastPlayedAt && d.queueLength > 0).sort(byLastPlayed)[0]?.id || self;
}

// Move the playback to `to` (this device, or another one).
export async function playOn(to) {
  const { self } = devices.get();
  const from = source();
  if (from === to) {
    if (to === self) { if (!MSTREAMPLAYER.playerStats.playing && MSTREAMPLAYER.playlist.length) { P.playPause(); } } else { command(to, 'play'); }
    return;
  }
  followHint = { id: to === self ? null : to, until: Date.now() + 8000 };
  if (from === self) { await report(true); }
  transferringUntil = Date.now() + 15000;
  try {
    const r = await api('POST', 'api/v1/devices/transfer', { from, to, caller: self, play: true });
    if (!r.ok) { P.toast(r.reason === 'offline' ? 'That device is offline' : 'Nothing to move', 'error'); return; }
    if (to === self) { commandedAt = Date.now(); await adopt(r.state, true); }
    if (from === self && MSTREAMPLAYER.playerStats.playing) { P.playPause(); }
    const name = byId(to)?.name;
    if (to !== self && name) { P.toast(`Playing on ${name}`); }
  } catch (_) { P.toast('Could not move the playback', 'error'); } finally { transferringUntil = Date.now() + 2000; }
}

// ── Another device's queue ──────────────────────────────────────────────
// For the queue column while that device is followed: fetched again when its
// queue changes (queueRev), rows as the engine's ({ rawFilePath, metadata }).

export const remoteQueue = createStore({ id: null, rev: -1, songs: [], loading: false });

export async function loadRemoteQueue(d) {
  const cur = remoteQueue.get();
  if (!d || (cur.id === d.id && cur.rev === d.queueRev)) { return; }
  remoteQueue.set({ id: d.id, rev: d.queueRev, loading: cur.id !== d.id, songs: cur.id === d.id ? cur.songs : [] });
  try {
    const q = await api('GET', `api/v1/devices/${encodeURIComponent(d.id)}/queue`);
    const tracks = await withMetadata(q.queue || []);
    if (remoteQueue.get().id !== d.id) { return; }
    remoteQueue.set({ songs: tracks.map((t) => ({ rawFilePath: t.filepath, metadata: t.metadata })), loading: false });
  } catch (_) {
    if (remoteQueue.get().id === d.id) { remoteQueue.set({ loading: false, rev: -1 }); }
  }
}

export async function rename(name) {
  const n = name.trim().slice(0, 80);
  if (!n) { return; }
  store(NAME_KEY, n);
  devices.set({ name: n });
  try { await api('POST', `api/v1/devices/${devices.get().self}/name`, { name: n }); } catch (_) { /* used on the next connect */ }
}

export async function forget(id) {
  try { await api('DELETE', `api/v1/devices/${id}`); } catch (_) { P.toast('Could not remove the device', 'error'); }
}

// ── The stream ──────────────────────────────────────────────────────────

let es = null;
let retry = null;

// A playing device's playhead runs on this browser's clock: a report keeps
// the running anchor unless it shows a jump (seek, another track, play /
// pause) — re-anchoring on each report made the seconds stutter.
const DRIFT_MS = 2500;
function smoothed(old, d) {
  const row = { ...d, receivedAt: Date.now() };
  if (old && old.playing && d.playing && old.track?.filepath === d.track?.filepath && old.index === d.index
    && Math.abs(d.positionMs - positionOf(old)) < DRIFT_MS) {
    return { ...row, positionMs: old.positionMs, receivedAt: old.receivedAt };
  }
  return row;
}

function upsert(d) {
  const row = smoothed(byId(d.id), d);
  devices.set((s) => ({ list: s.list.some((x) => x.id === d.id) ? s.list.map((x) => (x.id === d.id ? row : x)) : [...s.list, row] }));
}

export function connect() {
  const s = server();
  if (es || !s) { return; }
  const d = devices.get();
  const q = new URLSearchParams({ id: d.self, name: d.name, type: 'web' });
  if (s.token) { q.set('token', s.token); }
  es = new EventSource(`${s.host}api/v1/devices/events?${q}`);
  es.addEventListener('devices', (e) => {
    const data = JSON.parse(e.data);
    devices.set({ connected: true, list: data.devices.map((x) => smoothed(byId(x.id), x)) });
    sentQueue = null;
    lastStatusSig = '';
    if (!startedUp) {
      startedUp = true;
      setTimeout(async () => { try { await maybePickUp(); } finally { startupDone = true; report(true); } }, 300);
    } else { report(true); }
  });
  es.addEventListener('device', (e) => { upsert(JSON.parse(e.data)); maybePickUp(); });
  es.addEventListener('removed', (e) => {
    const { id } = JSON.parse(e.data);
    devices.set((st) => ({ list: st.list.filter((x) => x.id !== id) }));
  });
  es.addEventListener('command', (e) => run(JSON.parse(e.data)));
  // A duplicated tab came with this tab's id: this one becomes a new device.
  es.addEventListener('replaced', () => {
    es.close();
    es = null;
    devices.set({ self: newId(), connected: false, list: [] });
    connect();
  });
  es.onerror = () => {
    devices.set({ connected: false });
    // EventSource retries by itself, unless the server answered with an error.
    if (es && es.readyState === EventSource.CLOSED) {
      es = null;
      clearTimeout(retry);
      retry = setTimeout(async () => {
        try { await api('GET', 'api/v1/devices'); connect(); } catch (err) {
          if (err.status === 403 || err.status === 404) { devices.set({ available: false }); } else { retry = setTimeout(connect, 15000); }
        }
      }, 3000);
    }
  };
}
