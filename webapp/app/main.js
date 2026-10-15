// Boot: restore the session, ask the server what it offers, mount the app.
import { html, render } from './vendor/preact-htm.js';
import { app, useStore } from './store.js';
import { restorePlayerPrefs, toast } from './player.js';
import * as lib from './library.js';
import { Sidebar, Queue, PlayerBar } from './shell.js';
import { MenuLayer, DialogLayer, ToastLayer, Empty } from './ui.js';
import { connect as connectDevices } from './devices.js';
import { DeviceStrip } from './devices-ui.js';
import { initJobs } from './jobs.js';
import { Recent, Albums, Album, Artists, Artist, Tracks, Genres, Genre, Favorites, Search } from './screens/library.js';
import { Home, CustomizeHome } from './screens/home.js';
import { Playlists, Playlist } from './screens/playlists.js';
import { Folders } from './screens/folders.js';
import { AutoDJ } from './screens/dj.js';
import { Visualizer } from './screens/viz.js';
import { Downloads } from './screens/downloads.js';
import { Settings } from './screens/settings.js';
import { SonicPath } from './screens/sonicpath.js';
import { Discover } from './screens/discover.js';
import { Guests } from './screens/guests.js';
import { Lyrics } from './screens/lyrics.js';
import { Stats } from './screens/stats.js';

const SCREENS = {
  home: Home, recent: Recent, albums: Albums, album: Album, artists: Artists, artist: Artist,
  tracks: Tracks, genres: Genres, genre: Genre, fav: Favorites, search: Search,
  pl: Playlists, playlist: Playlist, folders: Folders, dj: AutoDJ, viz: Visualizer,
  dl: Downloads, settings: Settings, sonic: SonicPath, discover: Discover, guests: Guests,
  lyrics: Lyrics, stats: Stats, customize: CustomizeHome,
};

function App() {
  const route = useStore(app, (s) => s.route);
  const queueOpen = useStore(app, (s) => s.queueOpen);
  const Screen = SCREENS[route.screen];
  const showQueue = queueOpen && route.screen !== 'viz';
  // Keyed by the full route so each visit starts with fresh local state.
  const key = route.screen + '/' + route.args.join('/') + '?' + new URLSearchParams(route.params);
  return html`<div class=${`app ${showQueue ? 'with-queue' : ''}`}>
    <${Sidebar} />
    <main class="main">
      ${Screen ? html`<${Screen} key=${key} args=${route.args} params=${route.params} />`
        : html`<div class="screen"><${Empty} icon="error_outline" title="Page not found" /></div>`}
    </main>
    ${showQueue ? html`<${Queue} />` : null}
    ${showQueue ? html`<div class="queue-scrim" onClick=${() => app.set({ queueOpen: false })}></div>` : null}
    <${PlayerBar} />
    <${DeviceStrip} />
    <${MenuLayer} />
    <${DialogLayer} />
    <${ToastLayer} />
  </div>`;
}

async function boot() {
  const s = MSTREAMAPI.currentServer;
  try { s.token = localStorage.getItem('token') || ''; } catch (_) { s.token = ''; }

  let ping;
  try {
    ping = await MSTREAMAPI.ping();
  } catch (err) {
    if (err.status === 401 || err.status === 403) { location.assign('login'); return; }
    document.getElementById('app').innerHTML = '<div class="boot-error">Could not reach the mStream server.</div>';
    return;
  }

  s.vpaths = ping.vpaths || [];
  s.vpathMetaData = ping.vpathMetaData || {};
  s.noUpload = ping.noUpload === true;
  s.noMkdir = ping.noMkdir === true;
  s.discovery = ping.discovery === true;
  s.stats = Number(ping.stats) || 0;
  s.discoveryPath = ping.discoveryPath === true;
  s.discoveryP2p = ping.discoveryP2p === true;
  s.federationDiscovery = ping.federationDiscovery === true;
  app.set({ features: {
    discover: s.discovery, sonicPath: s.discoveryPath, stats: s.stats >= 2,
    network: s.discoveryP2p, peers: s.federationDiscovery, plugins: ping.discoveryPlugins === true,
    account: !!s.token,
  } });
  if (ping.transcode) {
    MSTREAMPLAYER.transcodeOptions.serverEnabled = true;
    MSTREAMPLAYER.transcodeOptions.defaultCodec = ping.transcode.defaultCodec;
    MSTREAMPLAYER.transcodeOptions.defaultBitrate = ping.transcode.defaultBitrate;
  }
  if (typeof MSTREAMPLAYER.statsInit === 'function') { MSTREAMPLAYER.statsInit(); }
  restorePlayerPrefs();
  app.set({ playlists: (ping.playlists || []).map((p) => p.name) });

  render(html`<${App} />`, document.getElementById('app'));

  MSTREAMAPI.serverInfo().then((info) => {
    s.admin = !!info?.user?.admin;
    // The version shown is the Zenelo fork's (its VERSION file); `upstream`
    // is the mStream it is based on.
    app.set({
      server: { name: location.hostname, version: info?.fork?.version || info?.server || '', upstream: info?.server || '', user: info?.user?.username || '', vpaths: s.vpaths },
      features: { ...app.get().features, admin: s.admin },
    });
  }).catch(() => {
    s.admin = false;
    app.set({ server: { name: location.hostname, version: '', upstream: '', user: '', vpaths: s.vpaths } });
  });
  // Downloads (torrents) only while a torrent client is set up and this
  // user may add torrents; otherwise the feature is off for them.
  fetch(s.host + 'api/v1/torrent/preflight', { headers: { 'x-access-token': s.token } })
    .then((r) => (r.ok ? r.json() : null))
    .then((p) => app.set({ features: { ...app.get().features, torrent: !!(p && p.active && p.userAllowed) } }))
    .catch(() => {});
  lib.loadCounts().catch(() => {});
  lib.loadLikedCount();
  // This tab as a playback device (devices.js); a server without accounts has none.
  if (s.token) { connectDevices(); }
  initJobs();

  // A share link handed to /?... from the old UI, or a stale hash: land on Home.
  if (!location.hash) { history.replaceState(null, '', '#/home'); }
}

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && e.reason.status === 401) { location.assign('login'); }
});

boot().catch((err) => { console.error(err); toast('Something went wrong while starting', 'error'); });
