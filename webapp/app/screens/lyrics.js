// Lyrics of the playing track (GET /api/v1/lyrics), as the app's lyrics
// page: synced lyrics follow the song — the current line in mustard, bold
// and larger, kept a third of the way down; a click on a line seeks there.
// Plain lyrics are shown as they are.
import { html, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { useStore } from '../store.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import { Header, Empty, Spinner, Cover } from '../ui.js';
import { server, trackTitle, trackArtist, trackCover } from '../util.js';

// [mm:ss.xx] lines → [{ t (s), text }]; a line may carry several stamps.
export function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) { continue; }
    const words = line.replace(/^(?:\s*\[[^\]]*\])+/, '').trim();
    if (!words) { continue; }
    stamps.forEach((m) => out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: words }));
  }
  return out.sort((a, b) => a.t - b.t);
}

async function fetchLyrics(path) {
  const s = server();
  const res = await fetch(`${s.host}api/v1/lyrics?path=${encodeURIComponent(String(path).replace(/^\/+/, ''))}`, { headers: { 'x-access-token': s.token } });
  if (res.status === 404) { return null; }
  if (!res.ok) { throw new Error(String(res.status)); }
  const data = await res.json();
  const pick = (c) => (c && Array.isArray(c.lyrics) ? c.lyrics[c.default || 0] : null);
  const synced = pick(data.syncedLyrics)?.data;
  const lines = synced ? parseLrc(synced) : [];
  return { lines, plain: lines.length ? null : pick(data.lyrics)?.data || null };
}

function Synced({ lines }) {
  const time = useStore(playback, (s) => s.currentTime);
  const current = useMemo(() => {
    let i = -1;
    for (let k = 0; k < lines.length && lines[k].t <= time + 0.15; k++) { i = k; }
    return i;
  }, [lines, Math.floor(time * 4)]);
  const box = useRef();
  useEffect(() => {
    const el = box.current?.querySelector('.ly-line.cur');
    if (!el) { return; }
    const b = box.current;
    b.scrollTo({ top: el.offsetTop - b.clientHeight / 3, behavior: 'smooth' });
  }, [current]);
  return html`<div class="ly-scroll" ref=${box}>
    <div class="ly-lines">${lines.map((l, i) => html`<button type="button" key=${i}
      class=${`ly-line ${i === current ? 'cur' : i < current ? 'past' : ''}`}
      onClick=${() => { const d = MSTREAMPLAYER.playerStats.duration; if (d > 0) { P.seekPct(l.t / d); } }}>${l.text}</button>`)}</div>
  </div>`;
}

export function Lyrics() {
  const current = useStore(playback, (s) => s.current);
  const path = current?.rawFilePath || null;
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    if (!path || current?.federation) { setState({ loading: false, data: null }); return undefined; }
    let alive = true;
    setState({ loading: true });
    fetchLyrics(path).then((data) => { if (alive) { setState({ loading: false, data }); } },
      () => { if (alive) { setState({ loading: false, error: true }); } });
    return () => { alive = false; };
  }, [path]);
  const track = current ? { filepath: current.rawFilePath, metadata: current.metadata || {} } : null;
  const d = state.data;
  return html`<div class="screen">
    <${Header} title="Lyrics" sub=${d?.lines?.length ? 'SYNCED · CLICK A LINE TO JUMP THERE' : d?.plain ? 'PLAIN TEXT' : ''}>
      ${track ? html`<div class="ly-track"><${Cover} file=${trackCover(track)} class="mini-cover" />
        <div class="mini-text"><span>${trackTitle(track)}</span><small>${trackArtist(track)}</small></div></div>` : null}
    </${Header}>
    ${!track ? html`<div class="scroll"><${Empty} icon="mic" title="Nothing playing">Lyrics of the playing track show here.</${Empty}></div>`
      : state.loading ? html`<${Spinner} />`
      : state.error ? html`<div class="scroll"><${Empty} icon="error_outline" title="Could not load the lyrics" /></div>`
      : d?.lines?.length ? html`<${Synced} lines=${d.lines} />`
      : d?.plain ? html`<div class="scroll ly-scroll"><div class="ly-plain">${d.plain}</div></div>`
      : html`<div class="scroll"><${Empty} icon="mic" title="No lyrics yet">The server picks them up from .lrc files, tags and LRCLIB as it scans.</${Empty}></div>`}
  </div>`;
}
