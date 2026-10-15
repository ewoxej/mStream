/**
 * webapp/app/viz-drive.js — what drives the visualizer from the music:
 * the envelope (a hit at once, silence fades it), the tempo, and the
 * presets' motion scaled by both.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrive, estimateBpm, spectralFlux, withDrive } from '../../webapp/app/viz-drive.js';

const STEP = 1 / 60;

// A beat at `bpm`: loud kicks with flux spikes, quiet between.
function feed(drive, bpm, seconds) {
  const period = Math.round(60 / bpm / STEP);
  let last;
  for (let f = 0; f < seconds / STEP; f++) {
    const hit = f % period === 0;
    last = drive.update(hit ? 0.3 : 0.08, hit ? 5 : 0.2, STEP);
  }
  return last;
}

test('tempo from an onset history', () => {
  for (const bpm of [90, 120, 150]) {
    const period = 60 / bpm / STEP;
    const hist = Array.from({ length: 360 }, (_, i) => (Math.abs(i % period) < 1 ? 1 : 0));
    const found = estimateBpm(hist, STEP);
    assert.ok(Math.abs(found - bpm) / bpm < 0.04, `${bpm} → ${found}`);
  }
  assert.equal(estimateBpm(new Array(360).fill(0), STEP), 0, 'silence has no tempo');
  assert.equal(estimateBpm(new Array(360).fill(0.5), STEP), 0, 'nor does a flat line');
});

test('a hit brings the envelope up at once; silence fades it out in a couple of seconds', () => {
  const d = createDrive();
  feed(d, 120, 4);
  const hit = d.update(0.3, 5, STEP);
  assert.equal(hit.onset, true);
  assert.equal(hit.env, 1);
  assert.equal(hit.brightness, 1, 'a hit flashes');
  let s;
  for (let f = 0; f < 18; f++) { s = d.update(0.1, 0.2, STEP); }
  assert.ok(s.brightness < 0.8 && s.env > 0.5, `between hits the flash is gone, the picture is not (${s.brightness})`);
  assert.ok(s.motion < hit.motion * 0.7, 'and the motion eases off');
  for (let f = 0; f < 60; f++) { s = d.update(0.3, 0, STEP); }
  for (let f = 0; f < 30; f++) { s = d.update(0, 0, STEP); }
  assert.ok(s.env > 0.3 && s.env < 0.8, `half a second of silence: still fading (${s.env})`);
  for (let f = 0; f < 150; f++) { s = d.update(0, 0, STEP); }
  assert.ok(s.env < 0.05, `three seconds: gone (${s.env})`);
  assert.ok(s.motion < 0.05, 'and the motion with it');
  const back = d.update(0.3, 5, STEP);
  assert.equal(back.env, 1, 'the next hit brings it back at once');
});

test('the speed follows the tempo', () => {
  const slow = feed(createDrive(), 80, 10);
  const fast = feed(createDrive(), 160, 10);
  assert.ok(Math.abs(slow.bpm - 80) < 5, `slow: ${slow.bpm}`);
  assert.ok(Math.abs(fast.bpm - 160) < 8, `fast: ${fast.bpm}`);
  assert.ok(fast.speed > 1.15 && slow.speed < 0.85, `${slow.speed} vs ${fast.speed}`);
});

test('spectral flux counts rises only', () => {
  assert.equal(spectralFlux([1, 2, 0], [0, 3, 0]), 1);
});

test('presets: their motion is scaled by VIZ_DRIVE.motion', () => {
  const preset = { baseVals: {}, frame_eqs_str: 'a.zoom=1.1;a.rot=0.2;', pixel_eqs_str: '' };
  const driven = withDrive(preset);
  assert.equal(preset.frame_eqs_str, 'a.zoom=1.1;a.rot=0.2;', 'the original is left alone');
  assert.equal(driven.pixel_eqs_str, '', 'no per-pixel equations added where there were none');
  const run = (motion) => {
    globalThis.VIZ_DRIVE = { motion };
    const a = { zoom: 1, rot: 0, warp: 1, dx: 0.01, dy: 0, sx: 1.2, sy: 1 };
    return new Function('a', driven.frame_eqs_str + ' return a;')(a);
  };
  assert.deepEqual(run(1), { zoom: 1.1, rot: 0.2, warp: 1, dx: 0.01, dy: 0, sx: 1.2, sy: 1 });
  const still = run(0);
  assert.deepEqual([still.zoom, still.rot, still.warp, still.dx, still.sx], [1, 0, 0, 0, 1], 'no motion at all');
  const half = run(0.5);
  assert.ok(Math.abs(half.zoom - 1.05) < 1e-9 && Math.abs(half.rot - 0.1) < 1e-9);
  delete globalThis.VIZ_DRIVE;
});
