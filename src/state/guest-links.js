// Guest links (Play on's guest access): a link lets someone without an
// account control one of a user's playback devices — see what plays and
// the queue, search the user's libraries, queue tracks, skip, pause, set
// the volume, remove from the queue. Made by the user for a device they
// pick, for a while (or until revoked).
//
// A link is { id, user (the owner's username), device, deviceName, label,
// createdAt, expiresAt (ms, null = until revoked) }. Its token (api/guest.js)
// is a JWT naming the link: revoking or expiring the link ends it.
//
// Kept in a JSON file next to the database, so links outlive a restart. The
// store is pure apart from the clock and the two file callbacks, so
// test/unit/guest-links.test.mjs drives it directly.

import crypto from 'crypto';

export const MAX_LINKS_PER_USER = 20;
export const DURATIONS = { '1h': 3600e3, '12h': 12 * 3600e3, '7d': 7 * 24 * 3600e3, never: null };

export function createStore({ load = () => [], save = () => {}, now = () => Date.now() } = {}) {
  let links = [];
  try { links = (load() || []).filter((l) => l && typeof l.id === 'string' && typeof l.user === 'string'); } catch (_) { links = []; }

  const alive = (l) => l.expiresAt == null || l.expiresAt > now();
  const persist = () => { try { save(links); } catch (_) { /* kept in memory; next change retries */ } };

  function prune() {
    const before = links.length;
    links = links.filter(alive);
    if (links.length !== before) { persist(); }
  }

  return {
    create({ user, device, deviceName, label = '', duration = '12h' }) {
      prune();
      if (!(duration in DURATIONS)) { throw new Error('unknown duration'); }
      const mine = links.filter((l) => l.user === user);
      // Too many: the oldest goes.
      if (mine.length >= MAX_LINKS_PER_USER) {
        const oldest = mine.sort((a, b) => a.createdAt - b.createdAt)[0];
        links = links.filter((l) => l !== oldest);
      }
      const ms = DURATIONS[duration];
      const link = {
        id: crypto.randomBytes(9).toString('base64url'),
        user, device, deviceName: deviceName || 'Device', label: String(label || '').slice(0, 80),
        createdAt: now(), expiresAt: ms == null ? null : now() + ms,
      };
      links.push(link);
      persist();
      return link;
    },

    // The link, while it lives.
    get(id) {
      const l = links.find((x) => x.id === id);
      return l && alive(l) ? l : null;
    },

    list(user) { prune(); return links.filter((l) => l.user === user); },

    revoke(user, id) {
      const before = links.length;
      links = links.filter((l) => !(l.id === id && l.user === user));
      if (links.length === before) { return false; }
      persist();
      return true;
    },

    // A device renamed: its links show the new name.
    renameDevice(user, device, name) {
      let changed = false;
      for (const l of links) { if (l.user === user && l.device === device && l.deviceName !== name) { l.deviceName = name; changed = true; } }
      if (changed) { persist(); }
    },
  };
}
