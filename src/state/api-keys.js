// Personal API keys (the Zenelo fork): a long-lived credential for one of
// the user's own apps — a home page widget, a dashboard — that plays their
// library and follows their devices (api/api-keys.js has what it reaches).
//
// A key is { id, userId, user (username), label, hash, createdAt,
// lastUsedAt }. Only its SHA-256 is kept: the key is shown once, when made.
// Kept in a JSON file next to the database, like the guest links. The store
// is pure apart from the clock and the two file callbacks, so
// test/unit/api-keys.test.mjs drives it directly.

import crypto from 'crypto';

export const PREFIX = 'mskey_';
export const MAX_KEYS_PER_USER = 20;
// `lastUsedAt` moves with every request; the file is written this often at most.
const TOUCH_SAVE_MS = 10 * 60 * 1000;

const hashOf = (key) => crypto.createHash('sha256').update(key).digest('hex');
const publicOf = ({ id, label, createdAt, lastUsedAt }) => ({ id, label, createdAt, lastUsedAt });

export function createStore({ load = () => [], save = () => {}, now = () => Date.now() } = {}) {
  let keys = [];
  try { keys = (load() || []).filter((k) => k && typeof k.hash === 'string' && typeof k.user === 'string'); } catch (_) { keys = []; }
  let savedAt = 0;

  const persist = () => {
    savedAt = now();
    try { save(keys); } catch (_) { /* kept in memory; next change retries */ }
  };
  const mine = (userId, user) => keys.filter((k) => k.userId === userId && k.user === user);

  return {
    // → { key (the secret, only here), ...entry }, or null when the user has too many.
    create({ userId, user, label = '' }) {
      if (mine(userId, user).length >= MAX_KEYS_PER_USER) { return null; }
      const key = PREFIX + crypto.randomBytes(32).toString('base64url');
      const entry = {
        id: crypto.randomBytes(9).toString('base64url'),
        userId, user, label: String(label || '').slice(0, 80), hash: hashOf(key),
        createdAt: now(), lastUsedAt: null,
      };
      keys.push(entry);
      persist();
      return { ...publicOf(entry), key };
    },

    // The key's owner ({ id, userId, user }), or null for an unknown one.
    use(key) {
      if (typeof key !== 'string' || !key.startsWith(PREFIX)) { return null; }
      const hash = hashOf(key);
      const entry = keys.find((k) => k.hash === hash);
      if (!entry) { return null; }
      entry.lastUsedAt = now();
      if (now() - savedAt >= TOUCH_SAVE_MS) { persist(); }
      return { id: entry.id, userId: entry.userId, user: entry.user };
    },

    list(userId, user) { return mine(userId, user).map(publicOf); },

    revoke(userId, user, id) {
      const before = keys.length;
      keys = keys.filter((k) => !(k.id === id && k.userId === userId && k.user === user));
      if (keys.length === before) { return false; }
      persist();
      return true;
    },
  };
}
