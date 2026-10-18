// Editing a track's tags (title, artist, album, album artist, track, disc,
// year, genre) in the file itself.
//
//   POST /api/v1/tags/read   { filepath }        → { filepath, format, tags }
//   POST /api/v1/tags/write  { filepath, tags }  → { filepath, tags }
//
// `filepath` is the usual "<vpath>/<relative path>". In `tags` a key that is
// left out stays as it is, an empty string removes that tag. `track` and
// `disc` take "3" or "3/12".
//
// The write is ffmpeg remuxing the file with every stream copied as it is
// (the audio, an embedded cover) and every other tag kept, into a temp file
// beside it that then replaces the original — the file is never half
// written. The folder is rescanned at once, so the library shows the new
// tags; the scanner moves stars / ratings / plays to the file's new hash
// (path is identity, see db/hash-migration.js).
//
// Allowed where writing album art into files is: the server's noFileModify
// and the user's allow_file_modify; ffmpeg must be there. The client learns
// it from `tagEdit` in /api/v1/ping (and /api/'s user part).

import path from 'node:path';
import fsp from 'node:fs/promises';
import { spawn } from 'node:child_process';
import Joi from 'joi';
import winston from 'winston';
import { parseFile } from 'music-metadata';
import * as vpath from '../util/vpath.js';
import * as config from '../state/config.js';
import * as dbQueue from '../db/task-queue.js';
import { ffmpegBin } from '../util/ffmpeg-bootstrap.js';
import { isDownloaded as ffmpegIsDownloaded } from './transcode.js';
import { joiValidate } from '../util/validation.js';
import WebError from '../util/web-error.js';

// Containers whose tags ffmpeg writes back faithfully with a stream copy.
export const EDITABLE = new Set(['.mp3', '.flac', '.m4a', '.m4b', '.ogg', '.opus']);

// Our names → ffmpeg's generic metadata keys (each muxer maps them to its
// own: ID3 TPE2 / Vorbis ALBUMARTIST / MP4 aART for album_artist, …).
const KEYS = {
  title: 'title',
  artist: 'artist',
  album: 'album',
  albumArtist: 'album_artist',
  track: 'track',
  disc: 'disc',
  year: 'date',
  genre: 'genre',
};

const NUMBERED = /^(\d{1,4}(\/\d{1,4})?)?$/;

export function canEditTags(user) {
  return !config.program.noFileModify
    && user.allow_file_modify !== false
    && user.allow_file_modify !== 0
    && ffmpegIsDownloaded();
}

/**
 * The `-metadata` arguments for a tag change (unit-tested). Ogg's Vorbis
 * comments belong to the audio stream, not the container: there they go on
 * the stream (`-metadata:s:a:0`), else ffmpeg kept the old ones.
 */
export function metadataArgs(tags, ext = '') {
  const flag = ext === '.ogg' || ext === '.opus' ? '-metadata:s:a:0' : '-metadata';
  const args = [];
  for (const [name, key] of Object.entries(KEYS)) {
    if (!(name in tags) || tags[name] === undefined || tags[name] === null) { continue; }
    // One line each: a newline in a tag value is never what was meant.
    const value = String(tags[name]).replace(/[\r\n]+/g, ' ').trim();
    args.push(flag, `${key}=${value}`);
  }
  return args;
}

const numbered = (n, of) => (n ? (of ? `${n}/${of}` : String(n)) : '');

async function readTags(fullPath) {
  const meta = await parseFile(fullPath, { duration: false, skipCovers: true });
  const c = meta.common;
  return {
    title: c.title || '',
    artist: c.artist || '',
    album: c.album || '',
    albumArtist: c.albumartist || '',
    track: numbered(c.track?.no, c.track?.of),
    disc: numbered(c.disk?.no, c.disk?.of),
    year: c.year ? String(c.year) : '',
    genre: (c.genre || []).join('; '),
  };
}

async function writeTags(fullPath, tags) {
  const ffmpeg = ffmpegBin();
  if (!ffmpeg) { throw new WebError('ffmpeg is not available', 503); }
  const ext = path.extname(fullPath).toLowerCase();
  // The real extension on the temp output: ffmpeg picks the container by it.
  const tmpOut = `${fullPath}.tmp_tags${ext}`;
  const args = ['-y', '-v', 'error', '-i', fullPath,
    // Every stream (audio + an attached cover) as it is, every tag kept,
    // then ours on top.
    '-map', '0', '-c', 'copy', '-map_metadata', '0',
    ...(ext === '.mp3' ? ['-id3v2_version', '3', '-write_id3v1', '0'] : []),
    ...metadataArgs(tags, ext),
    tmpOut];
  try {
    await new Promise((resolve, reject) => {
      let err = '';
      const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      proc.stderr.on('data', (b) => { if (err.length < 2000) { err += b; } });
      proc.on('error', () => reject(new Error('ffmpeg could not start')));
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited with ${code}`))));
    });
    await fsp.rename(tmpOut, fullPath);
  } finally {
    await fsp.unlink(tmpOut).catch(() => {}); // gone already after the rename
  }
}

export function setup(mstream) {
  const fileOf = (filepath, user) => {
    const info = vpath.getVPathInfo(filepath, user);
    if (!EDITABLE.has(path.extname(info.fullPath).toLowerCase())) {
      throw new WebError('Tags of this file type can\'t be edited', 415);
    }
    return info;
  };

  mstream.post('/api/v1/tags/read', async (req, res) => {
    joiValidate(Joi.object({ filepath: Joi.string().required() }), req.body);
    const info = fileOf(req.body.filepath, req.user);
    let tags;
    try {
      tags = await readTags(info.fullPath);
    } catch (e) {
      if (e.code === 'ENOENT') { throw new WebError('File not found', 404); }
      throw new WebError(`Can't read the tags: ${e.message}`, 422);
    }
    res.json({ filepath: req.body.filepath, format: path.extname(info.fullPath).slice(1).toLowerCase(), editable: canEditTags(req.user), tags });
  });

  mstream.post('/api/v1/tags/write', async (req, res) => {
    const text = Joi.string().allow('').max(1000);
    joiValidate(Joi.object({
      filepath: Joi.string().required(),
      tags: Joi.object({
        title: text, artist: text, album: text, albumArtist: text, genre: text,
        track: Joi.string().allow('').pattern(NUMBERED),
        disc: Joi.string().allow('').pattern(NUMBERED),
        year: Joi.string().allow('').pattern(/^(\d{4})?$/),
      }).min(1).required(),
    }), req.body);
    if (!canEditTags(req.user)) { throw new WebError('Editing tags is not allowed', 403); }
    const info = fileOf(req.body.filepath, req.user);
    try {
      await fsp.access(info.fullPath);
    } catch {
      throw new WebError('File not found', 404);
    }
    try {
      await writeTags(info.fullPath, req.body.tags);
    } catch (e) {
      if (e instanceof WebError) { throw e; }
      winston.warn(`Tag edit failed for ${req.body.filepath}: ${e.message}`);
      throw new WebError(`Couldn't write the tags: ${e.message}`, 500);
    }
    winston.info(`Tags edited by ${req.user.username}: ${req.body.filepath}`);
    // Into the library at once (as an upload): the folder the file is in.
    const dir = path.dirname(info.relativePath);
    dbQueue.scanSubtree(info.vpath, dir === '.' ? '' : dir);
    res.json({ filepath: req.body.filepath, tags: await readTags(info.fullPath) });
  });
}
