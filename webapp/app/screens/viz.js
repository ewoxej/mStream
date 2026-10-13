// Visualizer: butterchurn on a full-bleed canvas (app/viz.js).
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { useStore } from '../store.js';
import { playback } from '../player.js';
import { Icon, IconBtn, Spinner } from '../ui.js';
import { trackTitle, trackArtist } from '../util.js';

export function Visualizer() {
  const canvas = useRef();
  const wrap = useRef();
  const [info, setInfo] = useState(VIZ.info());
  const [error, setError] = useState(null);
  const [showTrack, setShowTrack] = useState(true);
  const [full, setFull] = useState(false);
  const current = useStore(playback, (s) => s.current);
  const track = current ? { filepath: current.rawFilePath, metadata: current.metadata } : null;

  useEffect(() => {
    const off = VIZ.subscribe(setInfo);
    VIZ.mount(canvas.current).catch((e) => setError(e.message));
    const ro = new ResizeObserver(() => VIZ.resize());
    ro.observe(canvas.current);
    const fs = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', fs);
    return () => { off(); ro.disconnect(); VIZ.unmount(); document.removeEventListener('fullscreenchange', fs); };
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); } else { wrap.current.requestFullscreen?.(); }
  };

  return html`<div class="viz" ref=${wrap}>
    <canvas ref=${canvas}></canvas>
    ${!info.ready && !error ? html`<div class="viz-center"><${Spinner} label="Loading presets" /></div>` : null}
    ${error ? html`<div class="viz-center muted">The visualizer needs WebGL 2. ${error}</div>` : null}
    <div class="viz-title">
      <span class="micro">VISUALIZER · PRESET ${info.count ? info.index + 1 : '–'} / ${info.count || '–'}</span>
      <span class="viz-name">${info.name}</span>
    </div>
    <div class="viz-corner">
      <${IconBtn} icon=${full ? 'minimize-2' : 'maximize-2'} title="Full screen" onClick=${toggleFull} />
      <${IconBtn} icon="x" title="Close" onClick=${() => history.back()} />
    </div>
    ${showTrack && track ? html`<div class="viz-track"><b>${trackTitle(track)}</b><span>${trackArtist(track)}</span></div>` : null}
    <div class="viz-bar">
      <button type="button" onClick=${() => VIZ.prev()}><${Icon} name="chevron-left" size=${15} />Previous</button>
      <button type="button" onClick=${() => VIZ.next()}>Next<${Icon} name="chevron-right" size=${15} /></button>
      <i></i>
      <button type="button" class=${info.cycle ? 'on' : ''} onClick=${() => VIZ.setCycle(!info.cycle)}><${Icon} name="timer" size=${15} />Change every 20 s</button>
      <button type="button" class=${showTrack ? 'on' : ''} onClick=${() => setShowTrack(!showTrack)}><${Icon} name="captions" size=${15} />Show track</button>
    </div>
  </div>`;
}
