/**
 * Klänge der Partie, im Browser erzeugt (Web Audio, keine Tondateien, docs/ASSETS.md): Horn für
 * „Du bist dran“, Federstrich für eine Wahl, Glocke für richtig, dumpfer Schlag für falsch,
 * Trommel für eine Eroberung, Schildklang für eine Verteidigung, Donner für einen Treffer auf die
 * Hauptstadt, Fanfare für den Sieg. Abschaltbar; die Wahl bleibt im Browser gespeichert.
 * Ohne Web Audio (alte Browser, Tests) passiert einfach nichts.
 */

export const SOUND_CUES = [
  'turn',
  'pick',
  'answer',
  'correct',
  'wrong',
  'conquer',
  'defend',
  'capitalHit',
  'fall',
  'victory',
  'defeat',
] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

const STORAGE_KEY = 'rdw.sound';
const listeners = new Set<(on: boolean) => void>();
/** Gewählter Zustand dieser Seite, falls der Browser nichts speichern darf. */
let memory: boolean | null = null;

export function soundEnabled(): boolean {
  if (memory !== null) return memory;
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Speichern verboten (privates Fenster): gilt dann nur für diese Seite
  }
  memory = on;
  for (const listener of listeners) listener(on);
}

export function onSoundChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let context: AudioContext | null = null;
let master: GainNode | null = null;

/** Muss einmal aus einer Nutzeraktion heraus laufen, sonst bleibt der Ton stumm (Autoplay-Regel). */
export function unlockAudio(): void {
  const Ctor =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  if (!context) {
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.8;
    master.connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume();
}

/** Gibt den Ton beim ersten Tippen oder Tastendruck irgendwo in der App frei (einmal in main). */
export function installAudioUnlock(): void {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

interface Voice {
  readonly at: number;
  readonly freq: number;
  readonly dur: number;
  readonly type?: OscillatorType;
  readonly gain?: number;
  /** Zielfrequenz am Ende (Gleiten). */
  readonly to?: number;
  readonly attack?: number;
  /** Tiefpass für weichere Töne. */
  readonly lowpass?: number;
}

interface Noise {
  readonly at: number;
  readonly dur: number;
  readonly gain?: number;
  readonly lowpass?: number;
  readonly highpass?: number;
}

function voice(ctx: BaseAudioContext, out: AudioNode, t0: number, v: Voice): void {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  const start = t0 + v.at;
  const end = start + v.dur;
  const peak = v.gain ?? 0.2;
  osc.type = v.type ?? 'sine';
  osc.frequency.setValueAtTime(v.freq, start);
  if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, end);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(peak, start + (v.attack ?? 0.01));
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  let node: AudioNode = osc;
  if (v.lowpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = v.lowpass;
    osc.connect(filter);
    node = filter;
  }
  node.connect(env);
  env.connect(out);
  osc.start(start);
  osc.stop(end + 0.05);
}

let noiseBuffer: AudioBuffer | null = null;

function noise(ctx: BaseAudioContext, out: AudioNode, t0: number, n: Noise): void {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    // Fester Pseudozufall: gleiches Rauschen bei jedem Start
    let seed = 0x2f6b2a;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const env = ctx.createGain();
  const start = t0 + n.at;
  const end = start + n.dur;
  env.gain.setValueAtTime(n.gain ?? 0.2, start);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  let node: AudioNode = src;
  for (const [type, freq] of [
    ['lowpass', n.lowpass],
    ['highpass', n.highpass],
  ] as const) {
    if (!freq) continue;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    node.connect(filter);
    node = filter;
  }
  node.connect(env);
  env.connect(out);
  src.start(start);
  src.stop(end + 0.05);
}

// Tonhöhen (Hz)
const C4 = 261.63;
const D4 = 293.66;
const E4 = 329.63;
const G4 = 392;
const B3 = 246.94;
const EB4 = 311.13;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.5;
const G6 = 1568;

const RECIPES: Record<SoundCue, { voices?: readonly Voice[]; noises?: readonly Noise[] }> = {
  turn: {
    voices: [
      { at: 0, freq: G4, dur: 0.2, type: 'sawtooth', gain: 0.12, lowpass: 1400, attack: 0.03 },
      { at: 0.18, freq: C5, dur: 0.45, type: 'sawtooth', gain: 0.14, lowpass: 1600, attack: 0.03 },
      { at: 0.18, freq: C4, dur: 0.45, type: 'triangle', gain: 0.08, attack: 0.03 },
    ],
  },
  pick: {
    voices: [{ at: 0, freq: 900, to: 620, dur: 0.09, type: 'triangle', gain: 0.1 }],
    noises: [{ at: 0, dur: 0.05, gain: 0.08, highpass: 2500 }],
  },
  answer: { voices: [{ at: 0, freq: 640, to: 520, dur: 0.06, type: 'triangle', gain: 0.12 }] },
  correct: {
    voices: [
      { at: 0, freq: C6, dur: 0.6, gain: 0.12 },
      { at: 0.07, freq: E6, dur: 0.6, gain: 0.1 },
      { at: 0.14, freq: G6, dur: 0.8, gain: 0.1 },
    ],
  },
  wrong: {
    voices: [{ at: 0, freq: 170, to: 85, dur: 0.32, gain: 0.3 }],
    noises: [{ at: 0, dur: 0.12, gain: 0.12, lowpass: 500 }],
  },
  conquer: {
    voices: [
      { at: 0, freq: 95, to: 55, dur: 0.35, gain: 0.35 },
      { at: 0.12, freq: C5, dur: 0.25, type: 'triangle', gain: 0.1 },
      { at: 0.22, freq: E5, dur: 0.25, type: 'triangle', gain: 0.1 },
      { at: 0.32, freq: G5, dur: 0.5, type: 'triangle', gain: 0.11 },
    ],
    noises: [{ at: 0, dur: 0.22, gain: 0.25, lowpass: 220 }],
  },
  defend: {
    voices: [
      { at: 0, freq: 520, dur: 0.45, gain: 0.08 },
      { at: 0, freq: 1233, dur: 0.35, gain: 0.05 },
      { at: 0, freq: 1847, dur: 0.25, gain: 0.04 },
      { at: 0, freq: 2412, dur: 0.18, gain: 0.03 },
    ],
    noises: [{ at: 0, dur: 0.04, gain: 0.1, highpass: 3000 }],
  },
  capitalHit: {
    voices: [{ at: 0, freq: 75, to: 38, dur: 0.75, gain: 0.45 }],
    noises: [
      { at: 0, dur: 0.06, gain: 0.18, highpass: 2500 },
      { at: 0, dur: 0.55, gain: 0.3, lowpass: 300 },
    ],
  },
  fall: {
    voices: [
      { at: 0, freq: G4, dur: 0.3, type: 'triangle', gain: 0.14 },
      { at: 0.25, freq: EB4, dur: 0.3, type: 'triangle', gain: 0.14 },
      { at: 0.5, freq: C4, dur: 0.7, type: 'triangle', gain: 0.15 },
    ],
  },
  victory: {
    voices: [
      { at: 0, freq: C5, dur: 0.16, type: 'sawtooth', gain: 0.1, lowpass: 2000 },
      { at: 0.14, freq: E5, dur: 0.16, type: 'sawtooth', gain: 0.1, lowpass: 2000 },
      { at: 0.28, freq: G5, dur: 0.16, type: 'sawtooth', gain: 0.1, lowpass: 2000 },
      { at: 0.42, freq: C6, dur: 0.9, type: 'sawtooth', gain: 0.12, lowpass: 2400 },
      { at: 0.42, freq: G5, dur: 0.9, type: 'triangle', gain: 0.08 },
      { at: 0.42, freq: E5, dur: 0.9, type: 'triangle', gain: 0.08 },
    ],
    noises: [{ at: 0.42, dur: 0.3, gain: 0.15, lowpass: 200 }],
  },
  defeat: {
    voices: [
      { at: 0, freq: E4, dur: 0.4, gain: 0.12 },
      { at: 0.35, freq: D4, dur: 0.4, gain: 0.12 },
      { at: 0.7, freq: C4, dur: 0.4, gain: 0.12 },
      { at: 1.05, freq: B3, dur: 0.9, gain: 0.12 },
    ],
  },
};

/** Plant einen Klang ab `t0` in einen beliebigen Audiokontext (auch offline zum Prüfen). */
export function scheduleCue(
  ctx: BaseAudioContext,
  out: AudioNode,
  cue: SoundCue,
  t0: number,
): void {
  const recipe = RECIPES[cue];
  for (const v of recipe.voices ?? []) voice(ctx, out, t0, v);
  for (const n of recipe.noises ?? []) noise(ctx, out, t0, n);
}

/** Spielt einen Klang, wenn eingeschaltet und freigegeben; `delayMs` für Abfolgen. */
export function playSound(cue: SoundCue, delayMs = 0): void {
  if (!soundEnabled() || !context || !master || context.state !== 'running') return;
  scheduleCue(context, master, cue, context.currentTime + delayMs / 1000 + 0.01);
}
