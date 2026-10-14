/**
 * src/api/oidc.js — the pure halves of the OIDC sign-in: who the claims
 * sign in (existing users only, the access group, the admin group), where
 * an app may be handed back, and the callback base URL.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideLogin, appRedirectAllowed, publicBase } from '../../src/api/oidc.js';

const users = { ann: { id: 1, username: 'ann', is_admin: 0 }, bob: { id: 2, username: 'bob', is_admin: 1 } };
const find = (n) => users[n] || null;
const base = { usernameClaim: 'preferred_username', groupsClaim: 'groups', userGroup: '', adminGroup: '' };

test('an existing user signs in by the username claim; nobody else does', () => {
  assert.deepEqual(decideLogin({ preferred_username: 'ann' }, base, find), { ok: true, user: users.ann, username: 'ann', admin: null, groups: [] });
  assert.deepEqual(decideLogin({ preferred_username: 'eve' }, base, find), { ok: false, reason: 'no-account', username: 'eve' });
  assert.equal(decideLogin({ sub: 'x' }, base, find).reason, 'no-username');
  assert.equal(decideLogin({ email: 'ann' }, { ...base, usernameClaim: 'email' }, find).username, 'ann', 'the claim is configurable');
});

test('the access group keeps others out; the admin group decides is_admin', () => {
  const s = { ...base, userGroup: 'mstream', adminGroup: 'mstream-admins' };
  assert.equal(decideLogin({ preferred_username: 'ann', groups: ['family'] }, s, find).reason, 'not-in-group');
  assert.equal(decideLogin({ preferred_username: 'ann', groups: ['mstream'] }, s, find).admin, false);
  assert.equal(decideLogin({ preferred_username: 'bob', groups: ['mstream', 'mstream-admins'] }, s, find).admin, true);
  assert.equal(decideLogin({ preferred_username: 'bob', groups: 'mstream mstream-admins' }, s, find).admin, true, 'a space-separated string counts');
  assert.equal(decideLogin({ preferred_username: 'eve', groups: ['family'] }, s, find).reason, 'not-in-group', 'the group is checked first: no hint whether the account exists');
});

test('apps are handed back only to a registered custom-scheme redirect', () => {
  const allowed = ['zenelo://oidc'];
  assert.equal(appRedirectAllowed('zenelo://oidc', allowed), true);
  assert.equal(appRedirectAllowed('zenelo://oidc?x=1', allowed), true, 'a query is the app\'s business');
  assert.equal(appRedirectAllowed('zenelo://evil', allowed), false);
  assert.equal(appRedirectAllowed('https://evil.example/oidc', ['https://evil.example/oidc']), false, 'never http(s)');
  assert.equal(appRedirectAllowed('javascript:alert(1)', ['javascript:alert(1)']), false);
  assert.equal(appRedirectAllowed('', allowed), false);
});

test('the callback base: the configured public URL, else the request', () => {
  const req = { protocol: 'https', get: () => 'music.example' };
  assert.equal(publicBase(req, ''), 'https://music.example');
  assert.equal(publicBase(req, 'https://mstream.example.org/'), 'https://mstream.example.org');
});
