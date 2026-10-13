// Folders: the file browser over mStream's vpaths.
import { html, useRef, useState } from '../vendor/preact-htm.js';
import { href, go } from '../store.js';
import * as lib from '../library.js';
import * as P from '../player.js';
import { playback } from '../player.js';
import { useStore } from '../store.js';
import { Btn, Icon, Header, Chip, Empty, Spinner, useAsync, openMenu, trackMenuItems } from '../ui.js';
import { fmtBytes, formatLabel, server } from '../util.js';

const AUDIO = /\.(mp3|flac|wav|ogg|oga|aac|m4a|m4b|opus|alac|aiff?|wma|ape|wv|dsf|dff)$/i;
const IMAGE = /\.(jpe?g|png|gif|webp|bmp)$/i;

export function Folders({ args }) {
  const vpaths = server().vpaths || [];
  const parts = args.length ? args : [];
  const path = parts.length ? '/' + parts.join('/') : '';
  const [rev, setRev] = useState(0);
  const state = useAsync(() => lib.dir(path), [path, rev]);
  const currentPath = useStore(playback, (s) => s.currentPath);
  const files = state.data?.files || [];
  const dirs = state.data?.directories || [];
  const rel = (name) => (parts.length ? parts.join('/') + '/' : '') + name;
  const audio = files.filter((f) => AUDIO.test(f.name));

  // FORMAT and SIZE come from the library's metadata for the audio files.
  const meta = useAsync(() => (audio.length ? lib.metadataBatch(audio.map((f) => rel(f.name))) : Promise.resolve({})), [path, rev, state.data]);
  const tracks = audio.map((f) => ({ filepath: rel(f.name), metadata: meta.data?.[rel(f.name)]?.metadata || {} }));
  const upload = useRef();

  const playFolder = async (shuffle) => {
    if (!parts.length) { return; }
    try {
      const all = await lib.dirRecursive(path);
      const list = (all || []).map((x) => (typeof x === 'string' ? { filepath: x, metadata: {} } : { filepath: x.filepath, metadata: x.metadata || {} }));
      if (!list.length) { P.toast('No audio in this folder'); return; }
      if (shuffle === 'queue') { P.addToQueue(list); } else if (shuffle) { P.shufflePlay(list); } else { P.playTracks(list); }
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

  const crumbs = html`${[{ t: 'Folders', to: [] }, ...parts.map((p, i) => ({ t: p, to: parts.slice(0, i + 1) }))].map((c, i, arr) => {
    const last = i === arr.length - 1;
    return html`${last ? html`<span class="crumb last">${c.t}</span>` : html`<a class="crumb" href=${href('folders', ...c.to)}>${c.t}</a>`}
      ${last ? null : html`<${Icon} name="chevron_right" size=${14} />`}`;
  })}`;

  const canUpload = parts.length && !server().noUpload;

  return html`<div class="screen" onDragOver=${(e) => { if (canUpload) { e.preventDefault(); } }}
    onDrop=${(e) => { if (canUpload) { e.preventDefault(); doUpload(e.dataTransfer.files); } }}>
    <${Header} crumbs=${crumbs}>
      ${canUpload ? html`<${Btn} icon="upload" onClick=${() => upload.current.click()}>Upload</${Btn}>
        <input type="file" multiple hidden ref=${upload} onChange=${(e) => doUpload(e.currentTarget.files)} />` : null}
      ${parts.length ? html`
        <${Btn} icon="download" onClick=${() => lib.downloadDirectory(path)}>Download .zip</${Btn}>
        <${Btn} icon="queue_music" onClick=${() => playFolder('queue')}>Add to queue</${Btn}>
        <${Btn} kind="primary" icon="play_arrow" iconSize=${14} onClick=${() => playFolder(false)}>Play folder</${Btn}>` : null}
    </${Header}>
    <div class="scroll pad col">
      ${vpaths.length > 1 || !parts.length ? html`<div class="chips">${vpaths.map((v) => html`<${Chip} icon="library_music" on=${parts[0] === v}
        onClick=${() => go('folders', v)}>${v}</${Chip}>`)}</div>` : null}
      ${state.loading && !state.data ? html`<${Spinner} />`
        : state.error ? html`<${Empty} icon="error_outline" title="Could not open this folder">${String(state.error.message)}</${Empty}>`
        : !dirs.length && !files.length ? html`<${Empty} icon="folder" title="This folder is empty">${canUpload ? 'Drop files here to upload them.' : ''}</${Empty}>`
        : html`<div class="card table-card files">
          <div class="f-row f-head micro"><span></span><span>NAME</span><span>FORMAT</span><span class="r">SIZE</span><span></span></div>
          ${dirs.map((d) => html`<a class="f-row" href=${href('folders', ...parts, d.name)}
            onContextMenu=${(e) => openMenu(e, [
              { label: 'Play folder', icon: 'play_arrow', onClick: () => lib.dirRecursive(path + '/' + d.name).then((l) => P.playTracks((l || []).map((x) => (typeof x === 'string' ? { filepath: x } : x)))) },
              { label: 'Add to queue', icon: 'queue_music', onClick: () => lib.dirRecursive(path + '/' + d.name).then((l) => P.addToQueue((l || []).map((x) => (typeof x === 'string' ? { filepath: x } : x)))) },
              { label: 'Download .zip', icon: 'download', onClick: () => lib.downloadDirectory(path ? path + '/' + d.name : '/' + d.name) }])}>
            <span class="f-plate accent"><${Icon} name=${parts.length ? 'folder' : 'library_music'} size=${15} /></span>
            <span class="f-name">${d.name}</span><span class="micro-n"></span><span class="micro-n r"></span><span></span>
          </a>`)}
          ${files.map((f) => {
            const isAudio = AUDIO.test(f.name);
            const t = isAudio ? tracks.find((x) => x.filepath === rel(f.name)) : null;
            const cur = t && t.filepath === currentPath;
            const m = t?.metadata || {};
            return html`<div class=${`f-row ${isAudio ? 'audio' : 'other'} ${cur ? 'cur' : ''}`}
              onClick=${() => { if (t) { P.playTracks(tracks, tracks.indexOf(t)); } }}
              onContextMenu=${(e) => { if (t) { openMenu(e, trackMenuItems([t])); } }}>
              <span class=${`f-plate ${cur ? 'state' : ''}`}><${Icon} name=${cur ? 'graphic_eq' : isAudio ? 'music_note' : IMAGE.test(f.name) ? 'image' : 'insert_drive_file'} size=${15} /></span>
              <span class="f-name">${f.name}</span>
              <span class="micro-n">${isAudio ? formatLabel(m) || (f.type || '').toUpperCase() : (f.type || '').toUpperCase()}</span>
              <span class="micro-n r">${m['file-size'] ? fmtBytes(m['file-size']) : ''}</span>
              <span>${t ? html`<button type="button" class="row-more" title="More" onClick=${(e) => { e.stopPropagation(); openMenu(e, trackMenuItems([t])); }}><${Icon} name="more_vert" size=${16} /></button>` : null}</span>
            </div>`;
          })}
        </div>`}
    </div>
  </div>`;
}
