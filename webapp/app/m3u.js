// M3U / M3U8 playlists: reading one into library tracks and writing tracks
// out as one. Pure (no DOM, no imports), unit-tested on node
// (test/unit/webapp-m3u.test.mjs); the buttons are in screens/playlists.js
// and the Favorites page.
//
// Entries are whatever the file was written with: this server's library
// paths ("music/Artist/Album/01.flac"), stream URLs (".../media/music/…"),
// absolute paths from another machine ("D:\Music\Artist\…", "/storage/…"),
// paths relative to the playlist ("../Artist/01.flac"). Each is matched
// against the library: the exact library path, else the longest unique tail
// of its folders and file name, else the #EXTINF "Artist - Title".

// Text → [{ path, artist, title, duration }] in file order.
export function parseM3u(text) {
  const out = [];
  let info = null;
  for (const raw of String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { continue; }
    if (line.startsWith('#')) {
      const m = /^#EXTINF:\s*(-?\d+(?:\.\d+)?)?[^,]*,(.*)$/i.exec(line);
      if (m) {
        const label = m[2].trim();
        const dash = label.indexOf(' - ');
        info = {
          duration: m[1] && Number(m[1]) > 0 ? Number(m[1]) : null,
          artist: dash > 0 ? label.slice(0, dash).trim() : '',
          title: dash > 0 ? label.slice(dash + 3).trim() : label,
        };
      }
      continue;
    }
    out.push({ path: line, artist: info?.artist || '', title: info?.title || '', duration: info?.duration ?? null });
    info = null;
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFC');

// An entry's path as library-style segments: URLs cut down to what follows
// /media/ (or /transcode/), decoded; backslashes, drive letters, ./ and ../
// dropped.
export function entrySegments(path) {
  let p = String(path || '').trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    try {
      const u = new URL(p);
      p = u.pathname;
      const at = p.search(/\/(media|transcode)\//);
      if (at >= 0) { p = p.slice(at).replace(/^\/(media|transcode)\//, ''); }
    } catch (_) { /* not a URL after all */ }
  } else if (/^file:/i.test(p)) {
    p = p.replace(/^file:\/*/i, '/');
  }
  try { p = decodeURIComponent(p); } catch (_) { /* a literal % */ }
  return p.replace(/\\/g, '/').replace(/^[a-z]:/i, '').split('/')
    .filter((s) => s && s !== '.' && s !== '..');
}

// Match entries to library tracks ({ filepath: "vpath/rel", metadata }).
// → { tracks: matched library tracks in file order (duplicates kept),
//     missing: the entries nothing matched }
export function resolveM3u(entries, library) {
  const byPath = new Map();
  const byTail = new Map();   // "k|tail" → [track]; k = 1..MAX segments
  const byLabel = new Map();  // "artist|title" → [track]
  const MAX = 4;
  for (const t of library || []) {
    const segs = String(t.filepath || '').split('/').filter(Boolean);
    if (!segs.length) { continue; }
    byPath.set(norm(segs.join('/')), t);
    for (let k = 1; k <= Math.min(MAX, segs.length); k++) {
      const key = k + '|' + norm(segs.slice(-k).join('/'));
      const list = byTail.get(key);
      if (list) { list.push(t); } else { byTail.set(key, [t]); }
    }
    const md = t.metadata || {};
    if (md.title) {
      const key = norm(md.artist || '') + '|' + norm(md.title);
      const list = byLabel.get(key);
      if (list) { list.push(t); } else { byLabel.set(key, [t]); }
    }
  }
  const tracks = [];
  const missing = [];
  for (const e of entries || []) {
    const segs = entrySegments(e.path);
    let hit = segs.length ? byPath.get(norm(segs.join('/'))) : null;
    // The longest tail that names one track; a file name shared by several
    // tracks (01.flac) needs its folders to decide.
    for (let k = Math.min(MAX, segs.length); !hit && k >= 1; k--) {
      const list = byTail.get(k + '|' + norm(segs.slice(-k).join('/')));
      if (list && list.length === 1) { hit = list[0]; }
    }
    if (!hit && e.title) {
      const list = byLabel.get(norm(e.artist) + '|' + norm(e.title));
      if (list && list.length) { hit = list[0]; }
    }
    if (hit) { tracks.push(hit); } else { missing.push(e); }
  }
  return { tracks, missing };
}

// Tracks → M3U8 text: #EXTINF with the length and "Artist - Title", then the
// library path ("vpath/rel"), which this server and the Zenelo app read back.
export function toM3u(tracks) {
  const lines = ['#EXTM3U'];
  for (const t of tracks || []) {
    const md = t.metadata || {};
    const fp = String(t.filepath || '').replace(/^\/+/, '');
    if (!fp) { continue; }
    const title = md.title || fp.split('/').pop();
    const label = md.artist ? `${md.artist} - ${title}` : title;
    lines.push(`#EXTINF:${Math.round(Number(md.duration) || -1)},${label.replace(/[\r\n]+/g, ' ')}`);
    lines.push(fp);
  }
  return lines.join('\n') + '\n';
}
