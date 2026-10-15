// Play on's guest page: control one device of someone's mStream without an
// account. The link's token (the URL fragment) reaches only the guest API
// (src/api/guest.js): the device and its queue, search, commands.
import { html, render, useEffect, useRef, useState } from '../app/vendor/preact-htm.js';
import { ICONS } from '../app/icons.js';

const token = decodeURIComponent(location.hash.slice(1));
const POLL_MS = 2500;

function Icon({ name, size = 20 }) {
  return html`<svg class="ic" width=${size} height=${size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;
}

async function api(method, path, body) {
  const res = await fetch(`../${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-access-token': token },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = new Error(String(res.status)); e.status = res.status; throw e; }
  return res.json();
}

const art = (file, size = 's') => (file ? `../album-art/${encodeURIComponent(file)}?compress=${size}&token=${encodeURIComponent(token)}` : null);
const fmt = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) { return '–:––'; }
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Cover({ file, size = 's', class: cls = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [file]);
  const src = art(file, size);
  return html`<div class=${'cover ' + cls}>${src && !failed ? html`<img src=${src} alt="" loading="lazy" onError=${() => setFailed(true)} />` : html`<${Icon} name="music_note" size=${22} />`}</div>`;
}

let toastTimer;
function useToast() {
  const [msg, setMsg] = useState(null);
  const show = (text) => { setMsg(text); clearTimeout(toastTimer); toastTimer = setTimeout(() => setMsg(null), 2200); };
  return [msg, show];
}

function App() {
  const [state, setState] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [error, setError] = useState(token ? null : 'missing');
  const [tab, setTab] = useState('queue');
  const [, tick] = useState(0);
  const [msg, toast] = useToast();
  const volTimer = useRef();
  const [vol, setVol] = useState(null);   // the slider while it's being moved

  const load = () => api('GET', 'api/v1/guest')
    .then((s) => { setState(s); setFetchedAt(Date.now()); setError(null); })
    .catch((e) => setError(e.status === 401 ? 'ended' : e.status === 403 ? 'ended' : 'network'));

  useEffect(() => {
    if (!token) { return undefined; }
    load();
    const t = setInterval(() => { if (!document.hidden && error !== 'ended') { load(); } }, POLL_MS);
    const clock = setInterval(() => tick((n) => n + 1), 500);
    const vis = () => { if (!document.hidden) { load(); } };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); clearInterval(clock); document.removeEventListener('visibilitychange', vis); };
  }, [error === 'ended']);

  const send = async (command, args, done) => {
    try {
      await api('POST', 'api/v1/guest/command', { command, args });
      if (done) { toast(done); }
      setTimeout(load, 350);
      setTimeout(load, 1200);
    } catch (e) {
      toast(e.status === 409 ? `${state?.link.deviceName || 'The device'} is offline` : e.status === 401 ? 'This link has ended' : 'That didn’t work');
      if (e.status === 401) { setError('ended'); }
    }
  };

  if (error === 'missing' || error === 'ended') {
    return html`<div class="ended">
      <div class="plate"><${Icon} name="error_outline" size=${26} /></div>
      <h1>${error === 'missing' ? 'This link is incomplete' : 'This guest link has ended'}</h1>
      <p>Ask whoever shared it for a new one.</p>
    </div>`;
  }
  if (!state) { return html`<div class="ended"><p class="muted">${error === 'network' ? 'Can’t reach the server…' : 'Connecting…'}</p></div>`; }

  const d = state.device;
  const online = !!d?.online;
  const t = d?.track;
  const cur = state.queue.items[state.queue.index - state.queue.start];
  const coverFile = cur?.art || t?.art || null;
  const pos = d ? (d.playing ? d.positionMs + (Date.now() - fetchedAt) : d.positionMs) : 0;
  const dur = t?.durationMs || cur?.durationMs || 0;
  const volume = vol ?? d?.volume ?? null;

  return html`
    <header class="top">
      <div class="brand"><${Icon} name="graphic_eq" size=${18} /><span>${state.link.label || 'mStream'}</span></div>
      <div class=${`dev ${online ? 'on' : ''}`}><i></i>${state.link.deviceName}${online ? '' : ' · offline'}</div>
    </header>

    <section class="now">
      <${Cover} file=${coverFile} size="l" class="big" />
      <div class="meta">
        <span class="micro">${!online ? 'OFFLINE' : d.playing ? 'NOW PLAYING' : t ? 'PAUSED' : 'NOTHING PLAYING'}</span>
        <h1>${t?.title || cur?.title || 'Nothing yet'}</h1>
        <p>${[t?.artist || cur?.artist, t?.album || cur?.album].filter(Boolean).join(' · ') || (online ? 'Search for something to play' : 'The device isn’t connected')}</p>
      </div>
      <div class="bar"><div style=${{ width: dur ? `${Math.min(100, (pos / dur) * 100)}%` : '0%' }}></div></div>
      <div class="times"><span>${fmt(pos)}</span><span>${dur ? fmt(dur) : ''}</span></div>
      <div class="controls">
        <button type="button" class="ctl" disabled=${!online} title="Previous" onClick=${() => send('previous')}><${Icon} name="skip_previous" size=${28} /></button>
        <button type="button" class="ctl play" disabled=${!online} title=${d?.playing ? 'Pause' : 'Play'} onClick=${() => send('playPause')}><${Icon} name=${d?.playing ? 'pause' : 'play_arrow'} size=${34} /></button>
        <button type="button" class="ctl" disabled=${!online} title="Next" onClick=${() => send('next')}><${Icon} name="skip_next" size=${28} /></button>
      </div>
      ${volume != null ? html`<label class="vol"><${Icon} name="volume_up" size=${18} />
        <input type="range" min="0" max="100" value=${volume} disabled=${!online}
          onInput=${(e) => { const v = Number(e.target.value); setVol(v); clearTimeout(volTimer.current); volTimer.current = setTimeout(() => { send('setVolume', { volume: v }); setTimeout(() => setVol(null), 1500); }, 200); }} />
      </label>` : null}
    </section>

    <nav class="tabs">
      <button type="button" class=${tab === 'queue' ? 'on' : ''} onClick=${() => setTab('queue')}><${Icon} name="queue_music" size=${17} />Up next</button>
      <button type="button" class=${tab === 'search' ? 'on' : ''} onClick=${() => setTab('search')}><${Icon} name="search" size=${17} />Add music</button>
    </nav>
    ${tab === 'queue' ? html`<${Queue} queue=${state.queue} online=${online} send=${send} />` : html`<${Search} online=${online} send=${send} />`}
    ${msg ? html`<div class="toast">${msg}</div>` : null}
  `;
}

function Queue({ queue, online, send }) {
  if (!queue.items.length) { return html`<p class="hint">The queue is empty. Add music to start it.</p>`; }
  const shownTo = queue.start + queue.items.length;
  return html`<ol class="list">
    ${queue.items.map((it, i) => {
      const index = queue.start + i;
      const now = index === queue.index;
      return html`<li key=${index + it.filepath} class=${`row ${now ? 'cur' : ''} ${index < queue.index ? 'past' : ''}`}>
        <button type="button" class="row-main" disabled=${!online || now} title="Play this" onClick=${() => send('goTo', { index })}>
          <${Cover} file=${it.art} />
          <span class="row-text"><b>${it.title}</b><small>${it.artist}</small></span>
          ${now ? html`<span class="eq"><${Icon} name="graphic_eq" size=${16} /></span>` : null}
        </button>
        ${!now ? html`<button type="button" class="row-act" disabled=${!online} title="Remove from the queue"
          onClick=${() => send('remove', { index, path: it.filepath }, 'Removed')}><${Icon} name="close" size=${18} /></button>` : null}
      </li>`;
    })}
    ${queue.total > shownTo ? html`<li class="more">${queue.total - shownTo} more</li>` : null}
  </ol>`;
}

function Search({ online, send }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const timer = useRef();
  const input = useRef();
  useEffect(() => { input.current?.focus(); }, []);
  const find = (text) => {
    setQ(text);
    clearTimeout(timer.current);
    if (!text.trim()) { setRes(null); return; }
    timer.current = setTimeout(() => {
      api('POST', 'api/v1/guest/search', { search: text.trim() }).then((r) => setRes(r.tracks)).catch(() => setRes([]));
    }, 280);
  };
  return html`<div class="search">
    <label class="field"><${Icon} name="search" size=${18} />
      <input ref=${input} type="search" placeholder="Songs, artists, albums" value=${q} onInput=${(e) => find(e.target.value)} /></label>
    ${res === null ? html`<p class="hint">Find a song and add it: next up, or at the end of the queue.</p>`
      : !res.length ? html`<p class="hint">Nothing found.</p>`
      : html`<ol class="list">${res.map((t) => html`<li key=${t.filepath} class="row">
          <div class="row-main static"><${Cover} file=${t.art} /><span class="row-text"><b>${t.title}</b><small>${[t.artist, t.album].filter(Boolean).join(' · ')}</small></span></div>
          <button type="button" class="row-act txt" disabled=${!online} title="Play next" onClick=${() => send('enqueue', { paths: [t.filepath], next: true }, 'Playing next')}>Next</button>
          <button type="button" class="row-act" disabled=${!online} title="Add to the end of the queue" onClick=${() => send('enqueue', { paths: [t.filepath], next: false }, 'Added to the queue')}><${Icon} name="add" size=${20} /></button>
        </li>`)}</ol>`}
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
