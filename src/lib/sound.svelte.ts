// Sounds, made on the spot with Web Audio: no files, no third parties. Off by default (the family's
// rule since Stichle, 2026-10-12), switched on per device in Settings (`skibbo:sound`). A browser
// only plays sound after a tap, so the context starts on the first pointer or key press. On a call
// each device plays its own. From Stammtisch's sound.svelte.ts.

const KEY = 'skibbo:sound';

function stored() {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export const sound = $state({ on: stored() });

export function setSound(on: boolean) {
  sound.on = on;
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // not kept
  }
}

let ctx: AudioContext | null = null;

function context() {
  if (!sound.on) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Unlocks audio on the first gesture (browsers start contexts suspended until then). */
export function unlockOnGesture() {
  const go = () => {
    context();
    removeEventListener('pointerdown', go);
    removeEventListener('keydown', go);
  };
  addEventListener('pointerdown', go);
  addEventListener('keydown', go);
}

/** One soft note: a sine with a quick attack and a decay. */
function note(freq: number, at: number, length: number, gain = 0.12, type: OscillatorType = 'sine') {
  const c = context();
  if (!c) return;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(amp).connect(c.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

/** A short burst of noise through a band-pass: glass on glass, a pencil on paper. */
function click(at: number, freq: number, length = 0.05, gain = 0.18, q = 1.2) {
  const c = context();
  if (!c) return;
  const t = c.currentTime + at;
  const frames = Math.max(1, Math.floor(c.sampleRate * length));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = q;
  const amp = c.createGain();
  amp.gain.value = gain;
  src.connect(band).connect(amp).connect(c.destination);
  src.start(t);
}

let lastClack = 0;

export const play = {
  /** A plate lands on a pile: enamel on enamel, a short bright clink. */
  clink: () => {
    const now = performance.now();
    if (now - lastClack < 40) return;
    lastClack = now;
    click(0, 3600 + Math.random() * 900, 0.05, 0.22, 4);
    note(2350 + Math.random() * 200, 0, 0.12, 0.025, 'sine');
  },
  /** A plate laid on a discard pile: duller, the turn's end. */
  lay: () => {
    click(0, 1800, 0.07, 0.2, 2);
  },
  /** It's your turn. */
  yourTurn: () => {
    note(587.3, 0, 0.14, 0.09, 'triangle');
    note(784, 0.12, 0.24, 0.09, 'triangle');
  },
  /** A pile reaches 12 and is cleared: a little run up. */
  cleared: () => [659.3, 784, 1046.5].forEach((f, i) => note(f, i * 0.08, 0.3, 0.07, 'triangle')),
  /** Your stock card played: a shimmer. */
  stock: () => [1046.5, 1318.5, 1568].forEach((f, i) => note(f, i * 0.05, 0.42, 0.045)),
  /** The last seconds. */
  tick: () => note(1200, 0, 0.05, 0.05, 'square'),
  /** The match's winner. */
  fanfare: () => [523.3, 659.3, 784, 1046.5].forEach((f, i) => note(f, i * 0.12, 0.4, 0.09, 'triangle')),
};
