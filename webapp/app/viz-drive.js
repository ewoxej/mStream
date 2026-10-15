// What drives the visualizer from the music (app/viz.js applies it):
// an envelope that jumps up on a hit and fades out over silence, a pulse
// that flashes on each hit, and a speed from the tempo. Milkdrop presets keep moving on their own clock
// and zoom / rotate the picture every frame whatever the sound; here
// both are scaled by `motion` (envelope × pulse × speed), and the
// picture's `brightness` follows the envelope and the pulse: silence (or
// pause) fades it out, the next hit brings it back at once.

const GATE = 0.004;          // RMS below this is silence (about −48 dBFS)
const RELEASE_S = 0.7;       // envelope fall time constant: gone in ~2 s
const PULSE_S = 0.18;        // a hit's flash fades this fast
const PEAK_HOLD_S = 8;       // loudness is relative to the recent peak
const FLUX_AVG_S = 0.6;      // onset threshold: flux against its average
const ONSET_RATIO = 1.6;
const ONSET_GAP_S = 0.09;
const TEMPO_WINDOW_S = 6;
const BPM_MIN = 70;
const BPM_MAX = 180;

/** Tempo (BPM) from an onset-strength history sampled every `stepS`, or 0. */
export function estimateBpm(history, stepS) {
  const n = history.length;
  if (n < 2 || !(stepS > 0)) { return 0; }
  const mean = history.reduce((s, v) => s + v, 0) / n;
  const x = history.map((v) => v - mean);
  let energy = 0;
  for (let i = 0; i < n; i++) { energy += x[i] * x[i]; }
  if (energy <= 1e-12) { return 0; }
  const lagMin = Math.max(1, Math.floor(60 / BPM_MAX / stepS));
  const lagMax = Math.min(n - 1, Math.ceil(60 / BPM_MIN / stepS));
  let best = 0;
  let bestLag = 0;
  let bestRaw = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) { s += x[i] * x[i - lag]; }
    // Twice the period correlates as well as the period itself: weigh
    // tempos by closeness to 120 BPM (in octaves), as beat trackers do.
    const octaves = Math.log2(60 / (lag * stepS) / 120);
    const w = s * Math.exp(-0.5 * octaves * octaves);
    if (w > best) { best = w; bestLag = lag; bestRaw = s; }
  }
  // A beat must stand out: its correlation a fair part of the variance.
  if (!bestLag || bestRaw < 0.25 * energy) { return 0; }
  return 60 / (bestLag * stepS);
}

/**
 * The running drive. `update(rms, flux, dt)` takes one frame's loudness
 * (RMS of the waveform, 0…1) and spectral flux (sum of rises in the
 * spectrum's magnitudes) and returns
 * { env, pulse, speed, motion, brightness, onset, bpm }.
 */
export function createDrive() {
  let env = 0;
  let pulse = 0;
  let peak = 0;
  let fluxAvg = 0;
  let sinceOnset = 1;
  let bpm = 0;
  let speed = 1;
  const hist = [];
  let histDt = 1 / 60;
  let sinceTempo = 0;

  return {
    update(rms, flux, dt) {
      dt = Math.min(Math.max(dt, 0), 0.25);
      peak = Math.max(rms, peak * Math.exp(-dt / PEAK_HOLD_S));
      fluxAvg += (flux - fluxAvg) * (1 - Math.exp(-dt / FLUX_AVG_S));
      sinceOnset += dt;

      const loud = rms > GATE;
      const onset = loud && sinceOnset > ONSET_GAP_S && flux > fluxAvg * ONSET_RATIO && flux > 1e-4;
      if (onset) { sinceOnset = 0; }

      const target = loud && peak > 0 ? Math.min(1, Math.pow(rms / peak, 0.8) * 1.1) : 0;
      pulse = onset ? 1 : pulse * Math.exp(-dt / PULSE_S);
      if (onset) {
        env = 1;
      } else if (target > env) {
        env += (target - env) * 0.5;
      } else {
        env = target + (env - target) * Math.exp(-dt / RELEASE_S);
      }

      // Tempo from the onset-strength history (rises of flux over its mean).
      if (dt > 0) {
        histDt += (dt - histDt) * 0.05;
        hist.push(loud ? Math.max(0, flux - fluxAvg) : 0);
        const keep = Math.round(TEMPO_WINDOW_S / histDt);
        if (hist.length > keep) { hist.splice(0, hist.length - keep); }
        sinceTempo += dt;
        if (sinceTempo > 0.5 && hist.length > keep / 2) {
          sinceTempo = 0;
          const found = estimateBpm(hist, histDt);
          if (found) { bpm = bpm ? bpm + (found - bpm) * 0.3 : found; }
        }
      }
      const want = bpm ? Math.min(1.7, Math.max(0.6, bpm / 120)) : 1;
      speed += (want - speed) * (1 - Math.exp(-dt / 1.5));

      return {
        env,
        pulse,
        speed,
        motion: env * speed * (0.55 + 0.75 * pulse),
        brightness: Math.pow(env, 0.7) * (0.6 + 0.4 * pulse),
        onset,
        bpm,
      };
    },
  };
}

/** Spectral flux between two magnitude spectra (sum of rises). */
export function spectralFlux(mags, prev) {
  let s = 0;
  for (let i = 0; i < mags.length; i++) {
    const d = mags[i] - prev[i];
    if (d > 0) { s += d; }
  }
  return s;
}

// Appended to a preset's per-frame and per-pixel equations: the frame's
// motion (zoom, rotation, warp, translation, stretch) scaled by the drive.
// The equations are plain functions of `a`; the drive is a global.
const MOTION_EQS = '\n;var __m=(typeof VIZ_DRIVE!=="undefined"?VIZ_DRIVE.motion:1);'
  + 'a.zoom=1+(a.zoom-1)*__m;a.rot*=__m;a.warp*=__m;a.dx*=__m;a.dy*=__m;'
  + 'a.sx=1+(a.sx-1)*__m;a.sy=1+(a.sy-1)*__m;';

/** A copy of `preset` whose motion follows the drive. */
export function withDrive(preset) {
  const p = { ...preset };
  p.frame_eqs_str = (p.frame_eqs_str || '') + MOTION_EQS;
  if (p.pixel_eqs_str) { p.pixel_eqs_str += MOTION_EQS; }
  return p;
}
