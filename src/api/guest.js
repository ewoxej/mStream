// Guest access to Play on (state/guest-links.js has the model): a link lets
// someone without an account control one of a user's devices. It replaced
// the Jukebox, whose guests held a token good for most of the owner's API;
// a guest token reaches only the routes below and album art (auth.js).
//
// The owner's routes:
//   GET    /api/v1/devices/guests          the user's links, each with its token
//   POST   /api/v1/devices/guests          { device, duration: 1h|12h|7d|never, label? }
//   DELETE /api/v1/devices/guests/:id      revoke
//   POST   /api/v1/devices/guests/qr       { text } → { size, modules } — the QR code of a
//                                           link, for apps without a QR encoder (row by
//                                           row, "1" = dark)
// The guest's (token from the link: /guest/#<token>, the page at webapp/guest):
//   GET    /api/v1/guest                   the device (summary) and its queue around the playing track
//   POST   /api/v1/guest/search            { search } → tracks of the owner's libraries
//   POST   /api/v1/guest/command           { command, args } → sent to the device as from a device

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import Joi from 'joi';
import jwt from 'jsonwebtoken';
import winston from 'winston';
import * as config from '../state/config.js';
import * as db from '../db/manager.js';
import { joiValidate } from '../util/validation.js';
import WebError from '../util/web-error.js';
import { createStore, DURATIONS } from '../state/guest-links.js';
import { hub } from './devices.js';
import { pullMetaDataBatch } from './db.js';
import { runFtsSearch, runLikeSearch } from './search.js';

const QUEUE_BEFORE = 10;
const QUEUE_AFTER = 150;
const MAX_ENQUEUE = 50;
const GUEST_COMMANDS = ['play', 'pause', 'playPause', 'next', 'previous', 'seek', 'goTo', 'setVolume', 'enqueue', 'remove'];

let store = null;
function links() {
  if (store) { return store; }
  const file = path.join(config.program.storage.dbDirectory, 'guest-links.json');
  store = createStore({
    load: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []),
    save: (list) => {
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
      fs.renameSync(tmp, file);
    },
  });
  return store;
}

/** For tests: start over with another store. */
export function useStore(s) { store = s; }

// The web app's QR encoder (Nayuki's qrcodegen, a browser script), run here.
let qrcodegen = null;
function qrOf(text) {
  if (!qrcodegen) {
    const src = fs.readFileSync(path.join(config.program.webAppDirectory, 'assets/js/lib/qr.js'), 'utf8');
    qrcodegen = vm.runInNewContext(`${src};qrcodegen`, {});
  }
  const code = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  let modules = '';
  for (let y = 0; y < code.size; y++) { for (let x = 0; x < code.size; x++) { modules += code.getModule(x, y) ? '1' : '0'; } }
  return { size: code.size, modules };
}

const tokenOf = (link) => jwt.sign({ guestLink: link.id }, config.program.secret, { noTimestamp: true });

// The owner's account, as the guest acts within it: their libraries, no
// writes, never admin.
function ownerOf(link) {
  const user = db.getUserByUsername(link.user);
  if (!user) { return null; }
  const libIds = db.getUserLibraryIds(user);
  const libraries = db.getAllLibraries().filter((l) => libIds.includes(l.id));
  return { ...user, vpaths: libraries.map((l) => l.name), admin: false };
}

/**
 * The wall's half (auth.js): a guest token → the restricted user, or a 401
 * once the link is revoked / expired. `guest` marks it; only the guest
 * routes and album art let it through (allowedPath).
 */
export function authenticate(decoded) {
  const link = links().get(decoded.guestLink);
  if (!link) { throw new WebError('This guest link has ended', 401); }
  const owner = ownerOf(link);
  if (!owner) { throw new WebError('Authentication Error', 401); }
  return {
    ...owner,
    guest: link,
    allow_upload: 0,
    allow_mkdir: 0,
    allow_file_modify: 0,
    allow_server_audio: 0,
    allow_discovery_jobs: 0,
  };
}

export const allowedPath = (p) => p === '/api/v1/guest' || p.startsWith('/api/v1/guest/') || p.startsWith('/album-art/');

function ownerKey(req) {
  if (!req.user?.id || req.user.federation || req.user.guest) { throw new WebError('Forbidden', 403); }
  return String(req.user.id);
}

function guestOf(req) {
  if (!req.user?.guest) { throw new WebError('Forbidden', 403); }
  return { link: req.user.guest, key: String(req.user.id) };
}

const trackOf = (fp, m) => ({
  filepath: fp,
  title: m?.title || fp.split('/').pop(),
  artist: m?.artist || '',
  album: m?.album || '',
  art: m?.['album-art'] || null,
  durationMs: Number.isFinite(m?.duration) ? Math.round(m.duration * 1000) : null,
});

export function setup(mstream) {
  // ── The owner ─────────────────────────────────────────────────────────

  mstream.get('/api/v1/devices/guests', (req, res) => {
    const key = ownerKey(req);
    const names = new Map(hub.list(key).map((d) => [d.id, d.name]));
    res.json({
      links: links().list(req.user.username).map((l) => ({
        id: l.id, device: l.device, deviceName: names.get(l.device) || l.deviceName, label: l.label,
        createdAt: new Date(l.createdAt).toISOString(), expiresAt: l.expiresAt ? new Date(l.expiresAt).toISOString() : null,
        token: tokenOf(l),
      })),
    });
  });

  mstream.post('/api/v1/devices/guests', (req, res) => {
    const key = ownerKey(req);
    const { value } = joiValidate(Joi.object({
      device: Joi.string().min(4).max(64).pattern(/^[A-Za-z0-9_-]+$/).required(),
      duration: Joi.string().valid(...Object.keys(DURATIONS)).default('12h'),
      label: Joi.string().max(80).allow('').default(''),
    }), req.body);
    const device = hub.list(key).find((d) => d.id === value.device);
    if (!device) { throw new WebError('Unknown device', 404); }
    const link = links().create({ user: req.user.username, device: device.id, deviceName: device.name, label: value.label, duration: value.duration });
    winston.info(`Guest link ${link.id} for ${req.user.username}'s ${device.name} (${value.duration})`);
    res.json({ id: link.id, token: tokenOf(link), expiresAt: link.expiresAt ? new Date(link.expiresAt).toISOString() : null });
  });

  mstream.post('/api/v1/devices/guests/qr', (req, res) => {
    ownerKey(req);
    const { value } = joiValidate(Joi.object({ text: Joi.string().min(1).max(1000).required() }), req.body);
    res.json(qrOf(value.text));
  });

  mstream.delete('/api/v1/devices/guests/:id', (req, res) => {
    ownerKey(req);
    if (!links().revoke(req.user.username, req.params.id)) { throw new WebError('Unknown link', 404); }
    res.json({});
  });

  // ── The guest ─────────────────────────────────────────────────────────

  mstream.get('/api/v1/guest', (req, res) => {
    const { link, key } = guestOf(req);
    const device = hub.list(key).find((d) => d.id === link.device) || null;
    const q = device ? hub.queue(key, link.device) : null;
    let queue = { total: 0, start: 0, index: -1, items: [] };
    if (q && q.queue.length) {
      const index = Math.min(Math.max(q.index ?? 0, 0), q.queue.length - 1);
      const start = Math.max(0, index - QUEUE_BEFORE);
      const paths = q.queue.slice(start, index + QUEUE_AFTER + 1);
      const meta = pullMetaDataBatch(paths, req.user);
      queue = { total: q.queue.length, start, index, items: paths.map((fp) => trackOf(fp, meta.get(fp)?.metadata)) };
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      link: { label: link.label, deviceName: device?.name || link.deviceName, expiresAt: link.expiresAt ? new Date(link.expiresAt).toISOString() : null },
      device: device && {
        name: device.name, type: device.type, online: device.online, playing: device.playing,
        positionMs: device.positionMs, volume: device.volume, track: device.track,
      },
      queue,
    });
  });

  mstream.post('/api/v1/guest/search', (req, res) => {
    guestOf(req);
    const { value } = joiValidate(Joi.object({ search: Joi.string().min(1).max(200).required() }), req.body);
    const opts = { noArtists: true, noAlbums: true, noFiles: true, noLyrics: true };
    const found = db.FTS5_AVAILABLE ? runFtsSearch(req, value.search, opts, { strict: false }) : runLikeSearch(req, value.search, opts);
    res.json({
      tracks: found.title.slice(0, 60).map((t) => ({ ...trackOf(t.filepath, t.metadata), art: t.album_art_file || t.metadata?.['album-art'] || null })),
    });
  });

  mstream.post('/api/v1/guest/command', (req, res) => {
    const { link, key } = guestOf(req);
    const { value } = joiValidate(Joi.object({
      command: Joi.string().valid(...GUEST_COMMANDS).required(),
      args: Joi.alternatives().conditional('command', {
        switch: [
          { is: 'enqueue', then: Joi.object({ paths: Joi.array().items(Joi.string().max(2048)).min(1).max(MAX_ENQUEUE).required(), next: Joi.boolean().default(false) }).required() },
          { is: 'remove', then: Joi.object({ index: Joi.number().integer().min(0).required(), path: Joi.string().max(2048).required() }).required() },
          { is: 'goTo', then: Joi.object({ index: Joi.number().integer().min(0).required() }).required() },
          { is: 'seek', then: Joi.object({ positionMs: Joi.number().min(0).required() }).required() },
          { is: 'setVolume', then: Joi.object({ volume: Joi.number().min(0).max(100).required() }).required() },
        ],
        otherwise: Joi.any().strip(),
      }),
    }), req.body);
    let args = value.args ?? null;
    if (value.command === 'enqueue') {
      // Only tracks of the owner's libraries.
      const meta = pullMetaDataBatch(args.paths, req.user);
      const paths = args.paths.filter((p) => meta.get(p)?.metadata);
      if (!paths.length) { throw new WebError('Not in the library', 404); }
      args = { ...args, paths };
    }
    if (!hub.command(key, `guest-${link.id}`, link.device, value.command, args)) {
      throw new WebError('The device is offline', 409);
    }
    res.json({});
  });
}
