// The frame around every screen: sidebar, queue column, player bar.
import { html, useEffect, useRef, useState } from './vendor/preact-htm.js';
import { app, useStore, href, go, savePrefs } from './store.js';
import * as P from './player.js';
import { playback } from './player.js';
import * as lib from './library.js';
import { sidebarLayout } from './nav.js';
import { devices, followed, positionOf, command as devCommand, remoteQueue, loadRemoteQueue } from './devices.js';
import { DevicesButton } from './devices-ui.js';
import { PipButton } from './pip.js';
import { Icon, IconBtn, Cover, LikeButton, openMenu, trackMenuItems, prompt, logOut } from './ui.js';
import { fmtTime, fmtCount, trackTitle, trackArtist, trackAlbum, trackCover, formatLabel, gainLabel } from './util.js';

// ── Sidebar ─────────────────────────────────────────────────────────────

const ACTIONS = { logout: logOut };

function NavItem({ id, label, icon, trail, trailTone, screen, to, link, action }) {
  const on = screen === id || (id === 'albums' && screen === 'album') || (id === 'artists' && screen === 'artist')
    || (id === 'genres' && screen === 'genre') || (id === 'pl' && screen === 'playlist');
  const run = action ? (e) => { e.preventDefault(); ACTIONS[action]?.(); } : null;
  return html`<a class=${`nav-item ${on ? 'on' : ''}`} href=${link || to || (action ? '#' : href(id))} title=${label}
    target=${link ? '_blank' : null} rel=${link ? 'noopener' : null} onClick=${run}>
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
      <span class="micro-n" title=${server.upstream && server.upstream !== server.version ? `mStream Zenelo ${server.version}, based on mStream ${server.upstream}` : null}>v${server.version}</span>
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
  const home = useStore(app, (s) => s.homeFolder);
  const stored = useStore(app, (s) => s.sidebar);
  const c = (n) => (n === undefined || n === null ? '' : fmtCount(n));
  const trail = {
    albums: c(counts.albums), artists: c(counts.artists), tracks: c(counts.tracks), genres: c(counts.genres),
    fav: c(counts.liked), pl: c(plCount), dj: dj ? 'ON' : '',
  };
  // The tab bar of a phone-sized window scrolls sideways: keep the page's tab in view.
  const navRef = useRef();
  useEffect(() => { navRef.current?.querySelector('.nav-item.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [screen]);
  const groups = sidebarLayout(stored)
    .map((g) => ({ ...g, items: g.items.filter((i) => i.on && (!i.when || i.when(features))) }))
    .filter((g) => g.items.length);
  return html`<aside class="sidebar">
    <a class="brand" href=${href('home')}>
      <div class="brand-mark"><${Icon} name="graphic_eq" size=${18} /></div>
      <span>mStream</span>
    </a>
    <nav class="nav" ref=${navRef}>
      ${groups.map((g) => html`<div class="nav-group" key=${g.id}>
        ${g.label ? html`<div class="nav-head">${g.label}</div>` : null}
        ${g.items.map((i) => html`<${NavItem} key=${i.id} id=${i.id} label=${i.label} icon=${i.icon} screen=${screen}
          trail=${trail[i.id]} trailTone=${i.id === 'dj' ? 'accent' : ''} link=${i.link} action=${i.action}
          to=${i.id === 'folders' && home ? href('folders', ...home.split('/')) : null} />`)}
      </div>`)}
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

// The followed device's queue: read-only, a click plays that row there.
function RemoteQueue({ d }) {
  const q = useStore(remoteQueue, (x) => ({ id: x.id, songs: x.songs, loading: x.loading }));
  useEffect(() => { loadRemoteQueue(d); }, [d.id, d.queueRev]);
  const songs = q.id === d.id ? q.songs : [];
  const pos = d.index ?? -1;
  const row = (s, i, faded) => {
    const track = { filepath: s.rawFilePath, metadata: s.metadata };
    const cur = i === pos;
    return html`<div key=${i + ':' + s.rawFilePath} class=${`q-row ${cur ? 'cur' : ''} ${faded ? 'faded' : ''}`}
      onClick=${() => devCommand(d.id, 'goTo', { index: i })}
      onContextMenu=${(e) => openMenu(e, [{ label: `Play on ${d.name}`, icon: 'play_arrow', tone: 'accent', onClick: () => devCommand(d.id, 'goTo', { index: i }) }, 'sep', ...trackMenuItems([track])])}>
      <${Cover} file=${trackCover(track)} class="q-cover">
        ${cur ? html`<span class="q-eq"><${Icon} name=${d.playing ? 'graphic_eq' : 'pause'} size=${16} /></span>` : null}
      </${Cover}>
      <div class="q-text"><span class="q-t">${trackTitle(track)}</span><span class="q-a">${trackArtist(track)}</span></div>
      <span class="q-d">${fmtTime(s.metadata?.duration)}</span>
    </div>`;
  };
  const before = pos > 0 ? songs.slice(0, pos) : [];
  const ahead = songs.slice(pos + 1);
  const [showHistory, setShowHistory] = useState(false);
  return html`<aside class="queue">
    <div class="q-head">
      <span class="q-title">Queue</span>
      <span class="micro-n">${songs.length ? ahead.length + (pos >= 0 ? 1 : 0) : ''}</span>
      <${IconBtn} icon="close" title="Close" class="q-close" onClick=${() => app.set({ queueOpen: false })} size=${17} />
    </div>
    <div class="q-on"><${Icon} name="devices" size=${13} /> On <b>${d.name}</b></div>
    <div class="q-list">
      ${!songs.length ? html`<div class="q-empty"><${Icon} name="list" size=${22} /><span>${q.loading ? 'Loading…' : 'The queue is empty'}</span></div>` : null}
      ${before.length ? html`<div class="q-group" key="played"><button type="button" class="q-section q-toggle" onClick=${() => setShowHistory(!showHistory)}>
        PLAYED · ${before.length} <${Icon} name=${showHistory ? 'expand_more' : 'chevron_right'} size=${12} />
      </button>${showHistory ? before.map((s, i) => row(s, i, true)) : null}</div>` : null}
      ${songs[pos] ? html`<div class="q-group" key="now"><div class="q-section">NOW PLAYING</div>${row(songs[pos], pos, false)}</div>` : null}
      ${ahead.length ? html`<div class="q-group" key="next"><div class="q-section">UP NEXT · ${ahead.length}</div>${ahead.map((s, i) => row(s, pos + 1 + i, false))}</div>` : null}
    </div>
  </aside>`;
}

export function Queue() {
  const dev = useStore(devices, (x) => ({ list: x.list, self: x.self }));
  const localPlaying = useStore(playback, (x) => x.playing);
  const remote = followed(dev.list, dev.self, localPlaying);
  return remote ? html`<${RemoteQueue} d=${remote} />` : html`<${LocalQueue} />`;
}

function LocalQueue() {
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
      <${IconBtn} icon="close" title="Close" class="q-close" onClick=${() => app.set({ queueOpen: false })} size=${17} />
    </div>
    <div class="q-list" ref=${listRef}>
      ${!queueLen ? html`<div class="q-empty">
        <${Icon} name="list" size=${22} />
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

export function Seek() {
  const { currentTime, duration } = useStore(playback, (s) => ({ currentTime: Math.floor(s.currentTime * 4) / 4, duration: s.duration }));
  return html`<${SeekBar} currentTime=${currentTime} duration=${duration} onSeek=${P.seekPct} />`;
}

// Another device's playhead, moving on between its reports.
export function RemoteSeek({ d }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(t); }, []);
  const duration = (d.track?.durationMs || 0) / 1000;
  return html`<${SeekBar} currentTime=${positionOf(d) / 1000} duration=${duration}
    onSeek=${(pct) => devCommand(d.id, 'seek', { positionMs: Math.round(pct * duration * 1000) })} />`;
}

function SeekBar({ currentTime, duration, onSeek }) {
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
    // The window the bar is in: the page, or the picture-in-picture player.
    const win = e.currentTarget.ownerDocument.defaultView;
    const move = (ev) => setDrag(at(ev));
    const up = (ev) => {
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', up);
      onSeek(at(ev));
      setDrag(null);
    };
    win.addEventListener('pointermove', move);
    win.addEventListener('pointerup', up);
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

export function Volume({ remote }) {
  const local = useStore(playback, (s) => s.volume);
  const volume = remote ? (remote.volume ?? 100) : local;
  const setVol = (v) => {
    if (!remote) { P.setVolume(v); return; }
    const vol = Math.round(Math.max(0, Math.min(100, v)));
    devices.set((st) => ({ list: st.list.map((x) => (x.id === remote.id ? { ...x, volume: vol } : x)) }));
    clearTimeout(Volume.timer);
    Volume.timer = setTimeout(() => devCommand(remote.id, 'setVolume', { volume: vol }), 120);
  };
  const bar = useRef();
  const set = (e) => {
    const r = bar.current.getBoundingClientRect();
    setVol(((e.clientX - r.left) / r.width) * 100);
  };
  const down = (e) => {
    e.preventDefault();
    set(e);
    const win = e.currentTarget.ownerDocument.defaultView;
    const up = () => { win.removeEventListener('pointermove', set); win.removeEventListener('pointerup', up); };
    win.addEventListener('pointermove', set);
    win.addEventListener('pointerup', up);
  };
  return html`<div class="volume">
    <${IconBtn} icon=${volume === 0 ? 'volume_off' : volume < 50 ? 'volume_down' : 'volume_up'} title=${volume === 0 ? 'Unmute' : 'Mute'}
      onClick=${remote ? () => setVol(volume > 0 ? 0 : 100) : P.toggleMute} size=${17} />
    <div class="bar" ref=${bar} onPointerDown=${down}
      onWheel=${(e) => { e.preventDefault(); setVol(volume - Math.sign(e.deltaY) * 5); }}>
      <div class="bar-fill" style=${{ width: volume + '%' }}></div>
      <div class="bar-knob" style=${{ left: volume + '%' }}></div>
    </div>
  </div>`;
}

// What the player shows and drives: this tab's playback, or the followed
// device's (playing elsewhere, or played last there). The bar, the mini
// player and the Now Playing sheet share it.
export function useNowPlaying() {
  const s = useStore(playback, (x) => ({
    current: x.current, playing: x.playing, shuffle: x.shuffle, loop: x.loop, loopOne: x.loopOne,
    autoDJ: x.autoDJ, rg: x.replayGain, pre: x.replayGainPreGainDb, title: x.current?.metadata?.title, rev: x.rev,
  }));
  const dev = useStore(devices, (x) => ({ list: x.list, self: x.self }));
  const remote = followed(dev.list, dev.self, s.playing);
  const song = s.current;
  const track = remote ? (remote.track ? { filepath: remote.track.filepath, metadata: {
    title: remote.track.title, artist: remote.track.artist, album: remote.track.album, 'album-art': remote.track.art || null,
    duration: (remote.track.durationMs || 0) / 1000,
  } } : null) : song ? { filepath: song.rawFilePath, metadata: song.metadata || {} } : null;
  const meta = track?.metadata || {};
  const playing = remote ? remote.playing : s.playing;
  const ctl = remote ? {
    prev: () => devCommand(remote.id, 'previous'), playPause: () => devCommand(remote.id, 'playPause'), next: () => devCommand(remote.id, 'next'),
  } : { prev: P.prev, playPause: P.playPause, next: P.next };
  // Shuffle / repeat: this tab's, or the followed device's (sent to it; idle when it doesn't report them).
  const REPEAT_NEXT = { off: 'all', all: 'one', one: 'autodj', autodj: 'off' };
  const rep = !remote ? {
    shuffle: s.shuffle, mode: s.autoDJ ? 'autodj' : s.loopOne ? 'one' : s.loop ? 'all' : 'off', dj: s.autoDJ,
    toggleShuffle: P.toggleShuffle, cycle: P.cycleRepeat, idle: false,
  } : {
    shuffle: !!remote.shuffle, mode: remote.repeat || 'off', dj: remote.repeat === 'autodj', idle: remote.repeat == null,
    toggleShuffle: () => { if (remote.shuffle != null) { devCommand(remote.id, 'setShuffle', { shuffle: !remote.shuffle }); } },
    cycle: () => { if (remote.repeat != null) { devCommand(remote.id, 'setRepeat', { mode: REPEAT_NEXT[remote.repeat] || 'off' }); } },
  };
  const rgText = !s.rg ? 'RG OFF' : meta['replaygain-track'] != null && meta['replaygain-track'] !== ''
    ? `RG ${gainLabel({ 'replaygain-track': Number(meta['replaygain-track']) + Number(s.pre || 0) })}` : 'RG · NO TAG';
  return { remote, track, meta, playing, ctl, rep, rgText };
}

export function Transport({ n, big = false }) {
  const { rep, ctl, playing } = n;
  const sz = big ? 26 : 19;
  return html`<div class="pb-controls">
    <${IconBtn} icon="shuffle" title="Shuffle" active=${rep.shuffle} onClick=${rep.toggleShuffle} size=${big ? 21 : 17} class=${`dim ${rep.idle ? 'idle' : ''}`} />
    <${IconBtn} icon="skip_previous" title="Previous" onClick=${ctl.prev} size=${sz} />
    <button type="button" class="play" onClick=${ctl.playPause} title=${playing ? 'Pause' : 'Play'}>
      <${Icon} name=${playing ? 'pause' : 'play_arrow'} size=${big ? 30 : 19} fill />
    </button>
    <${IconBtn} icon="skip_next" title="Next" onClick=${ctl.next} size=${sz} />
    <${IconBtn} icon=${rep.dj ? 'all_inclusive' : rep.mode === 'one' ? 'repeat_one' : 'repeat'} title=${rep.dj ? 'Auto DJ' : 'Repeat'}
      active=${rep.mode !== 'off'} onClick=${rep.cycle} size=${big ? 21 : 17} class=${`dim ${rep.idle ? 'idle' : ''}`} />
  </div>`;
}

const ArtistAlbum = ({ track, meta, onGo }) => html`
  ${trackArtist(track) ? html`<a href=${href('artist', meta.artist || trackArtist(track))} onClick=${onGo}>${trackArtist(track)}</a>` : null}
  ${trackAlbum(track) ? html` · <a href=${href('album', meta.album, { artist: meta['album-artist'] || '' })} onClick=${onGo}>${trackAlbum(track)}</a>` : null}`;

// The playhead as a thin line along the mini player's top edge.
function MiniProgress({ remote }) {
  const local = useStore(playback, (s) => (remote ? 0 : (s.duration > 0 ? Math.min(1, s.currentTime / s.duration) : 0)));
  const [, tick] = useState(0);
  useEffect(() => {
    if (!remote) { return undefined; }
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [remote?.id]);
  const dur = remote ? (remote.track?.durationMs || 0) : 0;
  const pct = remote ? (dur > 0 ? Math.min(1, positionOf(remote) / dur) : 0) : local;
  return html`<div class="pb-mini-line"><div style=${{ width: pct * 100 + '%' }}></div></div>`;
}

const openNow = () => app.set({ nowOpen: true, queueOpen: false });
const closeNow = () => app.set({ nowOpen: false });

// Small windows: the bar is a mini player (cover, title, play, next); a tap
// opens Now Playing over the page, as in the app.
function MiniPlayer({ n }) {
  const { track, meta, playing, ctl, remote } = n;
  return html`<div class="pb-mini" onClick=${(e) => { if (!e.target.closest('button, a')) { openNow(); } }}>
    <${MiniProgress} remote=${remote} />
    ${track ? html`<${Cover} file=${trackCover(track)} class="pb-cover" />` : html`<div class="pb-cover cover"></div>`}
    <div class="pb-text">
      ${track ? html`<span class="pb-t">${trackTitle(track)}</span>
        <span class="pb-a">${remote ? html`<span class="pb-on"><${Icon} name="devices" size=${12} /> ${remote.name}</span>` : [trackArtist(track), trackAlbum(track)].filter(Boolean).join(' · ') || meta.title || ''}</span>`
        : html`<span class="pb-t muted">Nothing playing</span>`}
    </div>
    ${track ? html`<${LikeButton} track=${track} size=${18} always />` : null}
    <button type="button" class="play" onClick=${ctl.playPause} title=${playing ? 'Pause' : 'Play'}>
      <${Icon} name=${playing ? 'pause' : 'play_arrow'} size=${19} fill />
    </button>
    <${IconBtn} icon="skip_next" title="Next" onClick=${ctl.next} size=${20} />
  </div>`;
}

// Now Playing: the expanded mini player. Down arrow, Escape or a pull down
// closes it; going to another page (lyrics, the artist, …) closes it too.
function NowSheet({ n }) {
  const { remote, track, meta } = n;
  const screen = useStore(app, (x) => x.route.screen);
  const sheet = useRef();
  const [dy, setDy] = useState(0);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && !app.get().menu && !app.get().dialog) { closeNow(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  // Pull down to close: from anywhere but the sliders and buttons.
  const down = (e) => {
    if (e.button !== 0 || e.target.closest('button, a, .bar, input, .popover')) { return; }
    const y0 = e.clientY;
    const t0 = performance.now();
    let last = 0;
    const move = (ev) => { last = Math.max(0, ev.clientY - y0); setDy(last); };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const fast = last > 40 && last / Math.max(1, performance.now() - t0) > 0.5;
      if (last > 120 || fast) { closeNow(); }
      setDy(0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  const page = (to) => { closeNow(); if (screen === to) { return; } go(to); };
  return html`<div class=${`now-sheet ${dy ? 'drag' : ''}`} ref=${sheet} onPointerDown=${down}
    style=${dy ? { transform: `translateY(${dy}px)` } : null}>
    <div class="ns-head">
      <${IconBtn} icon="expand_more" title="Close" size=${24} onClick=${closeNow} />
      <div class="ns-from micro">${remote ? html`${remote.playing ? 'PLAYING' : 'PAUSED'} ON <b>${remote.name}</b>` : 'NOW PLAYING'}</div>
      ${track ? html`<${IconBtn} icon="more_vert" title="More" size=${20} onClick=${(e) => openMenu(e, trackMenuItems([track]))} />` : html`<span class="ns-pad"></span>`}
    </div>
    <div class="ns-art">${track ? html`<${Cover} file=${trackCover(track)} size="l" class="ns-cover" />` : html`<div class="ns-cover cover"></div>`}</div>
    <div class="ns-info">
      <div class="ns-text">
        <span class=${`ns-t ${track ? '' : 'muted'}`}>${track ? trackTitle(track) : 'Nothing playing'}</span>
        <span class="ns-a">${track ? html`<${ArtistAlbum} track=${track} meta=${meta} onGo=${closeNow} />` : null}</span>
      </div>
      ${track ? html`<${LikeButton} track=${track} size=${22} always />` : null}
    </div>
    ${remote ? html`<${RemoteSeek} d=${remote} />` : html`<${Seek} />`}
    <${Transport} n=${n} big />
    <div class="ns-tools">
      <${IconBtn} icon="queue_music" title="Lyrics" size=${19} onClick=${() => page('lyrics')} />
      <${IconBtn} icon="equalizer" title="Visualizer" size=${19} onClick=${() => page('viz')} />
      <${IconBtn} icon="list" title="Queue" size=${19} onClick=${() => app.set({ nowOpen: false, queueOpen: true })} />
      <${DevicesButton} />
      <${Volume} remote=${remote} />
    </div>
    ${!remote && formatLabel(meta) ? html`<div class="ns-fmt micro">${formatLabel(meta)}${P.isTranscodingOn() ? ` → ${P.transcodeLabel()}` : ''} · ${n.rgText}</div>` : null}
  </div>`;
}

export function PlayerBar() {
  const n = useNowPlaying();
  const { remote, track, meta } = n;
  const screen = useStore(app, (x) => x.route.screen);
  const queueOpen = useStore(app, (x) => x.queueOpen);
  const nowOpen = useStore(app, (x) => x.nowOpen);

  return html`<footer class=${`playerbar ${remote ? 'remote' : ''}`}>
    <div class="pb-now">
      ${track ? html`
        <${Cover} file=${trackCover(track)} class="pb-cover" />
        <div class="pb-text">
          <span class="pb-t">${trackTitle(track)}</span>
          <span class="pb-a"><${ArtistAlbum} track=${track} meta=${meta} /></span>
        </div>
        <${LikeButton} track=${track} size=${17} always />
        <${IconBtn} icon="more_vert" title="More" size=${17} onClick=${(e) => openMenu(e, trackMenuItems([track]))} />
      ` : html`<div class="pb-cover cover"></div><div class="pb-text"><span class="pb-t muted">Nothing playing</span></div>`}
    </div>
    <div class="pb-center">
      <${Transport} n=${n} />
      ${remote ? html`<${RemoteSeek} d=${remote} />` : html`<${Seek} />`}
    </div>
    <div class="pb-right">
      ${remote ? null : html`<div class="pb-fmt">
        <span>${formatLabel(meta) || '—'}${P.isTranscodingOn() ? html` <em>→ ${P.transcodeLabel()}</em>` : null}</span>
        <span>${n.rgText}</span>
      </div>`}
      <${IconBtn} icon="queue_music" title="Lyrics" active=${screen === 'lyrics'} size=${17} class="pager"
        onClick=${() => (screen === 'lyrics' ? history.back() : go('lyrics'))} />
      <${IconBtn} icon="equalizer" title="Visualizer" active=${screen === 'viz'} size=${17} class="pb-viz pager"
        onClick=${() => (screen === 'viz' ? history.back() : go('viz'))} />
      <${IconBtn} icon="list" title=${queueOpen ? 'Hide queue' : 'Show queue'} active=${queueOpen} size=${17} class="pager"
        onClick=${() => { app.set({ queueOpen: !queueOpen }); savePrefs(); }} />
      <${PipButton} />
      <${DevicesButton} />
      <${Volume} remote=${remote} />
    </div>
    <${MiniPlayer} n=${n} />
    ${nowOpen ? html`<${NowSheet} n=${n} />` : null}
  </footer>`;
}
