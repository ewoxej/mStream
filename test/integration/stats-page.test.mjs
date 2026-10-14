/**
 * /stats: the old standalone listening page is gone — its address sends
 * bookmarks to the player's Stats screen (/#/stats), which reads the same
 * Stats API and charts with stats/stats-view.js. The player keeps its gate
 * (public mode open; with users, a session cookie or /login), and a plain
 * account may read its own listening.
 */

import { describe, before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref(); srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
async function waitForReady(baseUrl, timeoutMs = 90_000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${baseUrl}/api/`); if (r.status < 500) return; } catch (err) { lastErr = err; }
    await sleep(150);
  }
  throw new Error(`server not ready: ${lastErr?.message || 'unknown'}`, { cause: lastErr });
}
async function boot(tmpDir, musicDir) {
  const port = await findFreePort();
  const config = {
    port, address: '127.0.0.1', dlna: { mode: 'disabled' },
    folders: { testlib: { root: musicDir } },
    storage: { albumArtDirectory: path.join(tmpDir, 'image-cache'), dbDirectory: path.join(tmpDir, 'db'), logsDirectory: path.join(tmpDir, 'logs') },
    scanOptions: { bootScanDelay: 9999, scanInterval: 0, autoAlbumArt: false },
  };
  for (const dir of Object.values(config.storage)) await fs.mkdir(dir, { recursive: true });
  const configPath = path.join(tmpDir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(config));
  const proc = spawn(process.execPath, ['cli-boot-wrapper.js', '-j', configPath],
    { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test' } });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  const baseUrl = `http://127.0.0.1:${port}`;
  try { await waitForReady(baseUrl); } catch (err) { try { proc.kill('SIGKILL'); } catch { /* gone */ } throw err; }
  return { proc, baseUrl };
}
async function kill(proc) { if (proc.exitCode == null) { proc.kill('SIGKILL'); await new Promise((r) => proc.once('exit', r)); } }

const get = (url, headers = {}) => fetch(url, { headers, redirect: 'manual' });

describe('GET /stats', () => {
  let tmpDir, server;
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mstream-stats-page-'));
    const musicDir = path.join(tmpDir, 'music'); await fs.mkdir(musicDir, { recursive: true });
    server = await boot(tmpDir, musicDir);
  });
  after(async () => {
    if (server?.proc) await kill(server.proc);
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test('public mode: the old page sends you to the player\'s Stats screen', async () => {
    for (const p of ['/stats', '/stats/', '/stats/index.html']) {
      const r = await get(`${server.baseUrl}${p}`);
      assert.equal(r.status, 301, p);
      assert.equal(r.headers.get('location'), '/#/stats', p);
    }
    assert.equal((await fetch(`${server.baseUrl}/stats/stats-view.js`)).status, 200, 'the charts the player uses');
    const player = await (await fetch(`${server.baseUrl}/`)).text();
    assert.ok(player.includes('stats/stats-view.js'), 'the player loads them');
    const ping = await (await fetch(`${server.baseUrl}/api/v1/ping`)).json();
    assert.equal(ping.stats, 2, 'the flag the Stats screen follows');
  });

  test('with users: the player wants a session; a plain account reads its own listening', async () => {
    const mk = await fetch(`${server.baseUrl}/api/v1/admin/users`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ann', password: 'ann-pw', vpaths: ['testlib'], admin: false }),
    });
    assert.equal(mk.status, 200, await mk.text());
    const anon = await get(`${server.baseUrl}/`);
    assert.equal(anon.status, 302);
    assert.equal(anon.headers.get('location'), '/login');
    const login = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ann', password: 'ann-pw' }),
    });
    const { token } = await login.json();
    assert.ok(token);
    const ok = await get(`${server.baseUrl}/`, { cookie: `x-access-token=${token}` });
    assert.equal(ok.status, 200);
    const summary = await fetch(`${server.baseUrl}/api/v1/stats/summary?period=all`, { headers: { 'x-access-token': token } });
    assert.equal(summary.status, 200, 'a plain account may see its own listening — no admin role needed');
  });
});
