// webview-ui/src/games/fps/maps.ts
//
// Pixel Frag's maps: three built in (the same on every office, so a match on
// one needs nothing sent), and the office itself — the floor on screen turned
// into a map: its walls stand, desks become waist-high blocks, the rest of the
// furniture stands in the room as sprites. An office map is built by the
// match's host and sent to the others.

import type {
  FpsBlock,
  FpsItem,
  FpsItemKind,
  FpsMapData,
  FpsPoint,
  FpsProp,
  FpsSurface,
} from '../../../../core/src/messages.js';
import { FPS_BLOCK_HEIGHT, WALL_COLOR } from '../../constants.js';
import type { OfficeState } from '../../office/engine/officeState.js';
import { deskSurface } from '../../office/layout/deskSurface.js';
import { isDoorType } from '../../office/layout/doors.js';
import { getCatalogEntry } from '../../office/layout/furnitureCatalog.js';
import { mixRgb, shadeRgb } from '../../office/sprites/fpsArt.js';
import { TileType } from '../../office/types.js';
import { wallColorToHex } from '../../office/wallTiles.js';
import type { Rng } from './sim.js';

export interface MapChoice {
  id: string;
  name: string;
  description: string;
}

export const OFFICE_MAP_ID = 'office';

export const MAP_CHOICES: readonly MapChoice[] = [
  {
    id: OFFICE_MAP_ID,
    name: 'Your office',
    description: 'The floor on screen: desks, walls and all',
  },
  { id: 'arena', name: 'Arena', description: 'Open rooms, crates and pillars' },
  { id: 'maze', name: 'Maze', description: 'Stone corridors with loops' },
  { id: 'warehouse', name: 'Warehouse', description: 'Rows of crates to duck behind' },
];

export const mapName = (id: string): string => MAP_CHOICES.find((m) => m.id === id)?.name ?? id;

/** Deterministic random numbers (the same maze on every office). */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wallChar = (i: number) => String.fromCharCode(65 + Math.min(25, i));
const floorChar = (i: number) => String.fromCharCode(97 + Math.min(25, i));
const blockChar = (i: number) => String.fromCharCode(48 + Math.min(9, i));

const isFloorChar = (ch: string) => ch >= 'a' && ch <= 'z';

/**
 * Spread `count` points over the open cells: each as far as possible from the
 * ones already taken (and from `avoid`). Starts from the open cell nearest the middle.
 */
export function spreadPoints(
  open: ReadonlyArray<{ x: number; y: number }>,
  count: number,
  avoid: readonly FpsPoint[] = [],
): FpsPoint[] {
  if (open.length === 0 || count <= 0) return [];
  const taken: FpsPoint[] = [];
  const minDist = open.map((c) =>
    avoid.reduce((m, p) => Math.min(m, Math.hypot(p.x - c.x, p.y - c.y)), Infinity),
  );
  if (avoid.length === 0) {
    const mx = open.reduce((s, c) => s + c.x, 0) / open.length;
    const my = open.reduce((s, c) => s + c.y, 0) / open.length;
    let first = 0;
    open.forEach((c, i) => {
      if (Math.hypot(c.x - mx, c.y - my) < Math.hypot(open[first].x - mx, open[first].y - my)) {
        first = i;
      }
    });
    minDist[first] = -1;
    taken.push({ x: open[first].x, y: open[first].y });
    open.forEach((c, i) => {
      if (minDist[i] >= 0) minDist[i] = Math.hypot(c.x - open[first].x, c.y - open[first].y);
    });
  }
  while (taken.length < count) {
    let best = -1;
    for (let i = 0; i < open.length; i++) if (best < 0 || minDist[i] > minDist[best]) best = i;
    if (best < 0 || minDist[best] <= 0) break;
    const p = { x: open[best].x, y: open[best].y };
    taken.push(p);
    for (let i = 0; i < open.length; i++) {
      minDist[i] = Math.min(minDist[i], Math.hypot(open[i].x - p.x, open[i].y - p.y));
    }
  }
  return taken;
}

/** The biggest group of connected walkable cells (a shut room must not hold a spawn). */
function largestOpenArea(
  cells: string[],
  cols: number,
  rows: number,
  solid: Set<number>,
): number[] {
  const seen = new Uint8Array(cols * rows);
  let best: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (seen[i] || !isFloorChar(cells[i]) || solid.has(i)) continue;
    const group = [i];
    seen[i] = 1;
    for (let q = 0; q < group.length; q++) {
      const j = group[q];
      const c = j % cols;
      for (const k of [c > 0 ? j - 1 : -1, c < cols - 1 ? j + 1 : -1, j - cols, j + cols]) {
        if (k < 0 || k >= cells.length || seen[k] || !isFloorChar(cells[k]) || solid.has(k)) {
          continue;
        }
        seen[k] = 1;
        group.push(k);
      }
    }
    if (group.length > best.length) best = group;
  }
  return best;
}

const ITEM_CYCLE: FpsItemKind[] = ['health', 'bullets', 'shells', 'health', 'shells', 'bullets'];

/** Spawns and pickups over the largest open area, far apart. */
function placeSpawnsAndItems(
  cells: string[],
  cols: number,
  rows: number,
  solid: Set<number>,
  spawnCount: number,
  itemCount: number,
): { spawns: FpsPoint[]; items: FpsItem[] } {
  const area = largestOpenArea(cells, cols, rows, solid).map((i) => ({
    x: (i % cols) + 0.5,
    y: Math.floor(i / cols) + 0.5,
  }));
  const spawns = spreadPoints(area, spawnCount);
  const itemSpots = spreadPoints(area, itemCount, spawns);
  return {
    spawns,
    items: itemSpots.map((p, i) => ({ ...p, k: ITEM_CYCLE[i % ITEM_CYCLE.length] })),
  };
}

// ── Built-in maps ────────────────────────────────────────────

interface AsciiSpec {
  name: string;
  rows: string[];
  walls: FpsSurface[];
  floors: FpsSurface[];
  blocks: FpsBlock[];
  ceiling: number;
  fog: number;
}

/**
 * `#` `%` `&` walls 0-2, `.` `,` floors 0-1, `x` `o` blocks 0-1, and on floor 0:
 * `S` a spawn, `h` `s` `b` health / shells / bullets, `p` a barrel, `q` a plant.
 */
function fromAscii(spec: AsciiSpec): FpsMapData {
  const rows = spec.rows.length;
  const cols = spec.rows[0].length;
  const cells: string[] = [];
  const spawns: FpsPoint[] = [];
  const items: FpsItem[] = [];
  const props: FpsProp[] = [];
  const solid: number[] = [];
  const itemKinds: Record<string, FpsItemKind> = { h: 'health', s: 'shells', b: 'bullets' };
  const propKinds: Record<string, string> = { p: 'barrel', q: 'plant' };
  spec.rows.forEach((line, y) => {
    for (let x = 0; x < cols; x++) {
      const ch = line[x] ?? '#';
      const i = y * cols + x;
      const at = { x: x + 0.5, y: y + 0.5 };
      if (ch === '#' || ch === '%' || ch === '&') cells.push(wallChar('#%&'.indexOf(ch)));
      else if (ch === 'x' || ch === 'o') cells.push(blockChar('xo'.indexOf(ch)));
      else if (ch === ',') cells.push(floorChar(1));
      else {
        cells.push(floorChar(0));
        if (ch === 'S') spawns.push(at);
        else if (itemKinds[ch]) items.push({ ...at, k: itemKinds[ch] });
        else if (propKinds[ch]) {
          props.push({ ...at, t: propKinds[ch] });
          solid.push(i);
        }
      }
    }
  });
  return {
    name: spec.name,
    cols,
    rows,
    cells: cells.join(''),
    walls: spec.walls,
    floors: spec.floors,
    blocks: spec.blocks,
    props,
    solid,
    spawns,
    items,
    ceiling: spec.ceiling,
    fog: spec.fog,
  };
}

const CRATE: FpsBlock = { h: 0.42, top: 0xa07a48, side: 0x8a6a3a };
const PALLET: FpsBlock = { h: 0.25, top: 0x8a7a5a, side: 0x6a5a3a };

function arenaMap(): FpsMapData {
  return fromAscii({
    name: 'Arena',
    rows: [
      '##########################',
      '#S.....h.....#......b...S#',
      '#............#...........#',
      '#...xx............xx.....#',
      '#...xx.....%%.....xx.....#',
      '#..........%%............#',
      '#s.....p..........p.....s#',
      '###..###........###..#####',
      '#.......#......#.........#',
      '#...b...#..xx..#....h....#',
      '#.......S..xx..S.........#',
      '#.......#......#.........#',
      '###..###........###..#####',
      '#s.....p..........p.....s#',
      '#..........%%............#',
      '#...xx.....%%.....xx.....#',
      '#...xx............xx.....#',
      '#............#...........#',
      '#S.....h.....#......b...S#',
      '##########################',
    ],
    walls: [{ tex: 'tech' }, { tex: 'brick' }, { tex: 'metal' }],
    floors: [{ tex: 'grid' }, { tex: 'plate' }],
    blocks: [CRATE, PALLET],
    ceiling: 0x3a4050,
    fog: 0x0c0e16,
  });
}

/** A maze from a fixed seed (identical everywhere), with some walls knocked out for loops and a room in the middle. */
function mazeMap(): FpsMapData {
  const n = 11;
  const size = n * 2 + 1;
  const rng = seededRng(7);
  const grid: string[][] = Array.from({ length: size }, () => Array<string>(size).fill('#'));
  const visited = new Set<number>();
  const stack: Array<[number, number]> = [[0, 0]];
  visited.add(0);
  grid[1][1] = '.';
  while (stack.length > 0) {
    const [cx, cy] = stack[stack.length - 1];
    const next = (
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const
    )
      .map(([dx, dy]) => [cx + dx, cy + dy] as [number, number])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n && !visited.has(y * n + x));
    if (next.length === 0) {
      stack.pop();
      continue;
    }
    const [nx, ny] = next[Math.floor(rng() * next.length)];
    visited.add(ny * n + nx);
    grid[ny * 2 + 1][nx * 2 + 1] = '.';
    grid[cy + ny + 1][cx + nx + 1] = '.';
    stack.push([nx, ny]);
  }
  // Loops: knock out some walls between two corridors.
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (grid[y][x] !== '#') continue;
      const across = grid[y][x - 1] === '.' && grid[y][x + 1] === '.';
      const down = grid[y - 1][x] === '.' && grid[y + 1][x] === '.';
      if ((across || down) && rng() < 0.14) grid[y][x] = '.';
    }
  }
  const mid = Math.floor(size / 2);
  for (let y = mid - 2; y <= mid + 2; y++) {
    for (let x = mid - 2; x <= mid + 2; x++) grid[y][x] = '.';
  }
  grid[mid][mid] = '%';
  const cells = grid
    .flat()
    .map((ch) => (ch === '#' ? wallChar(0) : ch === '%' ? wallChar(1) : floorChar(0)));
  const { spawns, items } = placeSpawnsAndItems(cells, size, size, new Set(), 10, 10);
  return {
    name: 'Maze',
    cols: size,
    rows: size,
    cells: cells.join(''),
    walls: [{ tex: 'stone' }, { tex: 'brick' }],
    floors: [{ tex: 'concrete' }],
    blocks: [],
    props: [],
    solid: [],
    spawns,
    items,
    ceiling: 0x4a4438,
    fog: 0x0e0c0a,
  };
}

/** Crate stacks in a grid (every aisle stays open), a few pillars, barrels. */
function warehouseMap(): FpsMapData {
  const cols = 30;
  const rows = 22;
  const rng = seededRng(11);
  const cells: string[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const border = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      cells.push(border ? wallChar(0) : floorChar(0));
    }
  }
  const set = (x: number, y: number, ch: string) => {
    cells[y * cols + x] = ch;
  };
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 6; gx++) {
      if (rng() < 0.2) continue;
      const x0 = 3 + gx * 4;
      const y0 = 3 + gy * 4;
      const kind = rng() < 0.3 ? 1 : 0;
      const w = rng() < 0.5 ? 2 : 1;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < w; dx++) set(x0 + dx, y0 + dy, blockChar(kind));
      }
    }
  }
  for (const [x, y] of [
    [9, 9],
    [21, 9],
    [9, 13],
    [21, 13],
  ]) {
    set(x, y, wallChar(1));
  }
  const solid = new Set<number>();
  const props: FpsProp[] = [];
  for (let i = 0; i < 8; i++) {
    const x = 1 + Math.floor(rng() * (cols - 2));
    const y = 1 + Math.floor(rng() * (rows - 2));
    const idx = y * cols + x;
    if (!isFloorChar(cells[idx]) || solid.has(idx)) continue;
    // Barrels only where they leave the aisle open (a wall or crate beside them).
    const sideBlocked = [idx - 1, idx + 1, idx - cols, idx + cols].some(
      (k) => !isFloorChar(cells[k]),
    );
    if (!sideBlocked) continue;
    solid.add(idx);
    props.push({ x: x + 0.5, y: y + 0.5, t: 'barrel' });
  }
  const { spawns, items } = placeSpawnsAndItems(cells, cols, rows, solid, 10, 9);
  return {
    name: 'Warehouse',
    cols,
    rows,
    cells: cells.join(''),
    walls: [{ tex: 'metal' }, { tex: 'wood' }],
    floors: [{ tex: 'plate' }],
    blocks: [CRATE, PALLET],
    props,
    solid: [...solid],
    spawns,
    items,
    ceiling: 0x5a5a60,
    fog: 0x121214,
  };
}

const BUILTIN: Record<string, () => FpsMapData> = {
  arena: arenaMap,
  maze: mazeMap,
  warehouse: warehouseMap,
};

export const isBuiltinMap = (id: string): boolean => id in BUILTIN;

export function builtinMap(id: string): FpsMapData | null {
  return BUILTIN[id]?.() ?? null;
}

// ── The office as a map ──────────────────────────────────────

const hexToRgb = (hex: string): number => parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;

/** Average color of a sprite's visible pixels (a desk seen from above, for its block). */
function spriteColor(sprite: string[][]): number {
  const rect = deskSurface(sprite);
  if (rect) {
    const px = sprite[Math.floor((rect.y0 + rect.y1) / 2)]?.[Math.floor((rect.x0 + rect.x1) / 2)];
    if (px) return hexToRgb(px);
  }
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const row of sprite) {
    for (const px of row) {
      if (!px || px.length > 7) continue;
      const rgb = hexToRgb(px);
      r += (rgb >> 16) & 0xff;
      g += (rgb >> 8) & 0xff;
      b += rgb & 0xff;
      n++;
    }
  }
  if (n === 0) return 0x8a6a4a;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

const SPAWNS_PER_OPEN_CELLS = 12;
const ITEMS_PER_OPEN_CELLS = 30;
const MIN_OPEN_CELLS = 8;

/**
 * The floor on screen as a map, with a wall put round it. Null when it has too
 * little room to play in. Wall-hung items and doors are left out (a doorway is
 * floor already); pets and people are not part of the map.
 */
export function officeMap(os: OfficeState): FpsMapData | null {
  const layout = os.getLayout();
  const level = os.getViewLevel();
  const cols = level.cols + 2;
  const rows = level.rows + 2;
  const cells: string[] = Array<string>(cols * rows).fill(wallChar(0));
  const walls: FpsSurface[] = [];
  const floors: FpsSurface[] = [];
  const blocks: FpsBlock[] = [];
  const keys = {
    walls: new Map<string, number>(),
    floors: new Map<string, number>(),
    blocks: new Map<string, number>(),
  };
  const add = <T>(
    list: T[],
    index: Map<string, number>,
    key: string,
    value: T,
    cap: number,
  ): number => {
    const known = index.get(key);
    if (known !== undefined) return known;
    if (list.length >= cap) return 0;
    list.push(value);
    index.set(key, list.length - 1);
    return list.length - 1;
  };
  const voidWall = add(walls, keys.walls, 'void', { tex: 'void' }, 26);

  const at = (c: number, r: number) => (r + 1) * cols + (c + 1);
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      const lc = level.col + c;
      const lr = level.row + r;
      const idx = lr * layout.cols + lc;
      const tile = layout.tiles[idx];
      const color = layout.tileColors?.[idx] ?? null;
      if (tile === TileType.VOID) {
        cells[at(c, r)] = wallChar(voidWall);
      } else if (tile === TileType.WALL) {
        const base = hexToRgb(color ? wallColorToHex(color) : WALL_COLOR);
        // Wall color in the office is the dark top of the wall: its face in the room is lighter.
        const tint = mixRgb(base, 0xffffff, 0.45);
        cells[at(c, r)] = wallChar(
          add(walls, keys.walls, `office:${tint}`, { tex: 'office', tint }, 26),
        );
      } else {
        const adjust = color ?? { h: 0, s: 0, b: 0, c: 0 };
        const key = `${tile}:${adjust.h}:${adjust.s}:${adjust.b}:${adjust.c}`;
        const surface: FpsSurface = {
          pat: tile,
          color: { h: adjust.h, s: adjust.s, b: adjust.b, c: adjust.c },
        };
        cells[at(c, r)] = floorChar(add(floors, keys.floors, key, surface, 26));
      }
    }
  }
  if (floors.length === 0) floors.push({ tex: 'tile' });

  const solid = new Set<number>();
  const props: FpsProp[] = [];
  const inLevel = (c: number, r: number) => c >= 0 && r >= 0 && c < level.cols && r < level.rows;
  const surfaceItems: Array<{ x: number; y: number; t: string; c: number; r: number }> = [];
  for (const item of layout.furniture) {
    const entry = getCatalogEntry(item.type);
    if (!entry || entry.canPlaceOnWalls || isDoorType(item.type)) continue;
    const c0 = item.col - level.col;
    const r0 = item.row - level.row;
    if (!inLevel(c0, r0)) continue;
    const bg = entry.backgroundTiles ?? 0;
    const footprint: Array<[number, number]> = [];
    for (let dr = bg; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        if (inLevel(c0 + dc, r0 + dr)) footprint.push([c0 + dc, r0 + dr]);
      }
    }
    const cx = c0 + 1 + entry.footprintW / 2;
    const cy = r0 + 1 + (bg + entry.footprintH) / 2;
    if (entry.isDesk || entry.category === 'desks') {
      const top = spriteColor(entry.sprite);
      const block: FpsBlock = { h: FPS_BLOCK_HEIGHT, top, side: shadeRgb(top, 0.72) };
      const b = add(blocks, keys.blocks, `${top}`, block, 10);
      for (const [c, r] of footprint) {
        if (isFloorChar(cells[at(c, r)])) cells[at(c, r)] = blockChar(b);
      }
    } else if (entry.canPlaceOnSurfaces) {
      surfaceItems.push({ x: cx, y: cy, t: item.type, c: c0, r: r0 + entry.footprintH - 1 });
    } else if (entry.category === 'chairs' || footprint.length === 0) {
      props.push({ x: cx, y: cy, t: item.type });
    } else {
      props.push({ x: cx, y: cy, t: item.type });
      for (const [c, r] of footprint) solid.add(at(c, r));
    }
  }
  // Things on desks stand on the desk's top.
  for (const s of surfaceItems) {
    const onDesk = inLevel(s.c, s.r) && /[0-9]/.test(cells[at(s.c, s.r)]);
    props.push(
      onDesk ? { x: s.x, y: s.y, t: s.t, z: FPS_BLOCK_HEIGHT } : { x: s.x, y: s.y, t: s.t },
    );
  }

  const open = largestOpenArea(cells, cols, rows, solid).length;
  if (open < MIN_OPEN_CELLS) return null;
  const { spawns, items } = placeSpawnsAndItems(
    cells,
    cols,
    rows,
    solid,
    Math.max(4, Math.min(16, Math.round(open / SPAWNS_PER_OPEN_CELLS))),
    Math.max(2, Math.min(12, Math.round(open / ITEMS_PER_OPEN_CELLS))),
  );
  return {
    name: level.name || 'Office',
    cols,
    rows,
    cells: cells.join(''),
    walls,
    floors,
    blocks,
    props: props.slice(0, 400),
    solid: [...solid],
    spawns,
    items,
    ceiling: 0xe8e6de,
    fog: 0x1a1a24,
  };
}

/** The map a match plays on, as this office can make it (null = the host must send it). */
export function localMap(id: string, os: OfficeState | null): FpsMapData | null {
  if (id === OFFICE_MAP_ID) return os ? officeMap(os) : null;
  return builtinMap(id);
}

/** Cells people can walk on (floor with nothing standing on it). */
export function openCellCount(map: FpsMapData): number {
  const solid = new Set(map.solid);
  let n = 0;
  for (let i = 0; i < map.cells.length; i++) if (isFloorChar(map.cells[i]) && !solid.has(i)) n++;
  return n;
}
