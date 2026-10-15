// The server's own speakers as a playback device (Play on): while the
// server-audio engine runs (state/server-audio.js), every user who may use
// it — admins and allow_server_audio — sees "Server speakers" among their
// devices. Its status and queue come from the engine; the devices' commands
// (play / pause / skip / seek / volume / shuffle / repeat, takeover = a
// transfer to it, enqueue / remove from guests) become engine calls. Moving
// the music off it pauses it, as with any device. It replaced the
// /server-remote page, the web player driving the engine.
//
// The engine is one for the whole server: every allowed user sees and
// drives the same playback. It has no "insert after the playing track", so
// `enqueue` with `next` adds at the end too.
//
// Pure apart from its dependencies, so test/unit/server-device.test.mjs
// drives it with a fake engine and the real hub:
//   hub            state/devices.js createHub()
//   isUp()         the engine is running
//   users()        [{ key, user }] — who may use it (key = the hub's user key)
//   status()       the engine's GET /status, paths as library paths
//   queue()        the engine's queue as library paths
//   post(path, body)   an engine call (POST /pause, /queue/add-many, …)
//   enginePath(libraryPath, user)  the engine's path for a track, or null
//                  (not in that user's libraries)
//   describe(libraryPaths)  Map libraryPath → { title, artist, album, art }

export const SERVER_DEVICE_ID = 'server-speakers';
export const REPORT_EVERY_MS = 10000;
const LOOP_MODES = ['none', 'all', 'one'];

export function createServerDevice({
  hub, isUp, users, status, queue, post, enginePath, describe,
  name = 'Server speakers', now = () => Date.now(),
}) {
  const conns = new Map();   // user key → close()
  let last = null;           // { sig, queueKey, at }
  let lastQueue = [];

  function connectAll(allowed) {
    const keys = new Set(allowed.map((a) => a.key));
    for (const [key, close] of conns) {
      if (!keys.has(key)) { close(); conns.delete(key); }
    }
    for (const { key } of allowed) {
      if (conns.has(key)) { continue; }
      // Commands come in through `send`; the hub's other events are for
      // screens, not for the engine.
      const close = hub.connect(key, { id: SERVER_DEVICE_ID, name, type: 'server' }, (event, data) => {
        if (event === 'command') { handle(key, data.command, data.args).catch(() => {}); }
      });
      conns.set(key, close);
      last = null;   // a new listener gets the state at once
    }
  }

  function disconnectAll() {
    for (const close of conns.values()) { close(); }
    conns.clear();
    last = null;
  }

  const repeatOf = (mode) => (mode === 'all' ? 'all' : mode === 'one' ? 'one' : 'off');

  async function tick() {
    if (!isUp()) { if (conns.size) { disconnectAll(); } return; }
    const allowed = users();
    connectAll(allowed);
    if (!conns.size) { return; }
    let s;
    let q;
    try {
      [s, q] = await Promise.all([status(), queue()]);
    } catch (_) {
      return;   // the engine didn't answer this time; it's still up by the lifecycle
    }
    if (!s || typeof s !== 'object') { return; }
    q = Array.isArray(q) ? q : [];
    lastQueue = q;
    const index = Number.isInteger(s.queue_index) ? s.queue_index : -1;
    const file = typeof s.file === 'string' && s.file ? s.file : q[index] || null;
    const info = file ? (describe([file]).get(file) || {}) : {};
    const st = {
      index,
      positionMs: Math.max(0, Math.round((Number(s.position) || 0) * 1000)),
      playing: s.playing === true,
      volume: typeof s.volume === 'number' ? Math.round(s.volume * 100) : null,
      shuffle: typeof s.shuffle === 'boolean' ? s.shuffle : false,
      repeat: repeatOf(s.loop_mode),
      track: file ? {
        filepath: file, title: info.title || file.split('/').pop(), artist: info.artist || null,
        album: info.album || null, art: info.art || null,
        durationMs: Number(s.duration) > 0 ? Math.round(s.duration * 1000) : null,
      } : null,
    };
    // Report a change, and the position now and then while it plays (the
    // hub moves the playhead on between reports).
    const sig = [st.index, st.playing, file, st.volume, st.shuffle, st.repeat].join('|');
    const queueKey = q.join('\n');
    const t = now();
    const queueChanged = !last || last.queueKey !== queueKey;
    const changed = queueChanged || last.sig !== sig;
    const drifted = last && Math.abs(st.positionMs - expected(last, t)) > 2500;   // a seek
    if (!changed && !drifted && !(st.playing && t - last.at > REPORT_EVERY_MS)) { return; }
    last = { sig, queueKey, at: t, positionMs: st.positionMs, playing: st.playing };
    for (const key of conns.keys()) {
      hub.report(key, SERVER_DEVICE_ID, queueChanged ? { status: st, queue: q } : { status: st });
    }
  }

  // Where the last report's playhead would be by now.
  const expected = (l, t) => (l.playing ? l.positionMs + (t - l.at) : l.positionMs);

  const userOf = (key) => users().find((a) => a.key === key)?.user || null;

  function enginePaths(paths, user) {
    const out = [];
    const kept = [];
    paths.forEach((p, i) => {
      const e = typeof p === 'string' ? enginePath(p, user) : null;
      if (e) { out.push(e); kept.push(i); }
    });
    return { files: out, kept };
  }

  async function setRepeat(mode) {
    const want = mode === 'all' ? 'all' : mode === 'one' ? 'one' : 'none';
    let current = (await status())?.loop_mode || 'none';
    // The engine only cycles none → all → one.
    for (let i = 0; i < LOOP_MODES.length && current !== want; i++) {
      current = (await post('/loop', {}))?.loop_mode || LOOP_MODES[(LOOP_MODES.indexOf(current) + 1) % 3];
    }
  }

  async function handle(key, command, args) {
    const user = userOf(key);
    if (!user) { return; }
    switch (command) {
      case 'play': await post('/resume', {}); break;
      case 'pause': await post('/pause', {}); break;
      case 'playPause': {
        const s = await status();
        await post(s?.playing ? '/pause' : '/resume', {});
        break;
      }
      case 'next': await post('/next', {}); break;
      case 'previous': await post('/previous', {}); break;
      case 'seek': if (Number.isFinite(args?.positionMs)) { await post('/seek', { position: args.positionMs / 1000 }); } break;
      case 'goTo': if (Number.isInteger(args?.index)) { await post('/queue/play-index', { index: args.index }); } break;
      case 'setVolume': if (Number.isFinite(args?.volume)) { await post('/volume', { volume: Math.min(100, Math.max(0, args.volume)) / 100 }); } break;
      case 'setShuffle': if (typeof args?.shuffle === 'boolean') { await post('/shuffle', { value: args.shuffle }); } break;
      case 'setRepeat': await setRepeat(args?.mode); break;
      case 'takeover': {
        // A transfer here: the queue, the track, the position.
        const { files, kept } = enginePaths(Array.isArray(args?.queue) ? args.queue : [], user);
        if (!files.length) { break; }
        const want = Number.isInteger(args.index) ? args.index : 0;
        // The track at `index` may have been one the engine can't play: the next one kept.
        let index = kept.findIndex((i) => i >= want);
        if (index < 0) { index = 0; }
        await post('/queue/clear', {});
        await post('/queue/add-many', { files });
        await post('/queue/play-index', { index });
        if (kept[index] === want && args.positionMs > 1000) { await post('/seek', { position: args.positionMs / 1000 }); }
        if (args.play === false) { await post('/pause', {}); }
        break;
      }
      case 'enqueue': {
        const { files } = enginePaths(Array.isArray(args?.paths) ? args.paths : [], user);
        if (!files.length) { break; }
        const empty = !(lastQueue.length);
        await post('/queue/add-many', { files });
        if (empty) { await post('/queue/play-index', { index: 0 }); }
        break;
      }
      case 'remove': {
        const q = await queue();
        if (Number.isInteger(args?.index) && q[args.index] === args.path) { await post('/queue/remove', { index: args.index }); }
        break;
      }
      default: return;
    }
    last = null;   // report what the engine does now
    setTimeout(() => { tick().catch(() => {}); }, 250);
  }

  let timer = null;
  return {
    tick,
    handle,
    start(everyMs = 1000) {
      const loop = () => { tick().catch(() => {}).finally(() => { if (timer) { timer = setTimeout(loop, everyMs); } }); };
      timer = setTimeout(loop, 0);
    },
    stop() { clearTimeout(timer); timer = null; disconnectAll(); },
  };
}
