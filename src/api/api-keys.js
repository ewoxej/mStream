// Personal API keys (state/api-keys.js has the model). An app sends one in
// the `x-api-key` header and acts as its owner — their libraries, their
// devices — read-only and limited to what a player needs (the list below).
// Unlike a federation key (for other servers) it carries no bandwidth caps
// and sees the owner's devices, so one key is all a home page widget needs.
//
// The owner's routes (a signed-in session; a key can't manage keys):
//   GET    /api/v1/api-keys                the user's keys (never the secrets)
//   POST   /api/v1/api-keys   { label? }   → { id, label, key } — `key` only now
//   DELETE /api/v1/api-keys/:id            revoke

import fs from 'fs';
import path from 'path';
import Joi from 'joi';
import winston from 'winston';
import * as config from '../state/config.js';
import * as db from '../db/manager.js';
import { joiValidate } from '../util/validation.js';
import WebError from '../util/web-error.js';
import { createStore, MAX_KEYS_PER_USER } from '../state/api-keys.js';

let store = null;
function apiKeys() {
  if (store) { return store; }
  const file = path.join(config.program.storage.dbDirectory, 'api-keys.json');
  store = createStore({
    load: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []),
    save: (list) => {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, file);
    },
  });
  return store;
}

// What a key may call: exact "METHOD path", GET-only prefixes for the media
// and art trees, and a device's queue. All of it reads.
const ALLOWED_EXACT = new Set([
  'GET /api',
  'GET /api/',
  'GET /api/v1/devices',
  'GET /api/v1/devices/now',
  'POST /api/v1/db/random-songs',
  'POST /api/v1/db/metadata',
  'POST /api/v1/db/metadata/batch',
  'POST /api/v1/db/search',
]);
const ALLOWED_GET_PREFIXES = ['/media/', '/album-art/'];
const DEVICE_QUEUE = /^\/api\/v1\/devices\/[A-Za-z0-9_-]+\/queue$/;

export function isApiKeyRouteAllowed(method, p) {
  if (ALLOWED_EXACT.has(`${method} ${p}`)) { return true; }
  if (method !== 'GET' && method !== 'HEAD') { return false; }
  return DEVICE_QUEUE.test(p) || ALLOWED_GET_PREFIXES.some((x) => p.startsWith(x));
}

/**
 * The wall's half (auth.js): the key → its owner, restricted. Throws 401
 * (unknown or revoked key, owner gone) or 403 (off-limits route).
 */
export function authenticate(key, req) {
  const found = apiKeys().use(key);
  const user = found && db.getUserByUsername(found.user);
  // The id too: an account made again under an old name doesn't get its keys.
  if (!user || user.id !== found.userId) {
    winston.warn(`Rejected unknown API key from ${req.ip} on ${req.path}`);
    throw new WebError('Authentication Error', 401);
  }
  if (!isApiKeyRouteAllowed(req.method, req.path)) {
    winston.warn(`API key of '${user.username}' denied route ${req.method} ${req.path} from ${req.ip}`);
    throw new WebError('Forbidden', 403);
  }
  const libIds = db.getUserLibraryIds(user);
  const libraries = db.getAllLibraries().filter((l) => libIds.includes(l.id));
  return {
    ...user,
    vpaths: libraries.map((l) => l.name),
    apiKey: found.id,
    admin: false,
    allow_upload: 0,
    allow_mkdir: 0,
    allow_file_modify: 0,
    allow_server_audio: 0,
    allow_discovery_jobs: 0,
  };
}

// A real account's session: not public mode, a guest, a peer or another key.
function owner(req) {
  const u = req.user;
  if (!u?.id || u.federation || u.guest || u.apiKey) { throw new WebError('Forbidden', 403); }
  if (db.getUserByUsername(u.username)?.id !== u.id) { throw new WebError('API keys need an account on this server', 403); }
  return u;
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const view = (k) => ({ id: k.id, label: k.label, createdAt: iso(k.createdAt), lastUsedAt: iso(k.lastUsedAt) });

export function setup(mstream) {
  mstream.get('/api/v1/api-keys', (req, res) => {
    const u = owner(req);
    res.json({ keys: apiKeys().list(u.id, u.username).map(view) });
  });

  mstream.post('/api/v1/api-keys', (req, res) => {
    const u = owner(req);
    const { value } = joiValidate(Joi.object({ label: Joi.string().max(80).allow('').default('') }), req.body);
    const made = apiKeys().create({ userId: u.id, user: u.username, label: value.label });
    if (!made) { throw new WebError(`No more than ${MAX_KEYS_PER_USER} API keys`, 409); }
    winston.info(`API key ${made.id} made for ${u.username}`);
    res.set('Cache-Control', 'no-store');
    res.json({ ...view(made), key: made.key });
  });

  mstream.delete('/api/v1/api-keys/:id', (req, res) => {
    const u = owner(req);
    if (!apiKeys().revoke(u.id, u.username, req.params.id)) { throw new WebError('Unknown key', 404); }
    res.json({});
  });
}
