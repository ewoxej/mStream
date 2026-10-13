// Butterchurn (Milkdrop) visualizer for the new player. Same contract the
// playback engine expects from the classic t.js — VIZ.get() hands it the
// AudioContext and VIZ.connect(node) gives us the analyser — but the canvas
// belongs to the Visualizer screen, which mounts and unmounts it.
// Classic script: the engine checks `typeof VIZ` when a song starts.

var VIZ = (() => {
  const mod = {};
  const audioContext = new AudioContext();

  let visualizer = null;
  let canvas = null;
  let source = null;
  let presets = {};
  let presetKeys = [];
  let presetIndex = 0;
  const history = [];
  let cycleTimer = null;
  let cycle = true;
  const CYCLE_MS = 20000;
  let rafId = null;
  let loading = null;
  const listeners = new Set();

  function emit() { listeners.forEach((fn) => fn(mod.info())); }

  mod.get = () => audioContext;

  mod.connect = (node) => {
    audioContext.resume();
    const gain = audioContext.createGain();
    gain.gain.value = 1.25;
    node.connect(gain);
    source = gain;
    if (visualizer) { visualizer.connectAudio(source); }
  };

  // butterchurn and its preset packs are ~1.65 MB: fetched on first open.
  function load() {
    if (loading) { return loading; }
    const files = [
      'assets/js/lib/butterchurn.min.js',
      'assets/js/lib/butterchurn-presets.min.js',
      'assets/js/lib/butterchurn-presets-extra.js',
    ];
    loading = files.reduce((chain, src) => chain.then(() => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('failed to load ' + src));
      document.head.appendChild(s);
    })), Promise.resolve()).catch((err) => { loading = null; throw err; });
    return loading;
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    if (visualizer) { visualizer.render(); }
  }

  function loadPreset(i, blend) {
    if (!visualizer || presetKeys.length === 0) { return; }
    presetIndex = (i + presetKeys.length) % presetKeys.length;
    visualizer.loadPreset(presets[presetKeys[presetIndex]], blend);
    emit();
  }

  function restartCycle() {
    clearInterval(cycleTimer);
    cycleTimer = cycle ? setInterval(() => mod.next(2.7), CYCLE_MS) : null;
  }

  mod.mount = async (el) => {
    canvas = el;
    await load();
    if (canvas !== el) { return; }
    if (presetKeys.length === 0) {
      presets = {};
      if (window.butterchurnPresets) { Object.assign(presets, butterchurnPresets.getPresets()); }
      if (window.butterchurnPresetsExtra) { Object.assign(presets, butterchurnPresetsExtra.getPresets()); }
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
    if (source) { visualizer.connectAudio(source); }
    loadPreset(presetIndex, 0);
    restartCycle();
    cancelAnimationFrame(rafId);
    loop();
  };

  mod.unmount = () => {
    cancelAnimationFrame(rafId);
    clearInterval(cycleTimer);
    visualizer = null;
    canvas = null;
  };

  mod.resize = () => {
    if (!canvas) { return; }
    canvas.width = canvas.clientWidth || 800;
    canvas.height = canvas.clientHeight || 600;
    if (visualizer) { visualizer.setRendererSize(canvas.width, canvas.height); }
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
