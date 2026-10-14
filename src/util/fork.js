// This server is the Zenelo fork of mStream (github.com/ewoxej/mStream): the
// web UI restyled after the Zenelo Android app, plus playback devices. Its
// own version is the VERSION file at the repo root, released as
// `zenelo-v<version>` tags and the ghcr.io/ewoxej/mstream-zenelo image;
// package.json keeps upstream's version (the mStream it is based on).
import fs from 'fs';
import path from 'path';
import { appRoot } from './esm-helpers.js';
import { VERSION_RE } from './update-shared.js';
import packageJson from '../../package.json' with { type: 'json' };

function readVersion() {
  try {
    const v = fs.readFileSync(path.join(appRoot, 'VERSION'), 'utf8').trim();
    return VERSION_RE.test(v) ? v : null;
  } catch (_) { return null; }
}

export const FORK = Object.freeze({
  name: 'zenelo',
  version: readVersion(),
  upstream: packageJson.version,
  repo: 'ewoxej/mStream',
  image: 'ghcr.io/ewoxej/mstream-zenelo',
  tag: /^zenelo-v(\d+\.\d+\.\d+)$/,
});
