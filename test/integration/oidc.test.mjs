/**
 * OIDC sign-in (src/api/oidc.js) end to end against a fake provider on
 * loopback: discovery, the authorization redirect with PKCE, the code
 * exchange with client_secret_basic, an RS256 ID token checked against the
 * JWKS, userinfo for the username and groups (as Authelia serves them).
 * Covered: the web sign-in, the app's one-time code, the access and admin
 * groups, users that don't exist, and required mode (no password sign-in,
 * password sessions refused, switched on only from an OIDC session).
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { startServer } from '../helpers/server.mjs';

const CLIENT = { id: 'mstream', secret: 's3cret-value' };
const ADMIN = { username: 'admin', password: 'pw-admin-1' };
const ANN = { username: 'ann', password: 'pw-ann-1' };

// ── The fake provider ────────────────────────────────────────────────────
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
let provider;
let issuer;
let who = { preferred_username: 'ann', groups: ['mstream'] };   // the next sign-in's user
const grants = new Map();   // code → { challenge, nonce, redirect }
const b64u = (b) => Buffer.from(b).toString('base64url');
function signIdToken(claims) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' }));
  const body = b64u(JSON.stringify(claims));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

function startProvider() {
  return new Promise((resolve) => {
    provider = http.createServer(async (req, res) => {
      const u = new URL(req.url, issuer);
      const json = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (u.pathname === '/.well-known/openid-configuration') {
        return json(200, {
          issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`, userinfo_endpoint: `${issuer}/userinfo`, code_challenge_methods_supported: ['S256'],
        });
      }
      if (u.pathname === '/jwks') { return json(200, { keys: [jwk] }); }
      if (u.pathname === '/authorize') {
        // Signs `who` in at once and sends the browser back.
        assert.equal(u.searchParams.get('client_id'), CLIENT.id);
        assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
        const code = crypto.randomBytes(8).toString('hex');
        grants.set(code, { challenge: u.searchParams.get('code_challenge'), nonce: u.searchParams.get('nonce'), redirect: u.searchParams.get('redirect_uri'), who });
        const back = new URL(u.searchParams.get('redirect_uri'));
        back.searchParams.set('code', code);
        back.searchParams.set('state', u.searchParams.get('state'));
        res.writeHead(302, { Location: back.toString() });
        return res.end();
      }
      if (u.pathname === '/token') {
        let body = '';
        for await (const c of req) { body += c; }
        const f = new URLSearchParams(body);
        const basic = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
        if (basic !== `${CLIENT.id}:${CLIENT.secret}`) { return json(401, { error: 'invalid_client' }); }
        const g = grants.get(f.get('code'));
        grants.delete(f.get('code'));
        if (!g || g.redirect !== f.get('redirect_uri')) { return json(400, { error: 'invalid_grant' }); }
        const challenge = crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url');
        if (challenge !== g.challenge) { return json(400, { error: 'invalid_grant', error_description: 'PKCE' }); }
        const now = Math.floor(Date.now() / 1000);
        // As Authelia: the ID token is about the sub; the profile comes from userinfo.
        return json(200, {
          access_token: `at-${g.who.preferred_username}`, token_type: 'Bearer',
          id_token: signIdToken({ iss: issuer, aud: CLIENT.id, sub: `sub-${g.who.preferred_username}`, nonce: g.nonce, iat: now, exp: now + 300 }),
        });
      }
      if (u.pathname === '/userinfo') {
        const name = String(req.headers.authorization || '').replace(/^Bearer at-/, '');
        return json(200, { sub: `sub-${name}`, ...(name === who.preferred_username ? who : { preferred_username: name }) });
      }
      res.writeHead(404); res.end();
    });
    provider.listen(0, '127.0.0.1', () => { issuer = `http://127.0.0.1:${provider.address().port}`; resolve(); });
  });
}

// ── The mStream side ─────────────────────────────────────────────────────
let server;
let adminJwt;
const api = (p, opts = {}) => fetch(`${server.baseUrl}${p}`, { redirect: 'manual', ...opts });
const postJson = (p, body, token) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-access-token': token } : {}) }, body: JSON.stringify(body) });

// Follow the redirects of a browser sign-in: mStream → provider → mStream.
async function signIn(query = '') {
  const start = await api(`/api/v1/auth/oidc/start${query}`);
  assert.equal(start.status, 302, await start.text());
  const atProvider = await fetch(start.headers.get('location'), { redirect: 'manual' });
  assert.equal(atProvider.status, 302);
  const res = await fetch(atProvider.headers.get('location'), { redirect: 'manual' });
  const to = res.headers.get('location');
  if (res.status === 302 && to && !/^https?:/.test(to)) { return { appRedirect: to }; }
  return res;
}
const tokenOf = async (res) => /setItem\('token',"([^"]+)"\)/.exec(await res.text())?.[1];

before(async () => {
  await startProvider();
  server = await startServer({ dlnaMode: 'disabled', users: [{ ...ADMIN, admin: true }, { ...ANN, admin: false }] });
  adminJwt = (await (await postJson('/api/v1/auth/login', ADMIN)).json()).token;
  const r = await postJson('/api/v1/admin/oidc', {
    issuer, clientId: CLIENT.id, clientSecret: CLIENT.secret, mode: 'optional', userGroup: 'mstream', adminGroup: 'mstream-admins',
  }, adminJwt);
  assert.equal(r.status, 200, await r.text());
});

after(async () => {
  if (server) { await server.stop(); }
  provider?.close();
});

describe('OIDC sign-in', () => {
  test('the login screens learn what is offered; the secret is never read back', async () => {
    assert.deepEqual(await (await api('/api/v1/auth/oidc')).json(), { mode: 'optional', label: 'SSO', password: true, autoRedirect: false });
    const s = await (await api('/api/v1/admin/oidc', { headers: { 'x-access-token': adminJwt } })).json();
    assert.equal(s.secretSet, true);
    assert.equal(s.clientSecret, undefined);
    assert.equal(s.redirectUri, `${server.baseUrl}/api/v1/auth/oidc/callback`);
    assert.equal(s.signedInWithOidc, false);
    assert.equal((await (await postJson('/api/v1/admin/oidc/check', {}, adminJwt)).json()).ok, true);
  });

  test('redirect to the provider: /login goes there; ?local keeps the form', async () => {
    assert.notEqual((await api('/login')).headers.get('location'), '/api/v1/auth/oidc/start', 'the form by default');
    assert.equal((await postJson('/api/v1/admin/oidc', { autoRedirect: true }, adminJwt)).status, 200);
    const r = await api('/login');
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/api/v1/auth/oidc/start');
    assert.equal((await api('/login/?local')).status, 200, 'the password form is still there');
    assert.equal((await (await api('/api/v1/auth/oidc')).json()).autoRedirect, true);
    await postJson('/api/v1/admin/oidc', { autoRedirect: false }, adminJwt);
  });

  test('web: an existing user in the group gets a session token', async () => {
    who = { preferred_username: 'ann', groups: ['mstream'] };
    const res = await signIn();
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie') || '', /x-access-token=/);
    const token = await tokenOf(res);
    assert.ok(token, 'the page hands the token to the player');
    const me = await api('/api/', { headers: { 'x-access-token': token } });
    assert.equal((await me.json()).user.username, 'ann');
  });

  test('refused: not in the group, no such account, a replayed state', async () => {
    who = { preferred_username: 'ann', groups: ['family'] };
    assert.equal((await signIn()).status, 403);
    who = { preferred_username: 'eve', groups: ['mstream'] };
    const res = await signIn();
    assert.equal(res.status, 403);
    assert.match(await res.text(), /no mStream account/);
    assert.equal((await api('/api/v1/auth/oidc/callback?state=nope&code=x')).status, 403);
  });

  test('the admin group makes and unmakes admins (never the last one)', async () => {
    who = { preferred_username: 'ann', groups: ['mstream', 'mstream-admins'] };
    const token = await tokenOf(await signIn());
    assert.equal((await (await api('/api/', { headers: { 'x-access-token': token } })).json()).user.admin, true);
    who = { preferred_username: 'ann', groups: ['mstream'] };
    const again = await tokenOf(await signIn());
    assert.equal((await (await api('/api/', { headers: { 'x-access-token': again } })).json()).user.admin, false);
    // admin is the only admin now: not in the group, still an admin.
    who = { preferred_username: 'admin', groups: ['mstream'] };
    const adm = await tokenOf(await signIn());
    assert.equal((await (await api('/api/', { headers: { 'x-access-token': adm } })).json()).user.admin, true);
  });

  test('app: a registered redirect gets a one-time code, traded once for a token', async () => {
    who = { preferred_username: 'ann', groups: ['mstream'] };
    assert.equal((await api('/api/v1/auth/oidc/start?app=https%3A%2F%2Fevil.example%2F')).status, 400);
    const { appRedirect } = await signIn('?app=zenelo%3A%2F%2Foidc&state=xyz');
    const u = new URL(appRedirect);
    assert.equal(`${u.protocol}//${u.host}`, 'zenelo://oidc');
    assert.equal(u.searchParams.get('state'), 'xyz');
    const first = await postJson('/api/v1/auth/oidc/exchange', { code: u.searchParams.get('code') });
    const got = await first.json();
    assert.equal(got.username, 'ann');
    assert.ok(got.token);
    assert.equal((await postJson('/api/v1/auth/oidc/exchange', { code: u.searchParams.get('code') })).status, 400, 'single use');
    who = { preferred_username: 'eve', groups: ['mstream'] };
    const refused = new URL((await signIn('?app=zenelo%3A%2F%2Foidc&state=s2')).appRedirect);
    assert.equal(refused.searchParams.get('error'), 'no-account');
  });

  test('required: only from an OIDC session; then no password sign-in and no password sessions', async () => {
    assert.equal((await postJson('/api/v1/admin/oidc', { mode: 'required' }, adminJwt)).status, 409);
    who = { preferred_username: 'admin', groups: ['mstream', 'mstream-admins'] };
    const oidcAdmin = await tokenOf(await signIn());
    assert.equal((await postJson('/api/v1/admin/oidc', { mode: 'required' }, oidcAdmin)).status, 200);

    assert.equal((await postJson('/api/v1/auth/login', ANN)).status, 403, 'password sign-in is off');
    assert.equal((await api('/api/', { headers: { 'x-access-token': adminJwt } })).status, 401, 'a password session is over');
    assert.equal((await api('/api/', { headers: { 'x-access-token': oidcAdmin } })).status, 200);
    const page = await api('/', { headers: { cookie: `x-access-token=${adminJwt}` } });
    assert.equal(page.headers.get('location'), '/login', 'the player sends a password session to the login page');
    const login = await api('/login', { headers: { cookie: `x-access-token=${adminJwt}` } });
    assert.notEqual(login.headers.get('location'), '..', '…which does not send it back: no loop');
    assert.equal((await api('/login/', { headers: { cookie: `x-access-token=${adminJwt}` } })).status, 200);

    assert.equal((await postJson('/api/v1/admin/oidc', { mode: 'optional' }, oidcAdmin)).status, 200);
    assert.equal((await postJson('/api/v1/auth/login', ANN)).status, 200);
  });
});
