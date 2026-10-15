// Routes for server-side playback: /api/v1/server-playback/*, and the
// server's speakers as a playback device (state/server-device.js — Play on;
// it replaced the /server-remote page). The backend itself — which process is running, how it
// is found, spawned, watched and stopped — lives in src/state/server-audio.js;
// this module only translates paths, gates access and proxies.
//
// Which engine answers decides the translation. The headless engine the
// lifecycle spawns plays files off this machine's disks: it takes absolute
// paths and answers with them, so every path is translated both ways here
// (and no absolute path ever reaches a client). The desktop player the
// lifecycle adopts streams from this server: it takes the library paths the
// client sent and answers with the same, so for it they pass through
// untranslated — after the caller's access to them was checked exactly as
// before (pathForEngine).

import path from 'path';
import Joi from 'joi';
import winston from 'winston';
import * as serverAudio from '../state/server-audio.js';
import * as vpath from '../util/vpath.js';
import * as db from '../db/manager.js';
import { joiValidate } from '../util/validation.js';
import WebError from '../util/web-error.js';
import { createServerDevice } from '../state/server-device.js';
import { hub } from './devices.js';
import { pullMetaDataBatch } from './db.js';

// ── Path translation ────────────────────────────────────────────────────────

// Resolve a virtual path (e.g. "55/song.mp3") to an absolute filesystem path,
// on behalf of THIS user: getVPathInfo enforces the caller's library access
// and rejects with a typed 404. Clients build vpaths from what the server
// handed them, so a rejected one is almost never an honest mistake — it is
// stale client state or someone probing, and gets a line naming who sent what
// before the 404 goes out (the transcode routes' convention).
function resolveFilePath(filePath, user) {
  try {
    return vpath.getVPathInfo(filePath, user).fullPath;
  } catch (err) {
    winston.warn(`[server-audio] vpath rejected for user '${user?.username}': '${filePath}' (${err.message})`);
    throw err;
  }
}

// The path the engine gets for a library path the caller sent: the headless
// engine takes the absolute path, the desktop player the library path as it
// came. The caller's access was checked either way — resolveFilePath ran
// first and threw for a library they lack. Pure, exported for the unit tests.
export function pathForEngine(libraryPath, absolute, active) {
  return active?.engine === 'desktop' ? libraryPath : absolute;
}

// Is `child` the same path as `root`, or inside it? A plain startsWith isn't
// enough: "C:\Music" is a prefix of "C:\MusicVideos\song.mp3" without
// containing it, which produced vpaths like "music/../MusicVideos/song.mp3".
export function isWithin(child, root) {
  if (child === root) { return true; }
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  return child.startsWith(withSep);
}

// Reverse: convert an absolute path back to a virtual path (e.g. "55/song.mp3")
function absoluteToVpath(absolutePath) {
  const normalized = path.normalize(absolutePath);
  const libraries = db.getAllLibraries();
  for (const lib of libraries) {
    const root = path.normalize(lib.root_path);
    if (isWithin(normalized, root)) {
      const relative = path.relative(root, normalized);
      return lib.name + '/' + relative.replace(/\\/g, '/');
    }
  }
  // If no vpath matches, return the filename as fallback
  return path.basename(absolutePath);
}

// ── Request bodies ──────────────────────────────────────────────────────────

const oneFileSchema = Joi.object({ file: Joi.string().required() });
const manyFilesSchema = Joi.object({ files: Joi.array().items(Joi.string()).required() });

// { file: vpath } → { file: the engine's path } (pathForEngine). A malformed
// body is a 400 from the schema; a library the caller lacks is
// resolveFilePath's 404 — for either engine.
function oneFile(req) {
  const { value } = joiValidate(oneFileSchema, req.body || {});
  const active = serverAudio.getActiveBackend();
  return { file: pathForEngine(value.file, resolveFilePath(value.file, req.user), active) };
}

function manyFiles(req) {
  const { value } = joiValidate(manyFilesSchema, req.body || {});
  const active = serverAudio.getActiveBackend();
  return { files: value.files.map((f) => pathForEngine(f, resolveFilePath(f, req.user), active)) };
}

// ── Response bodies ─────────────────────────────────────────────────────────
//
// The headless engine speaks absolute paths — that is what it was handed —
// and no absolute path may reach a client: it tells every user with
// server-audio access how the host's disks are laid out. /queue always
// translated; /status handed `file` through untouched until this was caught.
// The desktop player speaks library paths already, and its answers pass
// through. Pure and exported so the unit tests need no database (`toVpath`
// is injectable, `active` says which engine answered).

// GET /status: the current track as a library path, plus which backend and
// engine answered. Anything that is not a status object passes through
// untouched.
export function statusForClient(data, active, toVpath = absoluteToVpath) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) { return data; }
  const out = { ...data, backend: active.backend, player: active.player, engine: active.engine ?? null };
  if (typeof data.file === 'string' && data.file !== '') {
    out.file = active.engine === 'desktop' ? data.file : toVpath(data.file);
  }
  return out;
}

// GET /queue: every entry as a library path.
export function queueForClient(data, toVpath = absoluteToVpath, active = null) {
  if (!data || !Array.isArray(data.queue)) { return data; }
  if (active?.engine === 'desktop') { return { ...data, queue: [...data.queue] }; }
  return { ...data, queue: data.queue.map(toVpath) };
}

// ── The one proxied-route handler ───────────────────────────────────────────

/**
 * Build the handler for one proxied route: shape the backend's request body,
 * proxy, shape the answer.
 *
 *   mapBody(req)    → the body the backend gets. Default: the request's own
 *                     body for a POST, none for a GET. Runs BEFORE the proxy,
 *                     so a malformed body or a library the caller lacks is
 *                     their error whether or not a backend is up. Its throws
 *                     go to the terminal error handler like any other
 *                     route's (schema → 400, WebError → its own status).
 *   mapResult(data) → the body the client gets, for a backend success.
 *
 * The backend's own status code and body are passed through as they are: a
 * 409 "already at end of queue" is the backend's answer, not a proxy failure.
 *
 * `proxy` is a parameter so the unit tests can drive a handler with no
 * backend at all.
 */
export function proxyRoute(proxy, method, rustPath, { mapBody, mapResult } = {}) {
  return async (req, res) => {
    let body;
    if (mapBody) { body = mapBody(req); }
    else if (method !== 'GET') { body = req.body || {}; }

    let result;
    try {
      result = await proxy(method, rustPath, body);
    } catch (err) {
      // "No backend answered" is a state, not an incident, so it is answered
      // here instead of by the terminal handler: the remote page polls
      // /status twice a second, and every one of those would be an
      // error-level log line for as long as the backend stays down. The
      // cause is not lost — the lifecycle module logs why a backend went
      // away, and the proxy logs the socket error when an engine stops
      // answering, once per outage.
      if (err instanceof WebError && err.status === 503) {
        return res.status(503).json({ error: err.message });
      }
      throw err;
    }

    const data = mapResult && result.status < 400 ? mapResult(result.data) : result.data;
    res.status(result.status).json(data);
  };
}

// Single source of truth for "may this user touch server audio?" — shared
// between the /api/v1/server-playback/* middleware and the server device.
function userCanUseServerAudio(user) {
  if (!user) { return false; }
  if (user.admin === true) { return true; }
  return user.allow_server_audio === 1 || user.allow_server_audio === true;
}

export function setup(mstream) {

  // ── Per-user permission gate ────────────────────────────────────────────
  // Any route under /api/v1/server-playback requires allow_server_audio.
  // Admins always pass; everyone else must have the flag set.
  mstream.all('/api/v1/server-playback/{*path}', (req, res, next) => {
    if (!userCanUseServerAudio(req.user)) {
      return res.status(403).json({ error: 'Server audio access disabled for this user' });
    }
    next();
  });

  // ── Proxied routes ──────────────────────────────────────────────────────
  // Every route is the backend's own path under one prefix, so a single name
  // serves both sides. Most need nothing else; the rest say what they map.
  const routes = [
    ['post', '/pause'],
    ['post', '/resume'],
    ['post', '/stop'],
    ['post', '/next'],
    ['post', '/previous'],
    ['post', '/loop'],
    ['post', '/seek'],             // { position: seconds }
    ['post', '/volume'],           // { volume: 0..1 }
    ['post', '/shuffle'],          // { value: boolean }
    ['get',  '/status',           { mapResult: (data) => statusForClient(data, serverAudio.getActiveBackend()) }],
    ['get',  '/queue',            { mapResult: (data) => queueForClient(data, absoluteToVpath, serverAudio.getActiveBackend()) }],
    ['post', '/play',             { mapBody: oneFile }],     // clear queue, add file, play
    ['post', '/queue/add',        { mapBody: oneFile }],
    ['post', '/queue/add-many',   { mapBody: manyFiles }],
    ['post', '/queue/play-index'], // { index }
    ['post', '/queue/remove'],     // { index }
    ['post', '/queue/clear',      { mapBody: () => ({}) }],  // stop and empty the queue
  ];

  for (const [verb, rustPath, opts] of routes) {
    mstream[verb](`/api/v1/server-playback${rustPath}`, proxyRoute(serverAudio.proxy, verb.toUpperCase(), rustPath, opts));
  }

  // The old page: the server's speakers are a device in the player now.
  mstream.get('/server-remote', (req, res) => res.redirect(301, '/'));
}

// ── The server's speakers as a device ───────────────────────────────────────

// A user as the device acts for them: their libraries (path checks).
function withLibraries(user) {
  const ids = db.getUserLibraryIds(user);
  return { ...user, admin: user.is_admin === 1, vpaths: db.getAllLibraries().filter((l) => ids.includes(l.id)).map((l) => l.name) };
}

let device = null;

/** Starts "Server speakers" in the users' devices (it follows the engine on its own). */
export function startServerDevice() {
  stopServerDevice();
  const up = () => serverAudio.getActiveBackend().engine !== null;
  const read = async (rustPath, shape) => {
    const r = await serverAudio.proxy('GET', rustPath);
    return r.status < 400 ? shape(r.data) : null;
  };
  device = createServerDevice({
    hub,
    isUp: up,
    users: () => db.getAllUsers()
      .filter((u) => u.is_admin === 1 || u.allow_server_audio === 1)
      .map((u) => ({ key: String(u.id), user: withLibraries(u) })),
    status: () => read('/status', (d) => statusForClient(d, serverAudio.getActiveBackend())),
    queue: () => read('/queue', (d) => queueForClient(d, absoluteToVpath, serverAudio.getActiveBackend())?.queue || []),
    post: async (rustPath, body) => (await serverAudio.proxy('POST', rustPath, body)).data,
    enginePath: (libraryPath, user) => {
      try { return pathForEngine(libraryPath, vpath.getVPathInfo(libraryPath, user).fullPath, serverAudio.getActiveBackend()); } catch (_) { return null; }
    },
    describe: (paths) => {
      const all = { vpaths: db.getAllLibraries().map((l) => l.name) };
      const meta = pullMetaDataBatch(paths, all);
      return new Map(paths.map((p) => {
        const m = meta.get(p)?.metadata;
        return [p, m ? { title: m.title, artist: m.artist, album: m.album, art: m['album-art'] } : null];
      }));
    },
  });
  device.start(1000);
}

export function stopServerDevice() {
  device?.stop();
  device = null;
}
