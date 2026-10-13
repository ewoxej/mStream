// The frame around every screen: sidebar, queue column, player bar.
import { html, useEffect, useRef, useState } from './vendor/preact-htm.js';
import { app, useStore, href, go, savePrefs } from './store.js';
import * as P from './player.js';
import { playback } from './player.js';
import * as lib from './library.js';
import { Icon, IconBtn, Cover, LikeButton, openMenu, trackMenuItems, prompt } from './ui.js';
import { fmtTime, fmtCount, trackTitle, trackArtist, trackAlbum, trackCover, formatLabel, gainLabel } from './util.js';

// ── Sidebar ─────────────────────────────────────────────────────────────

function NavItem({ id, label, icon, trail, trailTone, screen }) {
  const on = screen === id || (id === 'albums' && screen === 'album') || (id === 'artists' && screen === 'artist')
    || (id === 'genres' && screen === 'genre') || (id === 'pl' && screen === 'playlist');
  return html`<a class=${`nav-item ${on ? 'on' : ''}`} href=${href(id)} title=${label}>
    <${Icon} name=${icon} size=${17} />
    <span class="nav-label">${label}</span>
    ${trail ? html`<span class=${'nav-trail ' + (trailTone || '')}>${trail}</span>` : null}
  </a>`;
}

function ServerCard() {
  const server = useStore(app, (s) => s.server);
  const counts = useStore(app, (s) => s.counts);
  const [scan, setScan] = useState(null);
  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      try {
        const p = await lib.scanProgress();
        if (!alive) { return; }
        const was = scan?.scanning;
        setScan({ scanning: !!p.queue?.scanning, task: p.queue?.activeTask, tracks: p.totals?.tracks });
        if (was && !p.queue?.scanning) { lib.invalidate(''); lib.loadCounts(); }
        timer = setTimeout(tick, p.queue?.scanning ? 2000 : 30000);
      } catch (_) { timer = setTimeout(tick, 60000); }
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  if (!server) { return null; }
  const pct = scan?.task?.progress?.percent ?? scan?.task?.percent;
  return html`<div class="server-card">
    <div class="sc-top">
      <i class=${scan?.scanning ? 'busy' : ''}></i>
      <span class="sc-name">${server.name}</span>
      <span class="micro-n">v${server.version}</span>
    </div>
    <div class="sc-meta">${fmtCount(counts.tracks ?? scan?.tracks ?? 0)} tracks · ${server.vpaths.length} ${server.vpaths.length === 1 ? 'vpath' : 'vpaths'}<br />
      ${scan?.scanning ? `Scanning${Number.isFinite(pct) ? ' · ' + Math.round(pct) + '%' : '…'}` : 'Library up to date'}</div>
    <div class="sc-bar"><div style=${{ width: scan?.scanning ? (Number.isFinite(pct) ? pct + '%' : '35%') : '100%' }} class=${scan?.scanning && !Number.isFinite(pct) ? 'indet' : ''}></div></div>
  </div>`;
}

export function Sidebar() {
  const screen = useStore(app, (s) => s.route.screen);
  const counts = useStore(app, (s) => s.counts);
  const plCount = useStore(app, (s) => s.playlists.length);
  const dj = useStore(playback, (s) => s.autoDJ);
  const features = useStore(app, (s) => s.features);
  const c = (n) => (n === undefined || n === null ? '' : fmtCount(n));
  return html`<aside class="sidebar">
    <a class="brand" href=${href('home')}>
      <div class="brand-mark"><${Icon} name="graphic_eq" size=${18} /></div>
      <span>mStream</span>
    </a>
    <nav class="nav">
      <div class="nav-group">
        <${NavItem} id="home" label="Home" icon="home" screen=${screen} />
        <${NavItem} id="recent" label="Recently played" icon="history" screen=${screen} />
      </div>
      <div class="nav-group">
        <div class="nav-head">LIBRARY</div>
        <${NavItem} id="albums" label="Albums" icon="album" trail=${c(counts.albums)} screen=${screen} />
        <${NavItem} id="artists" label="Artists" icon="person" trail=${c(counts.artists)} screen=${screen} />
        <${NavItem} id="tracks" label="All tracks" icon="music_note" trail=${c(counts.tracks)} screen=${screen} />
        <${NavItem} id="genres" label="Genres" icon="category" trail=${c(counts.genres)} screen=${screen} />
        <${NavItem} id="folders" label="Folders" icon="folder" screen=${screen} />
        <${NavItem} id="fav" label="Favorites" icon="favorite_border" trail=${c(counts.liked)} screen=${screen} />
        <${NavItem} id="pl" label="Playlists" icon="queue_music" trail=${c(plCount)} screen=${screen} />
      </div>
      <div class="nav-group">
        <div class="nav-head">TOOLS</div>
        <${NavItem} id="dj" label="Auto DJ" icon="auto_awesome" trail=${dj ? 'ON' : ''} trailTone="accent" screen=${screen} />
        ${features.sonicPath ? html`<${NavItem} id="sonic" label="Sonic Path" icon="route" screen=${screen} />` : null}
        ${features.discover ? html`<${NavItem} id="discover" label="Discover" icon="explore" screen=${screen} />` : null}
        <${NavItem} id="jukebox" label="Jukebox" icon="qr_code_2" screen=${screen} />
        ${features.stats ? html`<${NavItem} id="stats" label="Stats" icon="insights" screen=${screen} />` : null}
        <${NavItem} id="viz" label="Visualizer" icon="equalizer" screen=${screen} />
        ${features.torrent ? html`<${NavItem} id="dl" label="Downloads" icon="download" screen=${screen} />` : null}
        <${NavItem} id="settings" label="Settings" icon="settings" screen=${screen} />
      </div>
    </nav>
    <${ServerCard} />
  </aside>`;
}

// ── Queue ───────────────────────────────────────────────────────────────

function QueueRow({ song, index, cur, faded, playing, dragState }) {
  const track = { filepath: song.rawFilePath, metadata: song.metadata };
  const menu = (e) => openMenu(e, [
    { label: 'Play', icon: 'play_arrow', tone: 'accent', onClick: () => P.playAt(index) },
    { label: 'Remove from queue', icon: 'remove_circle_outline', tone: 'danger', onClick: () => P.removeAt(index) },
    'sep',
    ...trackMenuItems([track]).filter((it) => it === 'sep' || !['Play next', 'Add to queue'].includes(it.label)),
  ]);
  return html`<div class=${`q-row ${cur ? 'cur' : ''} ${faded ? 'faded' : ''} ${dragState.over === index ? 'drop' : ''}`}
    draggable="true"
    onDragStart=${(e) => { dragState.from = index; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(index)); }}
    onDragOver=${(e) => { e.preventDefault(); if (dragState.over !== index) { dragState.setOver(index); } }}
    onDragLeave=${() => { if (dragState.over === index) { dragState.setOver(null); } }}
    onDrop=${(e) => { e.preventDefault(); dragState.setOver(null); if (dragState.from != null) { P.moveItem(dragState.from, index); } dragState.from = null; }}
    onDragEnd=${() => { dragState.from = null; dragState.setOver(null); }}
    onClick=${() => P.playAt(index)} onContextMenu=${menu}>
    <${Cover} file=${trackCover(track)} class="q-cover">
      ${cur ? html`<span class="q-eq"><${Icon} name=${playing ? 'graphic_eq' : 'pause'} size=${16} /></span>` : null}
    </${Cover}>
    <div class="q-text">
      <span class="q-t">${trackTitle(track)}</span>
      <span class="q-a">${trackArtist(track)}</span>
    </div>
    <span class="q-d">${fmtTime(song.metadata?.duration)}</span>
    <button type="button" class="q-x" title="Remove from queue" onClick=${(e) => { e.stopPropagation(); P.removeAt(index); }}><${Icon} name="close" size=${14} /></button>
  </div>`;
}

export function Queue() {
  const { queue, pos, autoDJ, playing, queueLen } = useStore(playback, (s) => ({
    queue: s.queue, pos: s.pos, autoDJ: s.autoDJ, playing: s.playing, queueLen: s.queueLen, rev: s.rev,
  }));
  const [over, setOver] = useState(null);
  const drag = useRef({}).current;
  drag.over = over;
  drag.setOver = setOver;
  const listRef = useRef();

  const cur = pos >= 0 ? queue[pos] : null;
  const ahead = queue.slice(pos + 1).map((s, i) => ({ s, i: pos + 1 + i }));
  const upNext = ahead.filter((x) => !x.s.metadata?._djPicked);
  const djPicks = ahead.filter((x) => x.s.metadata?._djPicked);
  const before = pos > 0 ? queue.slice(0, pos).map((s, i) => ({ s, i })) : [];
  const [showHistory, setShowHistory] = useState(false);

  const save = async () => {
    if (!queueLen) { return; }
    const name = await prompt({ title: 'Save queue as playlist', label: 'NAME', okLabel: 'Save' });
    if (!name) { return; }
    try {
      await lib.createPlaylist(name, queue.map((s) => ({ filepath: s.rawFilePath })));
      P.toast(`Saved “${name}”`, 'success');
    } catch (_) { P.toast('Could not save the playlist', 'error'); }
  };
  const clear = async () => {
    if (!queueLen) { return; }
    P.clearQueue();
  };

  // Each section is one keyed group: headers between keyed rows got reordered
  // by the diff (Now playing below Up next after a jump back).
  const row = ({ s, i }, faded) => html`<${QueueRow} key=${i + ':' + s.rawFilePath} song=${s} index=${i}
    cur=${i === pos} faded=${faded} playing=${playing} dragState=${drag} />`;

  return html`<aside class="queue">
    <div class="q-head">
      <span class="q-title">Queue</span>
      <span class="micro-n">${upNext.length + (cur ? 1 : 0)}${autoDJ ? ' + AUTO' : ''}</span>
      <${IconBtn} icon="save" title="Save as playlist" onClick=${save} size=${15} />
      <${IconBtn} icon="delete_outline" title="Clear queue" onClick=${clear} size=${15} />
    </div>
    <div class="q-list" ref=${listRef}>
      ${!queueLen ? html`<div class="q-empty">
        <${Icon} name="queue_music" size=${22} />
        <span>The queue is empty</span>
        <small>Play an album or a track, or set the repeat button to ∞ Auto DJ to keep music coming.</small>
      </div>` : null}
      ${before.length ? html`<div class="q-group" key="played"><button type="button" class="q-section q-toggle" onClick=${() => setShowHistory(!showHistory)}>
        PLAYED · ${before.length} <${Icon} name=${showHistory ? 'expand_more' : 'chevron_right'} size=${12} />
      </button>${showHistory ? before.map((x) => row(x, true)) : null}</div>` : null}
      ${cur ? html`<div class="q-group" key="now"><div class="q-section">NOW PLAYING</div>${row({ s: cur, i: pos }, false)}</div>` : null}
      ${upNext.length ? html`<div class="q-group" key="next"><div class="q-section">UP NEXT · ${upNext.length}</div>${upNext.map((x) => row(x, false))}</div>` : null}
      ${djPicks.length ? html`<div class="q-group" key="dj"><div class="q-section">AUTO DJ PICKS</div>${djPicks.map((x) => row(x, true))}</div>` : null}
    </div>
  </aside>`;
}

// ── Player bar ──────────────────────────────────────────────────────────

function Seek() {
  const { currentTime, duration } = useStore(playback, (s) => ({ currentTime: Math.floor(s.currentTime * 4) / 4, duration: s.duration }));
  const bar = useRef();
  const [drag, setDrag] = useState(null);
  const pct = drag ?? (duration > 0 ? Math.min(1, currentTime / duration) : 0);
  const at = (e) => {
    const r = bar.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const down = (e) => {
    if (!(duration > 0)) { return; }
    e.preventDefault();
    setDrag(at(e));
    const move = (ev) => setDrag(at(ev));
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      P.seekPct(at(ev));
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return html`<div class="seek">
    <span>${fmtTime(drag != null ? drag * duration : currentTime)}</span>
    <div class=${`bar ${drag != null ? 'drag' : ''} ${duration > 0 ? 'live' : ''}`} ref=${bar} onPointerDown=${down}>
      <div class="bar-fill" style=${{ width: pct * 100 + '%' }}></div>
      <div class="bar-knob" style=${{ left: pct * 100 + '%' }}></div>
    </div>
    <span>${fmtTime(duration)}</span>
  </div>`;
}

function Volume() {
  const volume = useStore(playback, (s) => s.volume);
  const bar = useRef();
  const set = (e) => {
    const r = bar.current.getBoundingClientRect();
    P.setVolume(((e.clientX - r.left) / r.width) * 100);
  };
  const down = (e) => {
    e.preventDefault();
    set(e);
    const up = () => { window.removeEventListener('pointermove', set); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', set);
    window.addEventListener('pointerup', up);
  };
  return html`<div class="volume">
    <${IconBtn} icon=${volume === 0 ? 'volume_off' : volume < 50 ? 'volume_down' : 'volume_up'} title=${volume === 0 ? 'Unmute' : 'Mute'} onClick=${P.toggleMute} size=${17} />
    <div class="bar" ref=${bar} onPointerDown=${down}
      onWheel=${(e) => { e.preventDefault(); P.setVolume(volume - Math.sign(e.deltaY) * 5); }}>
      <div class="bar-fill" style=${{ width: volume + '%' }}></div>
      <div class="bar-knob" style=${{ left: volume + '%' }}></div>
    </div>
  </div>`;
}

export function PlayerBar() {
  const s = useStore(playback, (x) => ({
    current: x.current, playing: x.playing, shuffle: x.shuffle, loop: x.loop, loopOne: x.loopOne,
    autoDJ: x.autoDJ, rg: x.replayGain, pre: x.replayGainPreGainDb, title: x.current?.metadata?.title, rev: x.rev,
  }));
  const screen = useStore(app, (x) => x.route.screen);
  const queueOpen = useStore(app, (x) => x.queueOpen);
  const song = s.current;
  const track = song ? { filepath: song.rawFilePath, metadata: song.metadata || {} } : null;
  const meta = track?.metadata || {};
  const rgText = !s.rg ? 'RG OFF' : meta['replaygain-track'] != null && meta['replaygain-track'] !== ''
    ? `RG ${gainLabel({ 'replaygain-track': Number(meta['replaygain-track']) + Number(s.pre || 0) })}` : 'RG · NO TAG';

  return html`<footer class="playerbar">
    <div class="pb-now">
      ${track ? html`
        <${Cover} file=${trackCover(track)} class="pb-cover" />
        <div class="pb-text">
          <span class="pb-t">${trackTitle(track)}</span>
          <span class="pb-a">
            ${trackArtist(track) ? html`<a href=${href('artist', meta.artist || trackArtist(track))}>${trackArtist(track)}</a>` : null}
            ${trackAlbum(track) ? html` · <a href=${href('album', meta.album, { artist: meta['album-artist'] || '' })}>${trackAlbum(track)}</a>` : null}
          </span>
        </div>
        <${LikeButton} track=${track} size=${17} always />
        <${IconBtn} icon="more_vert" title="More" size=${17} onClick=${(e) => openMenu(e, trackMenuItems([track]))} />
      ` : html`<div class="pb-cover cover"></div><div class="pb-text"><span class="pb-t muted">Nothing playing</span></div>`}
    </div>
    <div class="pb-center">
      <div class="pb-controls">
        <${IconBtn} icon="shuffle" title=${s.autoDJ ? 'Shuffle (off while Auto DJ runs)' : 'Shuffle'} active=${s.shuffle} onClick=${P.toggleShuffle} size=${17} class="dim" />
        <${IconBtn} icon="skip_previous" title="Previous" onClick=${P.prev} size=${19} />
        <button type="button" class="play" onClick=${P.playPause} title=${s.playing ? 'Pause' : 'Play'}>
          <${Icon} name=${s.playing ? 'pause' : 'play_arrow'} size=${19} fill />
        </button>
        <${IconBtn} icon="skip_next" title="Next" onClick=${P.next} size=${19} />
        <${IconBtn} icon=${s.autoDJ ? 'all_inclusive' : s.loopOne ? 'repeat_one' : 'repeat'} title=${s.autoDJ ? 'Auto DJ' : 'Repeat'}
          active=${s.autoDJ || s.loop || s.loopOne} onClick=${P.cycleRepeat} size=${17} class="dim" />
      </div>
      <${Seek} />
    </div>
    <div class="pb-right">
      <div class="pb-fmt">
        <span>${formatLabel(meta) || '—'}${P.isTranscodingOn() ? html` <em>→ ${P.transcodeLabel()}</em>` : null}</span>
        <span>${rgText}</span>
      </div>
      <${IconBtn} icon="mic" title="Lyrics" active=${screen === 'lyrics'} size=${17}
        onClick=${() => (screen === 'lyrics' ? history.back() : go('lyrics'))} />
      <${IconBtn} icon="equalizer" title="Visualizer" active=${screen === 'viz'} size=${17} class="pb-viz"
        onClick=${() => (screen === 'viz' ? history.back() : go('viz'))} />
      <${IconBtn} icon="queue_music" title=${queueOpen ? 'Hide queue' : 'Show queue'} active=${queueOpen} size=${17}
        onClick=${() => { app.set({ queueOpen: !queueOpen }); savePrefs(); }} />
      <${Volume} />
    </div>
  </footer>`;
}
