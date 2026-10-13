// Stats: the listening log (Stats API v2), as the /stats page shows it but
// in the player. The numbers, periods and charts come from that page's pure
// half (stats/stats-view.js, global STATSVIEW); the charts are recoloured to
// the app's palette.
import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Btn, Icon, Header, Seg, Empty, Spinner, Cover, confirm } from '../ui.js';
import * as P from '../player.js';
import { server, fmtCount } from '../util.js';

const V = () => window.STATSVIEW;
const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } })();

async function api(method, path, body) {
  const s = server();
  const res = await fetch(s.host + path, {
    method,
    headers: { 'x-access-token': s.token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = new Error(`${method} ${path}: ${res.status}`); e.status = res.status; throw e; }
  return res;
}
const getJson = (path) => api('GET', path).then((r) => r.json());
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

// The page's chart, in mustard on the app's surfaces.
function chartSvg(values, opts) {
  return V().columnChart(values, opts)
    .replaceAll('#657ee4', '#d4a24c').replaceAll('#30353e', '#2a2d24')
    .replaceAll('#8c919a', '#7f8274').replaceAll('#F5F7FA', '#f4f4ee')
    .replaceAll('font-size="11"', 'font-size="11" font-family="IBM Plex Mono, monospace"');
}

function Chart({ values, height, labels, peakLabel, barMax, titles }) {
  const box = useRef();
  const [w, setW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => setW(box.current?.clientWidth || 0));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const svg = w ? chartSvg(values, { width: Math.max(280, w), height, labels, peakLabel, barMax, titles }) : '';
  return html`<div class="st-chart" ref=${box} dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

function TrackCell({ meta }) {
  return html`<${Cover} file=${meta.art || null} class="mini-cover" />
    <div class="mini-text"><span>${meta.title || 'Unknown track'}</span><small>${meta.artist}</small></div>`;
}

const ENTITIES = [{ value: 'tracks', label: 'Tracks' }, { value: 'artists', label: 'Artists' }, { value: 'albums', label: 'Albums' }, { value: 'genres', label: 'Genres' }];

export function Stats() {
  const [ctx, setCtx] = useState(null);
  const [sel, setSel] = useState({ period: 'month', offset: 0, origin: 'all' });
  const [entity, setEntity] = useState('tracks');
  const [topLimit, setTopLimit] = useState(8);
  const [data, setData] = useState(null);
  const [top, setTop] = useState(null);
  const [history, setHistory] = useState({ items: [], next: null });
  const [error, setError] = useState(null);
  const [rev, setRev] = useState(0);

  const range = (delta = 0) => (sel.period === 'all' ? { tz, origin: sel.origin, period: 'all' } : { tz, origin: sel.origin, period: sel.period, offset: sel.offset + delta });

  // Once: the periods with data, peers, the library's size.
  useEffect(() => {
    Promise.all([
      getJson('api/v1/stats/periods?' + qs({ tz })).catch(() => null),
      getJson('api/v1/federation/peers').then((r) => (Array.isArray(r?.peers) ? r.peers : [])).catch(() => []),
      getJson('api/v1/db/status').catch(() => null),
    ]).then(([periods, peers, status]) => {
      const options = V().periodOptions(periods);
      setCtx({ periods, peers, list: periods?.periods || [], options, libraryTracks: Number.isFinite(status?.totalFileCount) ? status.totalFileCount : null });
      if (!options.some((o) => o.value === 'month:0')) { setSel((s) => ({ ...s, period: options[0].period, offset: options[0].offset })); }
    });
  }, [rev]);

  useEffect(() => {
    if (!ctx) { return undefined; }
    let alive = true;
    const r = range();
    const monthly = sel.period === 'year' || sel.period === 'all';
    setError(null);
    Promise.all([
      getJson('api/v1/stats/summary?' + qs(r)),
      sel.period === 'all' ? null : getJson('api/v1/stats/summary?' + qs(range(-1))).catch(() => null),
      getJson('api/v1/stats/timeseries?' + qs({ ...r, bucket: monthly ? 'month' : 'day' })),
      getJson('api/v1/stats/timeseries?' + qs({ ...r, bucket: 'hourOfDay' })),
      getJson('api/v1/stats/history?' + qs({ ...r, limit: 10 })),
    ]).then(([summary, prev, series, hours, hist]) => {
      if (!alive) { return; }
      setData({ summary, prev, series, hours, monthly });
      setHistory({ items: hist.items || [], next: hist.next || null });
    }).catch((e) => { if (alive) { setError(e); } });
    return () => { alive = false; };
  }, [ctx, sel.period, sel.offset, sel.origin, rev]);

  useEffect(() => {
    if (!ctx) { return; }
    getJson('api/v1/stats/top?' + qs({ ...range(), entity, metric: 'plays', limit: topLimit })).then(setTop).catch(() => setTop(null));
  }, [ctx, sel.period, sel.offset, sel.origin, entity, topLimit, rev]);

  const more = () => getJson('api/v1/stats/history?' + qs({ ...range(), limit: 20, before: history.next }))
    .then((h) => setHistory((x) => ({ items: [...x.items, ...(h.items || [])], next: h.next || null })));
  const forget = async (id) => {
    try { await api('DELETE', 'api/v1/stats/plays/' + encodeURIComponent(id)); setRev((n) => n + 1); } catch (_) { P.toast('Could not forget this play', 'error'); }
  };
  const exportLog = async () => {
    try {
      const blob = await (await api('GET', 'api/v1/stats/export')).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mstream-listening-' + new Date().toISOString().slice(0, 10) + '.ndjson';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (_) { P.toast('Could not export the log', 'error'); }
  };
  const clear = async (scope) => {
    const keep = scope === 'history';
    const ok = await confirm({
      title: 'Clear your listening history?',
      text: keep ? 'The log goes; play counts on tracks stay. This can’t be undone.' : 'The log and the play counts on tracks go. This can’t be undone.',
      okLabel: 'Clear',
    });
    if (!ok) { return; }
    try { await api('POST', 'api/v1/stats/reset', { scope }); setRev((n) => n + 1); P.toast('History cleared'); } catch (_) { P.toast('Could not clear the history', 'error'); }
  };

  const v = V();
  const s = data?.summary;
  const empty = data && (!s || !s.events);
  const showOrigin = ctx && (ctx.peers.length > 0 || ctx.periods?.peers || s?.origins?.peers?.plays > 0);
  const prevEntry = ctx?.list.find((p) => p.period === sel.period && p.offset === sel.offset - 1);
  const versus = v.versusLabel(sel.period, prevEntry && v.periodLabel(prevEntry));
  const now = new Date().toISOString();

  let body;
  if (error) {
    body = html`<${Empty} icon="error_outline" title=${error.status === 404 ? 'This server has no Stats API yet.' : 'Could not load your listening.'}>${error.status === 404 ? 'It arrived in mStream 6.27.' : String(error.message)}</${Empty}>`;
  } else if (!data) {
    body = html`<${Spinner} label="Loading your listening" />`;
  } else if (empty) {
    body = ctx.list.length === 0
      ? html`<${Empty} icon="insights" title="No plays yet">Plays land here as you listen: the player reports each track when it ends, and the app sends its history when it’s online.</${Empty}>`
      : html`<${Empty} icon="insights" title="Nothing in this period">No plays started in this period.</${Empty}>`;
  } else {
    // "All time" starts at the retention floor, years before the first play: start where the log does.
    let from = data.series.period?.from;
    const earliest = ctx.periods?.earliest;
    if (sel.period === 'all' && earliest && (!from || earliest > from)) { from = earliest; }
    const series = data.monthly ? v.monthSeries(data.series.items, from, data.series.period?.to, tz)
      : v.dailySeries(data.series.items, from, data.series.period?.to, tz);
    const hv = v.hourSeries(data.hours?.items);
    const peak = (vals) => { const m = Math.max(0, ...vals); return m > 0 ? v.fmtInt(m) : null; };
    const items = top?.items || [];
    const topMax = items.length ? Math.max(...items.map((i) => i.plays || 0)) : 0;
    body = html`
      <div class="st-tiles">${v.tiles(s, data.prev, { versus, libraryTracks: ctx.libraryTracks }).map((t) => html`<div class="card st-tile">
        <span class="micro">${t.label.toUpperCase()}</span><b>${t.value}</b><small>${t.sub}</small></div>`)}</div>
      <section class="card st-card">
        <div class="card-head"><span class="card-title">${data.monthly ? 'Plays per month' : 'Plays per day'}</span><span class="micro-n">${v.daysNote(s)}</span></div>
        <${Chart} values=${series.values} height=${190} barMax=${data.monthly ? 40 : 24} peakLabel=${peak(series.values)}
          labels=${data.monthly ? v.monthAxisLabels(series.keys) : v.dayAxisLabels(series.keys)}
          titles=${series.keys.map((k, i) => (data.monthly ? k : v.dayKeyLabel(k)) + ': ' + series.values[i] + ' plays')} />
      </section>
      <section class="card st-card">
        <div class="card-head"><span class="card-title">When you listen</span><span class="micro-n">${v.hoursNote(s)}</span></div>
        <${Chart} values=${hv} height=${160} barMax=${16} peakLabel=${Number.isInteger(s.peakHour) ? v.hourLabel(s.peakHour) : null}
          labels=${[[0, '0'], [6, '6'], [12, '12'], [18, '18'], [23, '23']]} titles=${hv.map((x, i) => v.hourLabel(i) + ': ' + x + ' plays')} />
      </section>
      <section class="card st-card">
        <div class="card-head"><span class="card-title">Top</span><${Seg} value=${entity} onChange=${(e) => { setEntity(e); setTopLimit(8); }} options=${ENTITIES} /></div>
        ${items.length ? items.map((it) => {
          const m = entity === 'tracks' ? v.metaOf(it.track) : null;
          const share = topMax > 0 ? Math.max(0.02, (it.plays || 0) / topMax) : 0;
          return html`<div class="st-row">
            <span class="st-rank">${v.fmtInt(it.rank)}</span>
            ${m ? html`<${TrackCell} meta=${m} />` : html`<div class="mini-text"><span>${it.name || 'Unknown'}</span>
              <small>${entity === 'albums' && it.artist ? it.artist : it.tracks ? fmtCount(it.tracks) + ' tracks' : ''}</small></div>`}
            <div class="meter st-share"><div style=${{ width: Math.round(share * 100) + '%' }} class="accent"></div></div>
            <span class="micro-n st-n">${it.plays} ${it.plays === 1 ? 'play' : 'plays'}</span>
            <span class="micro-n st-n">${v.fmtDuration(it.listenedMs)}</span>
          </div>`;
        }) : html`<div class="hint pad">Nothing here for this period.</div>`}
        ${items.length >= topLimit && topLimit < 20 ? html`<div class="st-more"><${Btn} kind="ghost" onClick=${() => setTopLimit(20)}>Show 20</${Btn}></div>` : null}
      </section>
      <section class="card st-card">
        <div class="card-head"><span class="card-title">Recent plays</span><span class="micro-n">${s.events} ${s.events === 1 ? 'start' : 'starts'} in this period</span></div>
        ${history.items.map((it) => {
          const m = v.metaOf(it.track);
          const o = v.outcomeParts(it);
          return html`<div class="st-row st-hist" key=${it.id}>
            <span class="st-when"><b>${v.timeLabel(it.startedAt, tz)}</b><small>${v.dayLabel(it.startedAt, now, tz)}</small></span>
            <${TrackCell} meta=${m} />
            <span class=${'st-outcome ' + o.cls}><i></i>${o.text}</span>
            <span class="micro-n st-n">${v.listenedText(it)}${it.counted ? '' : ' · not counted'}</span>
            <button type="button" class="icon-btn st-forget" title="Forget this play" onClick=${() => forget(it.id)}><${Icon} name="close" size=${15} /></button>
          </div>`;
        })}
        ${history.next ? html`<div class="st-more"><${Btn} kind="ghost" onClick=${more}>Load more</${Btn}></div>` : null}
      </section>`;
  }

  return html`<div class="screen">
    <${Header} title="Stats" sub=${s && !empty ? v.provenance(s, { peersNamed: ctx?.peers.length || 0 }).replace(/\.?\s*Times in your zone\.?/, '').toUpperCase() : 'YOUR LISTENING'}>
      ${showOrigin ? html`<${Seg} value=${sel.origin} onChange=${(o) => setSel({ ...sel, origin: o })}
        options=${[{ value: 'all', label: 'All' }, { value: 'local', label: 'This server' }, { value: 'peers', label: 'Peers' }]} />` : null}
      ${ctx ? html`<label class="select-field"><${Icon} name="insights" size=${15} />
        <select value=${sel.period + ':' + sel.offset} onChange=${(e) => { const [p, o] = e.currentTarget.value.split(':'); setSel({ ...sel, period: p, offset: Number(o) || 0 }); setTopLimit(8); }}>
          ${ctx.options.map((o) => html`<option value=${o.value}>${o.label}</option>`)}
        </select></label>` : null}
    </${Header}>
    <div class="scroll pad col st">
      ${body}
      <section class="card set-card st-data">
        <div class="set-head"><span class="card-title">Your data</span><span class="set-note">Every play this account reported through this server. Times in your zone.</span></div>
        <div class="set-row"><div class="set-text"><span>Export listening log</span><small>Every play as NDJSON, one per line, oldest first.</small></div>
          <${Btn} icon="download" onClick=${exportLog}>Export</${Btn}></div>
        <div class="set-row"><div class="set-text"><span>Clear history</span><small>Removes the log. Play counts on tracks can be kept or reset.</small></div>
          <${Btn} kind="ghost" onClick=${() => clear('history')}>Log only</${Btn}>
          <button type="button" class="btn btn-danger" onClick=${() => clear('all')}><${Icon} name="delete_sweep" size=${15} />Log and counts</button></div>
      </section>
    </div>
  </div>`;
}
