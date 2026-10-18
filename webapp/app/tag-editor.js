// The tag editor (a track's ⋮ → Edit tags…): the file's own tags, read and
// written through /api/v1/tags (src/api/tags.js). Open with
// `app.set({ tagEditor: track })`. Offered when ping's `tagEdit` says this
// user may change files; federated tracks are another server's.
import { html, useEffect, useRef, useState } from './vendor/preact-htm.js';
import { app, useStore } from './store.js';
import { Btn, IconBtn, Spinner } from './ui.js';
import * as lib from './library.js';
import { server, trackTitle } from './util.js';

const FIELDS = [
  { key: 'title', label: 'TITLE', wide: true },
  { key: 'artist', label: 'ARTIST', wide: true },
  { key: 'album', label: 'ALBUM', wide: true },
  { key: 'albumArtist', label: 'ALBUM ARTIST', wide: true },
  { key: 'track', label: 'TRACK', hint: '3 or 3/12', pattern: /^(\d{1,4}(\/\d{1,4})?)?$/ },
  { key: 'disc', label: 'DISC', hint: '1 or 1/2', pattern: /^(\d{1,4}(\/\d{1,4})?)?$/ },
  { key: 'year', label: 'YEAR', hint: '1999', pattern: /^(\d{4})?$/ },
  { key: 'genre', label: 'GENRE', wide: true },
];

async function call(path, body) {
  const s = server();
  const res = await fetch(s.host + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-access-token': s.token },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { throw new Error(json.error || `Error ${res.status}`); }
  return json;
}

// The track's own view of itself, so lists show the edit before the rescan
// reaches them.
function applyToTrack(track, tags) {
  const m = track.metadata || (track.metadata = {});
  m.title = tags.title || null;
  m.artist = tags.artist || null;
  m.album = tags.album || null;
  m['album-artist'] = tags.albumArtist || null;
  m.track = parseInt(tags.track, 10) || null;
  m.disk = parseInt(tags.disc, 10) || null;
  m.year = parseInt(tags.year, 10) || null;
  m.genre = tags.genre || null;
  if (m.genres) { m.genres = tags.genre ? tags.genre.split(/\s*;\s*/) : []; }
}

export function TagEditor() {
  const track = useStore(app, (s) => s.tagEditor);
  const [state, setState] = useState(null); // { tags, original, format } | { error }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const first = useRef();

  useEffect(() => {
    if (!track) { return undefined; }
    setState(null);
    setError('');
    setSaving(false);
    let live = true;
    call('api/v1/tags/read', { filepath: track.filepath })
      .then((r) => { if (live) { setState({ tags: { ...r.tags }, original: r.tags, format: r.format }); setTimeout(() => first.current?.focus(), 30); } })
      .catch((e) => { if (live) { setState({ error: e.message }); } });
    const key = (e) => { if (e.key === 'Escape') { close(); } };
    document.addEventListener('keydown', key);
    return () => { live = false; document.removeEventListener('keydown', key); };
  }, [track]);

  if (!track) { return null; }
  function close() { app.set({ tagEditor: null }); }

  const tags = state?.tags;
  const bad = tags ? FIELDS.filter((f) => f.pattern && !f.pattern.test(tags[f.key].trim())) : [];
  const changed = tags ? Object.fromEntries(FIELDS
    .filter((f) => tags[f.key].trim() !== (state.original[f.key] || ''))
    .map((f) => [f.key, tags[f.key].trim()])) : {};
  const dirty = Object.keys(changed).length > 0;

  async function save(e) {
    e.preventDefault();
    if (!dirty || bad.length || saving) { return; }
    setSaving(true);
    setError('');
    try {
      const r = await call('api/v1/tags/write', { filepath: track.filepath, tags: changed });
      applyToTrack(track, r.tags);
      // Pages read the library again (as after a scan: the rescan has the new tags).
      lib.invalidate('');
      window.APP_TOAST({ kind: 'success', message: 'Tags saved' });
      close();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const set = (key, value) => setState({ ...state, tags: { ...tags, [key]: value } });

  return html`<div class="scrim" onMouseDown=${(e) => { if (e.target === e.currentTarget) { close(); } }}>
    <form class="dialog dg tag-editor" onSubmit=${save}>
      <div class="dg-head">
        <div class="dg-head-text">
          <div class="dialog-title">Edit tags</div>
          <div class="dialog-text">${trackTitle(track)}${state?.format ? ` · ${state.format.toUpperCase()}` : ''}</div>
        </div>
        <${IconBtn} icon="close" title="Close" onClick=${close} />
      </div>
      ${!state ? html`<${Spinner} label="Reading the file" />` : null}
      ${state?.error ? html`<div class="dialog-text">Can’t read the tags: ${state.error}</div>` : null}
      ${tags ? html`<div class="tag-grid">
        ${FIELDS.map((f, i) => html`<label class=${`field ${f.wide ? 'wide' : ''} ${bad.includes(f) ? 'bad' : ''}`} key=${f.key}>
          <span class="micro">${f.label}</span>
          <input ref=${i === 0 ? first : null} value=${tags[f.key]} placeholder=${f.hint || ''}
            inputmode=${f.pattern ? 'numeric' : null} onInput=${(e) => set(f.key, e.currentTarget.value)} />
        </label>`)}
      </div>
      <div class="dialog-note">Written into the file: other tags, the cover and the audio stay as they are. An empty field removes that tag.</div>` : null}
      ${error ? html`<div class="dialog-text tag-error">${error}</div>` : null}
      <div class="dialog-actions">
        <${Btn} kind="ghost" onClick=${close}>Cancel</${Btn}>
        <button type="submit" class="btn btn-primary" disabled=${!dirty || bad.length > 0 || saving}>${saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  </div>`;
}
