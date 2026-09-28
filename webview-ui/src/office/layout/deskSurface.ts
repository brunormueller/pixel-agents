// webview-ui/src/office/layout/deskSurface.ts
//
// Geometry of sprites for desk decoration: where a desk's tabletop is, and
// where an item's base is. Read straight off the pixels, so any desk asset —
// bundled or from an external asset directory — works without extra metadata.
// Pure (no DOM).

import type { SpriteData } from '../types.js';

/** Inclusive pixel rectangle within a sprite. */
export interface PixelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const boxes = new WeakMap<SpriteData, PixelRect | null>();
const surfaces = new WeakMap<SpriteData, PixelRect | null>();
const fills = new WeakMap<SpriteData, string>();

const colorAt = (sprite: SpriteData, x: number, y: number): string =>
  (sprite[y]?.[x] ?? '').slice(0, 7);

/** Bounding box of a sprite's visible pixels, or null when it has none. */
export function opaqueBox(sprite: SpriteData): PixelRect | null {
  if (boxes.has(sprite)) return boxes.get(sprite)!;
  let box: PixelRect | null = null;
  sprite.forEach((row, y) =>
    row.forEach((px, x) => {
      if (!px) return;
      if (!box) box = { x0: x, y0: y, x1: x, y1: y };
      else {
        box.x0 = Math.min(box.x0, x);
        box.x1 = Math.max(box.x1, x);
        box.y0 = Math.min(box.y0, y);
        box.y1 = Math.max(box.y1, y);
      }
    }),
  );
  boxes.set(sprite, box);
  return box;
}

/**
 * The top face of a desk sprite. A tabletop is drawn as one flat fill color
 * framed by its edges, above the front panel and the legs: take the color
 * that dominates the sprite's middle column, its longest unbroken run down
 * that column is the tabletop's depth, and the same color's run across the
 * middle of it is its width. Null when nothing looks like a tabletop.
 */
export function deskSurface(sprite: SpriteData): PixelRect | null {
  if (surfaces.has(sprite)) return surfaces.get(sprite)!;
  const w = sprite[0]?.length ?? 0;
  const cx = Math.floor(w / 2);
  const counts = new Map<string, number>();
  for (let y = 0; y < sprite.length; y++) {
    const px = sprite[y][cx];
    // Semi-transparent pixels are shadows, not the table.
    if (!px || px.length > 7) continue;
    const c = px.slice(0, 7);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let fill = '';
  let best = 0;
  for (const [c, n] of counts) {
    if (n > best) {
      fill = c;
      best = n;
    }
  }
  let rect: PixelRect | null = null;
  if (fill) {
    // The longest unbroken run (a highlight line along the back edge doesn't count).
    let y0 = -1;
    let y1 = -1;
    for (let y = 0; y < sprite.length; y++) {
      if (colorAt(sprite, cx, y) !== fill) continue;
      let end = y;
      while (end + 1 < sprite.length && colorAt(sprite, cx, end + 1) === fill) end++;
      if (end - y > y1 - y0) {
        y0 = y;
        y1 = end;
      }
      y = end;
    }
    if (y0 >= 0 && y1 - y0 >= 2) {
      const mid = Math.floor((y0 + y1) / 2);
      let x0 = cx;
      let x1 = cx;
      while (x0 > 0 && colorAt(sprite, x0 - 1, mid) === fill) x0--;
      while (x1 + 1 < w && colorAt(sprite, x1 + 1, mid) === fill) x1++;
      if (x1 - x0 >= 2) rect = { x0, y0, x1, y1 };
    }
  }
  surfaces.set(sprite, rect);
  if (rect) fills.set(sprite, fill);
  return rect;
}

/** Whether sprite pixel (x, y) is part of the desk's top face (its fill color) —
 *  so round corners are round for what stands on them too. */
export function isTabletopPixel(sprite: SpriteData, x: number, y: number): boolean {
  if (!deskSurface(sprite)) return false;
  return colorAt(sprite, x, y) === fills.get(sprite);
}

/** Mirror a rect horizontally within a sprite of width `w`. */
export function mirrorRect(r: PixelRect, w: number): PixelRect {
  return { x0: w - 1 - r.x1, y0: r.y0, x1: w - 1 - r.x0, y1: r.y1 };
}

const bases = new WeakMap<SpriteData, { x0: number; x1: number } | null>();

/** What an item stands on: the visible pixels of its lowest row (a monitor's
 *  foot, a plate), which must rest on the tabletop — the rest may overhang. */
export function baseSpan(sprite: SpriteData): { x0: number; x1: number } | null {
  if (bases.has(sprite)) return bases.get(sprite)!;
  const box = opaqueBox(sprite);
  let span: { x0: number; x1: number } | null = null;
  if (box) {
    const row = sprite[box.y1];
    let x0 = -1;
    let x1 = -1;
    row.forEach((px, x) => {
      if (!px) return;
      if (x0 < 0) x0 = x;
      x1 = x;
    });
    if (x0 >= 0) span = { x0, x1 };
  }
  bases.set(sprite, span);
  return span;
}
