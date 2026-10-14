// Discover: more like the playing track, matched by sound (the server's
// discovery embeddings). Library = similar tracks and artists here; Network =
// leads from the discovery network (not playable here); Peers = federated
// servers' tracks, streamed through this one. A Network or Peers row opens
// the window that gets it into the library (discover-get.js) when the server
// has plug-ins; without them a network row copies "Artist - Title".
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { app, useStore, href } from '../store.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import { Btn, Icon, Header, Seg, Toggle, Empty, Spinner, TrackTable, Cover } from '../ui.js';
import { fmtTime, trackTitle, trackArtist, trackCover } from '../util.js';
import { GetSheet, JobsStrip } from './discover-get.js';

const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const tags = (list) => (list || []).slice(0, 2).map((x) => String(x).split('---').pop()).join(' · ');

function prefBool(key, def) { try { const v = localStorage.getItem(key); return v === null ? def : v === 'true'; } catch (_) { return def; } }
function setPref(key, v) { try { localStorage.setItem(key, String(v)); } catch (_) { /* private mode */ } }

async function copyLead(r) {
  const text = `${r.artist || ''} - ${r.title || ''}`.trim();
  try { await navigator.clipboard.writeText(text); P.toast(text, 'success', 'Copied'); } catch (_) { P.toast(text); }
}

function Match({ value, tone = '' }) {
  return html`<span class=${'match ' + tone} title=${pct(value) + ' match'}><i style=${{ height: Math.max(15, Math.round((value || 0) * 100)) + '%' }}></i></span>`;
}

export function Discover() {
  const features = useStore(app, (s) => s.features);
  const current = useStore(playback, (s) => s.current);
  const seedPath = current && !current.federation ? String(current.rawFilePath || '').replace(/^\/+/, '') : null;
  const seed = current ? { filepath: current.rawFilePath, metadata: current.metadata || {} } : null;
  const [source, setSource] = useState(() => { try { return localStorage.getItem('zenelo.discover') || 'library'; } catch (_) { return 'library'; } });
  const [newOnly, setNewOnly] = useState(() => prefBool('discoverNewArtistsOnly', false));
  const [data, setData] = useState(null);
  const [sheet, setSheet] = useState(null);   // { track, source }

  const sources = [{ value: 'library', label: 'Library' }];
  if (features.network) { sources.push({ value: 'network', label: 'Network' }); }
  if (features.peers) { sources.push({ value: 'peers', label: 'Peers' }); }
  const src = sources.some((x) => x.value === source) ? source : 'library';

  useEffect(() => {
    if (!seedPath || !features.discover) { setData(null); return undefined; }
    let alive = true;
    setData((d) => ({ ...(d || {}), loading: true }));
    const artist = current?.metadata?.artist;
    Promise.all([
      MSTREAMAPI.discoverySimilar(seedPath, 20),
      artist ? MSTREAMAPI.discoverySimilarArtists(artist, 6) : Promise.resolve(null),
      features.network ? MSTREAMAPI.discoveryP2pSimilar(seedPath, 20, newOnly) : Promise.resolve(null),
      features.peers ? MSTREAMAPI.discoveryFederationSimilar(seedPath, 20, newOnly) : Promise.resolve(null),
    ]).then(([similar, artists, p2p, fed]) => {
      if (!alive) { return; }
      setData({
        loading: false,
        failed: !similar,
        disabled: !!similar?.disabled,
        notAnalyzed: similar?.notAnalyzed === true,
        seedTags: similar?.seed?.genreTags,
        tracks: (similar?.results || []).map((r) => ({ filepath: r.filepath, metadata: r.metadata || {}, similarity: r.similarity, genreTags: r.genreTags })),
        artists: (artists && !artists.disabled && !artists.notAnalyzed && artists.results) || [],
        p2p: p2p && !p2p.disabled ? { rows: p2p.results || [], peers: p2p.searched?.peers ?? 0 } : null,
        fed: fed && !fed.disabled ? { rows: fed.results || [], peers: fed.searched?.peers ?? 0, unreachable: fed.searched?.unreachable || 0 } : null,
      });
    });
    return () => { alive = false; };
  }, [seedPath, newOnly, features.discover, features.network, features.peers]);

  const pickSource = (v) => { setSource(v); try { localStorage.setItem('zenelo.discover', v); } catch (_) { /* private mode */ } };
  const toggleNew = (v) => { setNewOnly(v); setPref('discoverNewArtistsOnly', v); };

  let body;
  if (!features.discover) {
    body = html`<${Empty} icon="explore" title="Discover is off on this server.">An admin can switch on discovery (sound analysis) in the admin panel.</${Empty}>`;
  } else if (!seed) {
    body = html`<${Empty} icon="explore" title="Nothing playing">Play a track: Discover finds more that sound like it.</${Empty}>`;
  } else if (current.federation) {
    body = html`<${Empty} icon="explore" title="A peer’s track is playing">Discover works from tracks in this server’s library.</${Empty}>`;
  } else if (!data || (data.loading && !data.tracks)) {
    body = html`<${Spinner} label="Listening for similar tracks" />`;
  } else if (data.disabled) {
    body = html`<${Empty} icon="explore" title="Discover is off on this server." />`;
  } else if (data.notAnalyzed) {
    body = html`<${Empty} icon="explore" title="This track hasn’t been analyzed yet.">Similar tracks appear once the discovery scan reaches it.</${Empty}>`;
  } else if (src === 'library') {
    body = html`
      ${data.artists.length ? html`<section class="block">
        <div class="block-head"><span class="micro">SIMILAR ARTISTS</span></div>
        <div class="chips">${data.artists.map((a) => html`<span class="chip artist-chip">
          <a href=${href('artist', a.artist)}>${a.artist}</a>
          ${a.entryPoints?.length ? html`<button type="button" title=${`Queue ${a.entryPoints.length} tracks that fit`}
            onClick=${() => P.addToQueue(a.entryPoints.map((e) => ({ filepath: e.filepath, metadata: e.metadata || {} })))}><${Icon} name="queue_music" size=${14} /></button>` : null}
        </span>`)}</div>
      </section>` : null}
      <section class="block disc-tracks">
        <div class="block-head"><span class="micro">SIMILAR TRACKS · ${data.tracks.length}</span>
          ${data.tracks.length ? html`<span class="sp-actions">
            <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => P.playTracks([seed, ...data.tracks])}>Play similar</${Btn}>
            <${Btn} icon="queue_music" onClick=${() => P.addToQueue(data.tracks)}>Queue all</${Btn}>
          </span>` : null}</div>
        <${TrackTable} groups=${[{ tracks: data.tracks }]} firstCol="MATCH" firstValue=${(t) => pct(t.similarity)}
          empty=${html`<div class="hint">Nothing similar found yet.</div>`} />
        <div class="hint">Matched by sound. Tracks the scan hasn’t reached yet don’t show.</div>
      </section>`;
  } else {
    const net = src === 'network';
    const part = net ? data.p2p : data.fed;
    const line = !part ? 'Looking up…'
      : net ? (part.peers === 1 ? 'Searched 1 server' : `Searched ${part.peers} servers`)
      : [part.peers === 1 ? '1 peer answered' : `${part.peers} peers answered`, part.unreachable ? `${part.unreachable} unreachable` : ''].filter(Boolean).join(' · ');
    body = html`<section class="block">
      <div class="block-head"><span class="micro">${line.toUpperCase()}</span>
        <label class="disc-new" onClick=${(e) => { e.preventDefault(); toggleNew(!newOnly); }}><span>New artists only</span><${Toggle} on=${newOnly} onChange=${toggleNew} /></label>
      </div>
      ${!part?.rows.length ? html`<div class="hint">${net ? 'Nothing new on the network for this track.' : 'No peer has something like this.'}</div>`
        : html`<div class="card table-card">${part.rows.map((r) => {
          const mb = r.recordingMbid ? `https://musicbrainz.org/recording/${r.recordingMbid}` : null;
          const peer = r.peer?.name || (net ? 'a server' : 'peer');
          const open = features.plugins ? () => setSheet({ track: r, source: net ? 'p2p' : 'federation' })
            : net ? () => copyLead(r)
            : () => window.VUEPLAYERCORE.addFederationSongWizard(r.peer, r.filepath, { title: r.title || '', artist: r.artist || '', duration: r.duration || null }, false);
          const queue = net ? null : (e) => {
            e.stopPropagation();
            window.VUEPLAYERCORE.addFederationSongWizard(r.peer, r.filepath, { title: r.title || '', artist: r.artist || '', duration: r.duration || null }, true);
            P.toast('Added to queue');
          };
          return html`<div class="disc-row live" onClick=${open}>
            <${Match} value=${r.similarity} tone=${net ? 'net' : 'peer'} />
            <div class="mini-text"><span>${r.title || '(untitled)'}</span><small>${[r.artist, r.album, peer].filter(Boolean).join(' · ')}</small></div>
            <span class="micro-n">${r.duration ? fmtTime(r.duration) : pct(r.similarity)}</span>
            ${mb ? html`<a class="icon-btn" href=${mb} target="_blank" rel="noopener" title="Open on MusicBrainz" onClick=${(e) => e.stopPropagation()}><${Icon} name="open_in_new" size=${15} /></a>`
              : queue ? html`<button type="button" class="icon-btn" title="Add to queue" onClick=${queue}><${Icon} name="queue_music" size=${16} /></button>` : html`<span></span>`}
          </div>`;
        })}</div>`}
      <div class="hint">${net ? (features.plugins ? 'Leads from the discovery network: other servers’ tracks, not on this one. Click one to get it.' : 'Leads from the discovery network: other servers’ tracks, not on this one. Click one to copy “Artist - Title”.')
        : features.plugins ? 'Peers’ tracks play through this server. Click one to play it or add it to your collection.' : 'Peers’ tracks play through this server. Click one to add it to the queue.'}</div>
    </section>`;
  }

  return html`<div class="screen">
    <${Header} title="Discover" sub=${seed && !current.federation ? `MORE LIKE “${trackTitle(seed).toUpperCase()}”` : 'MATCHED BY SOUND'}>
      ${sources.length > 1 && seed ? html`<${Seg} value=${src} onChange=${pickSource} options=${sources.map((x) => ({
        ...x, label: x.label + (data && !data.loading ? ` · ${x.value === 'library' ? data.tracks?.length ?? 0 : x.value === 'network' ? data.p2p?.rows.length ?? 0 : data.fed?.rows.length ?? 0}` : ''),
      }))} />` : null}
    </${Header}>
    <div class="scroll pad col disc">
      ${seed && !current.federation && features.discover ? html`<div class="disc-seed">
        <${Cover} file=${trackCover(seed)} class="mini-cover" />
        <div class="mini-text"><span>${trackTitle(seed)}</span><small>${[trackArtist(seed), tags(data?.seedTags)].filter(Boolean).join(' · ')}</small></div>
        ${data?.loading ? html`<${Icon} name="progress" size=${16} class="spin muted" />` : null}
      </div>` : null}
      ${features.plugins ? html`<${JobsStrip} onOpen=${(job) => setSheet({ track: { ...(job.recommendation || {}), peer: job.recommendation?.peer || {} }, source: job.recommendation?.source === 'federation' ? 'federation' : 'p2p' })} />` : null}
      ${body}
    </div>
    ${sheet ? html`<${GetSheet} track=${sheet.track} source=${sheet.source} onClose=${() => setSheet(null)} />` : null}
  </div>`;
}
