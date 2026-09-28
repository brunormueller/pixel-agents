// webview-ui/src/office/sprites/avatarLook.ts
//
// The person's customized character: a base body (one of the character
// sheets), its hair and clothes recolored, and an accessory drawn over the
// head. Everything is baked into the sprite frames themselves, so outlines,
// the matrix effect, game poses and the sprite cache need nothing special.
// Pure (no DOM): unit-tested in Node.

import type { AvatarAccessory, AvatarLook } from '../../../../core/src/messages.js';
import { HAIR_SWATCHES, LOOK_MIN_LIGHTNESS_SPREAD, OUTFIT_SWATCHES } from '../../constants.js';
import { hslToHex, rgbToHsl } from '../colorize.js';
import type { SpriteData } from '../types.js';
import parts from './avatar-parts.json';

export type { AvatarAccessory, AvatarLook };

/** One character sheet: 7 frames per direction (walk1-3, type1-2, read1-2). */
export interface CharacterSheet {
  down: SpriteData[];
  up: SpriteData[];
  right: SpriteData[];
}

type Direction = 'down' | 'up' | 'right';
const DIRECTIONS: Direction[] = ['down', 'up', 'right'];

interface AccessoryLayer {
  y: number;
  rows: string[];
}
interface AccessoryDef {
  coversHair: boolean;
  down: AccessoryLayer;
  up: AccessoryLayer;
  right: AccessoryLayer;
}

const ACCESSORIES = parts.accessories as Record<string, AccessoryDef>;
const PART_PALETTE = parts.palette as Record<string, string>;
const DESIGN_EYE_ROW = parts.eyeRow as Record<Direction, number>;
export const EYE_COLOR = '#000000';

/** Accessories in editor order, with their labels. */
export const ACCESSORY_OPTIONS: ReadonlyArray<{ id: AvatarAccessory; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'cap', label: 'Cap' },
  { id: 'beanie', label: 'Beanie' },
  { id: 'tophat', label: 'Top hat' },
  { id: 'crown', label: 'Crown' },
  { id: 'partyhat', label: 'Party hat' },
  { id: 'headphones', label: 'Headphones' },
  { id: 'glasses', label: 'Glasses' },
  { id: 'sunglasses', label: 'Sunglasses' },
  { id: 'flower', label: 'Flower' },
  { id: 'bow', label: 'Bow' },
  { id: 'halo', label: 'Halo' },
];

export const DEFAULT_LOOK: AvatarLook = {
  body: 0,
  hair: -1,
  top: -1,
  bottom: -1,
  accessory: 'none',
};

/** Cache key of a look (bodies wrap around the loaded sheet count). */
export function lookKey(look: AvatarLook): string {
  return `${look.body}:${look.hair}:${look.top}:${look.bottom}:${look.accessory}`;
}

/** Whether this body's clothes are one piece (a suit, a dress): no separate bottom color. */
export function isOnePiece(body: number): boolean {
  const roles = parts.roles[body % parts.roles.length];
  return !roles || roles.bottom.length === 0;
}

// ── Recolor ──────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/**
 * Map a part's colors onto a target color, keeping its shading: every color
 * takes the target's hue and saturation, and its lightness keeps the same
 * offset from the part's average as before (stretched when the part was
 * nearly flat, so a black hairdo turned blonde still has depth).
 */
function addRecolor(map: Map<string, string>, colors: string[], target: string | undefined): void {
  if (!target || colors.length === 0) return;
  const [th, ts, tl] = rgbToHsl(...hexToRgb(target));
  const lights = colors.map((c) => rgbToHsl(...hexToRgb(c))[2]);
  const mean = lights.reduce((a, b) => a + b, 0) / lights.length;
  const spread = Math.max(...lights.map((l) => Math.abs(l - mean)));
  const stretch =
    spread > 0 && spread < LOOK_MIN_LIGHTNESS_SPREAD ? LOOK_MIN_LIGHTNESS_SPREAD / spread : 1;
  colors.forEach((c, i) => {
    const l = Math.max(0.03, Math.min(0.97, tl + (lights[i] - mean) * stretch));
    map.set(c.toUpperCase(), hslToHex(th, ts, l));
  });
}

function recolorPixel(px: string, map: Map<string, string>): string {
  if (!px || map.size === 0) return px;
  const base = px.slice(0, 7).toUpperCase();
  const to = map.get(base);
  return to ? to + px.slice(7) : px;
}

// ── Accessory placement ─────────────────────────────────────

function firstOpaqueRow(sprite: SpriteData): number {
  for (let y = 0; y < sprite.length; y++) if (sprite[y].some((px) => px !== '')) return y;
  return 0;
}

function firstRowWith(sprite: SpriteData, color: string): number | null {
  for (let y = 0; y < sprite.length; y++) {
    if (sprite[y].some((px) => px.slice(0, 7).toUpperCase() === color)) return y;
  }
  return null;
}

/** Draw one accessory layer over a frame, `dy` rows lower than designed. */
function drawLayer(
  frame: SpriteData,
  layer: AccessoryLayer,
  dy: number,
  coversHair: boolean,
  hair: Set<string>,
): SpriteData {
  const out = frame.map((row) => [...row]);
  if (layer.rows.length === 0) return out;
  const top = layer.y + dy;
  if (coversHair) {
    // A hat hides the hair that would poke out above it.
    for (let y = 0; y < Math.min(top, out.length); y++) {
      for (let x = 0; x < out[y].length; x++) {
        if (hair.has(out[y][x].slice(0, 7).toUpperCase())) out[y][x] = '';
      }
    }
  }
  layer.rows.forEach((row, i) => {
    const y = top + i;
    if (y < 0 || y >= out.length) return;
    for (let x = 0; x < row.length && x < out[y].length; x++) {
      const key = row[x];
      if (key === '.') continue;
      const color = PART_PALETTE[key];
      if (color) out[y][x] = color;
    }
  });
  return out;
}

/**
 * The sheet of a customized character. `base` is the sheet of `look.body`;
 * the result has the same layout (left is still mirrored from right later).
 */
export function applyLook(base: CharacterSheet, look: AvatarLook): CharacterSheet {
  const roles = parts.roles[look.body % parts.roles.length] ?? { hair: [], top: [], bottom: [] };
  const map = new Map<string, string>();
  addRecolor(map, roles.hair, HAIR_SWATCHES[look.hair]?.color);
  addRecolor(map, roles.top, OUTFIT_SWATCHES[look.top]?.color);
  addRecolor(map, roles.bottom, OUTFIT_SWATCHES[look.bottom]?.color);
  const hairColors = new Set(roles.hair.map((c) => (map.get(c) ?? c).toUpperCase()));
  const accessory = look.accessory !== 'none' ? ACCESSORIES[look.accessory] : undefined;

  const sheet = {} as CharacterSheet;
  for (const dir of DIRECTIONS) {
    const frames = base[dir] ?? [];
    const walk0 = frames[0];
    // Where this body's eyes sit on the walking frame (the up view has none: same head as down).
    const eyeDir: Direction = dir === 'up' ? 'down' : dir;
    const eyeRow = base[eyeDir]?.[0] ? firstRowWith(base[eyeDir][0], EYE_COLOR) : null;
    const eyeShift = eyeRow === null ? 0 : eyeRow - DESIGN_EYE_ROW[eyeDir];
    const walkTop = walk0 ? firstOpaqueRow(walk0) : 0;
    sheet[dir] = frames.map((frame) => {
      let out: SpriteData = frame.map((row) => row.map((px) => recolorPixel(px, map)));
      if (accessory) {
        // Sitting, typing and walking frames move the head: follow it.
        const dy = eyeShift + (firstOpaqueRow(frame) - walkTop);
        out = drawLayer(out, accessory[dir], dy, accessory.coversHair, hairColors);
      }
      return out;
    });
  }
  return sheet;
}
