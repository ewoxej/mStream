// Playback devices: the routes over state/devices.js (see there for the model).
//
//   GET    /api/v1/devices/events?id=&name=&type=  the device's stream (SSE): `devices` (the
//                                                  list, on connect), `device` (one changed),
//                                                  `removed`, `command`, `replaced`
//   GET    /api/v1/devices/poll?id=&name=&type=&session=&ack=
//                                                  the same events by long polling:
//                                                  { cursor, events: [{ event, data }] }
//   POST   /api/v1/devices/state                   { id, status, queue? }
//   POST   /api/v1/devices/command                 { from, to, command, args? }
//   POST   /api/v1/devices/transfer                { from, to, caller, play? }
//   GET    /api/v1/devices                         the list
//   GET    /api/v1/devices/:id/queue               a device's queue (library paths)
//   POST   /api/v1/devices/:id/name                { name }
//   DELETE /api/v1/devices/:id                     forget an offline device
//
// The clients long-poll: behind some proxies (Cloudflare in front of the
// demo server, gzip / buffering ones) not a byte of an SSE stream came
// through, so devices never saw each other; a poll is an ordinary response
// that ends. A session is one client's run of polls (its own mailbox: a
// connection in the hub); `ack` = the cursor of the last answer it got, so
// an answer lost on the way is sent again. No poll for POLL_GONE_MS = gone.
//
// Server-Sent Events rather than a WebSocket: plain HTTP (fine through
// reverse proxies), and the compression
// middleware already leaves text/event-stream alone. The token rides the
// query string, as for media URLs (EventSource can't set headers).

import Joi from 'joi';
import { joiValidate } from '../util/validation.js';
import WebError from '../util/web-error.js';
import { createHub, COMMANDS, MAX_QUEUE } from '../state/devices.js';

// Shared with api/guest.js: guests control a device through it.
export const hub = createHub();
const HEARTBEAT_MS = 25000;
const POLL_WAIT_MS = 25000;
const POLL_GONE_MS = 45000;
const MAILBOX_MAX = 2000;
const mailboxes = new Map();   // user \0 id \0 session → mailbox

function userKey(req) {
  if (!req.user?.id || req.user.federation || req.user.guest) { throw new WebError('Forbidden', 403); }
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
    });
    res.flushHeaders?.();
    // Some proxies hold the first few KB of a response: get past that.
    res.write(`:${' '.repeat(2048)}\n\nretry: 3000\n\n`);

    const send = (event, data) => { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const close = hub.connect(user, { id: value.id, name: value.name, type: value.type }, send);
    const beat = setInterval(() => { res.write(': ping\n\n'); }, HEARTBEAT_MS);
    let done = false;
    const end = () => { if (done) { return; } done = true; clearInterval(beat); close(); };
    req.on('close', end);
    res.on('error', end);
  });

  mstream.get('/api/v1/devices/poll', (req, res) => {
    const user = userKey(req);
    const { value } = joiValidate(Joi.object({
      id: id.required(),
      name: Joi.string().max(80).allow(''),
      type: Joi.string().valid('web', 'android', 'desktop', 'other').default('other'),
      session: id.required(),
      ack: Joi.number().integer().min(0).default(0),
      token: Joi.any(),
    }), req.query);

    const key = `${user}\0${value.id}\0${value.session}`;
    let box = mailboxes.get(key);
    const fresh = !box;
    if (!box) {
      box = { base: 0, events: [], waiter: null, timer: null, close: null };
      mailboxes.set(key, box);
      box.close = hub.connect(user, { id: value.id, name: value.name, type: value.type }, (event, data) => {
        box.events.push({ event, data });
        if (box.events.length > MAILBOX_MAX) { box.events.shift(); box.base++; }
        // A burst (a report fans out to everyone) goes in one answer.
        if (box.waiter) { setTimeout(box.waiter, 30); }
      });
    }
    clearTimeout(box.timer);
    box.timer = null;
    // Delivered up to the cursor the client acknowledges (a new mailbox — the
    // old one expired — starts over: the client takes its cursor from the answer).
    const drop = fresh ? 0 : Math.min(Math.max(0, value.ack - box.base), box.events.length);
    box.events.splice(0, drop);
    box.base += drop;

    let done = false;
    let wait = null;
    const answer = () => {
      if (done) { return; }
      done = true;
      clearTimeout(wait);
      if (box.waiter === answer) { box.waiter = null; }
      clearTimeout(box.timer);
      box.timer = setTimeout(() => {
        if (mailboxes.get(key) !== box) { return; }
        mailboxes.delete(key);
        box.close();
      }, POLL_GONE_MS);
      if (!res.writableEnded) {
        res.set('Cache-Control', 'no-store');
        res.json({ cursor: box.base + box.events.length, events: box.events });
      }
    };
    if (box.events.length) { return answer(); }
    box.waiter?.();   // an older poll of this session still waiting: it answers empty
    box.waiter = answer;
    wait = setTimeout(answer, POLL_WAIT_MS);
    res.on('close', answer);
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
