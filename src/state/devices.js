// Playback devices (Spotify Connect–like): every player a user has open —
// a browser, the Zenelo app, … — registers here under a stable id, reports
// what it plays (status: track, index, position, playing, volume; and its
// queue as library paths when that changes), and listens for commands. The
// other devices of the same user see it, control it, and can take its
// playback over (transfer): the queue and position move, the old device
// pauses.
//
// In memory, per user. A device that goes offline keeps its last state, so
// the queue paused on one device can be picked up on another later
// (OFFLINE_KEEP_MS); a server restart forgets them all.
//
// Pure apart from the clock: the transport (an SSE stream in api/devices.js)
// is a `send(event, data)` callback per connection, so the hub is driven
// directly by test/unit/devices-hub.test.mjs.

export const OFFLINE_KEEP_MS = 30 * 24 * 3600 * 1000;
export const MAX_DEVICES = 20;
export const MAX_QUEUE = 20000;
// `enqueue` { paths, next } adds library tracks (after the playing one when
// `next`); `remove` { index, path } takes the queue's entry out if it still
// is that path. Guests (api/guest.js) send them; so may devices.
export const COMMANDS = ['play', 'pause', 'playPause', 'next', 'previous', 'seek', 'goTo', 'setVolume', 'setShuffle', 'setRepeat', 'takeover', 'enqueue', 'remove'];

export function createHub(now = () => Date.now()) {
  const users = new Map();   // userKey → Map(deviceId → device)

  const devicesOf = (user) => {
    let m = users.get(user);
    if (!m) { m = new Map(); users.set(user, m); }
    return m;
  };

  function prune(m) {
    const t = now();
    for (const [id, d] of m) {
      if (!d.conn && t - d.lastSeen > OFFLINE_KEEP_MS) { m.delete(id); }
    }
    // Too many: drop the offline ones seen longest ago.
    const offline = [...m.values()].filter((d) => !d.conn).sort((a, b) => a.lastSeen - b.lastSeen);
    while (m.size > MAX_DEVICES && offline.length) { m.delete(offline.shift().id); }
  }

  // Where the playhead is now: a playing device's position moves on since its report.
  function positionNow(d) {
    const s = d.status;
    if (!s) { return 0; }
    const base = Number(s.positionMs) || 0;
    if (!s.playing) { return base; }
    const p = base + Math.max(0, now() - s.updatedAt);
    const dur = Number(s.track?.durationMs) || 0;
    return dur > 0 ? Math.min(p, dur) : p;
  }

  function summary(d) {
    const s = d.status || {};
    return {
      id: d.id, name: d.name, type: d.type, online: !!d.conn, lastSeen: new Date(d.lastSeen).toISOString(),
      playing: !!(d.conn && s.playing), index: s.index ?? -1, positionMs: positionNow(d), volume: s.volume ?? null,
      // null from a client that doesn't report them (its buttons can't be driven).
      shuffle: typeof s.shuffle === 'boolean' ? s.shuffle : null, repeat: s.repeat ?? null,
      track: s.track || null, updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
      queueLength: d.queue.length, queueRev: d.queueRev,
      // When it last reported playing: a pick-up takes the queue of the device
      // that played last (a device that only took a queue over doesn't count,
      // or two of them would hand the same queue back and forth).
      lastPlayedAt: d.lastPlayedAt ? new Date(d.lastPlayedAt).toISOString() : null,
    };
  }

  function broadcast(user, event, data, exceptId) {
    for (const d of devicesOf(user).values()) {
      if (d.conn && d.id !== exceptId) { try { d.conn.send(event, data); } catch (_) { /* the stream closes itself */ } }
    }
  }

  return {
    // A device's stream opened. Returns the function that closes it.
    connect(user, { id, name, type }, send) {
      const m = devicesOf(user);
      prune(m);
      let d = m.get(id);
      if (d?.conn) { try { d.conn.send('replaced', { id }); d.conn.close?.(); } catch (_) { /* gone */ } }
      if (!d) { d = { id, queue: [], queueRev: 0, status: null }; m.set(id, d); }
      const conn = { send, close: null };
      Object.assign(d, { name: name || d.name || 'Device', type: type || d.type || 'other', conn, lastSeen: now() });
      send('devices', { self: id, devices: [...m.values()].map(summary) });
      broadcast(user, 'device', summary(d), id);
      return () => {
        if (d.conn !== conn) { return; }   // replaced by a newer stream of the same device
        d.conn = null;
        d.lastSeen = now();
        // Gone means not playing any more; the rest is kept for a pick-up.
        if (d.status) {
          if (d.status.playing) { d.lastPlayedAt = now(); }
          d.status = { ...d.status, positionMs: positionNow(d), playing: false, updatedAt: now() };
        }
        broadcast(user, 'device', summary(d), id);
      };
    },

    // A device reports its status (and its queue when that changed).
    report(user, id, { status, queue }) {
      const d = devicesOf(user).get(id);
      if (!d) { return false; }
      if (Array.isArray(queue)) { d.queue = queue.slice(0, MAX_QUEUE); d.queueRev++; }
      if (status) { d.status = { ...status, updatedAt: now() }; }
      if (status?.playing) { d.lastPlayedAt = now(); }
      d.lastSeen = now();
      // To itself too: its own summary carries the server's clock.
      broadcast(user, 'device', summary(d), null);
      return true;
    },

    command(user, from, to, command, args) {
      const d = devicesOf(user).get(to);
      if (!d?.conn) { return false; }
      d.conn.send('command', { from, command, args: args ?? null });
      return true;
    },

    // Move playback from one device to another: the source pauses, the
    // target gets the queue and the position. When the target is the caller
    // the state comes back in the answer instead of as a command.
    transfer(user, { from, to, caller, play = true }) {
      const m = devicesOf(user);
      const src = m.get(from);
      if (!src || !src.status || !src.queue.length) { return { ok: false, reason: 'nothing-to-transfer' }; }
      const state = { from, queue: src.queue, index: src.status.index ?? 0, positionMs: positionNow(src), track: src.status.track || null, play };
      if (from !== to && src.conn && src.status.playing) {
        src.lastPlayedAt = now();
        src.conn.send('command', { from: caller, command: 'pause', args: null });
        src.status = { ...src.status, positionMs: state.positionMs, playing: false, updatedAt: now() };
        broadcast(user, 'device', summary(src), null);
      }
      if (to === caller) { return { ok: true, state }; }
      const dst = m.get(to);
      if (!dst?.conn) { return { ok: false, reason: 'offline' }; }
      dst.conn.send('command', { from: caller, command: 'takeover', args: state });
      return { ok: true };
    },

    list(user) { const m = devicesOf(user); prune(m); return [...m.values()].map(summary); },
    queue(user, id) {
      const d = devicesOf(user).get(id);
      return d ? { queue: d.queue, queueRev: d.queueRev, index: d.status?.index ?? 0, positionMs: positionNow(d) } : null;
    },
    rename(user, id, name) {
      const d = devicesOf(user).get(id);
      if (!d) { return false; }
      d.name = name;
      broadcast(user, 'device', summary(d), null);
      return true;
    },
    forget(user, id) {
      const m = devicesOf(user);
      const d = m.get(id);
      if (!d || d.conn) { return false; }
      m.delete(id);
      broadcast(user, 'removed', { id }, null);
      return true;
    },
  };
}
