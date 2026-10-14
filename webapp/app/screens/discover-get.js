// Getting a Discover lead: the window a Network or Peers row opens. Links
// and 30-second previews from the plug-ins, "Get it" (an acquire plug-in's
// download, with its lookup: what it would fetch, before anything is),
// "Add to your collection" (a peer's song, album or artist, copied), where
// the files land (the collection destination, editable), and the downloads
// strip under Discover. State and polling: app/jobs.js.
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { useStore } from '../store.js';
import * as P from '../player.js';
import { Btn, Icon, IconBtn, Seg, Toggle, Spinner } from '../ui.js';
import { fmtTime } from '../util.js';
import * as J from '../jobs.js';
import { jobs, tt, rowText } from '../jobs.js';

const ROW_ICON = { download: 'download', folder: 'folder', clock: 'timer', check: 'check', warn: 'error_outline', close: 'close' };

// One job as a row: what it does, how far it is, what can be done.
function JobRow({ title, idleSub, startLabel, startIcon = 'download', row, busy, onStart, onCancel }) {
  const has = (a) => row.actions.includes(a);
  const sub = row.sub ? rowText(row.sub) : idleSub || '';
  return html`<div class=${`dg-job ${row.muted ? 'muted' : ''}`}>
    <span class=${`dg-ic ${row.iconCls || ''}`}><${Icon} name=${ROW_ICON[row.icon] || 'download'} size=${17} /></span>
    <div class="dg-body">
      <div class="dg-title">${title}${row.tag ? html`<span class=${`pill ${row.tagCls === 'ok' ? 'state' : row.tagCls === 'err' ? 'danger' : row.tagCls === 'src' ? 'accent' : 'muted'}`}>${tt(row.tag)}</span>` : null}</div>
      ${sub ? html`<div class=${`dg-sub ${row.errored ? 'err' : ''}`} title=${sub}>${sub}</div>` : null}
      ${row.progress !== null && row.progress !== undefined ? html`<div class=${`dg-progress ${row.progress === 'indeterminate' ? 'indet' : ''}`}>
        <i style=${row.progress === 'indeterminate' ? null : { width: row.progress + '%' }}></i></div>` : null}
    </div>
    <div class="dg-act">
      ${has('play') ? html`<${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => J.playFile(row.filepath)}>Play</${Btn}>` : null}
      ${has('queue') ? html`<${Btn} icon="queue_music" onClick=${() => J.queueFile(row.filepath)}>Queue</${Btn}>` : null}
      ${has('start') ? html`<${Btn} kind="primary" icon=${startIcon} iconSize=${14} disabled=${busy} onClick=${onStart}>${startLabel}</${Btn}>` : null}
      ${has('retry') ? html`<${Btn} icon="refresh" disabled=${busy} onClick=${onStart}>${tt('discover.job.retry')}</${Btn}>` : null}
      ${has('cancel') ? html`<${Btn} kind="ghost" onClick=${onCancel}>Cancel</${Btn}>` : null}
    </div>
  </div>`;
}

// What an acquire plug-in with a lookup would fetch: nothing is asked until
// the user presses (a search is a request to YouTube from this server).
function LookupRow({ plugin, lookup, busy, error, onLookup, onChoose, onStart }) {
  const c = DISCOVERJOBS.lookupCard(lookup);
  const [others, setOthers] = useState(false);
  const head = html`<span class="dg-ic"><${Icon} name="download" size=${17} /></span>`;
  if (c.state === 'idle' || c.state === 'loading' || c.state === 'error' || c.state === 'none') {
    const sub = c.state === 'loading' ? `Searching for “${c.query}”…` : c.state === 'error' ? (c.error || 'The search did not answer — try again')
      : c.state === 'none' ? `Nothing found for “${c.query}”` : `Searches for “${c.query}”`;
    return html`<div class="dg-job">${head}
      <div class="dg-body"><div class="dg-title">Get it · ${plugin.title || plugin.name}</div><div class=${`dg-sub ${c.state === 'error' || error ? 'err' : ''}`}>${error || sub}</div></div>
      <div class="dg-act">
        <${Btn} icon="search" disabled=${c.state === 'loading'} onClick=${onLookup}>${c.state === 'idle' ? 'Look it up' : 'Search again'}</${Btn}>
        <${Btn} kind="primary" icon="download" iconSize=${14} disabled=${busy} onClick=${() => onStart(null)}>Download</${Btn}>
      </div>
    </div>`;
  }
  if (c.state === 'owned') {
    return html`<div class="dg-job">${head}<div class="dg-body"><div class="dg-title">Get it · ${plugin.title || plugin.name}<span class="pill state">${tt('discover.job.owned')}</span></div>
      <div class="dg-sub">${tt('discover.job.ownedSub')}</div></div>
      ${c.owned?.filepath ? html`<div class="dg-act"><${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => J.playFile(c.owned.filepath)}>Play</${Btn}></div>` : null}
    </div>`;
  }
  const item = (x, chosen) => html`<button type="button" class=${`dg-cand ${chosen ? 'on' : ''}`} key=${x.url} onClick=${() => onChoose(x.url)}>
    ${x.thumbnail ? html`<img src=${x.thumbnail} alt="" loading="lazy" />` : html`<span class="dg-thumb"></span>`}
    <span class="dg-cand-text"><b>${x.title}</b><small>${[x.channel, x.length].filter(Boolean).join(' · ')}</small></span>
    <span class=${`dg-score ${x.loose ? 'loose' : ''}`} title="How well it matches">${x.scorePct}%</span>
  </button>`;
  return html`<div class="dg-look">
    <div class="dg-title">Get it · ${plugin.title || plugin.name}</div>
    ${item(c.card, true)}
    ${error ? html`<div class="dg-sub err">${error}</div>` : null}
    <div class="dg-act">
      <${Btn} kind="primary" icon="download" iconSize=${14} disabled=${busy} onClick=${() => onStart({ url: c.card.url })}>Download this</${Btn}>
      <a class="btn btn-ghost" href=${c.card.url} target="_blank" rel="noopener"><${Icon} name="open_in_new" size=${15} />Open</a>
      ${c.others.length ? html`<${Btn} kind="ghost" icon=${others ? 'expand_more' : 'chevron_right'} onClick=${() => setOthers(!others)}>${c.others.length} more</${Btn}>` : null}
    </div>
    ${others ? html`<div class="dg-cands">${c.others.map((x) => item(x, false))}</div>` : null}
  </div>`;
}

// Where files land, and the form that changes it (saved for the account).
function Destination({ dest, tags, peerName, fileName }) {
  const d = dest?.destination;
  const [form, setForm] = useState(null);
  const layoutRef = useRef();
  if (!d) { return null; }
  const preview = (k) => DISCOVERJOBS.previewTarget({ vpath: k.vpath, base: k.base, layout: k.layout, tags, peerName, fileName });
  if (!form) {
    const p = preview(d);
    const where = [d.vpath, ...DISCOVERJOBS.pathCrumbs(p.valid ? p.relDir : d.base)].join(' / ');
    return html`<div class="dg-dest">
      <${Icon} name="folder" size=${15} />
      <span class="dg-dest-path"><span class="muted">Files go to</span> ${where}</span>
      <${Btn} kind="ghost" onClick=${() => setForm({ vpath: d.vpath, base: d.base || '', layout: d.layout, saving: false, error: '' })}>Change…</${Btn}>
      ${dest.saved ? html`<${Btn} kind="ghost" title="Back to the library default" onClick=${() => J.saveDest(null).catch((e) => P.toast(J.errorText(e), 'error'))}><${Icon} name="restart_alt" size=${15} /></${Btn}>` : null}
    </div>`;
  }
  const p = preview(form);
  const set = (patch) => setForm({ ...form, ...patch, error: '' });
  const vars = dest.variables || DISCOVERJOBS.LAYOUT_VARS;
  const insert = (name) => {
    const el = layoutRef.current;
    const token = `{{${name}}}`;
    const at = el?.selectionStart ?? form.layout.length;
    const end = el?.selectionEnd ?? at;
    set({ layout: form.layout.slice(0, at) + token + form.layout.slice(end) });
    setTimeout(() => { el?.focus(); try { el.setSelectionRange(at + token.length, at + token.length); } catch (_) { /* not a text input */ } }, 0);
  };
  const problem = p.valid ? '' : p.error === 'unknown_variable'
    ? tt('discover.modal.dest.errUnknownVar', { name: p.variable || '', vars: vars.join(', ') })
    : ['empty_template', 'unbalanced_braces', 'absolute_template', 'traversal', 'empty_path'].includes(p.error)
      ? tt('discover.modal.dest.err.' + p.error) : tt('discover.modal.dest.errGeneric');
  const save = async () => {
    if (!p.valid || form.saving) { return; }
    setForm({ ...form, saving: true });
    try { await J.saveDest({ vpath: form.vpath, base: p.base, layout: form.layout }); setForm(null); } catch (e) { setForm({ ...form, saving: false, error: J.errorText(e) }); }
  };
  const libs = dest.libraries || [];
  const libTemplate = libs.find((l) => l.vpath === form.vpath)?.template || dest.defaultLayout || DISCOVERJOBS.DEFAULT_LAYOUT;
  return html`<div class="dg-form">
    <label class="field"><span class="micro">LIBRARY</span>
      <select value=${form.vpath} onChange=${(e) => set({ vpath: e.currentTarget.value })}>${libs.map((l) => html`<option value=${l.vpath}>${l.vpath}</option>`)}</select></label>
    <label class="field"><span class="micro">BASE FOLDER</span>
      <input value=${form.base} placeholder="library root" onInput=${(e) => set({ base: e.currentTarget.value })} /></label>
    <label class="field"><span class="micro">LAYOUT</span>
      <input ref=${layoutRef} value=${form.layout} onInput=${(e) => set({ layout: e.currentTarget.value })} /></label>
    <div class="chips">${vars.map((v) => html`<button type="button" class="chip static" onClick=${() => insert(v)}>${v}</button>`)}
      <button type="button" class="chip static" onClick=${() => set({ layout: libTemplate })}>library template</button></div>
    <div class=${`dg-sub ${problem || form.error ? 'err' : ''}`}>${problem || form.error || [form.vpath, p.relPath].filter(Boolean).join(' / ')}</div>
    ${p.valid && p.missingVars.length ? html`<div class="hint">${tt('discover.modal.dest.missing', { vars: p.missingVars.join(', ') })}</div>` : null}
    <div class="dg-act">
      <${Btn} kind="ghost" onClick=${() => setForm(null)}>Cancel</${Btn}>
      <${Btn} kind="primary" icon="check" iconSize=${14} disabled=${!p.valid || form.saving} onClick=${save}>Use this folder</${Btn}>
    </div>
  </div>`;
}

let previewAudio = null;
let pausedMain = false;
function stopPreview(setPlaying) {
  if (previewAudio) { try { previewAudio.pause(); } catch (_) { /* gone */ } previewAudio = null; }
  setPlaying?.(null);
  if (pausedMain) { pausedMain = false; if (!MSTREAMPLAYER.playerStats.playing) { P.playPause(); } }
}

// The window for one row. `source` = 'p2p' (a network lead) | 'federation' (a peer's track).
export function GetSheet({ track, source, onClose }) {
  const s = useStore(jobs, (x) => x);
  const recommendation = { ...track, source, filepath: source === 'federation' ? track.filepath : null };
  const [links, setLinks] = useState({ loading: true, list: [] });
  const [found, setFound] = useState({ keys: [], jobs: {} });
  const [lookups, setLookups] = useState({});
  const [busy, setBusy] = useState({});
  const [errors, setErrors] = useState({});
  const [previews, setPreviews] = useState({});
  const [playing, setPlaying] = useState(null);
  const [keep, setKeep] = useState({ scope: 'song', onlyMissing: true });
  const alive = useRef(true);

  useEffect(() => {
    J.watch(true);
    const key = (e) => { if (e.key === 'Escape') { onClose(); } };
    document.addEventListener('keydown', key);
    (async () => {
      await J.ensurePlugins();
      const st = jobs.get();
      const lp = J.linksPlugin(st);
      const tasks = [];
      tasks.push(lp ? MSTREAMAPI.discoveryPluginResolve(lp.name, recommendation).then((r) => {
        if (alive.current) { setLinks({ loading: false, list: (r && !r.disabled && r.result?.links) || [], error: !r || r.disabled }); }
      }) : Promise.resolve(setLinks({ loading: false, list: [] })));
      if (J.acquirePlugins(st).length) {
        tasks.push(J.ensureDest());
        tasks.push(MSTREAMAPI.discoveryJobLookup(recommendation).then((f) => {
          if (!alive.current || !f) { return; }
          setFound({ keys: [...Object.values(f.keys || {}), f.key].filter(Boolean), jobs: DISCOVERJOBS.jobsBySlot(f.jobs) });
          (f.jobs || []).forEach((j) => { if (DISCOVERJOBS.isLive(j)) { J.noteJob(j); } });
        }).catch(() => {}));
      }
      await Promise.all(tasks);
    })();
    return () => { alive.current = false; J.watch(false); document.removeEventListener('keydown', key); stopPreview(); };
  }, []);

  // A slot's job: the newest of what the lookup found and what the poll knows.
  const live = DISCOVERJOBS.jobsBySlot(s.list.filter((j) => found.keys.includes(j.key)));
  const jobOf = (slot) => {
    const a = found.jobs[slot];
    const b = live[slot];
    return !a ? b || null : !b ? a : (b.id >= a.id ? b : a);
  };
  const rowOf = (name, scope) => {
    const slot = DISCOVERJOBS.jobSlot(name, scope);
    const row = DISCOVERJOBS.jobRowState(jobOf(slot), { plugin: name });
    return errors[slot] ? { ...row, sub: { text: errors[slot] }, errored: true } : row;
  };
  const start = async (plugin, choice, scope) => {
    const slot = DISCOVERJOBS.jobSlot(plugin.name, scope);
    if (busy[slot]) { return; }
    if (choice === undefined) { const l = lookups[plugin.name]; choice = l?.status === 'ready' && l.chosen ? { url: l.chosen } : null; }
    setBusy((b) => ({ ...b, [slot]: true }));
    setErrors((e) => ({ ...e, [slot]: null }));
    try {
      const job = await J.startJob(plugin.name, recommendation, choice, scope);
      if (job && alive.current) {
        setFound((f) => ({ keys: f.keys.includes(job.key) ? f.keys : [...f.keys, job.key], jobs: { ...f.jobs, [slot]: job } }));
      }
    } catch (err) {
      if (alive.current) { setErrors((e) => ({ ...e, [slot]: J.errorText(err) })); }
    }
    if (alive.current) { setBusy((b) => ({ ...b, [slot]: false })); }
  };
  const cancel = (plugin, scope) => { const job = jobOf(DISCOVERJOBS.jobSlot(plugin.name, scope)); if (job) { J.cancelJob(job); } };
  const words = [track.artist, track.title].filter(Boolean).join(' ');
  const lookup = async (plugin) => {
    setLookups((l) => ({ ...l, [plugin.name]: { status: 'loading', query: words, candidates: [], chosen: null } }));
    let res = null;
    try { res = await MSTREAMAPI.discoveryPluginResolve(plugin.name, recommendation); } catch (_) { res = null; }
    if (!alive.current) { return; }
    const a = res && !res.disabled && res.result?.lookup;
    if (!a) { setLookups((l) => ({ ...l, [plugin.name]: { status: 'error', query: words, candidates: [], error: typeof res?.error === 'string' ? res.error : '' } })); return; }
    const candidates = (a.candidates || []).filter((c) => c && c.url);
    setLookups((l) => ({ ...l, [plugin.name]: {
      status: a.owned ? 'owned' : candidates.length ? 'ready' : 'none', query: a.query || words, minScore: a.minScore,
      candidates, chosen: candidates[0]?.url || null, owned: a.owned || null,
    } }));
  };
  const togglePreview = async (plugin) => {
    if (playing === plugin.name) { stopPreview(setPlaying); return; }
    let st = previews[plugin.name];
    if (!st || st.status === 'idle') {
      setPreviews((p) => ({ ...p, [plugin.name]: { status: 'loading' } }));
      const res = await MSTREAMAPI.discoveryPluginResolve(plugin.name, recommendation);
      st = res && !res.disabled && res.result ? { status: res.result.preview ? 'ready' : 'none', preview: res.result.preview || null } : { status: 'error' };
      if (!alive.current) { return; }
      setPreviews((p) => ({ ...p, [plugin.name]: st }));
    }
    if (st.status !== 'ready') { return; }
    stopPreview(setPlaying);
    if (MSTREAMPLAYER.playerStats.playing) { pausedMain = true; P.playPause(); }
    const audio = new Audio(st.preview.url);
    previewAudio = audio;
    setPlaying(plugin.name);
    const done = () => { if (previewAudio === audio) { stopPreview(setPlaying); } };
    audio.addEventListener('ended', done);
    audio.addEventListener('error', done);
    audio.play().catch(done);
  };

  const acquire = J.acquirePlugins(s);
  const hasDest = !!s.dest?.destination;
  const getIt = hasDest ? acquire.filter((p) => p.name !== DISCOVERJOBS.COPY_PLUGIN) : [];
  const copy = hasDest && source === 'federation' ? acquire.find((p) => p.name === DISCOVERJOBS.COPY_PLUGIN) : null;
  const scopes = copy ? [
    { value: 'song', label: 'Song' },
    ...(track.album && copy.scopes?.includes('album') ? [{ value: 'album', label: 'Album' }] : []),
    ...(track.artist && copy.scopes?.includes('artist') ? [{ value: 'artist', label: 'Artist' }] : []),
  ] : [];
  const chosen = scopes.some((x) => x.value === keep.scope) ? keep.scope : 'song';
  const missingOk = chosen === 'artist' && copy?.scopes?.includes('artist-missing');
  const copyScope = chosen === 'song' ? undefined : (missingOk && keep.onlyMissing ? 'artist-missing' : chosen);
  const peerName = track.peer?.name || (source === 'federation' ? 'peer' : '');
  const copyLabel = { album: 'Add the album', artist: 'Add every album', 'artist-missing': 'Add what you’re missing' }[copyScope] || 'Add the song';
  const copySub = { album: `${track.album} from ${peerName}`, artist: `Every album of ${track.artist} on ${peerName}`, 'artist-missing': `${track.artist}’s albums this library lacks` }[copyScope]
    || `A copy of the file from ${peerName}, into your library`;
  const tags = { artist: track.artist || null, album: track.album || null, year: track.year || null, genre: null, albumartist: null };
  const previewList = J.previewPlugins(s);

  return html`<div class="scrim" onMouseDown=${(e) => { if (e.target === e.currentTarget) { onClose(); } }}>
    <div class="dialog dg">
      <div class="dg-head">
        <div class="dg-head-text">
          <div class="dialog-title">${track.title || '(untitled)'}</div>
          <div class="dialog-text">${[track.artist, track.album, source === 'federation' ? `on ${peerName}` : 'from the discovery network'].filter(Boolean).join(' · ')}${track.duration ? ' · ' + fmtTime(track.duration) : ''}</div>
        </div>
        <${IconBtn} icon="close" title="Close" onClick=${onClose} />
      </div>

      ${source === 'federation' ? html`<div class="dg-act left">
        <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => { window.VUEPLAYERCORE.addFederationSongWizard(track.peer, track.filepath, { title: track.title || '', artist: track.artist || '', album: track.album || '', duration: track.duration || null }, false, MSTREAMPLAYER.positionCache.val + 1, true); onClose(); }}>Play</${Btn}>
        <${Btn} icon="queue_music" onClick=${() => { window.VUEPLAYERCORE.addFederationSongWizard(track.peer, track.filepath, { title: track.title || '', artist: track.artist || '', album: track.album || '', duration: track.duration || null }, true); P.toast('Added to queue'); }}>Queue</${Btn}>
      </div>` : null}

      ${s.plugins === null ? html`<${Spinner} label="Asking the plug-ins" />` : null}

      ${copy ? html`<section class="dg-sec">
        <div class="micro">ADD TO YOUR COLLECTION</div>
        ${scopes.length > 1 ? html`<div class="dg-scope"><${Seg} value=${chosen} onChange=${(v) => setKeep({ ...keep, scope: v })} options=${scopes} />
          ${missingOk ? html`<label class="dg-missing" onClick=${(e) => { e.preventDefault(); setKeep({ ...keep, onlyMissing: !keep.onlyMissing }); }}><span>Only the albums you don’t have</span><${Toggle} on=${keep.onlyMissing} onChange=${(v) => setKeep({ ...keep, onlyMissing: v })} /></label>` : null}
        </div>` : null}
        <${JobRow} title=${copyLabel} idleSub=${copySub} startLabel="Add" startIcon="add" row=${rowOf(copy.name, copyScope)}
          busy=${busy[DISCOVERJOBS.jobSlot(copy.name, copyScope)]} onStart=${() => start(copy, null, copyScope)} onCancel=${() => cancel(copy, copyScope)} />
      </section>` : null}

      ${getIt.length ? html`<section class="dg-sec">
        <div class="micro">GET IT</div>
        ${getIt.map((plugin) => {
          const row = rowOf(plugin.name);
          const slot = DISCOVERJOBS.jobSlot(plugin.name);
          return DISCOVERJOBS.hasLookup(plugin) && row.state === 'idle'
            ? html`<${LookupRow} key=${plugin.name} plugin=${plugin} lookup=${lookups[plugin.name] || { status: 'idle', query: words }} busy=${busy[slot]} error=${errors[slot]}
                onLookup=${() => lookup(plugin)} onChoose=${(url) => setLookups((l) => ({ ...l, [plugin.name]: { ...l[plugin.name], chosen: url } }))}
                onStart=${(choice) => start(plugin, choice)} />`
            : html`<${JobRow} key=${plugin.name} title=${`Get it · ${plugin.title || plugin.name}`} idleSub=${`Searches for “${words}”`} startLabel="Download"
                row=${row} busy=${busy[slot]} onStart=${() => start(plugin)} onCancel=${() => cancel(plugin)} />`;
        })}
      </section>` : null}

      ${(copy || getIt.length) ? html`<${Destination} dest=${s.dest} tags=${tags} peerName=${source === 'federation' ? peerName : null} fileName=${track.filepath || 'track'} />` : null}
      ${s.plugins && acquire.length && s.dest && !hasDest ? html`<div class="hint">There is nowhere to put a file: uploads are off for this account, or it has no library it may write to.</div>` : null}

      ${previewList.length ? html`<section class="dg-sec">
        <div class="micro">LISTEN</div>
        <div class="chips">${previewList.map((p) => {
          const st = previews[p.name]?.status;
          return html`<button type="button" class=${`chip ${playing === p.name ? 'on' : ''}`} disabled=${st === 'none' || st === 'error'} onClick=${() => togglePreview(p)}>
            <${Icon} name=${playing === p.name ? 'stop' : st === 'loading' ? 'refresh' : 'play_arrow'} size=${14} class=${st === 'loading' ? 'spin' : ''} />
            ${p.title || p.name}${st === 'none' ? ' · no preview' : st === 'error' ? ' · failed' : ''}</button>`;
        })}</div>
      </section>` : null}

      ${links.list.length ? html`<section class="dg-sec">
        <div class="micro">ELSEWHERE</div>
        <div class="chips">${links.list.map((l) => html`<a class="chip" href=${l.url} target="_blank" rel="noopener"><${Icon} name="open_in_new" size=${13} />${l.title || l.label || l.name || l.url}</a>`)}</div>
      </section>` : null}
      ${s.plugins && !links.loading && !links.list.length && !acquire.length && !previewList.length ? html`<div class="hint">No plug-in on this server does anything with network leads. An admin can turn plug-ins on in the admin panel.</div>` : null}
    </div>
  </div>`;
}

// The downloads strip under Discover: what still wants the user (live, failed).
export function JobsStrip({ onOpen }) {
  const list = useStore(jobs, (x) => x.list);
  const rows = DISCOVERJOBS.trayRows(list);
  if (!rows.length) { return null; }
  const sum = DISCOVERJOBS.traySummary(list);
  return html`<section class="card dg-strip">
    <div class="block-head"><span class="micro">DOWNLOADS · ${sum.parts.map((p) => tt(p.key, { count: p.count })).join(' · ').toUpperCase()}</span>
      ${sum.clearable ? html`<${Btn} kind="ghost" icon="delete_sweep" onClick=${J.clearFinished}>Clear failed</${Btn}>` : null}</div>
    ${rows.map((job) => {
      const row = DISCOVERJOBS.jobRowState(job);
      const kind = DISCOVERJOBS.jobKind(job);
      return html`<div class="dg-strip-row" key=${job.id}>
        <button type="button" class="dg-strip-open" onClick=${() => onOpen(job)}>
          <b>${DISCOVERJOBS.jobTitle(job) || 'Download'}</b>
          <small>${[J.pluginTitle(job.plugin), kind ? tt(kind) : '', rowText(row.sub)].filter(Boolean).join(' · ')}</small>
          ${row.progress !== null ? html`<span class=${`dg-progress ${row.progress === 'indeterminate' ? 'indet' : ''}`}><i style=${row.progress === 'indeterminate' ? null : { width: row.progress + '%' }}></i></span>` : null}
        </button>
        ${row.actions.includes('cancel') ? html`<${IconBtn} icon="close" title="Cancel" onClick=${() => J.cancelJob(job)} />` : null}
        ${row.actions.includes('retry') ? html`<${IconBtn} icon="refresh" title="Retry" onClick=${() => J.retryJob(job)} />` : null}
      </div>`;
    })}
  </section>`;
}

