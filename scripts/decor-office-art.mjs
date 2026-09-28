// Procedural pixel art for the modern-office set: white desks with a slate
// front, a curved desk, dark office chairs, and the desk setup (robot arm,
// monitors, PC tower, keyboard, mouse, pie, a plant on a wooden stand).
// Drawn with a tiny raster API so shapes stay clean and easy to tweak; used by
// generate-decor-sprites.mjs. Original art, in the style of a modern office.

/** Palette (sampled to sit well with each other, and with the office floor colors). */
export const C = {
  white: '#EFEDF7',
  whiteHi: '#FAFAFE',
  edge: '#AFBDD0',
  edgeDark: '#8695AD',
  slate: '#4F537A',
  slateHi: '#5E6390',
  slateDark: '#3A3D5C',
  drawer: '#5F6F7C',
  steel: '#9AA4B8',
  ink: '#2E3242',
  dark: '#3A3F52',
  gray: '#4A5064',
  grayHi: '#6A7288',
  red: '#C23A4A',
  redHi: '#E0585E',
  orange: '#FBA529',
  orangeHi: '#FFD06A',
  orangeDark: '#D07A1A',
  sky: '#28206E',
  skyHi: '#5F4DC5',
  sun: '#E04CB0',
  sunHi: '#FF7AD0',
  sea: '#3AC4D0',
  seaDark: '#2D9CBC',
  screen: '#2A2E40',
  yellow: '#F2C94C',
  pink: '#F28C8C',
  green: '#6FCF97',
  cyan: '#56CCF2',
  crust: '#E08A3A',
  crustMid: '#B95027',
  crustDark: '#9A2825',
  plate: '#DBDDEC',
  leaf: '#227255',
  leafMid: '#3A9A6A',
  leafHi: '#5CC08A',
  stem: '#7A4A2A',
  wood: '#A86B58',
  woodDark: '#6E4436',
  shadow: '#00000033',
};

export class Art {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = Array.from({ length: h }, () => Array(w).fill(null));
  }
  set(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y][x] = c;
  }
  get(x, y) {
    return this.px[y]?.[x] ?? null;
  }
  rect(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
    return this;
  }
  hline(x0, x1, y, c) {
    return this.rect(x0, y, x1, y, c);
  }
  vline(x, y0, y1, c) {
    return this.rect(x, y0, x, y1, c);
  }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.35);
        const dy = (y - cy) / (ry + 0.35);
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
    return this;
  }
  /** Rounded rectangle; `r` may differ per side: [left, right]. */
  roundRect(x0, y0, x1, y1, r, c) {
    const [rl, rr] = Array.isArray(r) ? r : [r, r];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const rad = x - x0 < rl ? rl : x1 - x < rr ? rr : 0;
        if (rad > 0) {
          const cx = x - x0 < rl ? x0 + rad : x1 - rad;
          const cy = y - y0 < rad ? y0 + rad : y1 - y < rad ? y1 - rad : y;
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy > rad * rad + rad * 0.6) continue;
        }
        this.set(x, y, c);
      }
    }
    return this;
  }
  /** A thick line between two points (round caps). */
  line(x0, y0, x1, y1, c, thick = 1) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2));
    const r = (thick - 1) / 2;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      if (r <= 0) this.set(x, y, c);
      else this.ellipse(x, y, r, r, c);
    }
    return this;
  }
  /** A 1px outline around everything drawn so far. */
  outline(c) {
    const add = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.px[y][x]) continue;
        const n = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dx, dy]) => {
          const p = this.get(x + dx, y + dy);
          return p && p !== C.shadow;
        });
        if (n) add.push([x, y]);
      }
    }
    for (const [x, y] of add) this.px[y][x] = c;
    return this;
  }
  /** Replace one color within a region (for shading passes). */
  recolor(from, to, x0 = 0, y0 = 0, x1 = this.w - 1, y1 = this.h - 1) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) if (this.px[y]?.[x] === from) this.px[y][x] = to;
    }
    return this;
  }
  mirrored() {
    const m = new Art(this.w, this.h);
    m.px = this.px.map((row) => [...row].reverse());
    return m;
  }
}

// ── Desks ────────────────────────────────────────────────────

/** White top, a light front edge, a slate front with a drawer unit on the left. */
export function officeDesk(w) {
  const a = new Art(w, 32);
  const x0 = 1;
  const x1 = w - 2;
  a.rect(x0, 1, x1, 19, C.white);
  a.hline(x0 + 1, x1 - 1, 2, C.whiteHi);
  a.hline(x0, x1, 1, C.edge);
  a.vline(x0, 1, 19, C.edge);
  a.vline(x1, 1, 19, C.edge);
  a.rect(x0, 20, x1, 21, C.edge);
  a.rect(x0, 22, x1, 30, C.slate);
  a.hline(x0, x1, 22, C.slateHi);
  a.vline(x0, 22, 30, C.slateDark);
  a.vline(x1, 22, 30, C.slateDark);
  a.hline(x0, x1, 30, C.slateDark);
  // Drawer unit
  const dw = Math.round(w * 0.3);
  a.rect(x0 + 2, 23, x0 + 1 + dw, 29, C.drawer);
  a.rect(x0 + 2, 23, x0 + 1 + dw, 23, C.edgeDark);
  a.rect(x0 + 2, 29, x0 + 1 + dw, 29, C.edgeDark);
  a.vline(x0 + 2, 23, 29, C.edgeDark);
  a.vline(x0 + 1 + dw, 23, 29, C.edgeDark);
  a.hline(x0 + 2, x0 + 1 + dw, 26, C.edgeDark);
  const mid = x0 + 2 + Math.floor(dw / 2);
  a.hline(mid - 2, mid + 1, 24, C.edge);
  a.hline(mid - 2, mid + 1, 28, C.edge);
  // Leg panel on the right
  a.rect(x1 - 4, 23, x1 - 2, 29, C.slateHi);
  a.hline(x0 + 1, x1 - 1, 31, C.shadow);
  return a;
}

/** A rounded white desk on a light-blue base: round on the left, softer on the right. */
export function curvedDesk(w) {
  const a = new Art(w, 32);
  // Base (the desk's side), drawn first, 6px lower than the top.
  a.roundRect(1, 7, w - 2, 29, [9, 4], C.edgeDark);
  a.roundRect(1, 6, w - 2, 28, [9, 4], C.edge);
  // Top
  a.roundRect(1, 1, w - 2, 23, [9, 4], C.white);
  a.roundRect(3, 2, w - 4, 4, [7, 2], C.whiteHi);
  a.recolor(C.whiteHi, C.white, 0, 4, w - 1, 31);
  a.roundRect(3, 3, w - 4, 22, [7, 2], C.white);
  a.outline(C.edge);
  // A soft shadow under it
  for (let x = 6; x < w - 4; x++) if (!a.get(x, 30)) a.set(x, 30, C.shadow);
  return a;
}

// ── Chairs ───────────────────────────────────────────────────

/** Office chair seen from behind: mesh back, red armrests, wheels. `top` = first row. */
function chairBack(a, top) {
  const t = top;
  a.roundRect(3, t, 12, t + 11, 3, C.gray);
  a.roundRect(4, t + 1, 11, t + 10, 2, C.dark);
  // Mesh: an X across the back
  a.line(5, t + 2, 10, t + 9, C.gray);
  a.line(10, t + 2, 5, t + 9, C.gray);
  a.hline(5, 10, t + 1, C.grayHi);
  // Armrests
  a.rect(1, t + 6, 2, t + 10, C.gray);
  a.rect(13, t + 6, 14, t + 10, C.gray);
  a.vline(1, t + 7, t + 9, C.red);
  a.vline(14, t + 7, t + 9, C.red);
  // Seat edge, stem, base, wheels
  a.rect(4, t + 12, 11, t + 12, C.gray);
  a.rect(7, t + 13, 8, t + 13, C.ink);
  a.hline(3, 12, t + 14, C.gray);
  a.set(3, t + 15, C.ink);
  a.set(7, t + 15, C.ink);
  a.set(8, t + 15, C.ink);
  a.set(12, t + 15, C.ink);
  a.outline(C.ink);
}

/** Office chair seen from the front: back behind, seat, armrests, wheels. */
function chairFront(a, top) {
  const t = top;
  a.roundRect(3, t, 12, t + 8, 3, C.dark);
  a.hline(5, 10, t + 1, C.gray);
  a.roundRect(2, t + 8, 13, t + 12, 2, C.gray);
  a.hline(4, 11, t + 9, C.grayHi);
  a.rect(1, t + 7, 2, t + 11, C.dark);
  a.rect(13, t + 7, 14, t + 11, C.dark);
  a.vline(1, t + 8, t + 10, C.red);
  a.vline(14, t + 8, t + 10, C.red);
  a.rect(7, t + 13, 8, t + 13, C.ink);
  a.hline(3, 12, t + 14, C.gray);
  a.set(3, t + 15, C.ink);
  a.set(7, t + 15, C.ink);
  a.set(8, t + 15, C.ink);
  a.set(12, t + 15, C.ink);
  a.outline(C.ink);
}

/** Office chair from the side, facing right (its seat toward the desk). */
function chairSide(a, top) {
  const t = top;
  a.roundRect(3, t, 6, t + 11, 2, C.dark);
  a.vline(4, t + 1, t + 9, C.gray);
  a.roundRect(4, t + 9, 12, t + 11, 1, C.gray);
  a.hline(5, 11, t + 9, C.grayHi);
  a.rect(8, t + 7, 11, t + 8, C.dark);
  a.hline(9, 11, t + 7, C.red);
  a.rect(7, t + 12, 8, t + 13, C.ink);
  a.hline(4, 11, t + 14, C.gray);
  a.set(4, t + 15, C.ink);
  a.set(11, t + 15, C.ink);
  a.outline(C.ink);
}

/** 16x32 (two tiles, seat on the lower one) or 16x16 (one tile) office chairs. */
export function officeChair(view, tall) {
  const a = new Art(16, tall ? 32 : 16);
  const top = tall ? 15 : 0;
  if (view === 'back') chairBack(a, top);
  else if (view === 'front') chairFront(a, top);
  else chairSide(a, top);
  return a;
}

// ── Desk setup ───────────────────────────────────────────────

/** Wide monitor, facing the viewer: a synthwave sunset on screen. */
export function monitorFront() {
  const a = new Art(16, 16);
  a.rect(0, 0, 15, 10, C.dark);
  // Sky, sun, sea
  a.rect(1, 1, 14, 9, C.sky);
  a.rect(1, 3, 14, 5, C.skyHi);
  for (let y = 3; y <= 6; y++) {
    for (let x = 5; x <= 10; x++) {
      const dx = x - 7.5;
      const dy = y - 6.5;
      if (dx * dx + dy * dy <= 10) a.set(x, y, y === 3 ? C.sunHi : C.sun);
    }
  }
  a.rect(1, 7, 14, 9, C.seaDark);
  a.hline(2, 6, 7, C.sea);
  a.hline(9, 13, 7, C.sea);
  a.hline(1, 4, 8, C.sea);
  a.hline(7, 11, 8, C.sea);
  a.hline(3, 8, 9, C.sea);
  a.hline(11, 14, 9, C.sea);
  // Stand
  a.rect(7, 11, 8, 12, C.gray);
  a.rect(5, 13, 10, 13, C.dark);
  a.outline(C.ink);
  return a;
}

export function monitorBack() {
  const a = new Art(16, 16);
  a.rect(0, 0, 15, 10, C.gray);
  a.rect(1, 1, 14, 9, C.dark);
  a.rect(6, 3, 9, 6, C.gray);
  a.hline(2, 13, 1, C.grayHi);
  a.rect(7, 11, 8, 12, C.gray);
  a.rect(5, 13, 10, 13, C.dark);
  a.outline(C.ink);
  return a;
}

/** Side view, screen toward the LEFT (a chair left of the desk). */
export function monitorSide() {
  const a = new Art(16, 16);
  a.rect(6, 0, 8, 10, C.dark);
  a.vline(6, 1, 9, C.sea);
  a.vline(8, 1, 9, C.gray);
  a.rect(8, 11, 9, 12, C.gray);
  a.rect(6, 13, 11, 13, C.dark);
  a.outline(C.ink);
  return a;
}

/** Portrait monitor with a colorful list (a board, a chat, a to-do). */
export function tallMonitorFront() {
  const a = new Art(16, 16);
  a.rect(2, 0, 12, 12, C.gray);
  a.rect(3, 1, 11, 11, C.screen);
  const rows = [
    [2, C.yellow],
    [5, C.pink],
    [8, C.green],
  ];
  for (const [y, c] of rows) {
    a.rect(4, y, 5, y + 1, c);
    a.hline(7, 10, y, C.edgeDark);
    a.hline(7, 9, y + 1, C.grayHi);
  }
  a.rect(4, 10, 5, 10, C.cyan);
  a.hline(7, 10, 10, C.edgeDark);
  a.rect(7, 13, 8, 13, C.gray);
  a.rect(5, 14, 10, 14, C.dark);
  a.outline(C.ink);
  return a;
}

export function tallMonitorBack() {
  const a = new Art(16, 16);
  a.rect(2, 0, 12, 12, C.gray);
  a.rect(3, 1, 11, 11, C.dark);
  a.rect(6, 4, 8, 7, C.gray);
  a.rect(7, 13, 8, 13, C.gray);
  a.rect(5, 14, 10, 14, C.dark);
  a.outline(C.ink);
  return a;
}

export function tallMonitorSide() {
  const a = new Art(16, 16);
  a.rect(6, 0, 8, 12, C.gray);
  a.vline(6, 1, 11, C.yellow);
  a.rect(8, 13, 9, 13, C.gray);
  a.rect(6, 14, 11, 14, C.dark);
  a.outline(C.ink);
  return a;
}

/** Dark PC tower with a cyan power light. */
export function pcTower() {
  const a = new Art(16, 16);
  a.rect(5, 0, 11, 13, C.gray);
  a.rect(6, 1, 10, 12, C.dark);
  for (const y of [3, 5, 7]) a.hline(7, 9, y, C.grayHi);
  a.set(8, 10, C.cyan);
  a.outline(C.ink);
  return a;
}

export function keyboardFront() {
  const a = new Art(16, 16);
  a.rect(1, 0, 14, 3, C.dark);
  for (let x = 2; x <= 13; x += 2) {
    a.set(x, 1, C.grayHi);
    a.set(x + 1, 2, C.grayHi);
  }
  a.hline(5, 10, 2, C.grayHi);
  a.outline(C.ink);
  return a;
}

export function keyboardSide() {
  const a = new Art(16, 16);
  a.rect(6, 0, 9, 11, C.dark);
  for (let y = 1; y <= 10; y += 2) {
    a.set(7, y, C.grayHi);
    a.set(8, y + 1, C.grayHi);
  }
  a.outline(C.ink);
  return a;
}

export function mouse() {
  const a = new Art(16, 16);
  a.roundRect(6, 0, 9, 4, 1, C.dark);
  a.vline(7, 0, 1, C.grayHi);
  a.outline(C.ink);
  return a;
}

/** A round lattice pie on a plate, seen from above at an angle. */
export function pie() {
  const a = new Art(16, 16);
  a.ellipse(7.5, 10.5, 7, 2.3, C.plate);
  a.ellipse(7.5, 9, 6.2, 2, C.crustDark);
  a.ellipse(7.5, 6, 6.2, 4, C.crustMid);
  a.ellipse(7.5, 5.8, 5.2, 3.2, C.crust);
  // Lattice
  for (let i = -4; i <= 4; i += 2) {
    a.line(7.5 + i - 2, 3, 7.5 + i + 2, 8.5, C.crustMid);
  }
  a.ellipse(7.5, 5.6, 1.5, 1, C.crustDark);
  a.outline(C.crustDark);
  a.recolor(C.crustDark, C.edgeDark, 0, 12, 15, 15);
  return a;
}

/** Industrial robot arm: dark base, orange arm up-left, elbow, forearm to the right, tool down. */
export function robotArm() {
  const a = new Art(32, 32);
  // Base
  a.roundRect(10, 25, 21, 29, 2, C.gray);
  a.rect(11, 22, 20, 25, C.dark);
  a.hline(11, 20, 22, C.gray);
  // Lower arm: from the shoulder (16,21) up-left to the elbow (7,10)
  a.line(15.5, 21, 7.5, 10, C.orange, 5);
  a.line(14, 20, 6.5, 10, C.orangeHi, 1);
  // Upper arm: from the elbow up-right to the wrist (22,4)
  a.line(7.5, 9.5, 21.5, 4.5, C.orange, 5);
  a.line(8.5, 7.5, 21, 3, C.orangeHi, 1);
  // Joints
  a.ellipse(16, 21, 2.6, 2.6, C.gray);
  a.ellipse(7.5, 10, 2.6, 2.6, C.gray);
  a.ellipse(7.5, 10, 1, 1, C.dark);
  a.ellipse(22, 4.5, 2.6, 2.6, C.gray);
  // Tool: a steel wrist down to a red gripper
  a.line(23.5, 6, 26.5, 11, C.steel, 2);
  a.rect(25, 11, 28, 12, C.dark);
  a.vline(25, 13, 14, C.red);
  a.vline(28, 13, 14, C.red);
  a.outline(C.ink);
  return a;
}

/** A leafy fig in a white pot on a small wooden stand (stands on the floor). */
export function plantStand() {
  const a = new Art(16, 32);
  // Stand: a top board and four splayed legs
  a.rect(2, 25, 13, 26, C.wood);
  a.hline(2, 13, 25, C.woodDark);
  a.line(3, 27, 2, 31, C.woodDark);
  a.line(12, 27, 13, 31, C.woodDark);
  a.line(5, 27, 5, 30, C.wood);
  a.line(10, 27, 10, 30, C.wood);
  // Pot
  a.roundRect(3, 18, 12, 24, 1, C.white);
  a.hline(3, 12, 18, C.whiteHi);
  a.vline(11, 19, 24, C.edge);
  a.hline(4, 11, 24, C.edge);
  // Branches
  a.line(7.5, 18, 6, 10, C.stem);
  a.line(7.5, 17, 10, 8, C.stem);
  a.line(6, 12, 3.5, 9, C.stem);
  // Big oval leaves, darker ones behind
  const leaves = [
    [3, 14.5, 2.6, 2, C.leaf],
    [12.5, 14, 2.6, 2, C.leaf],
    [7.5, 13.5, 2.8, 2, C.leafMid],
    [2.5, 9.5, 2.4, 2.2, C.leafMid],
    [12.5, 9, 2.4, 2.2, C.leafMid],
    [5.5, 6, 2.8, 2.4, C.leafMid],
    [10.5, 5, 2.8, 2.4, C.leafMid],
    [7.5, 9.5, 2.4, 2, C.leafMid],
    [8, 2, 2.4, 1.8, C.leafMid],
  ];
  for (const [x, y, rx, ry, c] of leaves) {
    a.ellipse(x, y, rx, ry, c);
    if (c === C.leafMid) a.ellipse(x - 0.7, y - 0.6, rx - 1.3, ry - 1.1, C.leafHi);
    a.set(x, y, C.leaf);
  }
  a.outline(C.leaf);
  return a;
}
