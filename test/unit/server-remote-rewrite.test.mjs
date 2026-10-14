/**
 * /server-remote serves the web player (webapp/index.html) with the browser engine swapped for
 * the server-audio client (src/api/server-playback.js
 * rewriteIndexForServerAudio).
 *
 * Every step of that rewrite is an exact-string or regex match against the
 * committed index.html, and a miss is silent: the page still renders, just
 * with the wrong player or a stray script. Three replacements had been
 * no-ops for months after the visualizer scripts left the old index.html. This pins
 * the rewrite to the REAL index.html so markup drift fails here instead of
 * on somebody's remote.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rewriteIndexForServerAudio } from '../../src/api/server-playback.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(here, '..', '..', 'webapp', 'index.html'), 'utf8');

describe('rewriteIndexForServerAudio', () => {
  const out = rewriteIndexForServerAudio(indexHtml);

  test('swaps the browser player for the server-audio client, flag first', () => {
    assert.ok(indexHtml.includes('assets/js/mstream.player.js'), 'index.html must load the browser player');
    assert.ok(!out.includes('assets/js/mstream.player.js'), 'the browser player must be gone');
    const flag = out.indexOf('var serverAudioMode = true');
    const client = out.indexOf('assets/js/mstream.server-audio.js');
    const app = out.indexOf('app/main.js');
    assert.ok(flag > 0, 'serverAudioMode must be set');
    assert.ok(client > flag, 'the client script must load after the flag is set');
    assert.ok(app > client, 'the app must start after the engine is defined');
  });

  test('drops the visualizer, which needs the browser engine', () => {
    assert.ok(indexHtml.includes('<script src="app/viz.js"></script>'), 'index.html must load app/viz.js');
    assert.ok(!out.includes('<script src="app/viz.js"></script>'), 'app/viz.js must be stripped');
  });

  test('names the page and leaves everything else alone', () => {
    assert.ok(out.includes('<title>mStream · Server audio</title>'));
    for (const src of ['app/shims.js', 'assets/js/mstream.api.js', 'assets/js/auto-dj.js', 'app/main.js']) {
      assert.ok(out.includes(src), `${src} must survive the rewrite`);
    }
    assert.equal(rewriteIndexForServerAudio('<html></html>'), '<html></html>', 'no anchors, no change');
    assert.equal(rewriteIndexForServerAudio(indexHtml), out, 'pure function of its input');
  });
});
