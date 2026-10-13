// Jukebox: this player takes commands from phones. Connecting opens a
// WebSocket (assets/js/mstream.jukebox.js); the server hands back a code,
// and anyone with /remote/<code> (or the QR) can queue, skip and pause here.
// Server audio (/server-remote) plays on the server's own speakers instead.
import { html, useEffect, useState } from '../vendor/preact-htm.js';
import { Btn, Icon, Header, Spinner } from '../ui.js';
import * as P from '../player.js';
import { server } from '../util.js';

function useJukebox() {
  const read = () => ({ live: JUKEBOX.stats.live === true && !!JUKEBOX.connection, code: JUKEBOX.stats.adminCode || null });
  const [s, setS] = useState(read);
  useEffect(() => {
    const t = setInterval(() => setS((old) => { const n = read(); return n.live === old.live && n.code === old.code ? old : n; }), 500);
    return () => clearInterval(t);
  }, []);
  return s;
}

function remoteUrl(code) {
  return new URL('remote/' + code, server().host || location.href.split('#')[0]).href;
}

function Qr({ text }) {
  const svg = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM).toSvgString(2);
  return html`<div class="jb-qr" dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

export function Jukebox() {
  const jb = useJukebox();
  const [connecting, setConnecting] = useState(false);
  const connect = () => {
    setConnecting(true);
    JUKEBOX.createWebsocket(server().token, false, () => setConnecting(false));
    setTimeout(() => setConnecting(false), 8000);
  };
  const disconnect = () => { try { JUKEBOX.connection?.close(); } catch (_) { /* already closed */ } };
  const url = jb.code ? remoteUrl(jb.code) : '';
  const copy = () => { navigator.clipboard?.writeText(url).then(() => P.toast('Link copied', 'success')); };

  return html`<div class="screen">
    <${Header} title="Jukebox" sub=${jb.live && jb.code ? `CONNECTED · CODE ${jb.code}` : 'REMOTE CONTROL FROM A PHONE'}>
      ${jb.live ? html`<${Btn} kind="ghost" onClick=${disconnect}>Disconnect</${Btn}>` : null}
    </${Header}>
    <div class="scroll pad col jb">
      <section class="card jb-card">
        <div class="card-head"><div class="plate plate-accent" style=${{ width: '30px', height: '30px' }}><${Icon} name="qr_code_2" size=${17} /></div>
          <span class="card-title">This player</span>
          <span class=${`pill ${jb.live && jb.code ? 'state' : 'muted'}`}>${jb.live && jb.code ? 'Connected' : 'Off'}</span></div>
        ${jb.live && jb.code ? html`<div class="jb-live">
            <${Qr} text=${url} />
            <div class="jb-info">
              <span class="micro">CODE</span>
              <span class="jb-code">${jb.code}</span>
              <span class="micro">REMOTE</span>
              <div class="jb-link"><a href=${url} target="_blank" rel="noopener">${url}</a>
                <button type="button" class="icon-btn" title="Copy link" onClick=${copy}><${Icon} name="content_copy" size=${15} /></button></div>
              <p class="card-text">Scan the code or open the link on a phone: it can queue tracks, skip, pause and set the volume here. Keep this tab open.</p>
            </div>
          </div>`
          : html`<p class="card-text">Let phones control what plays in this browser tab: they get a code and a link, and anything they queue plays here.</p>
            <div class="card-actions">${connecting ? html`<${Spinner} label="Connecting" />`
              : html`<${Btn} kind="primary" icon="qr_code_2" onClick=${connect}>Start Jukebox</${Btn}>`}</div>`}
      </section>
      <section class="card jb-card">
        <div class="card-head"><div class="plate plate-state" style=${{ width: '30px', height: '30px' }}><${Icon} name="speaker" size=${17} /></div>
          <span class="card-title">Server audio</span></div>
        <p class="card-text">Play on the server’s own speakers instead of this browser, and control it from here or any phone.</p>
        <div class="card-actions"><a class="btn btn-outline" href="server-remote" target="_blank"><${Icon} name="open_in_new" size=${15} />Open server audio</a></div>
      </section>
    </div>
  </div>`;
}
