// webview-ui/src/games/fps/render.ts
//
// Pixel Frag's first-person view: a raycaster drawing into a small pixel
// buffer (about 320×200) that the page scales up pixel-sharp. Walls are cast
// column by column (DDA); floor and ceiling row by row; waist-high blocks
// (desks, crates) are drawn where a ray crosses them, front face and top, so
// what stands behind them is cut off below their edge; sprites last, far to
// near, against a per-column depth buffer. Then the weapon in hand.

import { FPS_FOG_DISTANCE, FPS_FOG_MAX_FADE, FPS_SIDE_SHADE } from '../../constants.js';
import type { FpsTexture, WeaponArt } from '../../office/sprites/fpsArt.js';
import { FPS_MUZZLE_FLASH_ART, FPS_WEAPON_ART, rgbToPixel } from '../../office/sprites/fpsArt.js';
import type { Billboard, WorldTextures } from './sprites.js';
import type { FpsWorld } from './types.js';
import { Cell } from './types.js';

export interface WeaponView {
  slot: number;
  /** 0..1: how far the recoil still pushes the gun down. */
  kick: number;
  flash: boolean;
  /** Every other shot (a spinning chaingun). */
  alt: boolean;
  /** Walking sway, in weapon-art pixels. */
  bobX: number;
  bobY: number;
}

export interface FpsView {
  world: FpsWorld;
  textures: WorldTextures;
  x: number;
  y: number;
  a: number;
  fovRad: number;
  /** Eye height (it bobs a little while walking). */
  eye: number;
  billboards: Billboard[];
  weapon: WeaponView | null;
}

/** Block segments a ray may cross before it meets a wall, per column. */
const MAX_SEGMENTS = 8;

export class FpsRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private image: ImageData | null = null;
  private buf = new Uint32Array(0);
  private zbuf = new Float64Array(0);
  /** Per column: blocks crossed (far edge distance, and the screen row of their far top edge). */
  private occCount = new Uint8Array(0);
  private occDist = new Float64Array(0);
  private occY = new Float64Array(0);
  /** ...and its near edge distance and height, for what stands between its edges. */
  private occIn = new Float64Array(0);
  private occH = new Float64Array(0);
  // Scratch for one column's block segments.
  private segTex = new Int32Array(MAX_SEGMENTS);
  private segIn = new Float64Array(MAX_SEGMENTS);
  private segOut = new Float64Array(MAX_SEGMENTS);
  private segSide = new Uint8Array(MAX_SEGMENTS);

  constructor() {
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    this.image = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.image.data.buffer);
    this.zbuf = new Float64Array(w);
    this.occCount = new Uint8Array(w);
    this.occDist = new Float64Array(w * MAX_SEGMENTS);
    this.occY = new Float64Array(w * MAX_SEGMENTS);
    this.occIn = new Float64Array(w * MAX_SEGMENTS);
    this.occH = new Float64Array(w * MAX_SEGMENTS);
  }

  render(view: FpsView): HTMLCanvasElement {
    if (!this.image) return this.canvas;
    const W = this.w;
    const tanHalf = Math.tan(view.fovRad / 2);
    const dirX = Math.cos(view.a);
    const dirY = Math.sin(view.a);
    // The camera plane points right (y grows downward on the map).
    const plX = -dirY * tanHalf;
    const plY = dirX * tanHalf;
    const proj = W / 2 / tanHalf;
    const horizon = this.h / 2;
    const eye = view.eye;
    this.castFloorAndCeiling(view, dirX, dirY, plX, plY, proj, horizon, eye);
    this.castWalls(view, dirX, dirY, plX, plY, proj, horizon, eye);
    this.drawBillboards(view, dirX, dirY, tanHalf, proj, horizon, eye);
    if (view.weapon) this.drawWeapon(view.weapon);
    this.ctx.putImageData(this.image, 0, 0);
    return this.canvas;
  }

  // ── Floor and ceiling ─────────────────────────────────────

  private castFloorAndCeiling(
    view: FpsView,
    dirX: number,
    dirY: number,
    plX: number,
    plY: number,
    proj: number,
    horizon: number,
    eye: number,
  ): void {
    const { world, textures } = view;
    const { cols, rows, kind, tex } = world;
    const W = this.w;
    const buf = this.buf;
    const [fr, fg, fb] = textures.fog;
    const ceil = textures.ceiling;
    const floors = textures.floors;
    const floor0 = floors[0];
    const r0x = dirX - plX;
    const r0y = dirY - plY;
    const r1x = dirX + plX;
    const r1y = dirY + plY;
    for (let y = 0; y < this.h; y++) {
      const isFloor = y + 0.5 > horizon;
      const dy = isFloor ? y + 0.5 - horizon : horizon - (y + 0.5);
      const rowDist = ((isFloor ? eye : 1 - eye) * proj) / Math.max(dy, 0.001);
      const f = fade(rowDist);
      const inv = 1 - f;
      const ar = fr * inv;
      const ag = fg * inv;
      const ab = fb * inv;
      const stepX = (rowDist * (r1x - r0x)) / W;
      const stepY = (rowDist * (r1y - r0y)) / W;
      let wx = view.x + rowDist * r0x + stepX * 0.5;
      let wy = view.y + rowDist * r0y + stepY * 0.5;
      const rowStart = y * W;
      for (let x = 0; x < W; x++, wx += stepX, wy += stepY) {
        const cx = Math.floor(wx);
        const cy = Math.floor(wy);
        let t: FpsTexture;
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) {
          buf[rowStart + x] = 0xff000000 | (ab << 16) | (ag << 8) | ar;
          continue;
        }
        if (isFloor) {
          const ci = cy * cols + cx;
          t = kind[ci] === Cell.FLOOR ? (floors[tex[ci]] ?? floor0) : floor0;
        } else {
          t = ceil;
        }
        const tx = Math.floor((wx - cx) * t.w) & (t.w - 1);
        const ty = Math.floor((wy - cy) * t.h) & (t.h - 1);
        const c = t.px[ty * t.w + tx];
        buf[rowStart + x] =
          0xff000000 |
          (((((c >> 16) & 255) * f + ab) | 0) << 16) |
          (((((c >> 8) & 255) * f + ag) | 0) << 8) |
          (((c & 255) * f + ar) | 0);
      }
    }
  }

  // ── Walls and blocks ──────────────────────────────────────

  private castWalls(
    view: FpsView,
    dirX: number,
    dirY: number,
    plX: number,
    plY: number,
    proj: number,
    horizon: number,
    eye: number,
  ): void {
    const { world, textures } = view;
    const { cols, rows, kind, tex } = world;
    const W = this.w;
    const H = this.h;
    const buf = this.buf;
    const px = view.x;
    const py = view.y;
    const maxSteps = cols + rows + 4;
    const fog = textures.fog;
    for (let x = 0; x < W; x++) {
      const camX = (2 * (x + 0.5)) / W - 1;
      const rdx = dirX + plX * camX;
      const rdy = dirY + plY * camX;
      let mapX = Math.floor(px);
      let mapY = Math.floor(py);
      const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      const stepX = rdx < 0 ? -1 : 1;
      const stepY = rdy < 0 ? -1 : 1;
      let sideX = rdx < 0 ? (px - mapX) * ddx : (mapX + 1 - px) * ddx;
      let sideY = rdy < 0 ? (py - mapY) * ddy : (mapY + 1 - py) * ddy;
      let side = 0;
      let perp = 1e30;
      let wallTex = 0;
      let segments = 0;
      let inBlock = -1;
      for (let i = 0; i < maxSteps; i++) {
        let d: number;
        if (sideX < sideY) {
          d = sideX;
          sideX += ddx;
          mapX += stepX;
          side = 0;
        } else {
          d = sideY;
          sideY += ddy;
          mapY += stepY;
          side = 1;
        }
        const outside = mapX < 0 || mapY < 0 || mapX >= cols || mapY >= rows;
        const ci = mapY * cols + mapX;
        const k = outside ? Cell.WALL : kind[ci];
        const t = outside ? 0 : tex[ci];
        // Leaving a run of block cells (or entering one of another height).
        if (inBlock >= 0 && (k !== Cell.BLOCK || t !== inBlock)) {
          if (segments < MAX_SEGMENTS) this.segOut[segments++] = d;
          inBlock = -1;
        }
        if (k === Cell.WALL) {
          perp = d;
          wallTex = t;
          break;
        }
        if (k === Cell.BLOCK && inBlock < 0 && segments < MAX_SEGMENTS) {
          inBlock = t;
          this.segTex[segments] = t;
          this.segIn[segments] = d;
          this.segSide[segments] = side;
        }
      }
      this.zbuf[x] = perp;
      this.occCount[x] = 0;

      // The wall.
      const wt = textures.walls[wallTex] ?? textures.walls[0];
      const lineH = proj / perp;
      const top = horizon - (1 - eye) * lineH;
      const bottom = horizon + eye * lineH;
      let wallX = side === 0 ? py + perp * rdy : px + perp * rdx;
      wallX -= Math.floor(wallX);
      let tx = Math.floor(wallX * wt.w);
      if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) tx = wt.w - 1 - tx;
      this.drawColumn(
        x,
        top,
        bottom,
        wt,
        tx,
        0,
        1,
        fade(perp) * (side === 1 ? FPS_SIDE_SHADE : 1),
        fog,
      );

      // Blocks, far to near, each over what is behind it.
      for (let s = segments - 1; s >= 0; s--) {
        const block = textures.blocks[this.segTex[s]];
        if (!block) continue;
        const dIn = this.segIn[s];
        const dOut = this.segOut[s];
        const h = block.h;
        const yFrontTop = horizon + ((eye - h) * proj) / dIn;
        const yFrontBottom = horizon + (eye * proj) / dIn;
        const yFarTop = horizon + ((eye - h) * proj) / dOut;
        // Top face.
        const topShade = fade((dIn + dOut) / 2);
        const yA = Math.max(0, Math.ceil(yFarTop - 0.5));
        const yB = Math.min(H, Math.ceil(yFrontTop - 0.5));
        const tc = shade(block.top, topShade, fog);
        for (let y = yA; y < yB; y++) buf[y * W + x] = tc;
        // Front face.
        const bSide = this.segSide[s];
        let u = bSide === 0 ? py + dIn * rdy : px + dIn * rdx;
        u -= Math.floor(u);
        const st = block.side;
        const btx = Math.floor(u * st.w);
        this.drawColumn(
          x,
          yFrontTop,
          yFrontBottom,
          st,
          btx,
          1 - h,
          1,
          fade(dIn) * (bSide === 1 ? FPS_SIDE_SHADE : 1),
          fog,
        );
        const n = this.occCount[x];
        this.occDist[x * MAX_SEGMENTS + n] = dOut;
        this.occY[x * MAX_SEGMENTS + n] = yFarTop;
        this.occIn[x * MAX_SEGMENTS + n] = dIn;
        this.occH[x * MAX_SEGMENTS + n] = h;
        this.occCount[x] = n + 1;
      }
    }
  }

  /** One textured column from screen row `top` to `bottom`, texture v from v0 to v1. */
  private drawColumn(
    x: number,
    top: number,
    bottom: number,
    t: FpsTexture,
    tx: number,
    v0: number,
    v1: number,
    f: number,
    fog: [number, number, number],
  ): void {
    const W = this.w;
    const y0 = Math.max(0, Math.ceil(top - 0.5));
    const y1 = Math.min(this.h, Math.ceil(bottom - 0.5));
    if (y1 <= y0) return;
    const span = bottom - top;
    const inv = 1 - f;
    const ar = fog[0] * inv;
    const ag = fog[1] * inv;
    const ab = fog[2] * inv;
    const buf = this.buf;
    const col = Math.max(0, Math.min(t.w - 1, tx));
    for (let y = y0; y < y1; y++) {
      const v = v0 + ((y + 0.5 - top) / span) * (v1 - v0);
      const ty = Math.max(0, Math.min(t.h - 1, Math.floor(v * t.h)));
      const c = t.px[ty * t.w + col];
      buf[y * W + x] =
        0xff000000 |
        (((((c >> 16) & 255) * f + ab) | 0) << 16) |
        (((((c >> 8) & 255) * f + ag) | 0) << 8) |
        (((c & 255) * f + ar) | 0);
    }
  }

  // ── Sprites ───────────────────────────────────────────────

  private drawBillboards(
    view: FpsView,
    dirX: number,
    dirY: number,
    tanHalf: number,
    proj: number,
    horizon: number,
    eye: number,
  ): void {
    const W = this.w;
    const H = this.h;
    const buf = this.buf;
    const fog = view.textures.fog;
    const placed = view.billboards
      .map((b) => {
        const rx = b.x - view.x;
        const ry = b.y - view.y;
        return { b, depth: rx * dirX + ry * dirY, lateral: -rx * dirY + ry * dirX };
      })
      .filter((p) => p.depth > 0.08)
      .sort((p, q) => q.depth - p.depth);
    for (const { b, depth, lateral } of placed) {
      const sx = (W / 2) * (1 + lateral / (depth * tanHalf));
      const scale = proj / depth;
      const sw = b.w * scale;
      const sh = b.h * scale;
      const x0 = sx - sw / 2;
      const yTop = horizon + (eye - b.z - b.h) * scale;
      const yBot = horizon + (eye - b.z) * scale;
      const cStart = Math.max(0, Math.ceil(x0 - 0.5));
      const cEnd = Math.min(W, Math.ceil(x0 + sw - 0.5));
      if (cEnd <= cStart) continue;
      const f = fade(depth);
      const inv = 1 - f;
      const ar = fog[0] * inv;
      const ag = fog[1] * inv;
      const ab = fog[2] * inv;
      const t = b.tex;
      const rStart = Math.max(0, Math.ceil(yTop - 0.5));
      for (let x = cStart; x < cEnd; x++) {
        if (depth >= this.zbuf[x]) continue;
        // Cut off below the top edge of any block standing in front: all of it
        // when the sprite is behind the block, the part up to the sprite's depth
        // when it stands between the block's edges (beside a desk's corner). Its
        // base on the block's top is exactly there, so things on a desk stay whole.
        let clip = yBot;
        const n = this.occCount[x];
        for (let k = 0; k < n; k++) {
          const i = x * MAX_SEGMENTS + k;
          if (this.occDist[i] <= depth) clip = Math.min(clip, this.occY[i]);
          else if (this.occIn[i] < depth) {
            clip = Math.min(clip, horizon + (eye - this.occH[i]) * scale);
          }
        }
        const rEnd = Math.min(H, Math.ceil(clip - 0.5));
        const u = Math.min(t.w - 1, Math.floor(((x + 0.5 - x0) / sw) * t.w));
        for (let y = rStart; y < rEnd; y++) {
          const v = Math.min(t.h - 1, Math.floor(((y + 0.5 - yTop) / sh) * t.h));
          const c = t.px[v * t.w + u];
          if (c >>> 24 === 0) continue;
          buf[y * W + x] =
            0xff000000 |
            (((((c >> 16) & 255) * f + ab) | 0) << 16) |
            (((((c >> 8) & 255) * f + ag) | 0) << 8) |
            (((c & 255) * f + ar) | 0);
        }
      }
    }
  }

  // ── The weapon in hand ────────────────────────────────────

  private drawWeapon(w: WeaponView): void {
    const art: WeaponArt | undefined = FPS_WEAPON_ART[w.slot];
    if (!art) return;
    const s = Math.max(1, Math.round(this.h / 100));
    const ox = Math.round(this.w / 2 - (art.w / 2) * s + w.bobX * s);
    const oy = Math.round(this.h - art.h * s + (w.bobY + w.kick * 5) * s);
    if (w.flash) {
      const fl = FPS_MUZZLE_FLASH_ART;
      const fs = s * 2;
      this.blit(
        fl,
        ox + art.muzzle.x * s - (fl.w * fs) / 2,
        oy + art.muzzle.y * s - (fl.h * fs) / 2 - 2 * s,
        fs,
      );
    }
    const rects = w.alt && art.alt ? [...art.alt, ...art.rects.slice(art.alt.length)] : art.rects;
    for (const [rx, ry, rw, rh, rgb] of rects) {
      this.fillRect(ox + rx * s, oy + ry * s, rw * s, rh * s, rgbToPixel(rgb));
    }
  }

  private fillRect(x: number, y: number, w: number, h: number, c: number): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.floor(x + w));
    const y1 = Math.min(this.h, Math.floor(y + h));
    for (let yy = y0; yy < y1; yy++) this.buf.fill(c, yy * this.w + x0, yy * this.w + x1);
  }

  private blit(t: FpsTexture, x: number, y: number, s: number): void {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    for (let ty = 0; ty < t.h; ty++) {
      for (let tx = 0; tx < t.w; tx++) {
        const c = t.px[ty * t.w + tx];
        if (c >>> 24 === 0) continue;
        this.fillRect(bx + tx * s, by + ty * s, s, s, c);
      }
    }
  }
}

/** How much of a color survives the fog at a distance (1 = all of it). */
function fade(dist: number): number {
  return 1 - Math.min(1, dist / FPS_FOG_DISTANCE) * FPS_FOG_MAX_FADE;
}

function shade(c: number, f: number, fog: [number, number, number]): number {
  const inv = 1 - f;
  return (
    (0xff000000 |
      (((((c >> 16) & 255) * f + fog[2] * inv) | 0) << 16) |
      (((((c >> 8) & 255) * f + fog[1] * inv) | 0) << 8) |
      (((c & 255) * f + fog[0] * inv) | 0)) >>>
    0
  );
}
