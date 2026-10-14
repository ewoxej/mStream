// Settings: what this player controls (playback, transcoding) plus the
// server facts a listener needs. Server administration stays in /admin.
import { html, useState } from '../vendor/preact-htm.js';
import { app, useStore, href, setPref } from '../store.js';
import { sidebarLayout, sidebarPrefs } from '../nav.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import * as lib from '../library.js';
import { Header, Seg, Toggle, Btn, Icon, Plate, confirm } from '../ui.js';
import { fmtCount, server } from '../util.js';

const TABS = [
  ['playback', 'Playback'],
  ['interface', 'Interface'],
  ['transcoding', 'Transcoding'],
  ['library', 'Library'],
  ['server', 'Server'],
];

function Card({ title, note, children }) {
  return html`<section class="card set-card">
    <div class="set-head"><span class="card-title">${title}</span>${note ? html`<span class="set-note">${note}</span>` : null}</div>
    ${children}
  </section>`;
}

function Row({ title, sub, children }) {
  return html`<div class="set-row">
    <div class="set-text"><span>${title}</span>${sub ? html`<small>${sub}</small>` : null}</div>
    ${children}
  </div>`;
}

const Value = ({ children }) => html`<span class="value">${children}</span>`;

function Playback() {
  const s = useStore(playback, (x) => ({ rg: x.replayGain, pre: x.replayGainPreGainDb }));
  return html`<${Card} title="Volume normalization" note="Evens out loudness between tracks using the ReplayGain track-gain tags written at scan time.">
    <${Row} title="Mode" sub="Track applies each file's own gain tag">
      <${Seg} value=${s.rg ? 'track' : 'off'} onChange=${(v) => P.setReplayGain(v === 'track')}
        options=${[{ value: 'off', label: 'Off' }, { value: 'track', label: 'Track' }]} />
    </${Row}>
    <${Row} title="Pre-amp" sub="Added on top of the tag value">
      <div class="range-field">
        <input type="range" min="-15" max="15" step="0.5" value=${s.pre} disabled=${!s.rg}
          onInput=${(e) => P.setPreGain(Number(e.currentTarget.value))} />
        <${Value}>${s.pre > 0 ? '+' : s.pre < 0 ? '−' : '+'}${Math.abs(s.pre).toFixed(1)} dB</${Value}>
      </div>
    </${Row}>
  </${Card}>
  <${Card} title="Transitions" note="The next track is preloaded on a second audio element, so albums play without gaps.">
    <${Row} title="Gapless playback" sub="Always on"><${Value}>on</${Value}></${Row}>
  </${Card}>`;
}

function Transcoding() {
  const [, setRev] = useState(0);
  const t = MSTREAMPLAYER.transcodeOptions;
  const set = (patch) => { P.setTranscode(patch); setRev((n) => n + 1); };
  if (!t.serverEnabled) {
    return html`<${Card} title="Stream transcoding" note="The server can convert files on the fly, but transcoding is switched off on this server. An admin can turn it on in the admin panel.">
      <${Row} title="Transcode streams"><${Value}>unavailable</${Value}></${Row}>
    </${Card}>`;
  }
  const codec = t.selectedCodec || t.defaultCodec;
  const bitrate = t.selectedBitrate || t.defaultBitrate;
  return html`<${Card} title="Stream transcoding" note="The server converts files on the fly. Useful on slow connections. Applies from the next track.">
    <${Row} title="Transcode streams" sub="Every track is re-encoded by the server">
      <${Toggle} on=${!!t.frontendEnabled} onChange=${(v) => set({ frontendEnabled: v })} />
    </${Row}>
    <${Row} title="Codec">
      <${Seg} value=${codec} onChange=${(v) => set({ selectedCodec: v })} options=${['opus', 'mp3', 'aac'].map((c) => ({ value: c, label: c === 'opus' ? 'Opus' : c.toUpperCase() }))} />
    </${Row}>
    <${Row} title="Bitrate, kbps">
      <${Seg} value=${bitrate} onChange=${(v) => set({ selectedBitrate: v })} options=${['64k', '96k', '128k', '192k'].map((b) => ({ value: b, label: b.replace('k', '') }))} />
    </${Row}>
  </${Card}>`;
}

function Library() {
  const s = server();
  const counts = useStore(app, (x) => x.counts);
  const [busy, setBusy] = useState(false);
  const scan = async () => {
    setBusy(true);
    try { await lib.startScan(); P.toast('Scan started', 'success'); } catch (e) { P.toast(e.status === 403 ? 'Only admins can start a scan' : 'Could not start the scan', 'error'); }
    setBusy(false);
  };
  return html`<${Card} title="Library" note="Folders the server scans. Each one is a source in Folders and Auto DJ.">
    ${(s.vpaths || []).map((v) => html`<${Row} title=${v} sub=${s.vpathMetaData?.[v]?.type ? `${s.vpathMetaData[v].type} library` : ''}>
      <${Value}>${s.noUpload ? 'read' : 'read + upload'}</${Value}></${Row}>`)}
    <${Row} title="Tracks" sub=${`${fmtCount(counts.albums ?? 0)} albums · ${fmtCount(counts.artists ?? 0)} artists`}><${Value}>${fmtCount(counts.tracks ?? 0)}</${Value}></${Row}>
    ${s.admin ? html`<${Row} title="Rescan now" sub="Picks up new files and changed tags">
      <${Btn} icon="refresh" onClick=${scan} disabled=${busy}>Scan</${Btn}></${Row}>` : null}
  </${Card}>`;
}

// Sidebar: show / hide and order the items inside each group (drag, or
// the arrows). Settings always shows, so it stays reachable.
function Interface() {
  const stored = useStore(app, (x) => x.sidebar);
  const features = useStore(app, (x) => x.features);
  const layout = sidebarLayout(stored);
  const [drag, setDrag] = useState(null);   // { group, from, over }
  const save = (next) => setPref({ sidebar: sidebarPrefs(next) });
  const update = (gid, fn) => save(layout.map((g) => (g.id === gid ? { ...g, items: fn(g.items) } : g)));
  const move = (gid, from, to) => update(gid, (items) => {
    if (to < 0 || to >= items.length || from === to) { return items; }
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  });
  return html`<${Card} title="Sidebar" note="Show, hide and reorder the sidebar's items. Settings always stays, so it can be reached.">
    ${layout.map((g) => html`<div class="sb-group" key=${g.id}>
      <div class="sb-head micro">${g.label || 'GENERAL'}</div>
      ${g.items.map((i, n) => {
        const offered = !i.when || i.when(features);
        const dragHere = drag && drag.group === g.id;
        return html`<div key=${i.id} class=${`sb-row ${i.on ? '' : 'off'} ${dragHere && drag.from === n ? 'dragging' : ''} ${dragHere && drag.over === n && drag.from !== n ? (drag.from < n ? 'drop-after' : 'drop-before') : ''}`}
          draggable="true"
          onDragStart=${(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', i.id); setDrag({ group: g.id, from: n, over: n }); }}
          onDragOver=${(e) => { if (dragHere) { e.preventDefault(); if (drag.over !== n) { setDrag({ ...drag, over: n }); } } }}
          onDrop=${(e) => { e.preventDefault(); if (dragHere) { move(g.id, drag.from, n); } setDrag(null); }}
          onDragEnd=${() => setDrag(null)}>
          <span class="ch-handle" title="Drag to reorder"><${Icon} name="drag_indicator" size=${18} /></span>
          <${Plate} icon=${i.icon} size=${26} iconSize=${14} tone=${i.on ? 'accent' : 'muted'} />
          <span class="sb-name">${i.label}${!offered ? html`<small>Not on this server</small>` : i.fixed ? html`<small>Always shown</small>` : null}</span>
          <span class="ch-move">
            <button type="button" title="Move up" disabled=${n === 0} onClick=${() => move(g.id, n, n - 1)}><${Icon} name="arrow_upward" size=${14} /></button>
            <button type="button" title="Move down" disabled=${n === g.items.length - 1} onClick=${() => move(g.id, n, n + 1)}><${Icon} name="arrow_downward" size=${14} /></button>
          </span>
          ${i.fixed ? html`<span class="sb-fixed"><${Toggle} on=${true} onChange=${() => {}} title="Settings always shows" /></span>`
            : html`<${Toggle} on=${i.on} title=${i.on ? 'Hide' : 'Show'} onChange=${(v) => update(g.id, (items) => items.map((x) => (x.id === i.id ? { ...x, on: v } : x)))} />`}
        </div>`;
      })}
    </div>`)}
    <${Row} title="Reset sidebar" sub="Every item shown, in the original order">
      <${Btn} icon="restart_alt" onClick=${() => setPref({ sidebar: null })}>Reset</${Btn}>
    </${Row}>
  </${Card}>
  <${Card} title="Home" note="Sections on Home, how each shows (shortcut, grid or list card) and their order.">
    <${Row} title="Customize home">
      <a class="btn btn-outline" href=${href('customize')}><${Icon} name="tune" size=${15} />Customize</a>
    </${Row}>
  </${Card}>`;
}

async function logOut() {
  if (await confirm({ title: 'Log out of mStream?', text: 'You will need to sign in again to listen.', okLabel: 'Log out' })) { MSTREAMAPI.logout(); }
}

function Server() {
  const s = server();
  const info = useStore(app, (x) => x.server);
  return html`<${Card} title="Server" note="The mStream instance this player talks to.">
    <${Row} title="Address"><${Value}>${location.host}</${Value}></${Row}>
    <${Row} title="Version"><${Value}>${info?.version || '—'}</${Value}></${Row}>
    <${Row} title="Signed in as"><${Value}>${info?.user || 'public'}</${Value}></${Row}>
    ${s.admin ? html`<${Row} title="Administration" sub="Users, folders, scanning, transcoding, DLNA, federation">
      <a class="btn btn-outline" href="admin" target="_blank"><${Icon} name="open_in_new" size=${15} />Open admin</a></${Row}>` : null}
    ${s.token ? html`<${Row} title="Log out"><${Btn} onClick=${logOut}><${Icon} name="logout" size=${15} />Log out</${Btn}></${Row}>` : null}
  </${Card}>`;
}

export function Settings({ args }) {
  const tab = TABS.find((t) => t[0] === args[0]) ? args[0] : 'playback';
  const body = { playback: Playback, interface: Interface, transcoding: Transcoding, library: Library, server: Server }[tab];
  return html`<div class="screen">
    <${Header} title="Settings" />
    <div class="settings">
      <nav class="set-tabs">${TABS.map(([id, label]) => html`<a class=${tab === id ? 'on' : ''} href=${href('settings', id)}>${label}</a>`)}</nav>
      <div class="scroll set-body"><${body} /></div>
    </div>
  </div>`;
}
