// The floating player: a small always-on-top window (the Document
// Picture-in-Picture API, Chromium) with the playing track and its controls
// only — cover, title / artist / album, seek bar, previous / play / next,
// shuffle and repeat, volume, "Play here" while the music is on another
// device, and the current lyrics line when the track has synced lyrics.
// It renders the same components as the player bar into the other window's
// document, with this page's stylesheets copied over.
import { html, render, useEffect, useMemo, useState } from './vendor/preact-htm.js';
import { app, useStore } from './store.js';
import { playback, toast } from './player.js';
import { devices, positionOf, playOn } from './devices.js';
import { useNowPlaying, Transport, Seek, RemoteSeek, Volume } from './shell.js';
import { fetchLyrics } from './screens/lyrics.js';
import { Cover, Icon, IconBtn, LikeButton } from './ui.js';
import { trackTitle, trackArtist, trackAlbum, trackCover } from './util.js';

export const pipSupported = () => 'documentPictureInPicture' in window;

let pipWindow = null;

export async function togglePip() {
  if (pipWindow) { pipWindow.close(); return; }
  if (!pipSupported()) { return; }
  let w;
  try {
    w = await window.documentPictureInPicture.requestWindow({ width: 340, height: 300 });
  } catch (_) {
    toast('This browser can’t open the floating player here', 'error');
    return;
  }
  pipWindow = w;
  const unmount = mountPip(w);
  app.set({ pipOpen: true });
  w.addEventListener('pagehide', () => {
    unmount();
    pipWindow = null;
    app.set({ pipOpen: false });
  });
}

// Render the floating player into another window's document (the PiP
// window; a test frame), with this page's stylesheets. Returns the unmount.
export function mountPip(w) {
  for (const el of document.head.querySelectorAll('link[rel="stylesheet"], style')) {
    const copy = w.document.importNode(el, true);
    if (copy.href) { copy.href = el.href; }   // absolute: the window has no base URL of ours
    w.document.head.appendChild(copy);
  }
  w.document.title = 'mStream';
  w.document.documentElement.classList.add('pip-html');
  const root = w.document.createElement('div');
  w.document.body.appendChild(root);
  render(html`<${PipPlayer} />`, root);
  return () => render(null, root);
}

// Synced lyrics of the playing track, or null (plain text or none).
const lyricsCache = new Map();
function useSyncedLines(path) {
  const [lines, setLines] = useState(() => lyricsCache.get(path) || null);
  useEffect(() => {
    if (!path) { setLines(null); return undefined; }
    if (lyricsCache.has(path)) { setLines(lyricsCache.get(path)); return undefined; }
    let alive = true;
    setLines(null);
    fetchLyrics(path).then((d) => {
      const l = d?.lines?.length ? d.lines : null;
      lyricsCache.set(path, l);
      if (alive) { setLines(l); }
    }, () => { if (alive) { setLines(null); } });
    return () => { alive = false; };
  }, [path]);
  return lines;
}

// The playhead in seconds: this tab's, or the followed device's, moving on
// between its reports.
function usePlayhead(remote) {
  const local = useStore(playback, (s) => (remote ? 0 : s.currentTime));
  const [, tick] = useState(0);
  useEffect(() => {
    if (!remote) { return undefined; }
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [remote?.id]);
  return remote ? positionOf(remote) / 1000 : local;
}

function LyricLine({ lines, remote }) {
  const time = usePlayhead(remote);
  const at = useMemo(() => {
    let i = -1;
    for (let k = 0; k < lines.length && lines[k].t <= time + 0.15; k++) { i = k; }
    return i;
  }, [lines, Math.floor(time * 4)]);
  return html`<div class="pip-lyric">
    <span class="cur" key=${'c' + at}>${at >= 0 ? lines[at].text : '♪'}</span>
    <span class="next">${lines[at + 1]?.text || ''}</span>
  </div>`;
}

function PipPlayer() {
  const n = useNowPlaying();
  const { remote, track, meta, playing } = n;
  const self = useStore(devices, (x) => x.self);
  const [showLyrics, setShowLyrics] = useState(false);
  const current = useStore(playback, (s) => s.current);
  // Lyrics come from this server's files: not for a peer's track.
  const path = remote ? remote.track?.filepath || null : current && !current.federation ? current.rawFilePath : null;
  const lines = useSyncedLines(path);
  const lyricsOn = showLyrics && !!lines;
  return html`<div class=${`pip ${remote ? 'remote' : ''} ${lyricsOn ? 'with-lyrics' : ''}`}>
    ${remote ? html`<div class="pip-remote">
      <${Icon} name="devices" size=${14} />
      <span>${playing ? 'Playing' : 'Paused'} on <b>${remote.name}</b></span>
      <button type="button" class="strip-btn" onClick=${() => playOn(self)}><${Icon} name="computer" size=${13} />Play here</button>
    </div>` : null}
    <div class="pip-now">
      ${track ? html`<${Cover} file=${trackCover(track)} size="l" class="pip-cover" />` : html`<div class="pip-cover cover"></div>`}
      <div class="pip-text">
        <span class=${`pip-t ${track ? '' : 'muted'}`} title=${track ? trackTitle(track) : ''}>${track ? trackTitle(track) : 'Nothing playing'}</span>
        ${track ? html`<span class="pip-a" title=${trackArtist(track)}>${trackArtist(track) || meta.artist || ''}</span>
          <span class="pip-al" title=${trackAlbum(track)}>${trackAlbum(track)}</span>` : null}
      </div>
      ${track ? html`<${LikeButton} track=${track} size=${17} always />` : null}
    </div>
    ${lyricsOn ? html`<${LyricLine} lines=${lines} remote=${remote} />` : null}
    ${remote ? html`<${RemoteSeek} d=${remote} />` : html`<${Seek} />`}
    <${Transport} n=${n} />
    <div class="pip-tools">
      ${lines ? html`<${IconBtn} icon="queue_music" title=${lyricsOn ? 'Hide lyrics' : 'Lyrics'} active=${lyricsOn} size=${17} onClick=${() => setShowLyrics(!showLyrics)} />` : null}
      <${Volume} remote=${remote} />
    </div>
  </div>`;
}

// The player bar's button for it: shown only where the browser can do it.
export function PipButton({ size = 17 }) {
  const open = useStore(app, (s) => s.pipOpen);
  if (!pipSupported()) { return null; }
  return html`<${IconBtn} icon="picture_in_picture_alt" title=${open ? 'Close the floating player' : 'Floating player'} active=${open} size=${size} class="pager" onClick=${togglePip} />`;
}
