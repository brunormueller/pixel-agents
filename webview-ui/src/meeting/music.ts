/// <reference lib="dom" />
// ^ Web Audio types for the Node-side test program (tsconfig.node.json), which type-checks this
//   module through its test without the DOM lib.

/**
 * Meeting soundtrack: five procedural, royalty-free tracks synthesized live with the Web Audio API.
 *
 * Everyone in a meeting must hear the same bar at the same moment, and all the app shares is
 * "track X started at relay time T". So composition is a pure function of the track id (seeded
 * PRNG, never Math.random) and playback is seekable: `play(id, secondsSinceT)` maps song time onto
 * the AudioContext clock and a lookahead scheduler plays the looping score from that point on.
 */

import {
  MEETING_MUSIC_DEFAULT_VOLUME,
  MEETING_MUSIC_LOOKAHEAD_SEC,
  MEETING_MUSIC_TICK_MS,
} from '../constants.js';

export interface MusicTrack {
  id: string;
  title: string;
  mood: string;
  bpm: number;
}

export type MusicVoice = 'lead' | 'bass' | 'chord' | 'pad' | 'kick' | 'snare' | 'hat' | 'crackle';

/** velocity 0..1; drums ignore midi (0). */
export interface MusicNote {
  step: number;
  voice: MusicVoice;
  midi: number;
  lengthSteps: number;
  velocity: number;
}

/** notes sorted by step; every step in [0, loopSteps). */
export interface ComposedTrack {
  id: string;
  bpm: number;
  stepsPerBeat: number;
  loopSteps: number;
  swing: number;
  notes: MusicNote[];
}

// ── Composition data ────────────────────────────────────────────

const STEPS_PER_BEAT = 4;
const BAR_STEPS = 16;
/** Each part folds its notes into the octave above its floor (MIDI): closed voicings that
 *  voice-lead from chord to chord for free. */
const BASS_LOW = 40;
const CHORD_LOW = 55;
const PAD_LOW = 50;
const BELL_LOW = 72;
/** Drum pattern characters → velocity ('.' = rest). */
const HIT: Readonly<Record<string, number>> = { x: 0.62, o: 0.42, '-': 0.24 };
/** ± velocity jitter so repeated hits don't sound stamped out. */
const HUMANIZE = 0.1;
/** Melody contour moves in scale degrees, weighted toward steps over leaps. */
const MELODY_MOVES = [-2, -1, -1, 0, 1, 1, 2] as const;
/** How far above the tonic (in scale degrees past one octave) the melody may climb. */
const MELODY_HEADROOM = 2;
/** Bossa guitar comping: short chord stabs on these steps of every bar. */
const BOSSA_COMP = 'x..x..x...x..x..';
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PENTATONIC = [0, 2, 4, 7, 9];
const NOTE_PCS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITIES: Readonly<Record<string, readonly number[]>> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  '6': [0, 4, 7, 9],
};

interface Chord {
  pc: number; // root pitch class
  tones: readonly number[]; // semitones above the root
}
/** Patterns index by step, cycling (16 chars = one bar, 32 = two). `fill` replaces the snare on
 *  the last bar of every 8-bar phrase. */
interface Kit {
  kick: string;
  snare: string;
  hat: string;
  fill: string;
  snareLen: number;
}
interface Lead {
  from: number; // first bar
  to: number; // bar after the last
  lens: readonly number[]; // note lengths to pick from (steps)
  rest: number; // chance an 8th slot rests
}
interface Style {
  track: MusicTrack;
  bars: number;
  key: number; // MIDI of the scale's tonic; the lead sits an octave above
  scale: readonly number[];
  chords: readonly Chord[]; // one per bar, cycled
  bass: 'lazy' | 'bossa' | 'octaves' | 'pulse' | 'drone';
  comp?: 'hold' | 'bossa' | 'bells';
  pad?: boolean;
  arp?: boolean;
  lead?: Lead;
  kit?: Kit;
  swing?: number;
  crackle?: number; // chance per step of a vinyl (or rain) click
}

/** 'Gm7 C7 Fmaj7' → roots + tones (flats only). */
function chords(symbols: string): Chord[] {
  return symbols.split(' ').map((sym) => {
    const m = /^([A-G])(b?)(.*)$/.exec(sym);
    const tones = m ? QUALITIES[m[3]] : undefined;
    if (!m || !tones) throw new Error(`Bad chord symbol: ${sym}`);
    return { pc: (NOTE_PCS[m[1]] + (m[2] ? 11 : 0)) % 12, tones };
  });
}

const STYLES: readonly Style[] = [
  {
    track: { id: 'lofi', title: 'Lo-fi Study', mood: 'chill', bpm: 76 },
    bars: 16,
    key: 53,
    scale: PENTATONIC,
    chords: chords('Gm7 C7 Fmaj7 Dm7 Bbmaj7 Am7 Gm7 A7'), // ii-V-I-vi, IV-iii-ii-V/vi
    bass: 'lazy',
    comp: 'hold',
    lead: { from: 4, to: 12, lens: [2, 2, 4, 6], rest: 0.55 },
    kit: {
      kick: 'x......o..x.....',
      snare: '....x.......x...',
      hat: 'o.o.o.o.o.o.o.oo',
      fill: '....x.......x.-o',
      snareLen: 2,
    },
    swing: 0.18,
    crackle: 0.3,
  },
  {
    track: { id: 'bossa', title: 'Pixel Bossa', mood: 'warm', bpm: 118 },
    bars: 16,
    key: 60,
    scale: MAJOR,
    chords: chords('Cmaj7 Am7 Dm7 G7 Em7 A7 Dm7 G7'),
    bass: 'bossa',
    comp: 'bossa',
    lead: { from: 4, to: 12, lens: [2, 3, 4], rest: 0.5 },
    kit: {
      kick: 'x.....o.x.....o.',
      snare: 'x.....x.....x.......x...x.......', // 3-2 clave on the rim
      hat: '-o-o-o-o-o-o-o-o', // shaker
      fill: '',
      snareLen: 1,
    },
  },
  {
    track: { id: 'arcade', title: 'Arcade Break', mood: 'upbeat', bpm: 132 },
    bars: 8,
    key: 57,
    scale: MINOR,
    chords: chords('Am F C G'),
    bass: 'octaves',
    arp: true,
    lead: { from: 4, to: 8, lens: [2, 2, 4], rest: 0.45 },
    kit: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: 'o-x-o-x-o-x-o-x-',
      fill: '....x.......xoxx',
      snareLen: 2,
    },
  },
  {
    track: { id: 'synthwave', title: 'Night Drive', mood: 'focus', bpm: 96 },
    bars: 16,
    key: 50,
    scale: MINOR,
    chords: chords('Dm7 C Bbmaj7 C6'),
    bass: 'pulse',
    pad: true,
    lead: { from: 4, to: 12, lens: [4, 6, 8], rest: 0.6 },
    kit: {
      kick: 'x.......x.o.....',
      snare: '....x.......x...',
      hat: '-.o.-.o.-.o.-.o.',
      fill: '....x.......x.oo',
      snareLen: 3, // long, hard-cut noise: the gated snare
    },
  },
  {
    track: { id: 'ambient', title: 'Rain Garden', mood: 'calm', bpm: 60 },
    bars: 16,
    key: 48,
    scale: PENTATONIC,
    chords: chords('Fmaj7 G6 Am7 Em7'),
    bass: 'drone',
    comp: 'bells',
    pad: true,
    crackle: 0.12, // rain on the window
  },
];

export const MUSIC_TRACKS: readonly MusicTrack[] = STYLES.map((s) => s.track);

const styleOf = (id: string): Style | undefined =>
  typeof id === 'string' ? STYLES.find((s) => s.track.id === id) : undefined;

export function isMusicTrack(id: string): boolean {
  return styleOf(id) !== undefined;
}

export function musicTrack(id: string): MusicTrack | undefined {
  return styleOf(id)?.track;
}

// ── Composition ─────────────────────────────────────────────────

/** FNV-1a: a stable 32-bit seed from the track id. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: tiny and integer-only, so every engine draws the same stream. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rand: () => number, items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)];
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const mod12 = (n: number): number => ((n % 12) + 12) % 12;
/** `midi` moved by octaves into [low, low + 12). */
const fold = (midi: number, low: number): number => low + mod12(midi - low);
const voiced = (chord: Chord, low: number): number[] =>
  chord.tones.map((t) => fold(chord.pc + t, low)).sort((a, b) => a - b);

function scaleMidi(style: Style, degree: number): number {
  const n = style.scale.length;
  return style.key + 12 * (1 + Math.floor(degree / n)) + style.scale[((degree % n) + n) % n];
}

/** The chord tone nearest `midi` (ties go up), so held and on-beat melody notes stay consonant. */
function snapToChord(chord: Chord, midi: number): number {
  const pcs = chord.tones.map((t) => mod12(chord.pc + t));
  for (let d = 0; d < 7; d++) {
    if (pcs.includes(mod12(midi + d))) return midi + d;
    if (pcs.includes(mod12(midi - d))) return midi - d;
  }
  return midi;
}

interface MotifNote {
  at: number;
  len: number;
  degree: number;
  vel: number;
}

/** A 2-bar rhythm + scale-degree contour; phrases reuse motifs so the tune repeats like a tune. */
function motif(rand: () => number, lead: Lead, top: number): MotifNote[] {
  const out: MotifNote[] = [];
  let degree = 1 + Math.floor(rand() * 3);
  for (let t = 0; t < BAR_STEPS * 2;) {
    if (rand() < lead.rest) {
      t += 2;
      continue;
    }
    const len = Math.min(pick(rand, lead.lens), BAR_STEPS * 2 - t);
    degree = clamp(degree + pick(rand, MELODY_MOVES), 0, top);
    out.push({ at: t, len, degree, vel: 0.42 + rand() * 0.2 });
    t += len;
  }
  if (out.length === 0) out.push({ at: 0, len: 4, degree: 2, vel: 0.5 });
  return out;
}

/** Pure + deterministic: same id => deep-equal result. Throws on an unknown id. */
export function composeTrack(id: string): ComposedTrack {
  const style = styleOf(id);
  if (!style) throw new Error(`Unknown music track: ${id}`);
  const rand = mulberry32(hashId(id));
  const notes: MusicNote[] = [];
  const add = (step: number, voice: MusicVoice, midi: number, len: number, vel: number) => {
    const velocity = Math.round(clamp(vel, 0.05, 1) * 100) / 100;
    notes.push({ step, voice, midi, lengthSteps: len, velocity });
  };
  const human = (vel: number) => vel * (1 - HUMANIZE + 2 * HUMANIZE * rand());
  const chordAt = (bar: number) => style.chords[bar % style.chords.length];
  const { lead, kit } = style;

  for (let bar = 0; bar < style.bars; bar++) {
    const at = bar * BAR_STEPS;
    const chord = chordAt(bar);
    const root = fold(chord.pc, BASS_LOW);
    const nextRoot = fold(chordAt(bar + 1).pc, BASS_LOW);

    switch (style.bass) {
      case 'lazy': // late second hit, sometimes a chromatic walk-up into the next bar
        add(at, 'bass', root, 7, human(0.55));
        add(at + 10, 'bass', rand() < 0.5 ? root : root + 7, 4, human(0.45));
        if (rand() < 0.4) add(at + 14, 'bass', nextRoot - 1, 2, human(0.4));
        break;
      case 'bossa': // root-fifth, anticipating the next root on the last 8th
        add(at, 'bass', root, 6, human(0.55));
        add(at + 6, 'bass', root + 7, 2, human(0.45));
        add(at + 8, 'bass', root + 7, 6, human(0.5));
        add(at + 14, 'bass', nextRoot, 2, human(0.45));
        break;
      case 'octaves':
      case 'pulse':
        for (let s = 0; s < BAR_STEPS; s += 2) {
          const up = style.bass === 'octaves' && s % 4 === 2;
          add(at + s, 'bass', up ? root + 12 : root, 1, s % 4 === 0 ? 0.55 : 0.41);
        }
        break;
      case 'drone':
        add(at, 'bass', root, BAR_STEPS, 0.32);
        break;
    }

    const tones = voiced(chord, CHORD_LOW);
    if (style.comp === 'hold') {
      const rehit = rand() < 0.35;
      for (const m of tones) {
        add(at, 'chord', m, rehit ? 10 : 15, human(0.42));
        if (rehit) add(at + 10, 'chord', m, 6, human(0.3));
      }
    } else if (style.comp === 'bossa') {
      for (let s = 0; s < BAR_STEPS; s++)
        if (BOSSA_COMP[s] === 'x') for (const m of tones) add(at + s, 'chord', m, 2, human(0.34));
    } else if (style.comp === 'bells') {
      const bells = voiced(chord, BELL_LOW);
      const used = new Set<number>();
      for (let n = 1 + Math.floor(rand() * 2); n > 0; n--) {
        const s = Math.floor(rand() * 8) * 2;
        if (!used.has(s)) add(at + s, 'chord', pick(rand, bells), 8, human(0.38));
        used.add(s);
      }
    }

    if (style.pad) {
      // Open the voicing (second note up an octave): a closed cluster turns to mud this low.
      const pad = voiced(chord, PAD_LOW);
      pad[1] += 12;
      for (const m of pad) add(at, 'pad', m, BAR_STEPS, 0.5);
    }

    if (style.arp) {
      // Up on even bars, down on odd; thinned to 8ths while the melody plays over it.
      const arp = [...tones.slice(0, 3), tones[0] + 12];
      if (bar % 2 === 1) arp.reverse();
      const every = lead && bar >= lead.from && bar < lead.to ? 2 : 1;
      for (let s = 0; s < BAR_STEPS; s += every)
        add(at + s, 'lead', arp[(s / every) % arp.length], every, s % 4 === 0 ? 0.36 : 0.28);
    }

    if (kit) {
      const snares = (bar + 1) % 8 === 0 && kit.fill ? kit.fill : kit.snare;
      for (let i = at; i < at + BAR_STEPS; i++) {
        const kick = HIT[kit.kick[i % kit.kick.length]];
        const snare = HIT[snares[i % snares.length]];
        const hat = HIT[kit.hat[i % kit.hat.length]];
        if (kick) add(i, 'kick', 0, 1, human(kick));
        if (snare) add(i, 'snare', 0, kit.snareLen, human(snare));
        if (hat) add(i, 'hat', 0, 1, human(hat));
      }
    }
  }

  if (lead) {
    // Phrases go A A B A — repetition is what makes a handful of notes read as a melody.
    const top = style.scale.length + MELODY_HEADROOM;
    const motifs = [motif(rand, lead, top), motif(rand, lead, top)];
    for (let bar = lead.from, p = 0; bar < lead.to; bar += 2, p++) {
      for (const n of motifs[p % 4 === 2 ? 1 : 0]) {
        const midi = scaleMidi(style, n.degree);
        const strong = n.at % 8 === 0 || n.len >= 4;
        const chord = chordAt(bar + Math.floor(n.at / BAR_STEPS));
        add(bar * BAR_STEPS + n.at, 'lead', strong ? snapToChord(chord, midi) : midi, n.len, n.vel);
      }
    }
  }

  const loopSteps = style.bars * BAR_STEPS;
  const crackle = style.crackle ?? 0;
  for (let s = 0; s < loopSteps; s++)
    if (rand() < crackle) add(s, 'crackle', 0, 1, 0.2 + rand() * 0.4);

  notes.sort((a, b) => a.step - b.step); // stable: same-step order stays deterministic
  const { bpm } = style.track;
  return { id, bpm, stepsPerBeat: STEPS_PER_BEAT, loopSteps, swing: style.swing ?? 0, notes };
}

/** Seconds per step. Pure. */
export function stepSeconds(track: ComposedTrack): number {
  return 60 / track.bpm / track.stepsPerBeat;
}

/** The loop length in seconds. Pure. */
export function loopSeconds(track: ComposedTrack): number {
  return track.loopSteps * stepSeconds(track);
}

/** Pure: which step is playing `offsetSec` seconds into the (looping) song, and how far into
 *  that step (seconds). Grid position: swing is not applied. */
export function positionAt(
  track: ComposedTrack,
  offsetSec: number,
): { step: number; intoStep: number } {
  const step = stepSeconds(track);
  const loop = loopSeconds(track);
  const t = Number.isFinite(offsetSec) ? ((offsetSec % loop) + loop) % loop : 0;
  const s = Math.min(track.loopSteps - 1, Math.floor(t / step));
  return { step: s, intoStep: t - s * step };
}

// ── Playback ────────────────────────────────────────────────────

/** Per-voice peak levels: a quiet bed under conversation, drums and bass carrying the groove. */
const GAIN: Readonly<Record<MusicVoice, number>> = {
  lead: 0.16,
  bass: 0.34,
  chord: 0.11,
  pad: 0.045,
  kick: 0.55,
  snare: 0.24,
  hat: 0.09,
  crackle: 0.08,
};
/** Pitched voices: oscillators (paired waves are detuned apart), lowpass (0 = none), and the
 *  envelope [attack s, decay time-constant s, sustain ratio, release time-constant s]. */
interface Timbre {
  waves: readonly OscillatorType[];
  detune: number;
  cutoff: number;
  shape: readonly [number, number, number, number];
}
const TIMBRES: Readonly<Record<'lead' | 'bass' | 'chord' | 'bell' | 'pad', Timbre>> = {
  lead: { waves: ['square'], detune: 0, cutoff: 2500, shape: [0.01, 0.1, 0.6, 0.05] },
  bass: { waves: ['triangle'], detune: 0, cutoff: 0, shape: [0.005, 0.2, 0.7, 0.04] },
  chord: { waves: ['triangle'], detune: 0, cutoff: 0, shape: [0.015, 0.4, 0.35, 0.2] }, // e-piano-ish
  bell: { waves: ['sine'], detune: 0, cutoff: 0, shape: [0.015, 0.4, 0.35, 0.6] },
  pad: { waves: ['sawtooth', 'sawtooth'], detune: 8, cutoff: 900, shape: [0.8, 1, 1, 0.4] },
};
/** Noise voices: highpass cutoff and decay (s). */
const SNARE_CUTOFF_HZ = 1500;
const SNARE_TONE_HZ = 185;
const RIM_TONE_HZ = 480;
const HAT_CUTOFF_HZ = 7000;
const HAT_DECAY_SEC = 0.04;
const CRACKLE_CUTOFF_HZ = 2500;
const CRACKLE_DECAY_SEC = 0.006;
const KICK_FROM_HZ = 120;
const KICK_TO_HZ = 45;
/** setTargetAtTime is inaudible (~-43 dB) after this many time constants. */
const RELEASE_TAUS = 5;
/** Noise hits start somewhere early in the 1 s buffer so they don't repeat exactly. */
const NOISE_START_SPAN_SEC = 0.6;
/** A re-sent offset this close to where we already are is the same moment: don't restart. */
const RESYNC_TOLERANCE_SEC = 0.5;
const STOP_FADE_SEC = 0.12;
const VOLUME_RAMP_TAU_SEC = 0.05;
const GESTURES = ['pointerdown', 'keydown'] as const;

const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);
const wallNow = (): number => performance.now() / 1000;

function bucketize(track: ComposedTrack): MusicNote[][] {
  const buckets: MusicNote[][] = Array.from({ length: track.loopSteps }, () => []);
  for (const n of track.notes) buckets[n.step].push(n);
  return buckets;
}

export class MeetingMusic {
  private ctx: AudioContext | null = null;
  private input: AudioNode | null = null; // the compressor every playback bus feeds
  private master: GainNode | null = null;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private noise: AudioBuffer | null = null;
  /** One bus per playback, so stop() can fade it out without touching the next one. */
  private bus: GainNode | null = null;
  private readonly live = new Set<AudioScheduledSourceNode>();
  private readonly composed = new Map<string, ComposedTrack>();
  private track: ComposedTrack | null = null;
  private buckets: MusicNote[][] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Song time 0 on the wall clock: survives a suspended context, whose clock stands still. */
  private wallStart = 0;
  /** Song time 0 on the context clock, set whenever the context is (again) running. */
  private songStart = 0;
  private anchored = false;
  private nextStep = 0; // absolute: loop * loopSteps + step
  private volume = MEETING_MUSIC_DEFAULT_VOLUME;
  private watching = false;
  private disposed = false;

  get playing(): string | null {
    return this.track?.id ?? null;
  }

  play(trackId: string, offsetSec: number): void {
    if (this.disposed) return;
    if (!isMusicTrack(trackId)) return this.stop();
    const ctx = this.ensureContext();
    if (!ctx || !this.input) return;
    if (ctx.state === 'suspended') {
      // Autoplay policy: resume now if allowed, else on the person's next gesture.
      void ctx.resume().catch(() => undefined);
      this.watchGestures(true);
    }
    const offset = Number.isFinite(offsetSec) ? Math.max(0, offsetSec) : 0;
    const track = this.composed.get(trackId) ?? composeTrack(trackId);
    this.composed.set(trackId, track);
    if (this.track?.id === trackId && this.bus) {
      const loop = loopSeconds(track);
      const drift = Math.abs(this.position() - offset) % loop;
      if (Math.min(drift, loop - drift) < RESYNC_TOLERANCE_SEC) return;
    }
    this.silence();
    this.track = track;
    this.buckets = bucketize(track);
    this.bus = ctx.createGain();
    this.bus.connect(this.input);
    this.wallStart = wallNow() - offset;
    this.anchored = false;
    this.timer ??= setInterval(() => this.tick(), MEETING_MUSIC_TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.track = null;
    this.buckets = [];
    this.silence();
  }

  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    this.volume = clamp(volume, 0, 1);
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state === 'closed') return;
    const gain = this.master.gain;
    gain.cancelScheduledValues(ctx.currentTime);
    gain.setValueAtTime(gain.value, ctx.currentTime);
    gain.setTargetAtTime(this.volume, ctx.currentTime, VOLUME_RAMP_TAU_SEC);
  }

  getVolume(): number {
    return this.volume;
  }

  captureStream(): MediaStream | null {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state === 'closed') return null;
    if (!this.streamDest) {
      this.streamDest = ctx.createMediaStreamDestination();
      this.master.connect(this.streamDest);
    }
    return this.streamDest.stream;
  }

  dispose(): void {
    this.stop();
    this.watchGestures(false);
    this.disposed = true;
    const ctx = this.ctx;
    this.dropContext();
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  }

  /** Where the song actually is: the audio clock once anchored (it drifts from the wall clock
   *  over a long meeting, and a resync should catch that), else the wall clock. */
  private position(): number {
    const ctx = this.ctx;
    return this.anchored && ctx?.state === 'running'
      ? ctx.currentTime - this.songStart
      : wallNow() - this.wallStart;
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx?.state === 'closed') this.dropContext(); // closed under us: start over
    if (this.ctx) return this.ctx;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    // Gentle glue ahead of the volume, so the recording hears the same mix at any volume.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    comp.connect(master).connect(ctx.destination);
    this.ctx = ctx;
    this.input = comp;
    this.master = master;
    return ctx;
  }

  private dropContext(): void {
    this.ctx = this.input = this.master = this.streamDest = this.noise = this.bus = null;
    this.live.clear();
  }

  private readonly unlock = (): void => {
    const ctx = this.ctx;
    if (ctx?.state !== 'suspended') return this.watchGestures(false);
    void ctx.resume().then(
      () => this.watchGestures(false),
      () => undefined,
    );
  };

  private watchGestures(on: boolean): void {
    if (typeof window === 'undefined' || on === this.watching) return;
    this.watching = on;
    for (const type of GESTURES) {
      if (on) window.addEventListener(type, this.unlock, true);
      else window.removeEventListener(type, this.unlock, true);
    }
  }

  /** Fades the current bus out and cuts every note it still has queued or ringing. */
  private silence(): void {
    const { ctx, bus } = this;
    this.bus = null;
    if (!ctx || !bus || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(0, now + STOP_FADE_SEC);
    for (const src of this.live) {
      try {
        src.stop(now + STOP_FADE_SEC);
      } catch {
        // already stopped
      }
    }
    this.live.clear();
    setTimeout(() => bus.disconnect(), STOP_FADE_SEC * 1000 + 100);
  }

  private tick(): void {
    const { ctx, track, bus } = this;
    if (!ctx || !track || !bus) return;
    if (ctx.state !== 'running') {
      this.anchored = false; // its clock stands still: re-anchor to the wall clock on resume
      return;
    }
    const step = stepSeconds(track);
    const now = ctx.currentTime;
    if (!this.anchored) {
      const offset = wallNow() - this.wallStart;
      this.songStart = now - offset;
      this.nextStep = Math.ceil(offset / step); // skip the partly elapsed step
      this.anchored = true;
    }
    // A throttled timer fell behind: skip what is already past rather than burst it out.
    this.nextStep = Math.max(this.nextStep, Math.ceil((now - this.songStart) / step));
    const horizon = now + MEETING_MUSIC_LOOKAHEAD_SEC;
    for (;;) {
      const base = this.songStart + this.nextStep * step;
      if (base >= horizon) break;
      const s = this.nextStep % track.loopSteps;
      const at = base + (s % 2 === 1 ? track.swing * step : 0);
      for (const note of this.buckets[s]) this.voice(ctx, note, at, note.lengthSteps * step, bus);
      this.nextStep++;
    }
  }

  /** Stops `sources` at `stopAt` and disconnects the note once its last source has ended. */
  private finish(sources: AudioScheduledSourceNode[], nodes: AudioNode[], stopAt: number): void {
    let left = sources.length;
    for (const src of sources) {
      this.live.add(src);
      src.onended = () => {
        this.live.delete(src);
        src.disconnect();
        if (--left === 0) for (const n of nodes) n.disconnect();
      };
      src.stop(stopAt);
    }
  }

  private noiseSource(ctx: AudioContext, t: number): AudioBufferSourceNode {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, Math.random() * NOISE_START_SPAN_SEC);
    return src;
  }

  private voice(ctx: AudioContext, note: MusicNote, t: number, dur: number, out: AudioNode): void {
    const peak = note.velocity * GAIN[note.voice];
    const g = ctx.createGain();
    g.connect(out);
    const filter = (type: BiquadFilterType, freq: number) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      return f;
    };
    const osc = (type: OscillatorType, freq: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.start(t);
      return o;
    };
    const decay = (param: AudioParam, from: number, sec: number) => {
      param.setValueAtTime(from, t);
      param.exponentialRampToValueAtTime(0.0001, t + sec);
    };

    switch (note.voice) {
      case 'lead':
      case 'bass':
      case 'chord':
      case 'pad': {
        const timbre =
          TIMBRES[note.voice === 'chord' && note.midi >= BELL_LOW ? 'bell' : note.voice];
        const [attack, decayTau, sustain, releaseTau] = timbre.shape;
        const lp = timbre.cutoff ? filter('lowpass', timbre.cutoff) : null;
        lp?.connect(g);
        const oscs = timbre.waves.map((wave, i) => {
          const o = osc(wave, hz(note.midi));
          o.detune.value = i % 2 ? timbre.detune : -timbre.detune;
          o.connect(lp ?? g);
          return o;
        });
        // ADSR: attack (never longer than 40% of the note), settle, release past the note's end.
        const rise = Math.min(attack, dur * 0.4);
        const off = t + Math.max(dur, rise);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + rise);
        g.gain.setTargetAtTime(peak * sustain, t + rise, decayTau);
        g.gain.setTargetAtTime(0, off, releaseTau);
        this.finish(oscs, lp ? [lp, g] : [g], off + releaseTau * RELEASE_TAUS);
        break;
      }
      case 'kick': {
        const o = osc('sine', KICK_FROM_HZ);
        o.frequency.setValueAtTime(KICK_FROM_HZ, t);
        o.frequency.exponentialRampToValueAtTime(KICK_TO_HZ, t + 0.12);
        o.connect(g);
        decay(g.gain, peak, 0.3);
        this.finish([o], [g], t + 0.32);
        break;
      }
      case 'snare': {
        // Length sets the tail: a short tick reads as a rim click, a long hard-cut one as gated.
        const len = clamp(dur * 0.5, 0.05, 0.25);
        const rim = len < 0.08;
        const n = this.noiseSource(ctx, t);
        const hp = filter('highpass', SNARE_CUTOFF_HZ);
        n.connect(hp).connect(g);
        g.gain.setValueAtTime(rim ? peak * 0.5 : peak, t);
        g.gain.linearRampToValueAtTime(peak * 0.35, t + len);
        g.gain.setTargetAtTime(0, t + len, 0.012);
        const body = ctx.createGain();
        body.connect(out);
        const o = osc('triangle', rim ? RIM_TONE_HZ : SNARE_TONE_HZ);
        o.connect(body);
        decay(body.gain, peak * 0.5, 0.07);
        this.finish([n, o], [hp, g, body], t + len + 0.08);
        break;
      }
      case 'hat':
      case 'crackle': {
        const hat = note.voice === 'hat';
        const n = this.noiseSource(ctx, t);
        const hp = filter('highpass', hat ? HAT_CUTOFF_HZ : CRACKLE_CUTOFF_HZ);
        n.connect(hp).connect(g);
        const sec = hat ? HAT_DECAY_SEC : CRACKLE_DECAY_SEC;
        decay(g.gain, peak, sec);
        this.finish([n], [hp, g], t + sec + 0.02);
        break;
      }
    }
  }
}
