// The devices button (player bar) with its menu, and the "Playing on …"
// strip under the player bar. The logic is in devices.js.
import { html, useEffect, useRef, useState } from './vendor/preact-htm.js';
import { useStore } from './store.js';
import { playback } from './player.js';
import { Icon, IconBtn, prompt } from './ui.js';
import { devices, playOn, rename, forget, playingElsewhere, activeRemote } from './devices.js';
import { clockLabel } from './util.js';

const typeIcon = (t) => (t === 'android' ? 'smartphone' : t === 'web' || t === 'desktop' ? 'computer' : 'devices_other');
const ts = (s) => (s ? Date.parse(s) : NaN);

function DevicesMenu({ onClose, anchor }) {
  const d = useStore(devices, (x) => ({ list: x.list, self: x.self, name: x.name, connected: x.connected }));
  const localPlaying = useStore(playback, (x) => x.playing);
  const ref = useRef();
  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target) && !anchor.current?.contains(e.target)) { onClose(); } };
    const key = (e) => { if (e.key === 'Escape') { onClose(); } };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, []);
  const remote = activeRemote(d.list, d.self, localPlaying);
  // Where the sound is: this tab while it plays, else the device playing.
  const current = localPlaying ? d.self : remote?.id || null;
  const others = d.list.filter((x) => x.id !== d.self && x.online)
    .sort((a, b) => Number(b.playing) - Number(a.playing) || a.name.localeCompare(b.name));
  const offline = d.list.filter((x) => x.id !== d.self && !x.online && x.lastPlayedAt)
    .sort((a, b) => String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt))).slice(0, 4);

  const row = (x, self) => {
    const on = current === x.id;
    const status = self ? (localPlaying ? 'Playing' : 'This tab')
      : x.playing ? `Playing · ${x.track?.title || ''}` : x.track ? `Paused · ${x.track.title}` : 'Idle';
    return html`<button type="button" class=${`dev-row ${on ? 'on' : ''}`} key=${x.id}
      onClick=${() => { onClose(); playOn(x.id); }} title=${on ? 'Playing here' : `Play on ${x.name}`}>
      <span class="dev-ic"><${Icon} name=${on ? 'graphic_eq' : typeIcon(x.type)} size=${18} /></span>
      <span class="dev-text"><span>${self ? d.name : x.name}</span><small>${status}</small></span>
      ${self ? html`<span class="dev-act" role="button" title="Rename this device" onClick=${async (e) => {
        e.stopPropagation(); onClose();
        const n = await prompt({ title: 'Rename this device', label: 'NAME', value: d.name, okLabel: 'Rename', note: 'How it shows on your other devices.' });
        if (n) { rename(n); }
      }}><${Icon} name="edit" size=${14} /></span>` : null}
    </button>`;
  };

  return html`<div class="popover dev-pop" ref=${ref}>
    <div class="dev-head"><span class="card-title">Devices</span>${!d.connected ? html`<span class="micro">OFFLINE</span>` : null}</div>
    ${row({ id: d.self, type: 'web' }, true)}
    ${others.length ? html`<div class="micro dev-sec">OTHER DEVICES</div>${others.map((x) => row(x, false))}`
      : html`<div class="dev-hint">Open mStream on another device with this account — the Zenelo app or a browser — and it shows up here.</div>`}
    ${offline.length ? html`<div class="micro dev-sec">RECENTLY</div>${offline.map((x) => html`<div class="dev-row off" key=${x.id}>
      <span class="dev-ic"><${Icon} name=${typeIcon(x.type)} size=${18} /></span>
      <span class="dev-text"><span>${x.name}</span><small>${x.track ? `${x.track.title} · ` : ''}${clockLabel(ts(x.lastPlayedAt))}</small></span>
      <span class="dev-act" role="button" title="Remove from the list" onClick=${() => forget(x.id)}><${Icon} name="close" size=${14} /></span>
    </div>`)}` : null}
    <div class="dev-hint">Pick a device to move the playback there. A queue paused on one device is picked up on the next.</div>
  </div>`;
}

export function DevicesButton() {
  const [open, setOpen] = useState(false);
  const anchor = useRef();
  const d = useStore(devices, (x) => ({ list: x.list, self: x.self, available: x.available }));
  if (!d.available) { return null; }
  const elsewhere = playingElsewhere(d.list, d.self).length > 0;
  return html`<div class="pop-anchor" ref=${anchor}>
    <${IconBtn} icon="devices" title="Devices" active=${open || elsewhere} size=${17} class="pager" onClick=${() => setOpen(!open)} />
    ${open ? html`<${DevicesMenu} onClose=${() => setOpen(false)} anchor=${anchor} />` : null}
  </div>`;
}

// "Playing on …" under the player bar while another device plays.
export function DeviceStrip() {
  const d = useStore(devices, (x) => ({ list: x.list, self: x.self }));
  const localPlaying = useStore(playback, (x) => x.playing);
  const elsewhere = playingElsewhere(d.list, d.self);
  if (!elsewhere.length) { return null; }
  const first = elsewhere[0];
  const names = elsewhere.map((x) => x.name).join(', ');
  return html`<div class="device-strip">
    <${Icon} name=${typeIcon(first.type)} size=${15} />
    <span>${localPlaying ? 'Also playing on' : 'Playing on'} <b>${names}</b></span>
    ${!localPlaying ? html`<button type="button" class="strip-btn" onClick=${() => playOn(d.self)}><${Icon} name="computer" size=${14} />Play here</button>` : null}
  </div>`;
}
