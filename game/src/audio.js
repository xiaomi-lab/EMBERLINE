// audio.js — EMBERLINE: Saltworks Yard
// Procedural WebAudio only: no audio files, no network.
// The AudioContext is created lazily on the first user gesture:
// call unlock() from a click / key handler before any sound
// can play. Every method is a safe no-op until unlock() has
// run, so game code can call sound methods unconditionally.
// How the pieces fit together:
//   * unlock() — call once from a user gesture (click / keydown).
//     Browsers block AudioContext before a gesture, so nothing
//     here creates one at import time or on first method call.
//   * tone() / noise() — the only two sound builders. Every
//     public method is a short arrangement of one or both, so
//     new sounds stay consistent and cheap to add.
//   * All scheduling uses ctx.currentTime offsets, never
//     setTimeout, so sounds stay in sync with the game clock
//     even if the main thread stalls for a frame.
//   * Master gain sits at 0.6 by default; setVolume() lets the
//     settings menu scale everything at once without touching
//     individual sounds.
//
// Every method is a safe no-op until unlock() has run, so game
// code can call sound methods unconditionally.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let stepFlip = false;

  // Per-weapon shot profiles: noise length, filter sweep and
  // the low thump underneath. 'enemy' is deliberately duller
  // so incoming fire reads differently from the player's own.
  const SHOTS = {
    pistol: { dur: 0.11, from: 2600, to: 500, thump: 150, gain: 0.5 },
    rifle: { dur: 0.16, from: 3200, to: 350, thump: 110, gain: 0.65 },
    smg: { dur: 0.09, from: 3800, to: 700, thump: 170, gain: 0.45 },
    sniper: { dur: 0.32, from: 2200, to: 120, thump: 70, gain: 0.8 },
    enemy: { dur: 0.13, from: 1800, to: 400, thump: 130, gain: 0.4 },
  };

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
    // One 1-second white-noise buffer, shared by all sounds.
    const len = ctx.sampleRate;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  // Short oscillator tone with an exponential decay envelope.
  function tone(freq, dur, type, gain, when = 0, slideTo = 0) {
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // Filtered burst from the shared noise buffer.
  function noise(dur, from, to, gain, type = 'lowpass', when = 0) {
    if (!ctx || !master || !noiseBuf) return;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, t0);
    if (to > 0 && to !== from) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(to, 20), t0 + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function beep(freq, dur = 0.08, gain = 0.3, when = 0) {
    tone(freq, dur, 'sine', gain, when);
  }

  return {
    unlock,

    // Scale the master gain, 0 (silent) to 1. Safe no-op
    // before unlock(); the value is clamped, never trusted.
    setVolume(v) {
      if (!master) return;
      const clamped = Math.min(1, Math.max(0, Number(v) || 0));
      master.gain.setTargetAtTime(clamped * 0.6, ctx.currentTime, 0.02);
    },

    shot(kind) {
      const p = SHOTS[kind] || SHOTS.rifle;
      noise(p.dur, p.from, p.to, p.gain);
      tone(p.thump, 0.09, 'sine', 0.5, 0, p.thump * 0.45);
    },

    dryFire() {
      tone(1300, 0.03, 'square', 0.12);
    },

    reload() {
      // Two mechanical clicks: mag out, mag in.
      tone(700, 0.04, 'square', 0.14, 0);
      noise(0.04, 2500, 1200, 0.1, 'bandpass', 0);
      tone(950, 0.04, 'square', 0.16, 0.22);
      noise(0.05, 3000, 1400, 0.12, 'bandpass', 0.22);
    },

    hit() {
      beep(880, 0.07, 0.28);
    },

    kill() {
      tone(660, 0.09, 'sine', 0.3, 0);
      tone(990, 0.14, 'sine', 0.3, 0.09);
    },

    explosion() {
      // Long noise burst sweeping down, plus a sub sine.
      noise(0.9, 3000, 90, 0.9);
      tone(55, 0.8, 'sine', 0.8, 0, 30);
      noise(0.35, 900, 200, 0.4, 'lowpass', 0.05);
    },

    plantBeep() {
      beep(1000, 0.09, 0.32);
    },

    defuseBeep() {
      beep(1250, 0.09, 0.32);
    },

    buy() {
      tone(880, 0.08, 'sine', 0.25, 0);
      tone(1320, 0.12, 'sine', 0.25, 0.08);
    },

    roundWin() {
      tone(523, 0.14, 'sine', 0.3, 0);
      tone(659, 0.14, 'sine', 0.3, 0.13);
      tone(784, 0.22, 'sine', 0.32, 0.26);
    },

    roundLose() {
      tone(392, 0.16, 'sine', 0.3, 0);
      tone(330, 0.16, 'sine', 0.3, 0.15);
      tone(262, 0.26, 'sine', 0.32, 0.3);
    },

    step() {
      // Quiet alternating footstep tick; hot path, keep it tiny.
      stepFlip = !stepFlip;
      noise(0.05, stepFlip ? 900 : 700, 300, 0.08, 'lowpass');
    },

    grenadePin() {
      tone(2400, 0.03, 'square', 0.14);
      noise(0.03, 5000, 3000, 0.1, 'highpass', 0.02);
    },
  };
}
