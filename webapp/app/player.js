// The new UI's handle on the shared playback engine (MSTREAMPLAYER, a
// global from assets/js/mstream.player.js). The engine mutates its
// own objects; this module polls a cheap signature of them and publishes a
// snapshot store the player bar and queue subscribe to.
import { createStore, app } from './store.js';
import { server, trackTitle, serverAudio } from './util.js';

const P = () => MSTREAMPLAYER;

// Bumped by every action that changes the queue in place, so a reorder
// (same length, same position) still reaches subscribers.
let rev = 0;

export const playback = createStore(snapshot());

function snapshot() {
  const p = MSTREAMPLAYER;
  const st = p.playerStats;
  const pos = p.positionCache.val;
  return {
    playing: st.playing,
    currentTime: st.currentTime,
    duration: st.duration,
    volume: st.volume,
    shuffle: st.shuffle,
    loop: st.shouldLoop,
    loopOne: st.shouldLoopOne,
    autoDJ: st.autoDJ === true,
    replayGain: st.replayGain,
    replayGainPreGainDb: st.replayGainPreGainDb,
    queue: p.playlist,
    queueLen: p.playlist.length,
    pos,
    current: p.playlist[pos] || null,
    currentPath: p.playlist[pos]?.rawFilePath || null,
    rev,
  };
}

export function bump() { rev++; publish(); }

let lastSig = '';
function publish() {
  const s = snapshot();
  const sig = [s.playing, Math.floor(s.currentTime * 4), Math.round(s.duration), s.volume, s.shuffle, s.loop,
    s.loopOne, s.autoDJ, s.replayGain, s.replayGainPreGainDb, s.queueLen, s.pos, s.currentPath, s.rev,
    s.current?.metadata?.title].join('|');
  if (sig !== lastSig) { lastSig = sig; playback.set(s); }
}
setInterval(publish, 250);

// ── Adding songs ────────────────────────────────────────────────────────
// addSongWizard: build the stream URL (media/ or the
// transcode/ route), hand the song object to the engine, fetch metadata
// when the caller had none.

function songObject(filepath, metadata) {
  const raw = filepath;
  let fp = filepath.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F');
  if (fp.charAt(0) === '/') { fp = fp.substr(1); }
  const t = P().transcodeOptions;
  const base = t.serverEnabled && t.frontendEnabled ? 'transcode/' : 'media/';
  const s = server();
  let url = s.host + base + fp + '?';
  if (s.token) { url += 'token=' + s.token; }
  return { url, rawFilePath: raw, filepath: fp, metadata: metadata || {}, authToken: s.token };
}

async function enrich(song) {
  if (song.metadata && Object.keys(song.metadata).length > 0) { return; }
  try {
    const res = await MSTREAMAPI.lookupMetadata(song.rawFilePath);
    if (res && res.metadata) {
      song.metadata = res.metadata;
      if (P().getCurrentSong() === song) { P().resetCurrentMetadata(); }
      bump();
    }
  } catch (_) { /* row keeps its file name */ }
}

// The engine's Auto DJ queues picks through this global.
window.VUEPLAYERCORE.addSongWizard = async (filepath, metadata, lookup, position, _live, autoPlayOff) => {
  const song = songObject(filepath, metadata);
  if (position) { P().insertSongAt(song, position, true); } else { P().addSong(song, autoPlayOff); }
  bump();
  if (lookup) { await enrich(song); }
};
// A peer's track (Discover → Peers, federated Auto DJ): streamed through
// this server's federation proxy.
window.VUEPLAYERCORE.addFederationSongWizard = (peer, remotePath, metadata, autoPlayOff, position, playNow = true) => {
  let fp = remotePath.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F');
  if (fp.charAt(0) === '/') { fp = fp.substr(1); }
  const s = server();
  let url = `${s.host}api/v1/federation/peers/${peer.id}/stream/${fp}?`;
  if (s.token) { url += 'token=' + s.token; }
  const song = {
    url, rawFilePath: remotePath, filepath: remotePath, metadata: metadata || {}, authToken: s.token,
    federation: { peerId: peer.id, peerName: peer.name || 'peer' },
  };
  if (position !== undefined) { P().insertSongAt(song, position, playNow !== false); } else { P().addSong(song, autoPlayOff); }
  bump();
};

const asSongs = (tracks) => tracks
  .filter((t) => t && t.filepath)
  .map((t) => songObject(t.filepath, t.metadata && Object.keys(t.metadata).length ? { ...t.metadata } : {}));

// Replace the queue with `tracks` and start at `start`.
export function playTracks(tracks, start = 0) {
  const songs = asSongs(tracks);
  if (!songs.length) { return; }
  const p = P();
  const dj = p.playerStats.autoDJ;
  // clearPlaylist would bootstrap two Auto DJ picks into the empty queue.
  if (dj) { p.playerStats.autoDJ = false; }
  p.clearPlaylist();
  songs.forEach((s) => p.addSong(s, true));
  if (dj) { p.playerStats.autoDJ = true; }
  p.goToSongAtPosition(Math.min(start, songs.length - 1));
  bump();
  songs.forEach(enrich);
}

// Replace the queue with `tracks`, cued at `start` and `seconds` — paused,
// or playing when `play` (a queue taken over from another device).
export function loadQueue(tracks, start = 0, seconds = 0, play = false) {
  const songs = asSongs(tracks);
  if (!songs.length) { return; }
  const p = P();
  const dj = p.playerStats.autoDJ;
  if (dj) { p.playerStats.autoDJ = false; }
  if (p.playerStats.playing) { p.playPause(); }
  p.clearPlaylist();
  songs.forEach((s) => p.addSong(s, true));
  if (dj) { p.playerStats.autoDJ = true; }
  p.cueSongAtPosition(Math.max(0, Math.min(start, songs.length - 1)), seconds);
  if (play) { p.playPause(); }
  bump();
  songs.forEach(enrich);
}

export function shufflePlay(tracks) {
  const copy = [...tracks];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  playTracks(copy, 0);
}

export function addToQueue(tracks) {
  const songs = asSongs(tracks);
  const p = P();
  const wasEmpty = p.playlist.length === 0;
  songs.forEach((s, i) => p.addSong(s, !(wasEmpty && i === 0)));
  bump();
  songs.forEach(enrich);
  toast(`${songs.length === 1 ? trackTitle(tracks[0]) : songs.length + ' tracks'} added to queue`);
}

export function playNext(tracks) {
  const songs = asSongs(tracks);
  const p = P();
  if (p.playlist.length === 0) { return playTracks(tracks); }
  let at = p.positionCache.val + 1;
  songs.forEach((s) => { p.insertSongAt(s, at++, false); });
  bump();
  songs.forEach(enrich);
  toast(`${songs.length === 1 ? trackTitle(tracks[0]) : songs.length + ' tracks'} will play next`);
}

// Play `tracks` now, right after the current one (the queue stays).
export function playNow(tracks) {
  const songs = asSongs(tracks);
  const p = P();
  if (!songs.length) { return; }
  if (p.playlist.length === 0) { playTracks(tracks); return; }
  let at = p.positionCache.val + 1;
  songs.forEach((s, i) => { p.insertSongAt(s, at++, i === 0); });
  bump();
  songs.forEach(enrich);
}

// "Play similar" (the app's): the track, then what the server's sound
// analysis finds closest to it.
export async function playSimilar(track) {
  const path = String(track.filepath || '').replace(/^\/+/, '');
  const res = await MSTREAMAPI.discoverySimilar(path, 25);
  if (!res || res.disabled) { toast('Could not find similar tracks', 'error'); return; }
  if (res.notAnalyzed) { toast('This track hasn’t been analyzed yet'); return; }
  playTracks([track, ...(res.results || []).map((r) => ({ filepath: r.filepath, metadata: r.metadata || {} }))]);
}

export function playAt(i) { P().goToSongAtPosition(i); bump(); }
export function removeAt(i) { P().removeSongAtPosition(i); bump(); }

export function moveItem(from, to) {
  // The server's engine can't reorder its queue: a reorder here would leave
  // the two lists disagreeing about every index.
  if (serverAudio) { toast('The server’s queue can’t be reordered'); return; }
  const list = P().playlist;
  if (from === to || from < 0 || from >= list.length) { return; }
  const [item] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(to, list.length)), 0, item);
  P().resetPositionCache();
  bump();
}

export function clearQueue() {
  const p = P();
  const dj = p.playerStats.autoDJ;
  if (dj) { p.playerStats.autoDJ = false; }
  p.clearPlaylist();
  if (dj) { p.playerStats.autoDJ = true; }
  bump();
}

// ── Transport ───────────────────────────────────────────────────────────

export const playPause = () => { P().playPause(); publish(); };
export const next = () => { P().nextSong(); bump(); };
export const prev = () => {
  const p = P();
  // Restart the track when past its first seconds, like every player.
  if (p.playerStats.currentTime > 4) { p.seek(0); } else { p.previousSong(); }
  bump();
};
export const seekPct = (pct) => {
  const dur = P().playerStats.duration;
  if (!Number.isFinite(dur) || dur <= 0) { return; }
  P().seek(Math.max(0, Math.min(0.999, pct)) * dur);
  publish();
};
export const toggleShuffle = () => { P().toggleShuffle(); publish(); };
// The app's repeat button: off → all → one → ∞ Auto DJ → off. Auto DJ
// clears the repeat flags when it starts; turning it off leaves repeat off.
export const cycleRepeat = () => {
  const p = P();
  const st = p.playerStats;
  // The server's speakers have no Auto DJ: their repeat cycles off → all → one.
  if (serverAudio) { p.toggleRepeat(); } else if (st.autoDJ) { p.toggleAutoDJ(); } else if (st.shouldLoopOne) { p.toggleAutoDJ(); } else { p.toggleRepeat(); }
  publish();
};

// For other devices' commands: repeat as one value ('off' | 'all' | 'one' | 'autodj').
export const repeatOf = (st) => (st.autoDJ ? 'autodj' : st.shouldLoopOne ? 'one' : st.shouldLoop ? 'all' : 'off');
export function setRepeat(mode) {
  const p = P();
  const st = p.playerStats;
  if (mode === 'autodj') {
    if (!st.autoDJ) { p.toggleAutoDJ(); }
  } else if (['off', 'all', 'one'].includes(mode)) {
    if (st.autoDJ) { p.toggleAutoDJ(); }
    st.shouldLoop = mode === 'all';
    st.shouldLoopOne = mode === 'one';
  }
  publish();
}
export function setShuffle(on) { if (!!P().playerStats.shuffle !== !!on) { P().toggleShuffle(); } publish(); }

export function setVolume(v) {
  const vol = Math.round(Math.max(0, Math.min(100, v)));
  P().changeVolume(vol);
  if (vol > 0) { lastVolume = vol; }
  savePlayerPrefs();
  publish();
}
let lastVolume = 100;
export const toggleMute = () => setVolume(P().playerStats.volume > 0 ? 0 : lastVolume || 100);

export function toggleAutoDJ() {
  const on = P().toggleAutoDJ();
  publish();
  toast(on ? 'Auto DJ is on' : 'Auto DJ is off');
  return on;
}

export function setReplayGain(on) { P().setReplayGainActive(on); savePlayerPrefs(); publish(); }
export function setPreGain(db) { P().setReplayGainPreGainDb(db); savePlayerPrefs(); publish(); }

export const isTranscodingOn = () => P().transcodeOptions.serverEnabled === true && P().transcodeOptions.frontendEnabled === true;
export function transcodeLabel() {
  const t = P().transcodeOptions;
  const codec = (t.selectedCodec || t.defaultCodec || '').toUpperCase();
  const rate = String(t.selectedBitrate || t.defaultBitrate || '').replace(/k$/i, '');
  return [codec, rate].filter(Boolean).join(' ');
}

export function setTranscode(patch) {
  Object.assign(P().transcodeOptions, patch);
  savePlayerPrefs();
  publish();
}

// ── Likes ───────────────────────────────────────────────────────────────
// Ratings are gone from the UI; a like is stored as rating 10 (5★) and any
// rating above 0 counts as liked, so tracks rated with stars elsewhere show as
// favourites. Unlike clears the rating.

export function isLiked(track) {
  const path = track?.filepath || track?.rawFilePath;
  const o = app.get().likes[path];
  if (o !== undefined) { return o; }
  return Number(track?.metadata?.rating) > 0;
}

export async function toggleLike(track) {
  const path = track?.filepath || track?.rawFilePath;
  if (!path) { return; }
  const liked = !isLiked(track);
  app.set((s) => ({ likes: { ...s.likes, [path]: liked } }));
  try {
    await MSTREAMAPI.rateSong(path, liked ? 10 : null);
    // Keep queued copies in step so a reload of the queue agrees.
    P().playlist.forEach((s) => { if (s.rawFilePath === path && s.metadata) { s.metadata.rating = liked ? 10 : null; } });
  } catch (_) {
    app.set((s) => ({ likes: { ...s.likes, [path]: !liked } }));
    toast('Could not save the like', 'error');
  }
}

// ── Persistence ─────────────────────────────────────────────────────────

const PREFS = 'zenelo.player';
function savePlayerPrefs() {
  const p = P();
  try {
    localStorage.setItem(PREFS, JSON.stringify({
      volume: p.playerStats.volume,
      replayGain: p.playerStats.replayGain,
      preGain: p.playerStats.replayGainPreGainDb,
      transcode: p.transcodeOptions.frontendEnabled === true,
      codec: p.transcodeOptions.selectedCodec,
      bitrate: p.transcodeOptions.selectedBitrate,
    }));
  } catch (_) { /* private mode */ }
}

export function restorePlayerPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREFS)) || {}; } catch (_) { /* ignore */ }
  const p = P();
  // The server's speakers keep the room's volume: this browser's must not
  // overwrite it just because the page opened.
  if (Number.isFinite(saved.volume) && !serverAudio) { p.changeVolume(saved.volume); if (saved.volume > 0) { lastVolume = saved.volume; } }
  if (typeof saved.replayGain === 'boolean') { p.setReplayGainActive(saved.replayGain); }
  if (Number.isFinite(saved.preGain)) { p.setReplayGainPreGainDb(saved.preGain); }
  if (saved.transcode) { p.transcodeOptions.frontendEnabled = true; }
  if (saved.codec) { p.transcodeOptions.selectedCodec = saved.codec; }
  if (saved.bitrate) { p.transcodeOptions.selectedBitrate = saved.bitrate; }
  publish();
}

// ── Toasts ──────────────────────────────────────────────────────────────

let toastId = 0;
export function toast(message, kind = 'info', title = '') {
  const id = ++toastId;
  app.set((s) => ({ toasts: [...s.toasts, { id, kind, title, message }].slice(-4) }));
  setTimeout(() => app.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 5000 : 2800);
}
window.APP_TOAST = (t) => toast(t.message || t.title, t.kind, t.message ? t.title : '');
window.__drainPendingToasts().forEach(window.APP_TOAST);
