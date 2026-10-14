// Sign-in through an OpenID Connect provider (Authelia, Keycloak, …) — the
// Zenelo fork. This server is the relying party: authorization code flow
// with PKCE and a client secret, the ID token verified against the
// provider's keys, the profile and groups read from the ID token and the
// userinfo endpoint (Authelia puts them in the latter).
//
//   GET  /api/v1/auth/oidc            what the login screens offer: { mode, label }
//   GET  /api/v1/auth/oidc/start      → the provider's sign-in page
//          ?app=<redirect>&state=…    for an app: a registered custom-scheme
//                                      redirect (oidc.appRedirects) and its state
//   GET  /api/v1/auth/oidc/callback   the provider comes back here; the web
//                                      player gets its token in the page, an
//                                      app a one-time code on its redirect
//   POST /api/v1/auth/oidc/exchange   { code } → { token, vpaths, username }
//
// Accounts are never created: the username claim must name an existing
// user. With oidc.userGroup only its members get in; with oidc.adminGroup
// the group decides is_admin at every sign-in (never removing the last
// admin). Tokens from here carry `oidc: true` — in required mode the wall
// accepts no other user token (src/api/auth.js), so password sessions end.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import winston from 'winston';
import * as config from '../state/config.js';
import * as db from '../db/manager.js';
import { joiValidate } from '../util/validation.js';

const FLOW_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
const CACHE_MS = 60 * 60 * 1000;
const MAX_PENDING = 1000;
const ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'];

export const settings = () => config.program.oidc || {};
export const isConfigured = () => { const c = settings(); return !!(c.issuer && c.clientId && c.clientSecret); };
// 'off' | 'optional' | 'required' — off while it isn't set up, whatever the switch says.
export const mode = () => (isConfigured() ? (settings().mode || 'off') : 'off');
export const passwordAllowed = () => mode() !== 'required';
export const label = () => 'SSO';
// Send /login straight to the provider (not while it's off).
export const autoRedirect = () => mode() !== 'off' && settings().autoRedirect === true;
// May this decoded session token be used? In required mode only one from here.
export const sessionAllowed = (decoded) => mode() !== 'required' || decoded?.oidc === true;

// ── Pure halves (test/unit/oidc.test.mjs) ───────────────────────────────

const trimSlash = (s) => String(s || '').replace(/\/+$/, '');

// The base URL the provider sends the browser back to.
export function publicBase(req, publicUrl) {
  if (publicUrl) { return trimSlash(publicUrl); }
  return `${req.protocol}://${req.get('host')}`;
}
export const callbackUrl = (req) => `${publicBase(req, settings().publicUrl)}/api/v1/auth/oidc/callback`;

// May a sign-in hand an app back to `uri`? Only to a registered redirect
// with a custom scheme (never http(s): that would post the code to a site).
export function appRedirectAllowed(uri, allowed) {
  if (typeof uri !== 'string' || !uri) { return false; }
  let u;
  try { u = new URL(uri); } catch (_) { return false; }
  if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'javascript:' || u.protocol === 'data:') { return false; }
  const bare = `${u.protocol}//${u.host}${u.pathname}`;
  return (allowed || []).includes(bare);
}

// What the claims mean for this server: who signs in, and their admin flag
// (null = leave it). `findUser(username)` → the users row or null.
export function decideLogin(claims, s, findUser) {
  const name = claims?.[s.usernameClaim || 'preferred_username'];
  if (typeof name !== 'string' || !name.trim()) { return { ok: false, reason: 'no-username' }; }
  const raw = claims[s.groupsClaim || 'groups'];
  const groups = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[,\s]+/).filter(Boolean) : [];
  if (s.userGroup && !groups.includes(s.userGroup)) { return { ok: false, reason: 'not-in-group', username: name }; }
  const user = findUser(name.trim());
  if (!user) { return { ok: false, reason: 'no-account', username: name }; }
  return { ok: true, user, username: user.username, admin: s.adminGroup ? groups.includes(s.adminGroup) : null, groups };
}

const REASONS = {
  'no-username': 'The provider did not say who you are (no username claim). Check the scopes and the username claim in the admin panel.',
  'not-in-group': 'Your account is not allowed to use this server.',
  'no-account': 'There is no mStream account with your username. Ask the admin to create one.',
  'state': 'This sign-in expired or was already used. Start it again.',
  'provider': 'The sign-in provider refused or did not answer.',
  'off': 'Sign-in with the provider is turned off on this server.',
};

// ── The provider ────────────────────────────────────────────────────────

let cache = { issuer: null, doc: null, at: 0, jwks: null, jwksAt: 0 };

async function getJson(url, opts) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const why = body && (body.error_description || body.error) ? `: ${body.error_description || body.error}` : '';
    throw new Error(`${url} answered ${res.status}${why}`);
  }
  return body;
}

export async function discover(force = false) {
  const issuer = trimSlash(settings().issuer);
  if (!force && cache.issuer === issuer && Date.now() - cache.at < CACHE_MS) { return cache.doc; }
  const doc = await getJson(`${issuer}/.well-known/openid-configuration`);
  if (trimSlash(doc.issuer) !== issuer) { throw new Error(`the provider calls itself ${doc.issuer}, not ${issuer}`); }
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
    if (!doc[k]) { throw new Error(`the provider's configuration has no ${k}`); }
  }
  cache = { issuer, doc, at: Date.now(), jwks: null, jwksAt: 0 };
  return doc;
}

async function keyFor(kid) {
  const doc = await discover();
  const find = () => (cache.jwks?.keys || []).find((k) => (kid ? k.kid === kid : k.use !== 'enc'));
  let jwk = Date.now() - cache.jwksAt < CACHE_MS ? find() : null;
  if (!jwk) {   // rotated keys: fetch again once
    cache.jwks = await getJson(doc.jwks_uri);
    cache.jwksAt = Date.now();
    jwk = find();
  }
  if (!jwk) { throw new Error(`no signing key ${kid || ''} at the provider`); }
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

async function verifyIdToken(idToken, nonce) {
  const head = jwt.decode(idToken, { complete: true })?.header;
  if (!head) { throw new Error('the ID token is not a JWT'); }
  const key = await keyFor(head.kid);
  const doc = await discover();
  const claims = jwt.verify(idToken, key, { algorithms: ALGORITHMS, issuer: doc.issuer, audience: settings().clientId });
  if (claims.nonce !== nonce) { throw new Error('the ID token is for another sign-in (nonce)'); }
  return claims;
}

async function exchangeCode(code, verifier, redirectUri) {
  const s = settings();
  const doc = await discover();
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  if (s.tokenAuthMethod === 'client_secret_post') {
    form.set('client_id', s.clientId);
    form.set('client_secret', s.clientSecret);
  } else {
    const enc = (v) => encodeURIComponent(v);
    headers.Authorization = 'Basic ' + Buffer.from(`${enc(s.clientId)}:${enc(s.clientSecret)}`).toString('base64');
  }
  return getJson(doc.token_endpoint, { method: 'POST', headers, body: form.toString() });
}

// ── Sign-ins in flight, and the codes apps trade for a token ────────────

const flows = new Map();   // state → { verifier, nonce, app, appState, redirectUri, at }
const codes = new Map();   // code → { token, username, vpaths, at }

function sweep(map, ttl) {
  const now = Date.now();
  for (const [k, v] of map) { if (now - v.at > ttl) { map.delete(k); } }
  while (map.size > MAX_PENDING) { map.delete(map.keys().next().value); }
}
const random = (n = 32) => crypto.randomBytes(n).toString('base64url');

export function signToken(username) {
  return jwt.sign({ username, oidc: true }, config.program.secret);
}

function vpathsOf(user) {
  const ids = db.getUserLibraryIds(user);
  return db.getAllLibraries().filter((l) => ids.includes(l.id)).map((l) => l.name);
}

// The group's word on is_admin, never leaving the server without an admin.
function applyAdmin(user, admin) {
  if (admin === null || (user.is_admin === 1) === admin) { return; }
  const d = db.getDB();
  if (!admin) {
    const others = d.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND id != ? AND is_anonymous_sentinel = 0').get(user.id).n;
    if (others === 0) {
      winston.warn(`[oidc] ${user.username} is not in the admin group but is the only admin: left an admin`);
      return;
    }
  }
  d.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(admin ? 1 : 0, user.id);
  db.invalidateCache();   // users are cached in memory
  winston.info(`[oidc] ${user.username} ${admin ? 'is now an admin (in the admin group)' : 'is no longer an admin (not in the admin group)'}`);
}

// ── Pages ───────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0d0e0b;color:#f4f4ee;font-family:'IBM Plex Sans',-apple-system,'Segoe UI',sans-serif}
.box{max-width:420px;padding:28px;border-radius:16px;background:#181a15;box-shadow:inset 0 0 0 1px #2a2d24}h1{font-size:18px;margin:0 0 10px}p{color:#aeb0a0;line-height:1.5;font-size:14px}a{color:#d4a24c}</style></head>
<body><div class="box">${body}</div></body></html>`;

function failPage(res, reason, detail) {
  res.status(reason === 'off' ? 404 : 403).type('html').send(page('Sign-in failed',
    `<h1>Sign-in failed</h1><p>${esc(REASONS[reason] || reason)}</p>${detail ? `<p><small>${esc(detail)}</small></p>` : ''}<p><a href="/login/?local">Back to the login page</a></p>`));
}

// ── Routes (before the auth wall) ───────────────────────────────────────

export function setupBeforeAuth(mstream) {
  mstream.get('/api/v1/auth/oidc', (req, res) => {
    res.json({ mode: mode(), label: label(), password: passwordAllowed(), autoRedirect: autoRedirect() });
  });

  mstream.get('/api/v1/auth/oidc/start', async (req, res) => {
    if (mode() === 'off') { return failPage(res, 'off'); }
    const app = typeof req.query.app === 'string' ? req.query.app : null;
    if (app && !appRedirectAllowed(app, settings().appRedirects)) {
      return res.status(400).type('html').send(page('Sign-in failed', '<h1>Sign-in failed</h1><p>That app is not allowed to sign in here.</p>'));
    }
    let doc;
    try { doc = await discover(); } catch (err) {
      winston.warn(`[oidc] provider discovery failed: ${err.message}`);
      return failPage(res, 'provider', err.message);
    }
    sweep(flows, FLOW_TTL_MS);
    const state = random();
    const verifier = random(48);
    const nonce = random();
    const redirectUri = callbackUrl(req);
    flows.set(state, { verifier, nonce, app, appState: typeof req.query.state === 'string' ? req.query.state.slice(0, 200) : '', redirectUri, at: Date.now() });
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: settings().clientId, redirect_uri: redirectUri,
      scope: settings().scopes || 'openid profile email groups', state, nonce,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    }).toString();
    res.redirect(302, url.toString());
  });

  mstream.get('/api/v1/auth/oidc/callback', async (req, res) => {
    const flow = flows.get(String(req.query.state || ''));
    flows.delete(String(req.query.state || ''));
    const back = (reason, detail) => {
      if (flow?.app) {
        const u = new URL(flow.app);
        u.searchParams.set('error', reason);
        if (flow.appState) { u.searchParams.set('state', flow.appState); }
        return res.redirect(302, u.toString());
      }
      return failPage(res, reason, detail);
    };
    if (!flow || Date.now() - flow.at > FLOW_TTL_MS) { return back('state'); }
    if (mode() === 'off') { return back('off'); }
    if (req.query.error) { return back('provider', String(req.query.error_description || req.query.error)); }

    let claims;
    try {
      const tokens = await exchangeCode(String(req.query.code || ''), flow.verifier, flow.redirectUri);
      claims = await verifyIdToken(tokens.id_token, flow.nonce);
      const doc = await discover();
      if (tokens.access_token && doc.userinfo_endpoint) {
        const info = await getJson(doc.userinfo_endpoint, { headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' } });
        if (info && info.sub === claims.sub) { claims = { ...claims, ...info }; }
      }
    } catch (err) {
      winston.warn(`[oidc] sign-in failed: ${err.message}`);
      return back('provider', err.message);
    }

    const d = decideLogin(claims, settings(), (name) => db.getUserByUsername(name));
    if (!d.ok) {
      winston.warn(`[oidc] refused ${d.username || claims.sub}: ${d.reason}`);
      return back(d.reason);
    }
    applyAdmin(d.user, d.admin);
    const token = signToken(d.username);
    winston.info(`[oidc] ${d.username} signed in${flow.app ? ' (app)' : ''}`);

    if (flow.app) {
      sweep(codes, CODE_TTL_MS);
      const code = random();
      codes.set(code, { token, username: d.username, vpaths: vpathsOf(d.user), at: Date.now() });
      const u = new URL(flow.app);
      u.searchParams.set('code', code);
      if (flow.appState) { u.searchParams.set('state', flow.appState); }
      return res.redirect(302, u.toString());
    }
    // The web player keeps its token in localStorage: hand it over in the
    // page, not in a URL, and go home.
    res.cookie('x-access-token', token, { maxAge: 157784630000, sameSite: 'Lax' });
    res.set('Cache-Control', 'no-store');
    res.type('html').send(page('Signed in', `<h1>Signed in</h1><p>Opening mStream…</p>
<script>try{localStorage.setItem('token',${JSON.stringify(token).replace(/</g, '\\u003c')})}catch(e){}location.replace('/');</script>`));
  });

  mstream.post('/api/v1/auth/oidc/exchange', (req, res) => {
    joiValidate(Joi.object({ code: Joi.string().max(200).required() }), req.body);
    sweep(codes, CODE_TTL_MS);
    const got = codes.get(req.body.code);
    codes.delete(req.body.code);
    if (!got) { return res.status(400).json({ error: 'This sign-in code is unknown or expired' }); }
    res.json({ token: got.token, username: got.username, vpaths: got.vpaths });
  });
}

// For the admin panel: is the provider reachable and does it look right?
export async function check() {
  try {
    const doc = await discover(true);
    return { ok: true, issuer: doc.issuer, scopes: doc.scopes_supported || null, pkce: doc.code_challenge_methods_supported || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
