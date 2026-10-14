// Playback devices: the routes over state/devices.js (see there for the model).
//
//   GET    /api/v1/devices/events?id=&name=&type=  the device's stream (SSE): `devices` (the
//                                                  list, on connect), `device` (one changed),
//                                                  `removed`, `command`, `replaced`
//   POST   /api/v1/devices/state                   { id, status, queue? }
//   POST   /api/v1/devices/command                 { from, to, command, args? }
//   POST   /api/v1/devices/transfer                { from, to, caller, play? }
//   GET    /api/v1/devices                         the list
//   GET    /api/v1/devices/:id/queue               a device's queue (library paths)
//   POST   /api/v1/devices/:id/name                { name }
//   DELETE /api/v1/devices/:id                     forget an offline device
//
// Server-Sent Events rather than a WebSocket: plain HTTP (no upgrade next to
// the Jukebox socket, fine through reverse proxies), and the compression
// middleware already leaves text/event-stream alone. The token rides the
// query string, as for media URLs (EventSource can't set headers).

import Joi from 'joi';
import { joiValidate } from '../util/validation.js';
import WebError from '../util/web-error.js';
import { createHub, COMMANDS, MAX_QUEUE } from '../state/devices.js';

const hub = createHub();
const HEARTBEAT_MS = 25000;

function userKey(req) {
  if (!req.user?.id || req.user.federation) { throw new WebError('Forbidden', 403); }
  return String(req.user.id);
}

const id = Joi.string().min(4).max(64).pattern(/^[A-Za-z0-9_-]+$/);
const track = Joi.object({
  filepath: Joi.string().max(2048).allow(''),
  title: Joi.string().max(512).allow('', null),
  artist: Joi.string().max(512).allow('', null),
  album: Joi.string().max(512).allow('', null),
  art: Joi.string().max(512).allow('', null),
  durationMs: Joi.number().min(0).allow(null),
}).unknown(false);
const statusSchema = Joi.object({
  index: Joi.number().integer().min(-1).required(),
  positionMs: Joi.number().min(0).required(),
  playing: Joi.boolean().required(),
  volume: Joi.number().min(0).max(100).allow(null),
  shuffle: Joi.boolean(),
  repeat: Joi.string().valid('off', 'all', 'one', 'autodj'),
  track: track.allow(null),
});

export function setup(mstream) {
  mstream.get('/api/v1/devices/events', (req, res) => {
    const user = userKey(req);
    const { value } = joiValidate(Joi.object({
      id: id.required(),
      name: Joi.string().max(80).allow(''),
      type: Joi.string().valid('web', 'android', 'desktop', 'other').default('other'),
      token: Joi.any(),
    }), req.query);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      // Proxies that compress (Cloudflare, nginx gzip, Caddy encode) hold a
      // gzip stream until their buffer fills: behind them not a byte of the
      // stream came through, so devices never saw each other. An encoding
      // already set is left alone.
      'Content-Encoding': 'none',
    });
    res.flushHeaders?.();
    // Some proxies still hold the first few KB of a response: get past that.
    res.write(`:${' '.repeat(2048)}\n\nretry: 3000\n\n`);

    const send = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const close = hub.connect(user, { id: value.id, name: value.name, type: value.type }, send);
    const beat = setInterval(() => { res.write(': ping\n\n'); }, HEARTBEAT_MS);
    let done = false;
    const end = () => { if (done) { return; } done = true; clearInterval(beat); close(); };
    req.on('close', end);
    res.on('error', end);
  });

  mstream.post('/api/v1/devices/state', (req, res) => {
    const user = userKey(req);
    const { value } = joiValidate(Joi.object({
      id: id.required(),
      status: statusSchema.required(),
      queue: Joi.array().items(Joi.string().max(2048)).max(MAX_QUEUE),
    }), req.body);
    if (!hub.report(user, value.id, value)) { throw new WebError('Unknown device', 404); }
    res.json({});
  });

  mstream.post('/api/v1/devices/command', (req, res) => {
    const user = userKey(req);
    const { value } = joiValidate(Joi.object({
      from: id.required(), to: id.required(),
      command: Joi.string().valid(...COMMANDS).required(),
      args: Joi.any(),
    }), req.body);
    if (!hub.command(user, value.from, value.to, value.command, value.args)) { throw new WebError('Device offline', 404); }
    res.json({});
  });

  mstream.post('/api/v1/devices/transfer', (req, res) => {
    const user = userKey(req);
    const { value } = joiValidate(Joi.object({
      from: id.required(), to: id.required(), caller: id.required(), play: Joi.boolean().default(true),
    }), req.body);
    res.json(hub.transfer(user, value));
  });

  mstream.get('/api/v1/devices', (req, res) => { res.json({ devices: hub.list(userKey(req)) }); });

  mstream.get('/api/v1/devices/:id/queue', (req, res) => {
    const q = hub.queue(userKey(req), req.params.id);
    if (!q) { throw new WebError('Unknown device', 404); }
    res.json(q);
  });

  mstream.post('/api/v1/devices/:id/name', (req, res) => {
    const user = userKey(req);
    const { value } = joiValidate(Joi.object({ name: Joi.string().min(1).max(80).required() }), req.body);
    if (!hub.rename(user, req.params.id, value.name)) { throw new WebError('Unknown device', 404); }
    res.json({});
  });

  mstream.delete('/api/v1/devices/:id', (req, res) => {
    if (!hub.forget(userKey(req), req.params.id)) { throw new WebError('Unknown or online device', 404); }
    res.json({});
  });
}
