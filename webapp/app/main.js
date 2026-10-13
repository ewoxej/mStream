// Boot: restore the session, ask the server what it offers, mount the app.
import { html, render } from './vendor/preact-htm.js';
import { app, useStore } from './store.js';
import { restorePlayerPrefs, toast } from './player.js';
import * as lib from './library.js';
import { Sidebar, Queue, PlayerBar } from './shell.js';
import { MenuLayer, DialogLayer, ToastLayer, Empty } from './ui.js';
import { Home, Recent, Albums, Album, Artists, Artist, Tracks, Genres, Genre, Favorites, Search } from './screens/library.js';
import { Playlists, Playlist } from './screens/playlists.js';
import { Folders } from './screens/folders.js';
import { AutoDJ } from './screens/dj.js';
import { Visualizer } from './screens/viz.js';
import { Downloads } from './screens/downloads.js';
import { Settings } from './screens/settings.js';

const SCREENS = {
  home: Home, recent: Recent, albums: Albums, album: Album, artists: Artists, artist: Artist,
  tracks: Tracks, genres: Genres, genre: Genre, fav: Favorites, search: Search,
  pl: Playlists, playlist: Playlist, folders: Folders, dj: AutoDJ, viz: Visualizer,
  dl: Downloads, settings: Settings,
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
        : html`<div class="screen"><${Empty} icon="circle-alert" title="Page not found" /></div>`}
    </main>
    ${showQueue ? html`<${Queue} />` : null}
    <${PlayerBar} />
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
    app.set({ server: { name: location.hostname, version: info?.server || '', user: info?.user?.username || '', vpaths: s.vpaths } });
  }).catch(() => {
    s.admin = false;
    app.set({ server: { name: location.hostname, version: '', user: '', vpaths: s.vpaths } });
  });
  lib.loadCounts().catch(() => {});
  lib.loadLikedCount();

  // A share link handed to /?... from the old UI, or a stale hash: land on Home.
  if (!location.hash) { history.replaceState(null, '', '#/home'); }
}

window.addEventListener('unhandledrejection', (e) => {
  if (e.reason && e.reason.status === 401) { location.assign('login'); }
});

boot().catch((err) => { console.error(err); toast('Something went wrong while starting', 'error'); });
