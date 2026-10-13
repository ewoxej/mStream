// Settings: what this player controls (playback, transcoding) plus the
// server facts a listener needs. Server administration stays in /admin.
import { html, useState } from '../vendor/preact-htm.js';
import { app, useStore, href } from '../store.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import * as lib from '../library.js';
import { Header, Seg, Toggle, Btn, Icon, confirm } from '../ui.js';
import { fmtCount, server } from '../util.js';

const TABS = [
  ['playback', 'Playback'],
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
    <${Row} title="Classic player" sub="The previous interface, with Sonic Path, Discover, Jukebox and stats">
      <a class="btn btn-outline" href="classic/"><${Icon} name="open_in_new" size=${15} />Open</a></${Row}>
    ${s.token ? html`<${Row} title="Log out"><${Btn} onClick=${logOut}><${Icon} name="logout" size=${15} />Log out</${Btn}></${Row}>` : null}
  </${Card}>`;
}

export function Settings({ args }) {
  const tab = TABS.find((t) => t[0] === args[0]) ? args[0] : 'playback';
  const body = { playback: Playback, transcoding: Transcoding, library: Library, server: Server }[tab];
  return html`<div class="screen">
    <${Header} title="Settings" />
    <div class="settings">
      <nav class="set-tabs">${TABS.map(([id, label]) => html`<a class=${tab === id ? 'on' : ''} href=${href('settings', id)}>${label}</a>`)}</nav>
      <div class="scroll set-body"><${body} /></div>
    </div>
  </div>`;
}
