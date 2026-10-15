// Butterchurn (Milkdrop) visualizer for the player. The contract the
// playback engine expects — VIZ.get() hands it the
// AudioContext and VIZ.connect(node) gives us the analyser — but the canvas
// belongs to the Visualizer screen, which mounts and unmounts it.
// Classic script: the engine checks `typeof VIZ` when a song starts.

var VIZ = (() => {
  const mod = {};
  const audioContext = new AudioContext();

  let visualizer = null;
  let canvas = null;
  // The engine alternates two <audio> elements (and makes new ones after
  // errors): each connects into this one node, which the visualizer hears.
  // Keeping only the last-connected one left every other song silent here.
  const mix = audioContext.createGain();
  mix.gain.value = 1.25;
  // Our own ears on the mix, for the drive (app/viz-drive.js).
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  mix.connect(analyser);
  const wave = new Float32Array(analyser.fftSize);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  const mags = new Float32Array(analyser.frequencyBinCount / 4); // up to ~5.5 kHz
  const prevMags = new Float32Array(mags.length);
  let drive = null;
  let driveMod = null;
  let presets = {};
  let presetKeys = [];
  let presetIndex = 0;
  const history = [];
  let cycle = true;
  const CYCLE_MS = 20000;
  let rafId = null;
  let loading = null;
  const listeners = new Set();

  function emit() { listeners.forEach((fn) => fn(mod.info())); }

  mod.get = () => audioContext;

  mod.connect = (node) => {
    audioContext.resume();
    node.connect(mix);
  };

  // butterchurn, its presets (~300 KB) and the drive: fetched on first open.
  function load() {
    if (loading) { return loading; }
    const files = [
      'assets/js/lib/butterchurn.min.js',
      'assets/js/lib/butterchurn-presets-zenelo.js',
    ];
    loading = files.reduce((chain, src) => chain.then(() => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    })), Promise.resolve())
      .then(() => import('./viz-drive.js'))
      .then((m) => { driveMod = m; drive = m.createDrive(); })
      .catch((err) => { loading = null; throw err; });
    return loading;
  }

  const playing = () => typeof MSTREAMPLAYER !== 'undefined' && MSTREAMPLAYER.playerStats.playing === true;

  // One frame of the drive: loudness and spectral flux from the analyser.
  function listen(dt) {
    analyser.getFloatTimeDomainData(wave);
    let sum = 0;
    for (let i = 0; i < wave.length; i++) { sum += wave[i] * wave[i]; }
    analyser.getFloatFrequencyData(spectrum);
    for (let i = 0; i < mags.length; i++) {
      const db = spectrum[i];
      mags[i] = db > -100 ? Math.pow(10, db / 20) : 0;
    }
    const flux = driveMod.spectralFlux(mags, prevMags);
    prevMags.set(mags);
    return drive.update(Math.sqrt(sum / wave.length), flux, dt / 1000);
  }

  // The music drives the picture (app/viz-drive.js): the presets' motion
  // per frame (their equations read VIZ_DRIVE) and their clock run at
  // the drive's speed, and the brightness follows it — each hit flashes,
  // silence or a pause fades the picture out, the next hit brings it back.
  // Once it has faded while paused, no frames are drawn. The 20 s preset
  // cycle counts music time.
  let stale = true;
  let lastTick = 0;
  let clock = 0;
  let cycleS = 0;
  window.VIZ_DRIVE = { motion: 1 };
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (!visualizer) { return; }
    const dt = lastTick ? Math.min(now - lastTick, 250) : 0;
    lastTick = now;
    const d = listen(dt);
    window.VIZ_DRIVE.motion = d.motion;
    canvas.style.opacity = d.brightness.toFixed(3);
    if (!playing() && d.env < 0.005 && !stale) { return; }
    stale = false;
    clock += (dt / 1000) * d.motion;
    const r = visualizer.renderer;
    if (r && r.fps > 0) { r.time = clock - 1 / r.fps; }
    visualizer.render();
    if (cycle && (cycleS += (dt / 1000) * d.motion) >= CYCLE_MS / 1000) { cycleS = 0; mod.next(2.7); }
  }

  function loadPreset(i, blend) {
    if (!visualizer || presetKeys.length === 0) { return; }
    presetIndex = (i + presetKeys.length) % presetKeys.length;
    visualizer.loadPreset(driveMod.withDrive(presets[presetKeys[presetIndex]]), blend);
    emit();
  }

  function restartCycle() { cycleS = 0; }

  mod.mount = async (el) => {
    canvas = el;
    await load();
    if (canvas !== el) { return; }
    if (presetKeys.length === 0) {
      presets = window.BUTTERCHURN_PRESETS || {};
      presetKeys = Object.keys(presets);
      presetIndex = Math.floor(Math.random() * presetKeys.length);
    }
    mod.resize();
    visualizer = butterchurn.default.createVisualizer(audioContext, canvas, {
      width: canvas.width,
      height: canvas.height,
      pixelRatio: window.devicePixelRatio || 1,
      textureRatio: 1,
    });
    visualizer.connectAudio(mix);
    audioContext.resume();
    loadPreset(presetIndex, 0);
    restartCycle();
    cancelAnimationFrame(rafId);
    stale = true;
    lastTick = 0;
    clock = visualizer.renderer ? visualizer.renderer.time : 0;
    rafId = requestAnimationFrame(loop);
  };

  mod.unmount = () => {
    cancelAnimationFrame(rafId);
    visualizer = null;
    canvas = null;
  };

  mod.resize = () => {
    if (!canvas) { return; }
    canvas.width = canvas.clientWidth || 800;
    canvas.height = canvas.clientHeight || 600;
    if (visualizer) { visualizer.setRendererSize(canvas.width, canvas.height); stale = true; }
  };

  mod.next = (blend = 5.7) => { history.push(presetIndex); loadPreset(presetIndex + 1, blend); };
  mod.prev = (blend = 5.7) => { loadPreset(history.length ? history.pop() : presetIndex - 1, blend); };
  mod.setCycle = (on) => { cycle = on; restartCycle(); emit(); };

  mod.info = () => ({
    ready: !!visualizer,
    index: presetIndex,
    count: presetKeys.length,
    name: presetKeys[presetIndex] || '',
    cycle,
  });
  mod.subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  return mod;
})();
