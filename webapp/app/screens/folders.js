// Folders: the file browser over mStream's vpaths. As in the app: a home
// folder (prefs `homeFolder`; the sidebar and the Home button open it, the
// ⋮ menu sets it), a filter for the folder on screen that also searches its
// sub-folders through the server, and the sort menu (folders by name, files
// by the chosen field).
import { html, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { app, href, go, setPref, useStore } from '../store.js';
import * as lib from '../library.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import { useSort, sortBy, SortButton } from '../sort.js';
import { Btn, Icon, Header, Chip, Empty, Spinner, SearchField, useAsync, openMenu, trackMenuItems } from '../ui.js';
import { fmtBytes, formatLabel, server, trackTitle, trackArtist } from '../util.js';

const AUDIO = /\.(mp3|flac|wav|ogg|oga|aac|m4a|m4b|opus|alac|aiff?|wma|ape|wv|dsf|dff)$/i;
const IMAGE = /\.(jpe?g|png|gif|webp|bmp)$/i;

const asTracks = (list) => (list || []).map((x) => (typeof x === 'string' ? { filepath: x, metadata: {} } : { filepath: x.filepath, metadata: x.metadata || {} }));

// Server search for the filter, kept to this folder's sub-folders: matching
// folders (a path segment containing the words) and files. The server's
// file search answers a few dozen hits at most.
function useDeepSearch(parts, query) {
  const q = query.trim();
  const state = useAsync(() => (q.length >= 2 ? lib.searchFiles(q) : Promise.resolve(null)), [q]);
  return useMemo(() => {
    if (!state.data) { return { loading: state.loading && q.length >= 2, folders: [], tracks: [] }; }
    const prefix = parts.length ? parts.join('/') + '/' : '';
    const needle = q.toLowerCase();
    const folders = new Map();
    const tracks = [];
    state.data.forEach((f) => {
      const fp = String(f.filepath || '').replace(/^\/+/, '');
      if (!fp.startsWith(prefix)) { return; }
      const rel = fp.slice(prefix.length).split('/');
      // Folders below this one whose name matches.
      rel.slice(0, -1).forEach((seg, i) => {
        if (i > 0 && seg.toLowerCase().includes(needle)) {
          const path = [...parts, ...rel.slice(0, i + 1)];
          folders.set(path.join('/'), { path, within: rel.slice(0, i).join('/') });
        }
      });
      // Files not in this folder itself (those are filtered above).
      if (rel.length > 1) { tracks.push({ filepath: fp, metadata: f.metadata || {}, within: rel.slice(0, -1).join('/') }); }
    });
    // Top-level sub-folders show in the filtered list already.
    return { loading: false, folders: [...folders.values()], tracks };
  }, [state.data, parts.join('/'), q]);
}

export function Folders({ args }) {
  const vpaths = server().vpaths || [];
  const parts = args.length ? args : [];
  const path = parts.length ? '/' + parts.join('/') : '';
  const home = useStore(app, (s) => s.homeFolder);
  const isHome = parts.join('/') === home;
  const [rev, setRev] = useState(0);
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(q), 300); return () => clearTimeout(t); }, [q]);
  const sort = useSort('folders');
  const state = useAsync(() => lib.dir(path), [path, rev]);
  const currentPath = useStore(playback, (s) => s.currentPath);
  const rel = (name) => (parts.length ? parts.join('/') + '/' : '') + name;
  const allFiles = state.data?.files || [];
  const audio = allFiles.filter((f) => AUDIO.test(f.name));

  // FORMAT, SIZE and the sort fields come from the library's metadata.
  const meta = useAsync(() => (audio.length ? lib.metadataBatch(audio.map((f) => rel(f.name))) : Promise.resolve({})), [path, rev, state.data]);
  const metaOf = (f) => meta.data?.[rel(f.name)]?.metadata || {};

  const needle = q.trim().toLowerCase();
  const match = (name) => !needle || name.toLowerCase().includes(needle);
  const dirs = useMemo(() => {
    const d = (state.data?.directories || []).filter((x) => match(x.name));
    const byName = sortBy(d, { f: (x) => x.name }, sort.value.key === 'name' ? sort.value.dir : 'asc');
    return byName;
  }, [state.data, needle, sort.value.key, sort.value.dir]);
  // Files as track-like rows ({ name, filepath, metadata }) so the sort fields apply.
  const files = useMemo(() => {
    const rows = allFiles.filter((f) => match(f.name)).map((f) => ({ ...f, filepath: rel(f.name), metadata: metaOf(f), audio: AUDIO.test(f.name) }));
    return sortBy(rows, sort.field, sort.value.dir);
  }, [state.data, meta.data, needle, sort.value.key, sort.value.dir]);
  const tracks = files.filter((f) => f.audio).map((f) => ({ filepath: f.filepath, metadata: f.metadata }));
  const deep = useDeepSearch(parts, query);

  const upload = useRef();

  const playFolder = async (how, at = path) => {
    if (!at) { return; }
    try {
      const list = asTracks(await lib.dirRecursive(at));
      if (!list.length) { P.toast('No audio in this folder'); return; }
      if (how === 'queue') { P.addToQueue(list); } else if (how === 'shuffle') { P.shufflePlay(list); } else { P.playTracks(list); }
    } catch (_) { P.toast('Could not read the folder', 'error'); }
  };

  const doUpload = async (fileList) => {
    if (!parts.length || !fileList?.length) { return; }
    const fd = new FormData();
    [...fileList].forEach((f) => fd.append('file', f, f.name));
    P.toast(`Uploading ${fileList.length} ${fileList.length === 1 ? 'file' : 'files'}…`);
    try {
      const res = await fetch(server().host + 'api/v1/file-explorer/upload', {
        method: 'POST',
        headers: { 'x-access-token': server().token, 'data-location': encodeURI(path) },
        body: fd,
      });
      if (!res.ok) { throw new Error(String(res.status)); }
      P.toast('Upload finished', 'success');
      setRev((n) => n + 1);
    } catch (_) { P.toast('Upload failed', 'error'); }
  };

  const setHome = (p) => {
    setPref({ homeFolder: p });
    P.toast(p ? `Home folder set · ${p.split('/').pop()}` : 'Home folder cleared');
  };

  const homeParts = home ? home.split('/') : [];
  // The path under the header, from the library down (wraps, so long paths fit).
  const pathBar = parts.length > 1 ? html`<nav class="path-bar">${parts.map((p, i) => {
    const to = parts.slice(0, i + 1);
    const last = i === parts.length - 1;
    const atHome = home && to.join('/') === home;
    const label = html`${atHome ? html`<${Icon} name="home" size=${13} class="crumb-home" />` : null}${p}`;
    return html`${last ? html`<span class="crumb last">${label}</span>` : html`<a class="crumb" href=${href('folders', ...to)}>${label}</a>`}
      ${last ? null : html`<${Icon} name="chevron_right" size=${13} />`}`;
  })}</nav>` : null;

  const canUpload = parts.length && !server().noUpload;
  const more = (e) => openMenu(e, [
    ...(parts.length ? [
      { label: 'Add to queue', icon: 'queue_music', tone: 'accent', onClick: () => playFolder('queue') },
      { label: 'Shuffle folder', icon: 'shuffle', tone: 'accent', onClick: () => playFolder('shuffle') },
      { label: 'Download .zip', icon: 'download', tone: 'state', onClick: () => lib.downloadDirectory(path) },
      'sep',
    ] : []),
    isHome ? { label: 'Clear home folder', icon: 'home', onClick: () => setHome('') }
      : { label: 'Set as home folder', icon: 'home', tone: 'accent', onClick: () => setHome(parts.join('/')) },
    ...(home && !isHome ? [{ label: 'Clear home folder', icon: 'close', onClick: () => setHome('') }] : []),
  ]);

  const dirMenu = (e, d) => {
    const at = path + '/' + d.name;
    const p = [...parts, d.name].join('/');
    openMenu(e, [
      { label: 'Play folder', icon: 'play_arrow', tone: 'accent', onClick: () => playFolder('play', at) },
      { label: 'Add to queue', icon: 'queue_music', tone: 'accent', onClick: () => playFolder('queue', at) },
      { label: 'Download .zip', icon: 'download', tone: 'state', onClick: () => lib.downloadDirectory(at) },
      'sep',
      p === home ? { label: 'Clear home folder', icon: 'home', onClick: () => setHome('') }
        : { label: 'Set as home folder', icon: 'home', tone: 'accent', onClick: () => setHome(p) },
    ]);
  };

  const fileRow = (f) => {
    const t = f.audio ? { filepath: f.filepath, metadata: f.metadata } : null;
    const cur = t && t.filepath === currentPath;
    const m = f.metadata || {};
    return html`<div class=${`f-row ${f.audio ? 'audio' : 'other'} ${cur ? 'cur' : ''}`} key=${f.filepath}
      onClick=${() => { if (t) { P.playTracks(tracks, tracks.findIndex((x) => x.filepath === t.filepath)); } }}
      onContextMenu=${(e) => { if (t) { openMenu(e, trackMenuItems([t])); } }}>
      <span class=${`f-plate ${cur ? 'state' : ''}`}><${Icon} name=${cur ? 'graphic_eq' : f.audio ? 'music_note' : IMAGE.test(f.name) ? 'image' : 'insert_drive_file'} size=${15} /></span>
      <span class="f-name">${f.name}</span>
      <span class="micro-n">${f.audio ? formatLabel(m) || (f.type || '').toUpperCase() : (f.type || '').toUpperCase()}</span>
      <span class="micro-n r">${m['file-size'] ? fmtBytes(m['file-size']) : ''}</span>
      <span>${t ? html`<button type="button" class="row-more" title="More" onClick=${(e) => { e.stopPropagation(); openMenu(e, trackMenuItems([t])); }}><${Icon} name="more_vert" size=${16} /></button>` : null}</span>
    </div>`;
  };

  const deepBlock = needle.length >= 2 && (deep.loading || deep.folders.length || deep.tracks.length) ? html`
    <div class="micro f-section">IN SUB-FOLDERS${deep.loading ? ' · SEARCHING…' : ''}</div>
    ${deep.folders.length || deep.tracks.length ? html`<div class="card table-card files">
      ${deep.folders.map((d) => html`<a class="f-row" href=${href('folders', ...d.path)} key=${d.path.join('/')}>
        <span class="f-plate accent"><${Icon} name="folder" size=${15} /></span>
        <span class="f-name">${d.path[d.path.length - 1]}<small class="f-within">${d.within}</small></span><span></span><span></span><span></span>
      </a>`)}
      ${deep.tracks.map((t, i) => html`<div class=${`f-row audio ${t.filepath === currentPath ? 'cur' : ''}`} key=${t.filepath}
        onClick=${() => P.playTracks(deep.tracks, i)} onContextMenu=${(e) => openMenu(e, trackMenuItems([t]))}>
        <span class="f-plate"><${Icon} name="music_note" size=${15} /></span>
        <span class="f-name">${trackTitle(t)}<small class="f-within">${[trackArtist(t), t.within].filter(Boolean).join(' · ')}</small></span>
        <span class="micro-n">${formatLabel(t.metadata)}</span><span></span>
        <span><button type="button" class="row-more" title="More" onClick=${(e) => { e.stopPropagation(); openMenu(e, trackMenuItems([t])); }}><${Icon} name="more_vert" size=${16} /></button></span>
      </div>`)}
    </div>` : null}` : null;

  const nothingHere = !dirs.length && !files.length;

  return html`<div class="screen" onDragOver=${(e) => { if (canUpload) { e.preventDefault(); } }}
    onDrop=${(e) => { if (canUpload) { e.preventDefault(); doUpload(e.dataTransfer.files); } }}>
    <${Header} title=${parts.length ? parts[parts.length - 1] : 'Folders'} sub=${!parts.length ? 'LIBRARIES' : parts.length === 1 ? 'LIBRARY' : null}
      lead=${html`<${Btn} icon="home" class=${`home-btn ${isHome ? 'on' : ''}`} title=${home ? `Home folder · ${homeParts[homeParts.length - 1]}` : 'Home folder: not set (⋮ → Set as home folder)'}
        onClick=${() => go('folders', ...homeParts)} />`}>
      <${SearchField} value=${q} onInput=${setQ} width=${220} />
      <${SortButton} sort=${sort} />
      ${canUpload ? html`<${Btn} icon="upload" onClick=${() => upload.current.click()}>Upload</${Btn}>
        <input type="file" multiple hidden ref=${upload} onChange=${(e) => doUpload(e.currentTarget.files)} />` : null}
      <${Btn} icon="more_vert" title="More" onClick=${more} />
      ${parts.length ? html`<${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => playFolder('play')}>Play folder</${Btn}>` : null}
    </${Header}>
    ${pathBar}
    <div class="scroll pad col">
      ${vpaths.length > 1 || !parts.length ? html`<div class="chips">${vpaths.map((v) => html`<${Chip} icon="library_music" on=${parts[0] === v}
        onClick=${() => go('folders', v)}>${v}</${Chip}>`)}</div>` : null}
      ${state.loading && !state.data ? html`<${Spinner} />`
        : state.error ? html`<${Empty} icon="error_outline" title="Could not open this folder">${String(state.error.message)}</${Empty}>`
        : nothingHere && needle ? (deepBlock ? null : html`<${Empty} icon="search" title="Nothing found">${needle.length < 2 ? 'Type a little more to search the sub-folders too.' : 'Nothing in this folder or below matches.'}</${Empty}>`)
        : nothingHere ? html`<${Empty} icon="folder" title="This folder is empty">${canUpload ? 'Drop files here to upload them.' : ''}</${Empty}>`
        : html`<div class="card table-card files">
          <div class="f-row f-head micro"><span></span><span>NAME</span><span>FORMAT</span><span class="r">SIZE</span><span></span></div>
          ${dirs.map((d) => html`<a class="f-row" key=${'d:' + d.name} href=${href('folders', ...parts, d.name)} onContextMenu=${(e) => dirMenu(e, d)}>
            <span class="f-plate accent"><${Icon} name=${[...parts, d.name].join('/') === home ? 'home' : parts.length ? 'folder' : 'library_music'} size=${15} /></span>
            <span class="f-name">${d.name}</span><span class="micro-n"></span><span class="micro-n r"></span>
            <span><button type="button" class="row-more" title="More" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); dirMenu(e, d); }}><${Icon} name="more_vert" size=${16} /></button></span>
          </a>`)}
          ${files.map(fileRow)}
        </div>`}
      ${deepBlock}
    </div>
  </div>`;
}
