// Auto DJ: sources, filters and what it picked. Settings live in AUTODJ
// (alpha/auto-dj.js, persisted to localStorage); the engine reads them on
// every pick, so changes apply from the next one.
import { html, useState } from '../vendor/preact-htm.js';
import { useStore } from '../store.js';
import * as lib from '../library.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import { Btn, Icon, Header, Seg, Chip, Toggle, Cover, useAsync } from '../ui.js';
import { fmtTime, trackTitle, trackArtist, trackCover } from '../util.js';

const st = () => AUTODJ.state;
const vpaths = () => MSTREAMAPI.currentServer.vpaths || [];

export function djAhead(s) {
  return s.queue.slice(s.pos + 1).filter((x) => x.metadata?._djPicked).length;
}

// Short chips for the Home card: sources, rating, genres.
export function djSummaryChips() {
  const s = st();
  const chips = [];
  const v = s.djVpaths?.length ? s.djVpaths : vpaths();
  chips.push(...(v.length > 3 ? [`${v.length} folders`] : v));
  chips.push(s.djMinRating > 0 ? 'Liked only' : 'Any track');
  if (s.djGenreEnabled && s.djGenres?.length) {
    chips.push(...s.djGenres.slice(0, 2).map((g) => (s.djGenreMode === 'blacklist' ? `no ${g}` : g)));
    if (s.djGenres.length > 2) { chips.push(`+${s.djGenres.length - 2}`); }
  }
  return chips;
}

function Section({ label, children, note }) {
  return html`<div class="dj-section"><span class="micro">${label}</span>${children}${note ? html`<small class="hint">${note}</small>` : null}</div>`;
}

function OptRow({ title, sub, on, onChange }) {
  return html`<div class="opt-row" onClick=${() => onChange(!on)}>
    <div class="opt-text"><span>${title}</span>${sub ? html`<small>${sub}</small>` : null}</div>
    <${Toggle} on=${on} onChange=${onChange} />
  </div>`;
}

export function AutoDJ() {
  const [, setRev] = useState(0);
  const set = (patch) => { AUTODJ.setState(patch); setRev((n) => n + 1); };
  const s = st();
  const pb = useStore(playback, (x) => ({ on: x.autoDJ, queue: x.queue, pos: x.pos, rev: x.rev, len: x.queueLen }));
  const genres = useAsync(() => lib.genres(), []);
  const all = vpaths();
  const chosen = s.djVpaths?.length ? s.djVpaths : all;
  const picks = pb.queue.slice(pb.pos + 1).filter((x) => x.metadata?._djPicked);

  const toggleVpath = (v) => {
    const next = chosen.includes(v) ? chosen.filter((x) => x !== v) : [...chosen, v];
    if (next.length === 0) { return; }
    set({ djVpaths: next.length === all.length ? [] : next });
  };
  const toggleGenre = (g) => {
    const list = s.djGenres || [];
    const next = list.includes(g) ? list.filter((x) => x !== g) : [...list, g];
    set({ djGenres: next, djGenreEnabled: next.length > 0 });
  };
  const topGenres = [...(genres.data || [])].sort((a, b) => (b.track_count || 0) - (a.track_count || 0)).slice(0, 24);
  const filters = (s.djMinRating > 0 ? 1 : 0) + (s.djGenreEnabled && s.djGenres?.length ? 1 : 0) + (s.similar ? 1 : 0) + (s.bpmContinuity ? 1 : 0) + (s.harmonicMixing ? 1 : 0);
  const sub = pb.on ? `RUNNING · ${filters} ${filters === 1 ? 'FILTER' : 'FILTERS'} · ${chosen.length} ${chosen.length === 1 ? 'SOURCE' : 'SOURCES'}` : 'OFF';

  return html`<div class="screen">
    <${Header} title="Auto DJ" sub=${sub}>
      <${Btn} kind="primary" icon=${pb.on ? 'stop' : 'play_arrow'} onClick=${P.toggleAutoDJ}>${pb.on ? 'Stop Auto DJ' : 'Start Auto DJ'}</${Btn}>
    </${Header}>
    <div class="scroll pad dj-grid">
      <section class="card dj-opts">
        <${Section} label="SOURCES">
          ${all.map((v) => html`<button type="button" class="source" onClick=${() => toggleVpath(v)}>
            <span class=${`check ${chosen.includes(v) ? 'on' : ''}`}>${chosen.includes(v) ? html`<${Icon} name="check" size=${12} />` : null}</span>
            <${Icon} name="library_music" size=${15} /><span class="source-t">${v}</span>
          </button>`)}
        </${Section}>
        <${Section} label="TRACKS">
          <${Seg} value=${s.djMinRating > 0 ? 'liked' : 'any'} onChange=${(v) => set({ djMinRating: v === 'liked' ? 1 : 0 })}
            options=${[{ value: 'any', label: 'Any track' }, { value: 'liked', label: 'Favorites only' }]} class="wide" />
        </${Section}>
        <${Section} label="GENRES" note=${topGenres.length ? (s.djGenreEnabled && s.djGenres?.length ? null : 'None picked: every genre plays.') : 'No genre tags in the library.'}>
          ${topGenres.length ? html`<${Seg} value=${s.djGenreMode || 'whitelist'} onChange=${(v) => set({ djGenreMode: v })}
            options=${[{ value: 'whitelist', label: 'Only these' }, { value: 'blacklist', label: 'All but these' }]} class="wide" />` : null}
          <div class="chips">${topGenres.map((g) => html`<${Chip} on=${(s.djGenres || []).includes(g.name)} onClick=${() => toggleGenre(g.name)}>${g.name}</${Chip}>`)}</div>
        </${Section}>
        <${Section} label="PICKS PER TURN">
          <${Seg} value=${s.djLimit || 1} onChange=${(v) => set({ djLimit: v })} options=${[1, 3, 5, 10].map((n) => ({ value: n, label: String(n) }))} class="wide" />
        </${Section}>
        <${Section} label="CONTINUITY">
          <div class="opt-list">
            <${OptRow} title="Similar artists" sub="Leans toward artists Last.fm calls similar to the one playing" on=${!!s.similar} onChange=${(v) => set({ similar: v })} />
            <${OptRow} title="Keep the tempo" sub="Picks within a BPM window of the current track" on=${!!s.bpmContinuity} onChange=${(v) => set({ bpmContinuity: v })} />
            <${OptRow} title="Harmonic mixing" sub="Picks keys that mix well (Camelot wheel neighbours)" on=${!!s.harmonicMixing} onChange=${(v) => set({ harmonicMixing: v })} />
          </div>
        </${Section}>
      </section>
      <section class="card list-card">
        <div class="card-head pad"><span class="card-title">Next picks</span><span class="micro-n">${picks.length ? `${picks.length} AHEAD` : ''}</span></div>
        ${picks.length ? picks.map((song) => {
          const t = { filepath: song.rawFilePath, metadata: song.metadata };
          const idx = pb.queue.indexOf(song);
          return html`<div class="mini-row" onClick=${() => P.playAt(idx)}>
            <${Cover} file=${trackCover(t)} class="mini-cover" />
            <div class="mini-text"><span>${trackTitle(t)}</span><small>${trackArtist(t)}</small></div>
            <span class="tag">${(song.rawFilePath || '').split('/')[0]}</span>
            <span class="micro-n w40">${fmtTime(song.metadata?.duration)}</span>
          </div>`;
        }) : html`<div class="hint pad">${pb.on ? 'Picks appear here as the queue runs low.' : 'Start Auto DJ to fill the queue.'}</div>`}
        <div class="card-note">Picks are random within the filters. Recently picked tracks are skipped for a while. Turning Auto DJ off keeps the picks already in the queue.</div>
      </section>
    </div>
  </div>`;
}
