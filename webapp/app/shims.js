// Globals the shared playback engine (assets/js/mstream.player.js) reaches
// for (they were the old Vue UI's); here they forward to the app,
// which fills in the handlers once app/main.js has loaded. Classic script,
// loaded before the engine so the bare identifiers exist when it runs.

(() => {
  const pendingToasts = [];

  // iziToast: the engine calls iziToast.error / .warning / .info / .success
  // with { title, message }. Before the app mounts, toasts are buffered.
  const toast = (kind) => (opts = {}) => {
    const t = { kind, title: opts.title || '', message: opts.message || '' };
    if (window.APP_TOAST) { window.APP_TOAST(t); } else { pendingToasts.push(t); }
  };
  window.iziToast = {
    error: toast('error'),
    warning: toast('warning'),
    info: toast('info'),
    success: toast('success'),
    show: toast('info'),
    destroy() {},
    hide() {},
  };
  window.__drainPendingToasts = () => pendingToasts.splice(0);

  // VUEPLAYERCORE: Auto DJ queues its picks through addSongWizard (and the
  // federation variant). app/player.js installs the real implementations.
  window.VUEPLAYERCORE = {
    addSongWizard: async () => {},
    addFederationSongWizard: () => {},
  };
})();
