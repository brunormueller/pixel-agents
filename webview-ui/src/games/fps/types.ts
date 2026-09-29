// webview-ui/src/games/fps/types.ts
//
// Pixel Frag's shapes: weapons, a map compiled for play, the actors that run
// around in it (the player, other people, bots) and how hard bots are.

import type {
  AvatarLook,
  FpsConfig,
  FpsDifficulty,
  FpsMapData,
} from '../../../../core/src/messages.js';

export type { FpsConfig, FpsDifficulty, FpsMapData };

export type WeaponSlot = 0 | 1 | 2;
export type AmmoKind = 'shells' | 'bullets';

export interface WeaponDef {
  slot: WeaponSlot;
  name: string;
  /** null = never runs out. */
  ammo: AmmoKind | null;
  /** Damage per pellet at point blank; `falloff` cells away it is half. */
  damage: number;
  falloff: number;
  pellets: number;
  /** Radians either side a pellet may stray. */
  spread: number;
  /** Seconds between shots. */
  cooldown: number;
  range: number;
}

export const WEAPONS: readonly WeaponDef[] = [
  {
    slot: 0,
    name: 'Pistol',
    ammo: null,
    damage: 16,
    falloff: 30,
    pellets: 1,
    spread: 0.012,
    cooldown: 0.4,
    range: 40,
  },
  {
    slot: 1,
    name: 'Shotgun',
    ammo: 'shells',
    damage: 11,
    falloff: 5,
    pellets: 7,
    spread: 0.09,
    cooldown: 0.85,
    range: 24,
  },
  {
    slot: 2,
    name: 'Chaingun',
    ammo: 'bullets',
    damage: 7,
    falloff: 16,
    pellets: 1,
    spread: 0.035,
    cooldown: 0.11,
    range: 40,
  },
];

/** What a cell of a compiled map is. */
export const Cell = { FLOOR: 0, WALL: 1, BLOCK: 2 } as const;
export type Cell = (typeof Cell)[keyof typeof Cell];

/** A map ready to play in: per-cell kind, texture index and walkability. */
export interface FpsWorld {
  data: FpsMapData;
  cols: number;
  rows: number;
  /** Cell kind (Cell.*). */
  kind: Uint8Array;
  /** Index into data.walls / data.floors / data.blocks, by kind. */
  tex: Uint8Array;
  /** 1 = nobody walks here (walls, blocks, furniture). */
  solid: Uint8Array;
  /** Cells a player can reach from the spawns (the rest are shut rooms). */
  reachable: Uint8Array;
}

/** Someone in the match — this office's player, another person, or a bot. */
export interface Actor {
  id: string;
  name: string;
  bot: boolean;
  /** Position in cells, facing in radians (0 = east, growing clockwise on screen). */
  x: number;
  y: number;
  a: number;
  hp: number;
  alive: boolean;
  weapon: WeaponSlot;
  shells: number;
  bullets: number;
  /** Seconds until the weapon fires again. */
  cooldown: number;
  /** Shots fired so far: a change is a muzzle flash where the others see it. */
  shot: number;
  moving: boolean;
  /** While dead: seconds until back in. */
  respawnIn: number;
  /** Seconds of spawn protection left. */
  guard: number;
  palette: number;
  hueShift: number;
  look: AvatarLook | null;
  /** Drawing only: walk cycle, muzzle flash and hurt timers. */
  walkPhase: number;
  flash: number;
}

export interface DifficultyParams {
  /** Seconds from first sight to first shot. */
  reaction: number;
  /** Radians per second a bot turns. */
  turnSpeed: number;
  /** Radians its aim is off, at random, per shot. */
  aimError: number;
  /** How far it notices someone (cells), and its field of view (radians). */
  sight: number;
  fov: number;
  /** Fraction of full speed it moves at. */
  speed: number;
  /** It shoots in bursts: seconds on the trigger, then seconds off it. */
  burst: number;
  pause: number;
}

export const DIFFICULTY: Record<FpsDifficulty, DifficultyParams> = {
  easy: {
    reaction: 0.9,
    turnSpeed: 2.2,
    aimError: 0.2,
    sight: 12,
    fov: 1.6,
    speed: 0.7,
    burst: 0.5,
    pause: 1.1,
  },
  normal: {
    reaction: 0.55,
    turnSpeed: 3.6,
    aimError: 0.11,
    sight: 16,
    fov: 2,
    speed: 0.85,
    burst: 0.8,
    pause: 0.7,
  },
  hard: {
    reaction: 0.3,
    turnSpeed: 6,
    aimError: 0.055,
    sight: 22,
    fov: 2.4,
    speed: 1,
    burst: 1.2,
    pause: 0.35,
  },
};

export const DEFAULT_FPS_CONFIG: FpsConfig = {
  map: 'arena',
  bots: 3,
  difficulty: 'normal',
  fragLimit: 10,
  timeLimit: 5,
};

/** Input for one frame of the local player. */
export interface FpsInput {
  forward: number;
  strafe: number;
  /** Radians to turn this frame (mouse + keys). */
  turn: number;
  run: boolean;
  fire: boolean;
  /** A weapon picked this frame, or null. */
  weapon: WeaponSlot | null;
  /** +1 / -1 = next / previous weapon (mouse wheel). */
  cycle: number;
}

export const NO_INPUT: FpsInput = {
  forward: 0,
  strafe: 0,
  turn: 0,
  run: false,
  fire: false,
  weapon: null,
  cycle: 0,
};
