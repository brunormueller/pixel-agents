/**
 * Sanitizers for games played inside a room (Pixel Frag, the first-person
 * match). Like meetings, a match is a set of presences: every office in it
 * publishes a `game` presence on its state frame, and `play` frames go to the
 * other offices publishing the same match id only (never back to the sender).
 *
 * The relay and every office run the same checks: known frame kinds, bounded
 * numbers and lists, short printable ids. A malformed field is dropped, a frame
 * with nothing left that its kind needs is refused. What a player shows the
 * room is where it stands, which way it faces, its health and its shots — no
 * more than a character's pose on the shared map.
 */

import type {
  FpsBlock,
  FpsBotState,
  FpsColorAdjust,
  FpsConfig,
  FpsDifficulty,
  FpsItem,
  FpsItemKind,
  FpsMapData,
  FpsPoint,
  FpsProp,
  FpsScoreEntry,
  FpsSurface,
  GameFrameBody,
  GameFrameKind,
  GamePresence,
} from '../../../core/src/messages.js';
import {
  FPS_MAX_BLOCK_HEIGHT,
  FPS_MAX_BOTS,
  FPS_MAX_FRAG_LIMIT,
  FPS_MAX_HP,
  FPS_MAX_MAP_BLOCKS,
  FPS_MAX_MAP_DIM,
  FPS_MAX_MAP_ITEMS,
  FPS_MAX_MAP_PROPS,
  FPS_MAX_MAP_SPAWNS,
  FPS_MAX_MAP_SURFACES,
  FPS_MAX_TIME_LIMIT_MIN,
  FPS_MAX_WEAPON_SLOT,
  GAME_MAX_ID_LENGTH,
  GAME_MAX_TITLE_LENGTH,
  HUE_SHIFT_MAX_DEG,
  MULTIPLAYER_MAX_NAME_LENGTH,
  MULTIPLAYER_MAX_PEERS_PER_ROOM,
} from '../constants.js';

export type { FpsMapData, GameFrameBody, GamePresence };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isIntIn = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

const isNumIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

const isStamp = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

const TAU = Math.PI * 2;
const MAX_RGB = 0xffffff;
/** Match ids, player ids (relay peerIds are UUIDs) and bot ids. */
const ID = new RegExp(`^[A-Za-z0-9_-]{1,${GAME_MAX_ID_LENGTH}}$`);
/** Built-in map, texture and prop ids. */
const TOKEN = /^[a-z0-9-]{1,24}$/;
/** Furniture catalog types (`DESK_FRONT`, `OFFICE_CHAIR_SIDE:left`). */
const PROP_TYPE = /^[A-Za-z0-9_:.-]{1,128}$/;
const CELLS = /^[A-Za-z0-9]*$/;
const DIFFICULTIES: ReadonlySet<string> = new Set<FpsDifficulty>(['easy', 'normal', 'hard']);
const ITEM_KINDS: ReadonlySet<string> = new Set<FpsItemKind>(['health', 'shells', 'bullets']);
/** Score rows: every player a room can hold, plus the bots. */
const MAX_SCORE_ENTRIES = MULTIPLAYER_MAX_PEERS_PER_ROOM + FPS_MAX_BOTS;

/** Printable characters only (as protocol.ts sanitizeText), trimmed and capped. */
function text(raw: unknown, maxLength: number): string {
  if (typeof raw !== 'string') return '';

  const cleaned = raw.replace(
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
    '',
  );
  return Array.from(cleaned.trim()).slice(0, maxLength).join('');
}

export function sanitizeGameId(raw: unknown): string | null {
  return typeof raw === 'string' && ID.test(raw) ? raw : null;
}

/** A facing, folded into [0, 2π). */
function angle(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > 1e6) return null;
  return ((raw % TAU) + TAU) % TAU;
}

const coord = (raw: unknown): raw is number => isNumIn(raw, 0, FPS_MAX_MAP_DIM);

export function sanitizeFpsConfig(raw: unknown): FpsConfig | null {
  if (!isObject(raw) || typeof raw.map !== 'string' || !TOKEN.test(raw.map)) return null;
  return {
    map: raw.map,
    bots: isIntIn(raw.bots, 0, FPS_MAX_BOTS) ? raw.bots : 0,
    difficulty:
      typeof raw.difficulty === 'string' && DIFFICULTIES.has(raw.difficulty)
        ? (raw.difficulty as FpsDifficulty)
        : 'normal',
    fragLimit: isIntIn(raw.fragLimit, 0, FPS_MAX_FRAG_LIMIT) ? raw.fragLimit : 0,
    timeLimit: isIntIn(raw.timeLimit, 0, FPS_MAX_TIME_LIMIT_MIN) ? raw.timeLimit : 0,
  };
}

/** A person's presence in a match, or undefined when it is not one. */
export function sanitizeGamePresence(raw: unknown): GamePresence | undefined {
  if (!isObject(raw)) return undefined;
  const id = sanitizeGameId(raw.id);
  const cfg = sanitizeFpsConfig(raw.cfg);
  if (!id || raw.game !== 'fps' || !cfg || !isStamp(raw.since)) return undefined;
  return {
    id,
    game: 'fps',
    title: text(raw.title, GAME_MAX_TITLE_LENGTH) || 'Pixel Frag',
    since: raw.since,
    cfg,
    palette: isIntIn(raw.palette, 0, 255) ? raw.palette : 0,
    hueShift: isIntIn(raw.hueShift, 0, HUE_SHIFT_MAX_DEG) ? raw.hueShift : 0,
  };
}

function sanitizeBot(raw: unknown): FpsBotState | null {
  if (!isObject(raw)) return null;
  const id = sanitizeGameId(raw.id);
  const a = angle(raw.a);
  if (!id || !coord(raw.x) || !coord(raw.y) || a === null) return null;
  return {
    id,
    n: text(raw.n, MULTIPLAYER_MAX_NAME_LENGTH) || 'Bot',
    x: raw.x,
    y: raw.y,
    a,
    hp: isIntIn(raw.hp, 0, FPS_MAX_HP) ? raw.hp : 0,
    alive: raw.alive === true,
    w: isIntIn(raw.w, 0, FPS_MAX_WEAPON_SLOT) ? raw.w : 0,
    shot: isStamp(raw.shot) ? raw.shot : 0,
    mv: raw.mv === true,
    p: isIntIn(raw.p, 0, 255) ? raw.p : 0,
    h: isIntIn(raw.h, 0, HUE_SHIFT_MAX_DEG) ? raw.h : 0,
  };
}

function sanitizeScoreEntry(raw: unknown): FpsScoreEntry | null {
  if (!isObject(raw)) return null;
  const id = sanitizeGameId(raw.id);
  if (!id) return null;
  const entry: FpsScoreEntry = {
    id,
    n: text(raw.n, MULTIPLAYER_MAX_NAME_LENGTH) || 'Player',
    f: isIntIn(raw.f, -9999, 9999) ? raw.f : 0,
    d: isIntIn(raw.d, 0, 9999) ? raw.d : 0,
  };
  if (raw.bot === true) entry.bot = true;
  return entry;
}

/** Up to `max` entries that survive `each`, with no id twice. */
function list<T extends { id: string }>(
  raw: unknown,
  max: number,
  each: (v: unknown) => T | null,
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (out.length >= max) break;
    const v = each(entry);
    if (!v || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

function sanitizeColorAdjust(raw: unknown): FpsColorAdjust | undefined {
  if (!isObject(raw)) return undefined;
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(-360, Math.min(360, v)) : 0;
  const color: FpsColorAdjust = { h: num(raw.h), s: num(raw.s), b: num(raw.b), c: num(raw.c) };
  if (raw.colorize === true) color.colorize = true;
  return color;
}

function sanitizeSurface(raw: unknown): FpsSurface | null {
  if (!isObject(raw)) return null;
  const surface: FpsSurface = {};
  if (typeof raw.tex === 'string' && TOKEN.test(raw.tex)) surface.tex = raw.tex;
  if (isIntIn(raw.tint, 0, MAX_RGB)) surface.tint = raw.tint;
  if (isIntIn(raw.pat, 0, 63)) {
    surface.pat = raw.pat;
    const color = sanitizeColorAdjust(raw.color);
    if (color) surface.color = color;
  }
  return surface.tex !== undefined || surface.pat !== undefined ? surface : null;
}

function surfaces(raw: unknown): FpsSurface[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, FPS_MAX_MAP_SURFACES).map((s) => sanitizeSurface(s) ?? { tex: 'stone' });
}

function sanitizeBlock(raw: unknown): FpsBlock {
  const b = isObject(raw) ? raw : {};
  return {
    h: isNumIn(b.h, 0.05, FPS_MAX_BLOCK_HEIGHT) ? b.h : 0.4,
    top: isIntIn(b.top, 0, MAX_RGB) ? b.top : 0x8a6a4a,
    side: isIntIn(b.side, 0, MAX_RGB) ? b.side : 0x5a4030,
  };
}

/**
 * A Pixel Frag map, or null when it is not one: a grid of known cell
 * characters of sane size with at least one spawn inside it. Lists are capped,
 * entries outside the grid dropped.
 */
export function sanitizeFpsMap(raw: unknown): FpsMapData | null {
  if (!isObject(raw)) return null;
  const { cols, rows, cells } = raw;
  if (!isIntIn(cols, 3, FPS_MAX_MAP_DIM) || !isIntIn(rows, 3, FPS_MAX_MAP_DIM)) return null;
  const count = cols * rows;
  if (typeof cells !== 'string' || cells.length !== count || !CELLS.test(cells)) return null;
  const inside = (p: Record<string, unknown>) => isNumIn(p.x, 0, cols) && isNumIn(p.y, 0, rows);

  const props: FpsProp[] = [];
  if (Array.isArray(raw.props)) {
    for (const p of raw.props) {
      if (props.length >= FPS_MAX_MAP_PROPS) break;
      if (!isObject(p) || !inside(p) || typeof p.t !== 'string' || !PROP_TYPE.test(p.t)) continue;
      const prop: FpsProp = { x: p.x as number, y: p.y as number, t: p.t };
      if (isNumIn(p.z, 0, 1)) prop.z = p.z;
      props.push(prop);
    }
  }
  const solid: number[] = [];
  if (Array.isArray(raw.solid)) {
    const seen = new Set<number>();
    for (const i of raw.solid) {
      if (solid.length >= count) break;
      if (!isIntIn(i, 0, count - 1) || seen.has(i)) continue;
      seen.add(i);
      solid.push(i);
    }
  }
  const spawns: FpsPoint[] = [];
  if (Array.isArray(raw.spawns)) {
    for (const p of raw.spawns) {
      if (spawns.length >= FPS_MAX_MAP_SPAWNS) break;
      if (isObject(p) && inside(p)) spawns.push({ x: p.x as number, y: p.y as number });
    }
  }
  if (spawns.length === 0) return null;
  const items: FpsItem[] = [];
  if (Array.isArray(raw.items)) {
    for (const p of raw.items) {
      if (items.length >= FPS_MAX_MAP_ITEMS) break;
      if (!isObject(p) || !inside(p) || typeof p.k !== 'string' || !ITEM_KINDS.has(p.k)) continue;
      items.push({ x: p.x as number, y: p.y as number, k: p.k as FpsItemKind });
    }
  }
  return {
    name: text(raw.name, 40) || 'Map',
    cols,
    rows,
    cells,
    walls: surfaces(raw.walls),
    floors: surfaces(raw.floors),
    blocks: Array.isArray(raw.blocks)
      ? raw.blocks.slice(0, FPS_MAX_MAP_BLOCKS).map(sanitizeBlock)
      : [],
    props,
    solid,
    spawns,
    items,
    ceiling: isIntIn(raw.ceiling, 0, MAX_RGB) ? raw.ceiling : 0x303040,
    fog: isIntIn(raw.fog, 0, MAX_RGB) ? raw.fog : 0x101018,
  };
}

const FRAME_KINDS: ReadonlySet<string> = new Set<GameFrameKind>([
  'pos',
  'hit',
  'die',
  'bots',
  'score',
  'map',
  'req',
  'take',
]);

/** One match frame: the fields its kind carries, each checked; null when the kind's essentials are missing. */
export function sanitizeGameFrame(raw: unknown): GameFrameBody | null {
  if (!isObject(raw) || typeof raw.k !== 'string' || !FRAME_KINDS.has(raw.k)) return null;
  const k = raw.k as GameFrameKind;
  switch (k) {
    case 'pos': {
      const a = angle(raw.a);
      if (!coord(raw.x) || !coord(raw.y) || a === null) return null;
      return {
        k,
        x: raw.x,
        y: raw.y,
        a,
        hp: isIntIn(raw.hp, 0, FPS_MAX_HP) ? raw.hp : 0,
        alive: raw.alive === true,
        w: isIntIn(raw.w, 0, FPS_MAX_WEAPON_SLOT) ? raw.w : 0,
        shot: isStamp(raw.shot) ? raw.shot : 0,
        mv: raw.mv === true,
      };
    }
    case 'hit': {
      const to = sanitizeGameId(raw.to);
      if (!to || !isIntIn(raw.dmg, 1, FPS_MAX_HP)) return null;
      const frame: GameFrameBody = {
        k,
        to,
        dmg: raw.dmg,
        w: isIntIn(raw.w, 0, FPS_MAX_WEAPON_SLOT) ? raw.w : 0,
      };
      // A host's bot fired it (the sender being the host).
      const by = sanitizeGameId(raw.by);
      if (by) frame.by = by;
      return frame;
    }
    case 'die': {
      const frame: GameFrameBody = {
        k,
        by: sanitizeGameId(raw.by) ?? '',
        w: isIntIn(raw.w, 0, FPS_MAX_WEAPON_SLOT) ? raw.w : 0,
      };
      const who = sanitizeGameId(raw.who);
      if (who) frame.who = who;
      return frame;
    }
    case 'bots':
      return { k, bots: list(raw.bots, FPS_MAX_BOTS, sanitizeBot) };
    case 'score': {
      if (!isIntIn(raw.round, 0, 1e9)) return null;
      const frame: GameFrameBody = {
        k,
        score: list(raw.score, MAX_SCORE_ENTRIES, sanitizeScoreEntry),
        round: raw.round,
        endsAt: isStamp(raw.endsAt) ? raw.endsAt : 0,
        over: raw.over === true,
        items:
          typeof raw.items === 'string' && /^[01]*$/.test(raw.items)
            ? raw.items.slice(0, FPS_MAX_MAP_ITEMS)
            : '',
      };
      if (frame.over && isStamp(raw.restartAt)) frame.restartAt = raw.restartAt;
      return frame;
    }
    case 'map': {
      const map = sanitizeFpsMap(raw.map);
      return map ? { k, map } : null;
    }
    case 'req':
      return { k };
    case 'take':
      return isIntIn(raw.i, 0, FPS_MAX_MAP_ITEMS - 1) ? { k, i: raw.i } : null;
  }
}
