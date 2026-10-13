// Sonic Path (POST /api/v1/discovery/local/path), laid out as the app's:
// a start and an end track (picked here, or "Sonic path" in a track's ⋮
// menu: the first sets the start, the next the end), a length, and the
// server fills the way between them with tracks whose sound morphs from
// one to the other. Play / queue / save the result.
import { html, useState } from '../vendor/preact-htm.js';
import { createStore, useStore, go } from '../store.js';
import * as lib from '../library.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import { Btn, Icon, IconBtn, Header, Cover, Empty, Spinner, SearchField, TrackTable, prompt, useAsync } from '../ui.js';
import { fmtTime, sumDuration, trackTitle, trackArtist, trackCover, debounce } from '../util.js';

// Kept for the session, like the app's: leaving the screen loses nothing.
const sonic = createStore({ start: null, end: null, length: 14, rows: null, loading: false, notAnalyzed: null });

const asTrack = (t) => ({ filepath: String(t.filepath || '').replace(/^\/+/, ''), metadata: t.metadata || {} });

// The ⋮ menu's "Sonic path": the start, else the end, then the screen.
export function sonicPathAdd(track) {
  const s = sonic.get();
  if (!s.start) { sonic.set({ start: asTrack(track), rows: null }); } else { sonic.set({ end: asTrack(track), rows: null }); }
  go('sonic');
}

async function build() {
  const { start, end, length } = sonic.get();
  if (!start || !end) { return; }
  sonic.set({ loading: true, notAnalyzed: null });
  const res = await MSTREAMAPI.discoveryPath(start.filepath, end.filepath, length);
  if (!res || res.disabled) {
    sonic.set({ loading: false });
    P.toast(res?.disabled ? 'Sonic Path is off on this server' : 'Could not build the path', 'error');
    return;
  }
  const na = res.notAnalyzed || {};
  sonic.set({
    loading: false,
    notAnalyzed: na.start ? 'start' : na.end ? 'end' : null,
    rows: (res.results || []).map((r) => ({ filepath: r.filepath, metadata: r.metadata || {}, similarity: r.similarity })),
  });
}

async function save(rows) {
  const name = await prompt({ title: 'Save as playlist', label: 'NAME', okLabel: 'Save' });
  if (!name) { return; }
  try {
    await lib.createPlaylist(name, rows);
    P.toast(`Saved “${name}”`, 'success');
  } catch (_) { P.toast('Could not save the playlist', 'error'); }
}

// Search over the server's library for one end of the path.
function Picker({ side, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [later] = useState(() => debounce(setQuery, 250));
  const current = useStore(playback, (s) => s.current);
  const found = useAsync(() => (query.trim() ? lib.search(query.trim()) : Promise.resolve(null)), [query]);
  const tracks = found.data ? [...(found.data.title || []), ...(found.data.files || [])]
    .filter((x, i, a) => x.filepath && a.findIndex((y) => y.filepath === x.filepath) === i).slice(0, 30) : [];
  const playing = current && !current.federation ? { filepath: current.rawFilePath, metadata: current.metadata || {} } : null;
  return html`<div class="sp-picker">
    <div class="sp-picker-head">
      <${SearchField} value=${q} onInput=${(v) => { setQ(v); later(v); }} placeholder=${`${side === 'start' ? 'Start' : 'End'} track: title, artist, album`} autoFocus />
      ${playing ? html`<${Btn} icon="graphic_eq" onClick=${() => onPick(playing)}>Playing</${Btn}>` : null}
      <${IconBtn} icon="close" title="Cancel" onClick=${onClose} />
    </div>
    ${!query.trim() ? html`<div class="hint pad">Search for a track on the server.</div>`
      : found.loading && !found.data ? html`<${Spinner} />`
      : !tracks.length ? html`<div class="hint pad">Nothing on the server matches</div>`
      : html`<div class="sp-found">${tracks.map((t) => html`<button type="button" class="mini-row" onClick=${() => onPick(asTrack(t))}>
          <${Cover} file=${trackCover(t)} class="mini-cover" />
          <div class="mini-text"><span>${trackTitle(t)}</span><small>${[trackArtist(t), t.metadata?.album].filter(Boolean).join(' · ')}</small></div>
          <span class="micro-n">${fmtTime(t.metadata?.duration)}</span>
        </button>`)}</div>`}
  </div>`;
}

function EndCard({ side, track, picking, onPick, onClear }) {
  const label = side === 'start' ? 'Start' : 'End';
  return html`<button type="button" class=${`sp-end ${picking ? 'on' : ''} ${track ? '' : 'unset'}`} onClick=${onPick}>
    <span class="micro sp-end-label">${label.toUpperCase()}</span>
    ${track ? html`
      <${Cover} file=${trackCover(track)} class="sp-cover" />
      <span class="sp-end-text"><b>${trackTitle(track)}</b><small>${trackArtist(track)}</small></span>
      <span class="sp-clear" role="button" title="Clear" onClick=${(e) => { e.stopPropagation(); onClear(); }}><${Icon} name="close" size=${16} /></span>`
      : html`<span class="sp-cover sp-cover-empty"><${Icon} name="add" size=${18} /></span>
        <span class="sp-end-text"><b>Pick the ${label.toLowerCase()} track</b><small>Search the library, or take the one playing</small></span>`}
  </button>`;
}

export function SonicPath() {
  const s = useStore(sonic, (x) => x);
  const [picking, setPicking] = useState(null);
  const pick = (side) => (t) => { sonic.set({ [side]: t, rows: null }); setPicking(null); };
  const canSwap = !!(s.start || s.end);
  const rows = s.rows || [];
  return html`<div class="screen">
    <${Header} title="Sonic Path" sub=${rows.length ? `THE PATH · ${rows.length} TRACKS · ${fmtTime(sumDuration(rows))}` : 'FROM ONE SOUND TO ANOTHER'}>
      ${s.start || s.end ? html`<${Btn} kind="ghost" onClick=${() => { sonic.set({ start: null, end: null, rows: null, notAnalyzed: null }); setPicking(null); }}>Start over</${Btn}>` : null}
    </${Header}>
    <div class="scroll pad sp">
      <section class="sp-setup">
        <p class="card-text">Pick two tracks — the server fills the way between them with tracks whose sound morphs from one to the other.</p>
        <div class="sp-ends">
          <${EndCard} side="start" track=${s.start} picking=${picking === 'start'} onPick=${() => setPicking(picking === 'start' ? null : 'start')} onClear=${() => sonic.set({ start: null, rows: null })} />
          ${picking === 'start' ? html`<${Picker} side="start" onPick=${pick('start')} onClose=${() => setPicking(null)} />` : null}
          <button type="button" class=${`sp-swap ${canSwap ? '' : 'off'}`} title="Swap start and end" disabled=${!canSwap}
            onClick=${() => sonic.set({ start: s.end, end: s.start, rows: null })}><${Icon} name="swap_vert" size=${20} /></button>
          <${EndCard} side="end" track=${s.end} picking=${picking === 'end'} onPick=${() => setPicking(picking === 'end' ? null : 'end')} onClear=${() => sonic.set({ end: null, rows: null })} />
          ${picking === 'end' ? html`<${Picker} side="end" onPick=${pick('end')} onClose=${() => setPicking(null)} />` : null}
        </div>
        <div class="sp-length">
          <span class="sp-length-n">${s.length} tracks</span>
          <input type="range" min="4" max="32" step="1" value=${s.length} onInput=${(e) => sonic.set({ length: Number(e.currentTarget.value) })} />
          <button type="button" class="btn btn-primary" disabled=${!s.start || !s.end || s.loading} onClick=${build}>
            <${Icon} name="route" size=${15} />${s.rows ? 'Rebuild' : 'Build the path'}</button>
        </div>
        ${!s.start || !s.end ? html`<div class="hint">Tap an end to pick its track, or use “Sonic path” in a track’s ⋮ menu: the first sets the start, the next the end.</div>` : null}
      </section>

      ${s.loading ? html`<${Spinner} label="Building the path" />`
        : s.notAnalyzed ? html`<${Empty} icon="route" title=${`The ${s.notAnalyzed} track hasn’t been analyzed yet.`}>The path appears once the server’s discovery scan reaches it.</${Empty}>`
        : s.rows && !rows.length ? html`<${Empty} icon="route" title="No path between these two.">Try other tracks or another length.</${Empty}>`
        : rows.length ? html`<section class="block sp-result">
            <div class="block-head">
              <span class="micro">THE PATH · ${rows.length} TRACKS</span>
              <span class="sp-actions">
                <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => P.playTracks(rows)}>Play</${Btn}>
                <${Btn} icon="queue_music" onClick=${() => P.addToQueue(rows)}>Queue</${Btn}>
                <${Btn} icon="save" onClick=${() => save(rows)}>Save</${Btn}>
              </span>
            </div>
            <${TrackTable} groups=${[{ tracks: rows }]} firstCol="MATCH"
              firstValue=${(t) => `${Math.round((t.similarity || 0) * 100)}%`} />
          </section>` : null}
    </div>
  </div>`;
}
