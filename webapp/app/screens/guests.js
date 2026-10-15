// Guests: Play on's guest access (api/guest.js). A link (QR) for one of the
// user's devices lets someone without an account see what plays there,
// search the library, queue tracks, skip, pause, set the volume and edit the
// queue — on the page at /guest. Links last 1 h / 12 h / 7 days or until
// revoked. It replaced the Jukebox.
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { useStore } from '../store.js';
import { Btn, Icon, Header, Seg, Spinner, Plate, confirm } from '../ui.js';
import * as P from '../player.js';
import { devices, listGuests, createGuest, revokeGuest, guestUrl } from '../devices.js';
import { clockLabel } from '../util.js';

const DURATIONS = [
  { value: '1h', label: '1 hour' }, { value: '12h', label: '12 hours' },
  { value: '7d', label: '7 days' }, { value: 'never', label: 'Until revoked' },
];

function Qr({ text }) {
  const svg = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM).toSvgString(2);
  return html`<div class="gl-qr" dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

function expiry(at) {
  if (!at) { return 'Until revoked'; }
  const ms = Date.parse(at) - Date.now();
  if (ms <= 0) { return 'Ended'; }
  const h = ms / 3600e3;
  return h >= 48 ? `${Math.round(h / 24)} days left` : h >= 1 ? `${Math.round(h)} h left` : `${Math.max(1, Math.round(ms / 60e3))} min left`;
}

const copy = (url) => navigator.clipboard?.writeText(url).then(() => P.toast('Link copied', 'success'));

function LinkCard({ link, open, onToggle, onRevoke }) {
  const url = guestUrl(link.token);
  return html`<div class=${`gl-row ${open ? 'open' : ''}`}>
    <div class="gl-head" onClick=${onToggle}>
      <${Plate} icon="qr_code_2" size=${30} iconSize=${16} />
      <div class="gl-text">
        <span>${link.label || link.deviceName}</span>
        <small>${link.label ? `${link.deviceName} · ` : ''}${expiry(link.expiresAt)} · made ${clockLabel(Date.parse(link.createdAt))}</small>
      </div>
      <button type="button" class="icon-btn" title="Copy link" onClick=${(e) => { e.stopPropagation(); copy(url); }}><${Icon} name="content_copy" size=${16} /></button>
      <button type="button" class="icon-btn" title="Revoke" onClick=${(e) => { e.stopPropagation(); onRevoke(); }}><${Icon} name="delete_outline" size=${16} /></button>
    </div>
    ${open ? html`<div class="gl-live">
      <${Qr} text=${url} />
      <div class="gl-info">
        <span class="micro">LINK</span>
        <div class="gl-link"><a href=${url} target="_blank" rel="noopener">${url}</a></div>
        <p class="card-text">Scan the code or open the link on a phone. No account needed: the guest sees what plays on ${link.deviceName} and the queue, searches your library, queues tracks, skips, pauses and sets the volume.</p>
      </div>
    </div>` : null}
  </div>`;
}

export function Guests() {
  const d = useStore(devices, (x) => ({ list: x.list, self: x.self, name: x.name, available: x.available }));
  const [links, setLinks] = useState(null);
  const [device, setDevice] = useState(null);
  const [duration, setDuration] = useState('12h');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = () => listGuests().then(setLinks).catch(() => setLinks([]));
  useEffect(() => { load(); }, []);

  // This tab first, then the other devices, online before offline.
  const choices = [
    ...(d.self ? [{ id: d.self, name: `${d.name} (this tab)`, online: true }] : []),
    ...d.list.filter((x) => x.id !== d.self).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
  ];
  const picked = device && choices.some((c) => c.id === device) ? device : choices[0]?.id;

  const make = async () => {
    if (!picked) { return; }
    setBusy(true);
    try {
      const r = await createGuest(picked, duration, label.trim());
      setLabel('');
      await load();
      setOpenId(r.id);
    } catch (e) {
      P.toast(e.status === 404 ? 'That device is gone: reopen it and try again' : 'Could not make the link', 'error');
    } finally { setBusy(false); }
  };
  const revoke = async (l) => {
    if (!(await confirm({ title: 'Revoke this link?', text: 'Whoever has it loses access at once.', okLabel: 'Revoke' }))) { return; }
    try { await revokeGuest(l.id); } catch (_) { /* gone already */ }
    load();
  };

  return html`<div class="screen">
    <${Header} title="Guests" sub="LET OTHERS CONTROL A DEVICE" />
    <div class="scroll pad col gl">
      <section class="card gl-card">
        <div class="card-head"><${Plate} icon="share" size=${30} iconSize=${17} /><span class="card-title">New guest link</span></div>
        <p class="card-text">A link (and a QR code) for one of your devices: whoever opens it controls what plays there — no account, no password. Revoke it any time.</p>
        ${!d.available ? html`<p class="card-text muted">Devices aren't connected yet.</p>` : html`
          <label class="gl-field"><span class="micro">DEVICE</span>
            <select value=${picked || ''} onChange=${(e) => setDevice(e.target.value)}>
              ${choices.map((c) => html`<option value=${c.id}>${c.name}${c.online ? '' : ' — offline'}</option>`)}
            </select></label>
          <div class="gl-field"><span class="micro">FOR</span><${Seg} options=${DURATIONS} value=${duration} onChange=${setDuration} /></div>
          <label class="gl-field"><span class="micro">NAME (OPTIONAL)</span>
            <input type="text" maxlength="80" placeholder="Party, Friday…" value=${label} onInput=${(e) => setLabel(e.target.value)} /></label>
          <div class="card-actions">${busy ? html`<${Spinner} label="Making the link" />`
            : html`<${Btn} kind="primary" icon="qr_code_2" onClick=${make} disabled=${!picked}>Make a link</${Btn}>`}</div>`}
      </section>
      <section class="card gl-card">
        <div class="card-head"><${Plate} icon="link" size=${30} iconSize=${17} tone="state" /><span class="card-title">Links</span></div>
        ${links === null ? html`<${Spinner} />` : links.length === 0 ? html`<p class="card-text muted">No guest links.</p>`
          : links.map((l) => html`<${LinkCard} key=${l.id} link=${l} open=${openId === l.id}
              onToggle=${() => setOpenId(openId === l.id ? null : l.id)} onRevoke=${() => revoke(l)} />`)}
      </section>
    </div>
  </div>`;
}
