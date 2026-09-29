// webview-ui/src/games/fps/sprites.ts
//
// The office's own sprites, as the raycaster draws them: characters (the
// person's look, each agent's palette) seen from the side they face you with,
// furniture standing in an office map, and the textures a map names.

import type { FpsMapData, FpsSurface } from '../../../../core/src/messages.js';
import {
  FPS_CHARACTER_HEIGHT,
  FPS_FURNITURE_HEIGHT_SQUASH,
  FPS_FURNITURE_MAX_HEIGHT,
  FPS_FURNITURE_UNITS_PER_PX,
} from '../../constants.js';
import { getColorizedFloorSprite } from '../../office/floorTiles.js';
import { getCatalogEntry } from '../../office/layout/furnitureCatalog.js';
import type { FpsTexture } from '../../office/sprites/fpsArt.js';
import {
  blockSideTexture,
  ceilingTexture,
  floorTexture,
  FPS_PROP_ART,
  rgbToPixel,
  wallTexture,
} from '../../office/sprites/fpsArt.js';
import type { CharacterSprites } from '../../office/sprites/spriteData.js';
import { getCharacterSprites } from '../../office/sprites/spriteData.js';
import type { SpriteData } from '../../office/types.js';
import { Direction } from '../../office/types.js';
import { angleDiff } from './sim.js';
import type { Actor } from './types.js';

/** Semi-transparent pixels at or above this alpha are drawn (shadows below it are not). */
const ALPHA_DRAWN = 128;

function parseColor(px: string): number {
  if (!px) return 0;
  const rgb = parseInt(px.slice(1, 7), 16);
  const alpha = px.length > 7 ? parseInt(px.slice(7, 9), 16) : 255;
  return alpha < ALPHA_DRAWN ? 0 : rgbToPixel(rgb);
}

interface Crop {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bounding box of the drawn pixels, or null when there are none. */
function cropOf(sprite: SpriteData): Crop | null {
  let crop: Crop | null = null;
  sprite.forEach((row, y) =>
    row.forEach((px, x) => {
      if (parseColor(px) === 0) return;
      if (!crop) crop = { x0: x, y0: y, x1: x, y1: y };
      else {
        crop.x0 = Math.min(crop.x0, x);
        crop.x1 = Math.max(crop.x1, x);
        crop.y0 = Math.min(crop.y0, y);
        crop.y1 = Math.max(crop.y1, y);
      }
    }),
  );
  return crop;
}

function toTexture(sprite: SpriteData, crop: Crop): FpsTexture {
  const w = crop.x1 - crop.x0 + 1;
  const h = crop.y1 - crop.y0 + 1;
  const px = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = sprite[crop.y0 + y] ?? [];
    for (let x = 0; x < w; x++) px[y * w + x] = parseColor(row[crop.x0 + x] ?? '');
  }
  return { w, h, px };
}

/** Rotated a quarter turn clockwise: a character lying on the floor. */
function rotated(tex: FpsTexture): FpsTexture {
  const px = new Uint32Array(tex.w * tex.h);
  const w = tex.h;
  for (let y = 0; y < tex.h; y++) {
    for (let x = 0; x < tex.w; x++) px[x * w + (tex.h - 1 - y)] = tex.px[y * tex.w + x];
  }
  return { w, h: tex.w, px };
}

// ── Characters ───────────────────────────────────────────────

interface CharacterSet {
  /** [direction][walk frame] */
  frames: FpsTexture[][];
  dead: FpsTexture;
  /** World size of a standing frame. */
  w: number;
  h: number;
}

const characterSets = new WeakMap<CharacterSprites, CharacterSet>();

function characterSet(sheet: CharacterSprites): CharacterSet {
  const known = characterSets.get(sheet);
  if (known) return known;
  const dirs = [Direction.DOWN, Direction.LEFT, Direction.RIGHT, Direction.UP];
  // One crop for every frame, so a walk cycle does not wobble in size.
  let crop: Crop | null = null;
  for (const d of dirs) {
    for (const frame of sheet.walk[d]) {
      const c = cropOf(frame);
      if (!c) continue;
      if (!crop) crop = { ...c };
      else {
        crop.x0 = Math.min(crop.x0, c.x0);
        crop.x1 = Math.max(crop.x1, c.x1);
        crop.y0 = Math.min(crop.y0, c.y0);
        crop.y1 = Math.max(crop.y1, c.y1);
      }
    }
  }
  const full: Crop = crop ?? { x0: 0, y0: 0, x1: 15, y1: 31 };
  const frames = dirs.map((d) => sheet.walk[d].map((f) => toTexture(f, full)));
  const unit = FPS_CHARACTER_HEIGHT / (full.y1 - full.y0 + 1);
  const set: CharacterSet = {
    frames: [],
    dead: rotated(frames[0][1]),
    w: (full.x1 - full.x0 + 1) * unit,
    h: FPS_CHARACTER_HEIGHT,
  };
  dirs.forEach((d, i) => {
    set.frames[d] = frames[i];
  });
  characterSets.set(sheet, set);
  return set;
}

export interface Billboard {
  x: number;
  y: number;
  /** Height its bottom stands at (0 = the floor). */
  z: number;
  w: number;
  h: number;
  tex: FpsTexture;
}

/**
 * How an actor looks from where the viewer stands: the frame for the side it
 * shows (its face when it looks at you), walking or standing, or lying down.
 */
export function actorBillboard(actor: Actor, viewerX: number, viewerY: number): Billboard {
  const set = characterSet(getCharacterSprites(actor.palette, actor.hueShift, actor.look));
  if (!actor.alive) {
    return { x: actor.x, y: actor.y, z: 0, w: set.h, h: set.w * 0.55, tex: set.dead };
  }
  const toViewer = Math.atan2(viewerY - actor.y, viewerX - actor.x);
  const rel = angleDiff(actor.a, toViewer);
  const abs = Math.abs(rel);
  const dir =
    abs <= Math.PI / 4
      ? Direction.DOWN
      : abs >= (Math.PI * 3) / 4
        ? Direction.UP
        : rel > 0
          ? Direction.RIGHT
          : Direction.LEFT;
  const frame = actor.moving ? Math.floor(actor.walkPhase * 2.2) % 4 : 1;
  return { x: actor.x, y: actor.y, z: 0, w: set.w, h: set.h, tex: set.frames[dir][frame] };
}

// ── Furniture and props ──────────────────────────────────────

const propCache = new Map<string, { tex: FpsTexture; w: number; h: number }>();

/** A map prop: office furniture by catalog type, or a built-in prop (a crate when unknown). */
export function propBillboard(t: string, x: number, y: number, z = 0): Billboard {
  let known = propCache.get(t);
  if (!known) {
    const sprite = getCatalogEntry(t)?.sprite;
    const crop = sprite ? cropOf(sprite) : null;
    const tex = sprite && crop ? toTexture(sprite, crop) : (FPS_PROP_ART[t] ?? FPS_PROP_ART.box);
    const fromOffice = Boolean(sprite && crop);
    const unit = fromOffice ? FPS_FURNITURE_UNITS_PER_PX : 1 / 20;
    const squash = fromOffice ? FPS_FURNITURE_HEIGHT_SQUASH : 1;
    let w = tex.w * unit;
    let h = tex.h * unit * squash;
    if (h > FPS_FURNITURE_MAX_HEIGHT) {
      w *= FPS_FURNITURE_MAX_HEIGHT / h;
      h = FPS_FURNITURE_MAX_HEIGHT;
    }
    known = { tex, w, h };
    // Office furniture can change (assets reload); built-ins cannot.
    propCache.set(t, known);
  }
  return { x, y, z, w: known.w, h: known.h, tex: known.tex };
}

/** Forget cached furniture sprites (a new map may use reloaded assets). */
export function clearPropCache(): void {
  propCache.clear();
}

// ── Map textures ─────────────────────────────────────────────

export interface WorldTextures {
  walls: FpsTexture[];
  floors: FpsTexture[];
  blocks: Array<{ h: number; top: number; side: FpsTexture }>;
  ceiling: FpsTexture;
  /** The fog color, as channels. */
  fog: [number, number, number];
}

function surfaceTexture(s: FpsSurface, kind: 'wall' | 'floor'): FpsTexture {
  if (s.pat !== undefined) {
    const sprite = getColorizedFloorSprite(s.pat, s.color ?? { h: 0, s: 0, b: 0, c: 0 });
    return toTexture(sprite, { x0: 0, y0: 0, x1: 15, y1: 15 });
  }
  return kind === 'wall' ? wallTexture(s.tex, s.tint) : floorTexture(s.tex, s.tint);
}

export function buildWorldTextures(map: FpsMapData): WorldTextures {
  const walls = map.walls.map((s) => surfaceTexture(s, 'wall'));
  const floors = map.floors.map((s) => surfaceTexture(s, 'floor'));
  return {
    walls: walls.length > 0 ? walls : [wallTexture('stone')],
    floors: floors.length > 0 ? floors : [floorTexture('concrete')],
    blocks: map.blocks.map((b) => ({
      h: b.h,
      top: rgbToPixel(b.top),
      side: blockSideTexture(b.side),
    })),
    ceiling: ceilingTexture(map.ceiling),
    fog: [(map.fog >> 16) & 0xff, (map.fog >> 8) & 0xff, map.fog & 0xff],
  };
}
