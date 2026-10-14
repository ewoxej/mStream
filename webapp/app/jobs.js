// Discovery plug-in jobs: getting a Discover lead into the library — a
// plug-in download ("Get it" from YouTube, …) or a copy from a federated
// peer ("Add to your collection"). The rows' pure half is DISCOVERJOBS
// (assets/js/discover-jobs.js, unit-tested); this keeps the plug-in list,
// the collection destination and the caller's jobs, polls them while one
// runs, and says when one finishes. The window is screens/discover-get.js.
import { createStore, app } from './store.js';
import { toast, addToQueue, playNow } from './player.js';

export const jobs = createStore({
  plugins: null,        // null = not fetched yet
  jobsAllowed: false,   // may this account start jobs
  dest: null,           // GET collection/destination; dest.destination null = nowhere to put a file
  list: [],             // GET plugin-jobs: the caller's jobs, newest first
  watching: 0,          // open windows that want the fast beat
});

// ── Text ─────────────────────────────────────────────────────────────────
// DISCOVERJOBS hands out i18n keys ({ key, params }); their English is in
// locales/en.json, read once.
let strings = {};
fetch('locales/en.json').then((r) => (r.ok ? r.json() : {})).then((s) => { strings = s || {}; }).catch(() => {});

export function tt(key, params = {}) {
  let s = strings[key];
  if (s && typeof s === 'object') { s = params.count === 1 ? s.one : s.other; }
  if (typeof s !== 'string') { return key.split('.').pop(); }
  return s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
}

// A row's line: a key, the server's own text, or parts joined.
export function rowText(part) {
  if (!part) { return ''; }
  if (Array.isArray(part.parts)) { return part.parts.map(rowText).filter(Boolean).join(' · '); }
  return part.key ? tt(part.key, part.params) : String(part.text || '');
}

export const errorText = (err) => (err?.body && typeof err.body.error === 'string' && err.body.error) || tt('discover.job.requestFailed');

// ── Plug-ins and the destination ─────────────────────────────────────────

let pluginsPromise = null;
export function ensurePlugins() {
  const s = jobs.get();
  if (s.plugins) { return Promise.resolve(s.plugins); }
  if (!pluginsPromise) {
    pluginsPromise = MSTREAMAPI.discoveryPlugins().then((res) => {
      jobs.set({ plugins: res?.plugins || [], jobsAllowed: res?.jobs?.allowed === true });
      return jobs.get().plugins;
    }).finally(() => { pluginsPromise = null; });
  }
  return pluginsPromise;
}

export async function ensureDest() {
  if (jobs.get().dest) { return jobs.get().dest; }
  try { const d = await MSTREAMAPI.discoveryDestination(); jobs.set({ dest: d }); return d; } catch (_) { return null; }
}

export async function saveDest(destination) {
  const d = await MSTREAMAPI.discoverySaveDestination(destination);
  jobs.set({ dest: d });
  return d;
}

const caps = (p) => p?.capabilities || [];
export const acquirePlugins = (s) => (s.jobsAllowed ? (s.plugins || []).filter((p) => caps(p).includes('acquire')) : []);
export const linksPlugin = (s) => (s.plugins || []).find((p) => caps(p).includes('links')) || null;
export const previewPlugins = (s) => (s.plugins || []).filter((p) => caps(p).includes('preview'));
export const pluginTitle = (name) => (jobs.get().plugins || []).find((p) => p.name === name)?.title || name;

// ── Jobs ─────────────────────────────────────────────────────────────────

// One job the server just answered with, ahead of the next poll.
export function noteJob(job) {
  jobs.set((s) => ({ list: [job, ...s.list.filter((j) => j.id !== job.id)] }));
  schedule();
}

let failures = 0;
export async function refreshJobs() {
  let res = null;
  try { res = await MSTREAMAPI.discoveryJobs(); } catch (_) { res = null; }
  if (res && Array.isArray(res.jobs)) {
    failures = 0;
    const finished = DISCOVERJOBS.finishedSince(jobs.get().list, res.jobs);
    jobs.set({ list: res.jobs });
    finished.forEach(announce);
    if (DISCOVERJOBS.trayRows(res.jobs).length) { ensurePlugins(); }
  } else {
    failures += 1;
  }
  schedule();
}

function announce(job) {
  const row = DISCOVERJOBS.jobRowState(job);
  const what = DISCOVERJOBS.jobTitle(job);
  if (row.state === 'failed') { toast(job.error || what, 'error', tt('discover.job.toastFailed', { plugin: pluginTitle(job.plugin) })); }
  else if (row.state === 'copied') { toast(what, 'success', tt('discover.job.toastCopied')); }
  else if (row.state === 'copiedMany') { toast([what, rowText(row.sub)].filter(Boolean).join(' · '), 'success', tt('discover.job.toastCopiedMany')); }
  else if (row.state === 'stopped') { toast([what, rowText(row.sub)].filter(Boolean).join(' · '), 'error', tt('discover.job.toastStopped')); }
  else if (row.state === 'downloaded') { toast([what, DISCOVERJOBS.pathCrumbs(row.filepath).join(' / ')].filter(Boolean).join(' · '), 'success', tt('discover.job.toastDownloaded')); }
  else if (row.state === 'owned') { toast(what, 'info', tt('discover.job.toastOwned')); }
}

// Polled only while a job is live and the tab is visible: fast with a
// window open, slower for the strip alone, backing off while the server
// is away.
let timer = null;
let hooked = false;
function schedule() {
  clearTimeout(timer);
  timer = null;
  const s = jobs.get();
  if (!s.list.some(DISCOVERJOBS.isLive)) { return; }
  if (!hooked) {
    hooked = true;
    document.addEventListener('visibilitychange', () => { if (!document.hidden && jobs.get().list.some(DISCOVERJOBS.isLive)) { refreshJobs(); } });
  }
  if (document.hidden) { return; }
  const beat = s.watching > 0 ? 1500 : 4000;
  timer = setTimeout(refreshJobs, Math.min(60000, beat * 2 ** Math.min(failures, 6)));
}

export function watch(on) { jobs.set((s) => ({ watching: Math.max(0, s.watching + (on ? 1 : -1)) })); schedule(); }

export async function startJob(name, recommendation, choice, scope) {
  const res = await MSTREAMAPI.discoveryJobStart(name, recommendation, choice || undefined, scope);
  if (res?.job) { noteJob(res.job); }
  return res?.job || null;
}

export async function cancelJob(job) {
  try { const res = await MSTREAMAPI.discoveryJobCancel(job.id); if (res?.job) { noteJob(res.job); } } catch (_) { /* finished first */ }
  await refreshJobs();
}

export async function retryJob(job) {
  try { await startJob(job.plugin, job.recommendation, job.params?.choice, DISCOVERJOBS.jobScope(job)); } catch (err) { toast(errorText(err), 'error'); }
}

export async function clearFinished() {
  try { await MSTREAMAPI.discoveryJobsClear(); } catch (_) { /* the refresh shows what is left */ }
  await refreshJobs();
}

// A finished download or copy is a library song.
export const playFile = (filepath) => playNow([{ filepath, metadata: {} }]);
export const queueFile = (filepath) => addToQueue([{ filepath, metadata: {} }]);

// The plug-ins are revealed by the ping (features.plugins); the strip shows
// what this account still has running from an earlier visit.
export function initJobs() {
  if (!app.get().features.plugins) { return; }
  refreshJobs();
}
