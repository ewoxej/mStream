// Formatting and track helpers. A track is the API's { filepath, metadata }.

export const server = () => MSTREAMAPI.currentServer;

export function coverUrl(file, size = 's') {
  if (!file) { return null; }
  const s = server();
  const q = new URLSearchParams();
  if (size) { q.set('compress', size); }
  if (s.token) { q.set('token', s.token); }
  return `${s.host}album-art/${encodeURIComponent(file)}?${q}`;
}

export const trackTitle = (t) => t?.metadata?.title || (t?.filepath || '').split('/').pop() || '';
export const trackArtist = (t) => t?.metadata?.['artist-display'] || t?.metadata?.artist || '';
export const trackAlbum = (t) => t?.metadata?.album || '';
export const trackCover = (t) => t?.metadata?.['album-art'] || null;

// "FLAC 24/96", "MP3 320", "OPUS"
export function formatLabel(meta) {
  if (!meta || !meta.format) { return ''; }
  const fmt = String(meta.format).toUpperCase();
  if (meta['bit-depth'] && meta['sample-rate']) {
    return `${fmt} ${meta['bit-depth']}/${Math.round(meta['sample-rate'] / 1000)}`;
  }
  if (meta.bitrate) { return `${fmt} ${Math.round(meta.bitrate / 1000)}`; }
  return fmt;
}

export function gainLabel(meta) {
  const g = meta?.['replaygain-track'];
  if (g === null || g === undefined || g === '') { return '—'; }
  const n = Number(g);
  if (!Number.isFinite(n)) { return '—'; }
  return `${n < 0 ? '−' : '+'}${Math.abs(n).toFixed(1)} dB`;
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) { return '0:00'; }
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// 12480 → "12 480" (thin grouping, as in the design).
export function fmtCount(n) {
  if (n === null || n === undefined) { return ''; }
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function fmtBytes(b) {
  if (!Number.isFinite(b)) { return ''; }
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b >= 10 || i === 0 ? Math.round(b) : b.toFixed(1)} ${u[i]}`;
}

export function plural(n, word) { return `${fmtCount(n)} ${word}${n === 1 ? '' : 's'}`; }

// The first letter used for A–Z grouping; digits and symbols fall in "#".
export function groupLetter(s) {
  const c = (s || '').trim().charAt(0).toUpperCase();
  return /\p{L}/u.test(c) ? c : '#';
}

export function sumDuration(tracks) {
  return tracks.reduce((a, t) => a + (Number(t.metadata?.duration) || 0), 0);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Day buckets for "Recently played": TODAY / YESTERDAY / THIS WEEK / EARLIER.
export function dayBucket(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startToday) { return 'TODAY'; }
  if (d.getTime() >= startToday - 86400000) { return 'YESTERDAY'; }
  if (d.getTime() >= startToday - 6 * 86400000) { return 'THIS WEEK'; }
  return 'EARLIER';
}

export function clockLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startToday - 86400000) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (d.getTime() >= startToday - 6 * 86400000) {
    return d.toLocaleDateString('en-GB', { weekday: 'short' });
  }
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) { return 'Good night'; }
  if (h < 12) { return 'Good morning'; }
  if (h < 18) { return 'Good afternoon'; }
  return 'Good evening';
}
