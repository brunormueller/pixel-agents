// webview-ui/src/games/fps/sim.ts
//
// Pixel Frag's rules, pure (no DOM, no clock, randomness passed in): compiling
// a map for play, moving round it, rays and shots, pickups, spawn points, and
// how a bot decides what to do. Node-tested (webview-ui/test/fpsSim.test.ts).

import type { FpsItemKind, FpsMapData } from '../../../../core/src/messages.js';
import {
  FPS_BULLETS_PICKUP,
  FPS_HEALTH_PICKUP,
  FPS_HIT_RADIUS,
  FPS_MAX_BULLETS,
  FPS_MAX_HP,
  FPS_MAX_SHELLS,
  FPS_MUZZLE_FLASH_SEC,
  FPS_SHELLS_PICKUP,
} from '../../constants.js';
import type { Actor, DifficultyParams, FpsWorld, WeaponSlot } from './types.js';
import { Cell, WEAPONS } from './types.js';

export type Rng = () => number;

const TAU = Math.PI * 2;

/** b - a, wrapped into (-π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

export const wrapAngle = (a: number): number => ((a % TAU) + TAU) % TAU;

/** Turn `from` toward `to` by at most `step` radians. */
export function turnToward(from: number, to: number, step: number): number {
  const d = angleDiff(from, to);
  if (Math.abs(d) <= step) return wrapAngle(to);
  return wrapAngle(from + Math.sign(d) * step);
}

// ── Maps ─────────────────────────────────────────────────────

const CODE_A = 65;
const CODE_Z = 90;
const CODE_LOWER_A = 97;
const CODE_LOWER_Z = 122;
const CODE_0 = 48;
const CODE_9 = 57;

/** Turn map data into what play reads per cell. The border is always wall, so every ray ends. */
export function compileWorld(data: FpsMapData): FpsWorld {
  const { cols, rows, cells } = data;
  const n = cols * rows;
  const kind = new Uint8Array(n);
  const tex = new Uint8Array(n);
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const code = cells.charCodeAt(i);
    const col = i % cols;
    const row = Math.floor(i / cols);
    const border = col === 0 || row === 0 || col === cols - 1 || row === rows - 1;
    if (code >= CODE_LOWER_A && code <= CODE_LOWER_Z && !border) {
      kind[i] = Cell.FLOOR;
      tex[i] = Math.min(code - CODE_LOWER_A, Math.max(0, data.floors.length - 1));
    } else if (code >= CODE_0 && code <= CODE_9 && !border && data.blocks.length > 0) {
      kind[i] = Cell.BLOCK;
      tex[i] = Math.min(code - CODE_0, data.blocks.length - 1);
    } else {
      kind[i] = Cell.WALL;
      const w = code >= CODE_A && code <= CODE_Z ? code - CODE_A : 0;
      tex[i] = w < data.walls.length ? w : 0;
    }
    solid[i] = kind[i] === Cell.FLOOR ? 0 : 1;
  }
  for (const i of data.solid) if (i >= 0 && i < n) solid[i] = 1;

  const world: FpsWorld = { data, cols, rows, kind, tex, solid, reachable: new Uint8Array(n) };
  // Where people can actually get to: flood from every spawn.
  const queue: number[] = [];
  for (const s of data.spawns) {
    const i = Math.floor(s.y) * cols + Math.floor(s.x);
    if (i >= 0 && i < n && !solid[i] && !world.reachable[i]) {
      world.reachable[i] = 1;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of [i - 1, i + 1, i - cols, i + cols]) {
      if (j < 0 || j >= n || solid[j] || world.reachable[j]) continue;
      world.reachable[j] = 1;
      queue.push(j);
    }
  }
  return world;
}

export function isSolid(w: FpsWorld, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= w.cols || cy >= w.rows) return true;
  return w.solid[cy * w.cols + cx] === 1;
}

/** Stops rays and shots: walls only (people shoot over desks and crates). */
export function isOpaque(w: FpsWorld, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= w.cols || cy >= w.rows) return true;
  return w.kind[cy * w.cols + cx] === Cell.WALL;
}

/** Whether a square of half-size r centred at (x, y) overlaps anything solid. */
export function collides(w: FpsWorld, x: number, y: number, r: number): boolean {
  const x0 = Math.floor(x - r);
  const x1 = Math.floor(x + r);
  const y0 = Math.floor(y - r);
  const y1 = Math.floor(y + r);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) if (isSolid(w, cx, cy)) return true;
  }
  return false;
}

const SKIN = 1e-4;

/** Move by (dx, dy), each axis on its own, stopping flush against what is in the way (slides along walls). */
export function moveCircle(
  w: FpsWorld,
  pos: { x: number; y: number },
  dx: number,
  dy: number,
  r: number,
): void {
  // Sub-steps keep a fast move from tunnelling through a thin corner.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (r * 0.9)));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0) {
      const nx = pos.x + sx;
      if (!collides(w, nx, pos.y, r)) pos.x = nx;
      else if (sx > 0) pos.x = Math.max(pos.x, Math.floor(nx + r) - r - SKIN);
      else pos.x = Math.min(pos.x, Math.floor(nx - r) + 1 + r + SKIN);
    }
    if (sy !== 0) {
      const ny = pos.y + sy;
      if (!collides(w, pos.x, ny, r)) pos.y = ny;
      else if (sy > 0) pos.y = Math.max(pos.y, Math.floor(ny + r) - r - SKIN);
      else pos.y = Math.min(pos.y, Math.floor(ny - r) + 1 + r + SKIN);
    }
  }
}

/** Distance from (x, y) along the unit vector (dx, dy) to the first wall, at most `max`. */
export function rayToWall(
  w: FpsWorld,
  x: number,
  y: number,
  dx: number,
  dy: number,
  max: number,
): number {
  let mapX = Math.floor(x);
  let mapY = Math.floor(y);
  const ddx = dx === 0 ? 1e30 : Math.abs(1 / dx);
  const ddy = dy === 0 ? 1e30 : Math.abs(1 / dy);
  const stepX = dx < 0 ? -1 : 1;
  const stepY = dy < 0 ? -1 : 1;
  let sideX = dx < 0 ? (x - mapX) * ddx : (mapX + 1 - x) * ddx;
  let sideY = dy < 0 ? (y - mapY) * ddy : (mapY + 1 - y) * ddy;
  for (;;) {
    let d: number;
    if (sideX < sideY) {
      d = sideX;
      sideX += ddx;
      mapX += stepX;
    } else {
      d = sideY;
      sideY += ddy;
      mapY += stepY;
    }
    if (d >= max) return max;
    if (isOpaque(w, mapX, mapY)) return d;
  }
}

export function hasLineOfSight(
  w: FpsWorld,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const dist = Math.hypot(bx - ax, by - ay);
  if (dist < 1e-6) return true;
  return rayToWall(w, ax, ay, (bx - ax) / dist, (by - ay) / dist, dist) >= dist - 1e-6;
}

export interface Target {
  id: string;
  x: number;
  y: number;
}

/** Where a ray from (ox, oy) along the unit vector (dx, dy) enters a circle, or null. */
export function rayCircle(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  r: number,
): number | null {
  const lx = cx - ox;
  const ly = cy - oy;
  const t = lx * dx + ly * dy;
  if (t < 0) return null;
  const perp2 = lx * lx + ly * ly - t * t;
  if (perp2 > r * r) return null;
  return Math.max(0, t - Math.sqrt(r * r - perp2));
}

/** One bullet: the nearest target it meets before a wall (and how far), else where it hit the wall. */
export function traceShot(
  w: FpsWorld,
  ox: number,
  oy: number,
  angle: number,
  range: number,
  targets: readonly Target[],
): { hit: Target | null; dist: number } {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const wall = rayToWall(w, ox, oy, dx, dy, range);
  let best: Target | null = null;
  let bestDist = wall;
  for (const t of targets) {
    const d = rayCircle(ox, oy, dx, dy, t.x, t.y, FPS_HIT_RADIUS);
    if (d !== null && d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return { hit: best, dist: bestDist };
}

export interface ShotResult {
  /** Damage dealt, per target id. */
  damage: Map<string, number>;
  /** Where the pellets ended (a wall, or someone). */
  impacts: Array<{ x: number; y: number; blood: boolean }>;
}

export function hasAmmo(a: Actor, slot: WeaponSlot): boolean {
  const ammo = WEAPONS[slot].ammo;
  return ammo === null || a[ammo] > 0;
}

/** The best weapon that still has ammo (the chaingun first, the pistol last). */
export function bestWeapon(a: Actor): WeaponSlot {
  for (const slot of [2, 1, 0] as WeaponSlot[]) if (hasAmmo(a, slot)) return slot;
  return 0;
}

/**
 * Fire the shooter's weapon at whoever is in the way: spends ammo, starts the
 * cooldown, counts the shot. Null when it cannot fire (cooling down, dead,
 * empty). `aimError` is extra random stray (a bot's shaky aim).
 */
export function fireWeapon(
  w: FpsWorld,
  shooter: Actor,
  targets: readonly Actor[],
  rng: Rng,
  aimError = 0,
): ShotResult | null {
  if (!shooter.alive || shooter.cooldown > 0) return null;
  const def = WEAPONS[shooter.weapon];
  if (def.ammo !== null) {
    if (shooter[def.ammo] <= 0) return null;
    shooter[def.ammo] -= 1;
  }
  shooter.cooldown = def.cooldown;
  shooter.shot += 1;
  shooter.flash = FPS_MUZZLE_FLASH_SEC;
  const others = targets.filter((t) => t.alive && t.id !== shooter.id);
  const damage = new Map<string, number>();
  const impacts: ShotResult['impacts'] = [];
  const aim = shooter.a + (rng() * 2 - 1) * aimError;
  for (let p = 0; p < def.pellets; p++) {
    const angle = aim + (rng() * 2 - 1) * def.spread;
    const { hit, dist } = traceShot(w, shooter.x, shooter.y, angle, def.range, others);
    const end = hit ? dist : Math.max(0, dist - 0.05);
    impacts.push({
      x: shooter.x + Math.cos(angle) * end,
      y: shooter.y + Math.sin(angle) * end,
      blood: hit !== null,
    });
    if (!hit) continue;
    const dealt = Math.max(1, Math.round(def.damage / (1 + dist / def.falloff)));
    damage.set(hit.id, (damage.get(hit.id) ?? 0) + dealt);
  }
  return { damage, impacts };
}

/** Pick an item up if it does the actor any good. */
export function applyPickup(a: Actor, kind: FpsItemKind): boolean {
  switch (kind) {
    case 'health':
      if (a.hp >= FPS_MAX_HP) return false;
      a.hp = Math.min(FPS_MAX_HP, a.hp + FPS_HEALTH_PICKUP);
      return true;
    case 'shells':
      if (a.shells >= FPS_MAX_SHELLS) return false;
      a.shells = Math.min(FPS_MAX_SHELLS, a.shells + FPS_SHELLS_PICKUP);
      return true;
    case 'bullets':
      if (a.bullets >= FPS_MAX_BULLETS) return false;
      a.bullets = Math.min(FPS_MAX_BULLETS, a.bullets + FPS_BULLETS_PICKUP);
      return true;
  }
}

/** A spawn point far from everyone alive: one of the three best, at random. */
export function pickSpawn(
  w: FpsWorld,
  others: ReadonlyArray<{ x: number; y: number; alive: boolean }>,
  rng: Rng,
): { x: number; y: number } {
  const alive = others.filter((o) => o.alive);
  const spawns = w.data.spawns.filter(
    (s) => w.reachable[Math.floor(s.y) * w.cols + Math.floor(s.x)] === 1,
  );
  const pool = spawns.length > 0 ? spawns : w.data.spawns;
  const scored = pool
    .map((s) => ({
      s,
      d: alive.reduce((m, o) => Math.min(m, Math.hypot(o.x - s.x, o.y - s.y)), Infinity),
    }))
    .sort((a, b) => b.d - a.d);
  const pick = scored[Math.floor(rng() * Math.min(3, scored.length))] ?? scored[0];
  return { x: pick.s.x, y: pick.s.y };
}

/** The facing with the longest clear view (of eight): a spawned player looks into the room, not at a wall. */
export function openFacing(w: FpsWorld, x: number, y: number): number {
  let best = 0;
  let bestDist = -1;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const d = rayToWall(w, x, y, Math.cos(a), Math.sin(a), 64);
    if (d > bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best;
}

// ── Paths ────────────────────────────────────────────────────

/** Shortest walk between two cells (8 ways, no cutting corners): cell centres after the start, or null. */
export function findPath(
  w: FpsWorld,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): Array<{ x: number; y: number }> | null {
  const start = Math.floor(sy) * w.cols + Math.floor(sx);
  const goal = Math.floor(ty) * w.cols + Math.floor(tx);
  const n = w.cols * w.rows;
  if (goal < 0 || goal >= n || w.solid[goal]) return null;
  if (start === goal) return [];
  const prev = new Int32Array(n).fill(-1);
  prev[start] = start;
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    if (i === goal) break;
    const cx = i % w.cols;
    const cy = (i - cx) / w.cols;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        const nx = cx + ox;
        const ny = cy + oy;
        if (isSolid(w, nx, ny)) continue;
        if (ox !== 0 && oy !== 0 && (isSolid(w, cx + ox, cy) || isSolid(w, cx, cy + oy))) continue;
        const j = ny * w.cols + nx;
        if (prev[j] !== -1) continue;
        prev[j] = i;
        queue.push(j);
      }
    }
  }
  if (prev[goal] === -1) return null;
  const path: Array<{ x: number; y: number }> = [];
  for (let i = goal; i !== start; i = prev[i]) {
    path.push({ x: (i % w.cols) + 0.5, y: Math.floor(i / w.cols) + 0.5 });
  }
  return path.reverse();
}

/** A random cell people can reach. */
export function randomOpenCell(w: FpsWorld, rng: Rng): { x: number; y: number } | null {
  for (let tries = 0; tries < 200; tries++) {
    const i = Math.floor(rng() * w.cols * w.rows);
    if (w.reachable[i] && !w.solid[i]) {
      return { x: (i % w.cols) + 0.5, y: Math.floor(i / w.cols) + 0.5 };
    }
  }
  return null;
}

// ── Bots ─────────────────────────────────────────────────────

/** What a bot keeps in mind between frames. */
export interface BotBrain {
  targetId: string | null;
  /** Seconds the current target has been in sight (it shoots after its reaction time). */
  seenFor: number;
  lastSeen: { x: number; y: number } | null;
  lastSeenAge: number;
  path: Array<{ x: number; y: number }>;
  pathAge: number;
  strafe: number;
  strafeTimer: number;
  /** On the trigger (true) or between bursts, and for how long yet. */
  firing: boolean;
  burstTimer: number;
  /** Stuck detection: where it was a moment ago. */
  checkX: number;
  checkY: number;
  checkTimer: number;
}

export function newBrain(): BotBrain {
  return {
    targetId: null,
    seenFor: 0,
    lastSeen: null,
    lastSeenAge: 0,
    path: [],
    pathAge: 0,
    strafe: 1,
    strafeTimer: 0,
    firing: true,
    burstTimer: 0,
    checkX: 0,
    checkY: 0,
    checkTimer: 0,
  };
}

export interface BotIntent {
  /** World-space direction to move in (length ≤ 1). */
  moveX: number;
  moveY: number;
  /** Where to look. */
  face: number;
  fire: boolean;
  weapon: WeaponSlot;
}

export interface ItemState {
  x: number;
  y: number;
  k: FpsItemKind;
  available: boolean;
}

const BOT_KEEP_DISTANCE_FAR = 7;
const BOT_KEEP_DISTANCE_NEAR = 2.5;
const BOT_HEAR_DISTANCE = 2.5;
const BOT_FIRE_CONE = 0.14;
const BOT_MEMORY_SEC = 4;
const BOT_REPATH_SEC = 8;
const BOT_WAYPOINT_REACHED = 0.35;
const BOT_LOW_HEALTH = 45;

/** Who the bot can see (or hear, up close): the nearest, keeping its current target while it can. */
function spotTarget(
  w: FpsWorld,
  bot: Actor,
  brain: BotBrain,
  actors: readonly Actor[],
  p: DifficultyParams,
): Actor | null {
  let best: Actor | null = null;
  let bestDist = Infinity;
  for (const other of actors) {
    if (other.id === bot.id || !other.alive || other.guard > 0) continue;
    const d = Math.hypot(other.x - bot.x, other.y - bot.y);
    if (d > p.sight) continue;
    const facing = Math.abs(angleDiff(bot.a, Math.atan2(other.y - bot.y, other.x - bot.x)));
    if (facing > p.fov / 2 && d > BOT_HEAR_DISTANCE && other.id !== brain.targetId) continue;
    if (!hasLineOfSight(w, bot.x, bot.y, other.x, other.y)) continue;
    // Stick with the current target unless someone is much closer.
    const score = other.id === brain.targetId ? d * 0.6 : d;
    if (score < bestDist) {
      bestDist = score;
      best = other;
    }
  }
  return best;
}

function chooseWeapon(bot: Actor, dist: number): WeaponSlot {
  if (dist < 4 && bot.shells > 0) return 1;
  if (bot.bullets > 0) return 2;
  if (bot.shells > 0) return 1;
  return 0;
}

/** One frame of a bot's thinking: where it goes, where it looks, whether it shoots. Mutates the brain only. */
export function thinkBot(
  w: FpsWorld,
  bot: Actor,
  brain: BotBrain,
  actors: readonly Actor[],
  items: readonly ItemState[],
  p: DifficultyParams,
  dt: number,
  rng: Rng,
): BotIntent {
  brain.pathAge += dt;
  brain.lastSeenAge += dt;
  brain.strafeTimer -= dt;
  if (brain.strafeTimer <= 0) {
    brain.strafe = rng() < 0.5 ? -1 : 1;
    brain.strafeTimer = 0.6 + rng() * 0.9;
  }

  brain.burstTimer -= dt;
  if (brain.burstTimer <= 0) {
    brain.firing = !brain.firing;
    brain.burstTimer = (brain.firing ? p.burst : p.pause) * (0.6 + rng() * 0.8);
  }

  const target = spotTarget(w, bot, brain, actors, p);
  if (target) {
    if (target.id !== brain.targetId) brain.seenFor = 0;
    brain.targetId = target.id;
    brain.seenFor += dt;
    brain.lastSeen = { x: target.x, y: target.y };
    brain.lastSeenAge = 0;
    brain.path = [];
    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    const dist = Math.hypot(dx, dy);
    const face = Math.atan2(dy, dx);
    const ux = dx / dist;
    const uy = dy / dist;
    // Close in from afar, back off up close, side-step all the while.
    const along = dist > BOT_KEEP_DISTANCE_FAR ? 1 : dist < BOT_KEEP_DISTANCE_NEAR ? -0.7 : 0;
    let mx = ux * along - uy * brain.strafe * 0.8;
    let my = uy * along + ux * brain.strafe * 0.8;
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    const weapon = chooseWeapon(bot, dist);
    const aimed = Math.abs(angleDiff(bot.a, face)) < BOT_FIRE_CONE;
    return {
      moveX: mx,
      moveY: my,
      face,
      fire: aimed && brain.firing && brain.seenFor >= p.reaction && dist <= WEAPONS[weapon].range,
      weapon,
    };
  }

  brain.targetId = null;
  brain.seenFor = 0;

  // Stuck against something: forget the plan.
  brain.checkTimer -= dt;
  if (brain.checkTimer <= 0) {
    if (brain.path.length > 0 && Math.hypot(bot.x - brain.checkX, bot.y - brain.checkY) < 0.1) {
      brain.path = [];
    }
    brain.checkX = bot.x;
    brain.checkY = bot.y;
    brain.checkTimer = 1;
  }

  if (brain.path.length === 0 || brain.pathAge > BOT_REPATH_SEC) {
    let goal: { x: number; y: number } | null;
    if (brain.lastSeen && brain.lastSeenAge < BOT_MEMORY_SEC) {
      goal = brain.lastSeen;
      brain.lastSeen = null;
    } else {
      const wanted = items.filter(
        (it) =>
          it.available &&
          (it.k === 'health'
            ? bot.hp < BOT_LOW_HEALTH
            : it.k === 'shells'
              ? bot.shells < 8
              : bot.bullets < 30),
      );
      if (wanted.length > 0 && rng() < 0.7) {
        goal = wanted.reduce((m, it) =>
          Math.hypot(it.x - bot.x, it.y - bot.y) < Math.hypot(m.x - bot.x, m.y - bot.y) ? it : m,
        );
      } else {
        goal = randomOpenCell(w, rng);
      }
    }
    brain.path = goal ? (findPath(w, bot.x, bot.y, goal.x, goal.y) ?? []) : [];
    brain.pathAge = 0;
  }

  while (brain.path.length > 0) {
    const next = brain.path[0];
    if (Math.hypot(next.x - bot.x, next.y - bot.y) > BOT_WAYPOINT_REACHED) break;
    brain.path.shift();
  }
  const next = brain.path[0];
  if (!next) {
    return { moveX: 0, moveY: 0, face: bot.a, fire: false, weapon: chooseWeapon(bot, 10) };
  }
  const dx = next.x - bot.x;
  const dy = next.y - bot.y;
  const dist = Math.hypot(dx, dy) || 1;
  return {
    moveX: dx / dist,
    moveY: dy / dist,
    face: Math.atan2(dy, dx),
    fire: false,
    weapon: chooseWeapon(bot, 10),
  };
}
