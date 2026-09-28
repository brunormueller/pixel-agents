// webview-ui/src/office/engine/emotes.ts
//
// Emotes: what a person's character can do for fun. Two kinds:
// - motion (dance, jump, spin): the character itself moves. A purely VISUAL
//   layer over the FSM — facing, walk frame and a hop offset — so it never
//   fights pathfinding or seating, and plays the same on a remote character
//   that follows its office's pose.
// - reactions (wave, heart, clap, laugh, party): an emoji floats up from the
//   head (EmoteOverlay); the character gets at most a small hop.
// Pure: OfficeState ticks it, the renderer and overlay read it.

import type { RemoteEmote } from '../../../../core/src/messages.js';
import {
  EMOTE_BEAT_SEC,
  EMOTE_DANCE_HOP_PX,
  EMOTE_JUMP_HOP_PX,
  EMOTE_JUMP_HOPS,
  EMOTE_REACTION_HOP_PX,
  EMOTE_SPIN_STEP_SEC,
} from '../../constants.js';
import type { Character } from '../types.js';
import { Direction } from '../types.js';

export type EmoteKind = RemoteEmote;

export interface Emote {
  kind: EmoteKind;
  /** Seconds since it started. */
  t: number;
  /** Bumped per start, so a remote replays the same emote triggered twice. */
  seq: number;
}

interface EmoteDef {
  label: string;
  /** Floating emoji (reactions; dance shows notes). */
  emoji: string | null;
  /** Seconds; Infinity = loops until stopped. */
  duration: number;
  /** Moves the character: needs it idle, and the keyboard free. */
  motion: boolean;
  /** Number key that triggers it. */
  key: string;
}

export const EMOTES: Record<EmoteKind, EmoteDef> = {
  dance: { label: 'Dance', emoji: '🎶', duration: Infinity, motion: true, key: '1' },
  wave: { label: 'Wave', emoji: '👋', duration: 2, motion: false, key: '2' },
  heart: { label: 'Heart', emoji: '❤️', duration: 2.5, motion: false, key: '3' },
  clap: { label: 'Clap', emoji: '👏', duration: 2, motion: false, key: '4' },
  laugh: { label: 'Laugh', emoji: '😂', duration: 2, motion: false, key: '5' },
  party: { label: 'Party', emoji: '🎉', duration: 2.5, motion: false, key: '6' },
  jump: {
    label: 'Jump',
    emoji: null,
    duration: EMOTE_JUMP_HOPS * EMOTE_BEAT_SEC * 2,
    motion: true,
    key: '7',
  },
  spin: { label: 'Spin', emoji: null, duration: 1.2, motion: true, key: '8' },
};

export const EMOTE_ORDER: EmoteKind[] = [
  'dance',
  'wave',
  'heart',
  'clap',
  'laugh',
  'party',
  'jump',
  'spin',
];

export function isEmoteKind(v: unknown): v is EmoteKind {
  return typeof v === 'string' && v in EMOTES;
}

/** Number key (1-8) → emote, or null. */
export function emoteForKey(key: string): EmoteKind | null {
  return EMOTE_ORDER.find((k) => EMOTES[k].key === key) ?? null;
}

/** Advance an emote; returns false once it has run its course. */
export function advanceEmote(emote: Emote, dt: number): boolean {
  emote.t += dt;
  return emote.t < EMOTES[emote.kind].duration;
}

export interface EmoteLook {
  /** Facing to draw instead of the character's own; null = keep. */
  dir: Direction | null;
  /** Walk frame (0-3) to draw instead of the FSM's pose; null = keep. */
  walkFrame: number | null;
  /** Upward offset in sprite pixels (≤ 0). */
  hop: number;
}

const NO_LOOK: EmoteLook = { dir: null, walkFrame: null, hop: 0 };
/** Dance: two beats each side, facing front in between — a sway. */
const DANCE_DIRS = [
  Direction.DOWN,
  Direction.LEFT,
  Direction.DOWN,
  Direction.RIGHT,
  Direction.DOWN,
  Direction.LEFT,
  Direction.UP,
  Direction.RIGHT,
];
const SPIN_DIRS = [Direction.DOWN, Direction.RIGHT, Direction.UP, Direction.LEFT];

/** A bounce of `px` peaking once per `period` seconds, whole pixels (pixel-perfect). */
const bounce = (t: number, period: number, px: number): number =>
  -Math.round(px * Math.abs(Math.sin((t / period) * Math.PI)));

/** How the character looks at this moment of its emote. */
export function emoteLook(emote: Emote | null | undefined): EmoteLook {
  if (!emote) return NO_LOOK;
  const { t } = emote;
  switch (emote.kind) {
    case 'dance': {
      const beat = Math.floor(t / EMOTE_BEAT_SEC);
      return {
        dir: DANCE_DIRS[beat % DANCE_DIRS.length],
        // Step feet on the beat: alternate the two stride frames
        walkFrame: beat % 2 === 0 ? 0 : 2,
        hop: bounce(t, EMOTE_BEAT_SEC, EMOTE_DANCE_HOP_PX),
      };
    }
    case 'jump':
      return { dir: null, walkFrame: 1, hop: bounce(t, EMOTE_BEAT_SEC * 2, EMOTE_JUMP_HOP_PX) };
    case 'spin':
      return {
        dir: SPIN_DIRS[Math.floor(t / EMOTE_SPIN_STEP_SEC) % SPIN_DIRS.length],
        walkFrame: 1,
        hop: 0,
      };
    case 'party':
      return { dir: null, walkFrame: null, hop: bounce(t, EMOTE_BEAT_SEC, EMOTE_REACTION_HOP_PX) };
    default:
      // Reactions: one small hop at the start, then just the floating emoji.
      return {
        dir: null,
        walkFrame: null,
        hop: t < EMOTE_BEAT_SEC ? bounce(t, EMOTE_BEAT_SEC, EMOTE_REACTION_HOP_PX) : 0,
      };
  }
}

/** Whether a motion emote is playing (the sprite comes from emoteLook, not the FSM). */
export function playsMotionEmote(ch: Character): boolean {
  return !!ch.emote && EMOTES[ch.emote.kind].motion;
}
