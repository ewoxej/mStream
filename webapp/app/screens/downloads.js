// Downloads: torrents through the client mStream is connected to
// (qBittorrent / Transmission / Deluge, set up in the admin panel). The
// transfer list is an admin route; anyone allowed to add torrents can.
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { href } from '../store.js';
import * as P from '../player.js';
import { Icon, IconBtn, Header, Chip, Plate, Empty, Spinner, confirm } from '../ui.js';
import { fmtBytes, server } from '../util.js';

async function api(method, path, body) {
  const s = server();
  const res = await fetch(s.host + path, {
    method,
    headers: { 'x-access-token': s.token, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.message || data.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}

// Shared poller so Home's card and the screen agree.
const listeners = new Set();
let last = { loading: true, torrents: [], error: null, forbidden: false };
let timer = null;
async function poll() {
  try {
    const d = await api('GET', 'api/v1/admin/torrent/list');
    last = { loading: false, torrents: d.torrents || [], error: d.error || null, forbidden: false, client: d.clientType };
  } catch (e) {
    last = { loading: false, torrents: [], error: e.status === 403 || e.status === 401 ? null : e.message, forbidden: e.status === 403 || e.status === 401 };
  }
  listeners.forEach((fn) => fn(last));
  const active = last.torrents.some((t) => t.status === 'downloading' || t.status === 'verifying');
  timer = setTimeout(poll, active ? 3000 : 15000);
}
function useTorrents() {
  const [s, setS] = useState(last);
  useEffect(() => {
    listeners.add(setS);
    if (!timer) { poll(); }
    return () => {
      listeners.delete(setS);
      if (!listeners.size) { clearTimeout(timer); timer = null; }
    };
  }, []);
  return s;
}

const TONE = { downloading: 'accent', seeding: 'state', paused: 'muted', queued: 'muted', verifying: 'muted', error: 'danger', unknown: 'muted' };
const LABEL = { downloading: 'Downloading', seeding: 'Seeding', paused: 'Paused', queued: 'Queued', verifying: 'Checking', error: 'Error', unknown: 'Unknown' };
const ICON = { downloading: 'arrow-down', seeding: 'arrow-up', paused: 'circle-pause', queued: 'timer', verifying: 'refresh-cw', error: 'circle-alert', unknown: 'download' };

function eta(s) {
  if (!(s > 0)) { return ''; }
  if (s < 60) { return `${s} s left`; }
  if (s < 3600) { return `${Math.round(s / 60)} min left`; }
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min left`;
}
const rate = (b) => `${fmtBytes(b || 0)}/s`;
const pct = (t) => Math.round((t.percent || 0) * 100);

export function DownloadsCard() {
  const s = useTorrents();
  const active = s.torrents.filter((t) => t.status === 'downloading').slice(0, 2);
  const down = s.torrents.reduce((a, t) => a + (t.rateDownload || 0), 0);
  const up = s.torrents.reduce((a, t) => a + (t.rateUpload || 0), 0);
  return html`<section class="card dl-card">
    <div class="card-head"><${Plate} icon="download" /><span class="card-title">Downloads</span><a class="link" href=${href('dl')}>Open</a></div>
    ${s.loading ? html`<${Spinner} />`
      : s.forbidden ? html`<p class="card-text">Add a magnet link or a .torrent file; it lands in your library when done.</p>`
      : s.error ? html`<p class="card-text">${s.error}. Set up a torrent client in the admin panel.</p>`
      : active.length ? active.map((t) => html`<div class="dl-mini">
          <div class="dl-mini-top"><span>${t.name}</span><span class="micro-n">${pct(t)}%</span></div>
          <div class="meter"><div style=${{ width: pct(t) + '%' }} class="accent"></div></div>
        </div>`)
      : html`<p class="card-text">${s.torrents.length ? `${s.torrents.length} torrents, nothing downloading.` : 'No torrents yet.'}</p>`}
    ${!s.loading && !s.error && !s.forbidden ? html`<div class="micro-n card-foot">↓ ${rate(down)} · ↑ ${rate(up)} · added to library when done</div>` : null}
  </section>`;
}

function AddTorrent({ onAdded }) {
  const vpaths = server().vpaths || [];
  const [magnet, setMagnet] = useState('');
  const [file, setFile] = useState(null);
  const [vpath, setVpath] = useState(vpaths[0] || '');
  const [dir, setDir] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef();

  // Folder name defaults to the torrent's own name.
  useEffect(() => {
    if (file) { setDir(file.name.replace(/\.torrent$/i, '')); return; }
    const dn = /[?&]dn=([^&]+)/.exec(magnet);
    if (dn) { try { setDir(decodeURIComponent(dn[1].replace(/\+/g, ' '))); } catch (_) { /* keep */ } }
  }, [magnet, file]);

  const submit = async (e) => {
    e.preventDefault();
    if (!magnet.trim() && !file) { return; }
    if (!dir.trim()) { P.toast('Name the folder the download goes into', 'error'); return; }
    const fd = new FormData();
    fd.append('vpath', vpath);
    fd.append('directoryName', dir.trim().replace(/[/\\]/g, '-'));
    if (file) { fd.append('torrentFile', file); } else { fd.append('magnet', magnet.trim()); }
    setBusy(true);
    try {
      await api('POST', 'api/v1/torrent/add', fd);
      P.toast('Torrent added', 'success');
      setMagnet(''); setFile(null); setDir('');
      onAdded();
    } catch (err) {
      P.toast(err.message, 'error', 'Could not add the torrent');
    }
    setBusy(false);
  };

  return html`<form class="dl-add" onSubmit=${submit}
    onDragOver=${(e) => e.preventDefault()}
    onDrop=${(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && /\.torrent$/i.test(f.name)) { setFile(f); setMagnet(''); } }}>
    <label class="search-field grow">
      <${Icon} name="magnet" size=${16} />
      ${file ? html`<span class="file-pill">${file.name}<button type="button" onClick=${() => setFile(null)}><${Icon} name="x" size=${12} /></button></span>`
        : html`<input value=${magnet} placeholder="Paste a magnet link or drop a .torrent file" onInput=${(e) => setMagnet(e.currentTarget.value)} />`}
      <button type="button" class="link small" onClick=${() => fileInput.current.click()}>.torrent</button>
      <input type="file" accept=".torrent" hidden ref=${fileInput} onChange=${(e) => { setFile(e.currentTarget.files[0] || null); setMagnet(''); }} />
    </label>
    <label class="select-field"><${Icon} name="folder" size=${15} />
      <select value=${vpath} onChange=${(e) => setVpath(e.currentTarget.value)}>${vpaths.map((v) => html`<option value=${v}>/${v}</option>`)}</select>
      <span>/</span>
      <input class="dir-input" value=${dir} placeholder="Folder" onInput=${(e) => setDir(e.currentTarget.value)} />
    </label>
    <button type="submit" class="btn btn-primary" disabled=${busy || (!magnet.trim() && !file)}><${Icon} name="plus" size=${15} />Add</button>
  </form>`;
}

export function Downloads() {
  const s = useTorrents();
  const [tab, setTab] = useState('All');
  const filters = {
    All: () => true,
    Active: (t) => ['downloading', 'queued', 'verifying', 'paused'].includes(t.status) && t.percent < 1,
    Seeding: (t) => t.status === 'seeding',
    Done: (t) => t.percent >= 1 && t.status !== 'seeding',
  };
  const rows = s.torrents.filter(filters[tab]);
  const down = s.torrents.reduce((a, t) => a + (t.rateDownload || 0), 0);
  const up = s.torrents.reduce((a, t) => a + (t.rateUpload || 0), 0);
  const remove = async (t) => {
    const ok = await confirm({ title: 'Remove torrent?', text: `“${t.name}” leaves the torrent client. Files already in the library stay.`, okLabel: 'Remove' });
    if (!ok) { return; }
    try {
      await api('DELETE', `api/v1/admin/torrent/${t.infoHash}`);
      P.toast('Torrent removed');
      clearTimeout(timer); poll();
    } catch (err) { P.toast(err.message, 'error'); }
  };
  return html`<div class="screen">
    <${Header} title="Downloads" sub=${`TORRENTS${s.client ? ' · ' + s.client.toUpperCase() : ''} · SAVED INTO THE LIBRARY`}>
      ${!s.forbidden && !s.error ? html`<span class="micro-n rates">↓ ${rate(down)} · ↑ ${rate(up)}</span>` : null}
    </${Header}>
    <div class="scroll pad col">
      <${AddTorrent} onAdded=${() => { clearTimeout(timer); poll(); }} />
      ${s.loading ? html`<${Spinner} />`
        : s.forbidden ? html`<${Empty} icon="download" title="Transfers are visible to admins">Torrents you add still download and land in the folder you chose.</${Empty}>`
        : s.error ? html`<${Empty} icon="circle-alert" title="Torrent client not available">${s.error}. Connect qBittorrent, Transmission or Deluge in the <a href="admin" target="_blank">admin panel</a>.</${Empty}>`
        : html`
          <div class="chips">${Object.keys(filters).map((k) => html`<${Chip} on=${tab === k} onClick=${() => setTab(k)}>${k}<span class="chip-n">${s.torrents.filter(filters[k]).length}</span></${Chip}>`)}</div>
          ${rows.length ? html`<div class="card table-card">${rows.map((t) => html`<div class="dl-row">
            <${Plate} icon=${ICON[t.status] || 'download'} tone=${TONE[t.status] || 'muted'} size=${30} />
            <div class="dl-text"><span>${t.name}</span>
              <small>${[fmtBytes(t.sizeBytes), t.status === 'downloading' && `↓ ${rate(t.rateDownload)}`, t.rateUpload > 0 && `↑ ${rate(t.rateUpload)}`, t.managedBy && `by ${t.managedBy}`].filter(Boolean).join(' · ')}</small></div>
            <div class="dl-prog"><div class="meter"><div class=${TONE[t.status]} style=${{ width: pct(t) + '%' }}></div></div>
              <small>${pct(t)}%${t.status === 'downloading' && eta(t.eta) ? ' · ' + eta(t.eta) : t.errorMessage ? ' · ' + t.errorMessage : ''}</small></div>
            <span class=${'pill ' + (TONE[t.status] || 'muted')}>${LABEL[t.status] || t.status}</span>
            <${IconBtn} icon="trash-2" title="Remove" onClick=${() => remove(t)} size=${15} />
          </div>`)}</div>` : html`<${Empty} icon="download" title=${tab === 'All' ? 'No torrents' : `Nothing in ${tab}`} />`}`}
    </div>
  </div>`;
}
