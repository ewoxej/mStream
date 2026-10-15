// Tracks ahead, fetched whole before they play: the next one(s) of the queue
// are downloaded into memory (a blob URL each) while the current one plays,
// and the engine plays them from there (mstream.player.js `cachedUrl`). A
// track then starts at once and never stalls on the network — through a
// slow link or a proxy that drops idle streams, the second audio element's
// own preload (whatever the browser chose to buffer) left gaps and hiccups
// between tracks. A transcoded copy fetched whole seeks like a file too.
//
// How many tracks ahead is a setting (`prefetchAhead`: 0 = off); all of it
// stays under BUDGET_BYTES. Copies no longer ahead are dropped unless an
// audio element still holds them.
import { app } from './store.js';
import { playback } from './player.js';

export const BUDGET_BYTES = 400 * 1024 * 1024;
const START_DELAY_MS = 2500;   // let a track that just started have the network first

const copies = new Map();   // stream URL → { blob URL, size, song } once fetched
let running = null;         // { url, controller }
let timer = null;

export const stats = () => ({ count: copies.size, bytes: [...copies.values()].reduce((n, c) => n + c.size, 0), loading: !!running });

function ahead() {
  const n = Number(app.get().prefetchAhead ?? 2);
  const list = MSTREAMPLAYER.playlist;
  const pos = MSTREAMPLAYER.positionCache.val;
  if (!(n > 0) || pos < 0 || !list.length) { return []; }
  const out = [];
  for (let i = 1; i <= n && i < list.length; i++) {
    let j = pos + i;
    if (j >= list.length) {
      if (!MSTREAMPLAYER.playerStats.shouldLoop) { break; }
      j %= list.length;
    }
    out.push(list[j]);
  }
  return out;
}

function drop(url) {
  const c = copies.get(url);
  if (!c) { return; }
  copies.delete(url);
  URL.revokeObjectURL(c.blobUrl);
}

// Keep what's ahead (and what an audio element holds); fetch the next one missing.
function plan() {
  timer = null;
  const wanted = ahead().map((song) => ({ song, url: MSTREAMPLAYER.streamUrl(song) }));
  const keep = new Set(wanted.map((w) => w.url));
  const inUse = new Set(MSTREAMPLAYER.urlsInUse());
  for (const [url, c] of copies) {
    if (!keep.has(url) && !inUse.has(c.blobUrl)) { drop(url); }
  }
  if (running && !keep.has(running.url)) { running.controller.abort(); running = null; }
  if (running) { return; }
  const next = wanted.find((w) => !copies.has(w.url));
  if (!next || stats().bytes >= BUDGET_BYTES) { return; }
  fetchCopy(next);
}

async function fetchCopy({ song, url }) {
  const controller = new AbortController();
  running = { url, controller };
  try {
    const res = await fetch(url, { signal: controller.signal, priority: 'low' });
    if (!res.ok) { throw new Error(String(res.status)); }
    const blob = await res.blob();
    if (running?.url !== url) { return; }   // no longer wanted
    copies.set(url, { blobUrl: URL.createObjectURL(blob), size: blob.size, song });
    // The next song's copy: the engine preloads from it at once.
    const pos = MSTREAMPLAYER.positionCache.val;
    const list = MSTREAMPLAYER.playlist;
    if (list[pos + 1] === song || (pos === list.length - 1 && list[0] === song)) { MSTREAMPLAYER.recacheNext(); }
  } catch (_) {
    // Aborted, offline, a 404: the engine streams that one as before.
  } finally {
    if (running?.url === url) { running = null; }
    schedule(0);
  }
}

function schedule(delay = START_DELAY_MS) {
  clearTimeout(timer);
  timer = setTimeout(plan, delay);
}

export function startPrefetch() {
  MSTREAMPLAYER.cachedUrl = (url) => copies.get(url)?.blobUrl || null;
  // What's ahead changes with the playing track and with queue edits.
  let last = '';
  playback.subscribe(() => {
    const pos = MSTREAMPLAYER.positionCache.val;
    const key = `${pos}|${MSTREAMPLAYER.playlist.length}|${ahead().map((s) => s.url).join('\n')}`;
    if (key !== last) { last = key; schedule(); }
  });
  app.subscribe((s) => { if (s.prefetchAhead !== startPrefetch.ahead) { startPrefetch.ahead = s.prefetchAhead; schedule(0); } });
  startPrefetch.ahead = app.get().prefetchAhead;
  schedule();
}
