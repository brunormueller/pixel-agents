/**
 * Levels: the floors of a building, all in ONE layout grid.
 *
 * Each level is a rectangle of the grid, side by side, a VOID column apart
 * (LEVEL_GAP_COLS), so nothing walks from one to the next except through a
 * portal (stairs, an elevator — see portals.ts). Keeping every level in one
 * grid is what lets the whole engine stay as it is: seats, pathfinding, games,
 * decoration and the multiplayer poses all work in one coordinate system, and
 * an office that knows nothing about levels still reads the file (it just sees
 * the floors next to each other). Only the view shows one level at a time.
 *
 * Pure and DOM-free: every operation returns a new layout.
 */

import type { ColorValue } from '../../components/ui/types.js';
import {
  LEVEL_GAP_COLS,
  LEVEL_GROUND_NAME,
  LEVEL_NAME_MAX_LENGTH,
  levelDefaultName,
  MAIN_LEVEL_ID,
  MAX_LEVELS,
} from '../../constants.js';
import type {
  CarpetTile,
  OfficeLayout,
  OfficeLevel,
  PlacedFurniture,
  TileType as TileTypeVal,
} from '../types.js';
import { MAX_COLS, MAX_ROWS, TileType } from '../types.js';

/** A rectangle of the grid (a level, or what the view shows). */
export interface GridRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** Where a tile went after a grid change; null = it no longer exists. */
export type TileRemap = (col: number, row: number) => { col: number; row: number } | null;

/** The layout's levels. A layout without any is one level covering the whole grid. */
export function getLevels(layout: Pick<OfficeLayout, 'levels' | 'cols' | 'rows'>): OfficeLevel[] {
  if (layout.levels && layout.levels.length > 0) return layout.levels;
  return [
    {
      id: MAIN_LEVEL_ID,
      name: LEVEL_GROUND_NAME,
      elevation: 0,
      col: 0,
      row: 0,
      cols: layout.cols,
      rows: layout.rows,
    },
  ];
}

/** Levels top floor first — the order the switcher lists them in. */
export function levelsTopDown(levels: OfficeLevel[]): OfficeLevel[] {
  return [...levels].sort((a, b) => b.elevation - a.elevation);
}

export function inRect(rect: GridRect, col: number, row: number): boolean {
  return (
    col >= rect.col && col < rect.col + rect.cols && row >= rect.row && row < rect.row + rect.rows
  );
}

/** The level a tile belongs to (by column: levels stand side by side), or null (a gap). */
export function levelAt(levels: OfficeLevel[], col: number, row: number): OfficeLevel | null {
  for (const l of levels) if (inRect(l, col, row)) return l;
  return null;
}

/** The level whose columns hold `col`, whatever the row (walls hanging above a level
 *  and characters just off its edge still belong to it). */
export function levelOfColumn(levels: OfficeLevel[], col: number): OfficeLevel | null {
  for (const l of levels) if (col >= l.col && col < l.col + l.cols) return l;
  return null;
}

export function levelById(
  levels: OfficeLevel[],
  id: string | null | undefined,
): OfficeLevel | null {
  if (!id) return null;
  return levels.find((l) => l.id === id) ?? null;
}

/** The level a new building is seen from: the ground floor, else the lowest above it. */
export function defaultLevel(levels: OfficeLevel[]): OfficeLevel {
  const ground = levels.find((l) => l.elevation === 0);
  if (ground) return ground;
  const up = levels.filter((l) => l.elevation > 0).sort((a, b) => a.elevation - b.elevation);
  return up[0] ?? levelsTopDown(levels)[0];
}

/** Clean up a name typed for a level. Empty stays empty (the caller keeps the old name). */
export function cleanLevelName(name: string): string {
  const printable = [...name].filter((ch) => ch >= ' ' && ch !== '\u007f').join('');
  return printable.trim().slice(0, LEVEL_NAME_MAX_LENGTH);
}

// ── Grid surgery ──────────────────────────────────────────────────────────

function perTile<T>(
  layout: OfficeLayout,
  arr: T[] | undefined,
  newCols: number,
  newRows: number,
  fill: T,
  from: (c: number, r: number) => { col: number; row: number } | null,
): T[] | undefined {
  if (!arr) return undefined;
  const out = new Array<T>(newCols * newRows).fill(fill);
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      const to = from(c, r);
      if (!to || to.col < 0 || to.row < 0 || to.col >= newCols || to.row >= newRows) continue;
      out[to.row * newCols + to.col] = arr[r * layout.cols + c] ?? fill;
    }
  }
  return out;
}

/** Rebuild the grid with a new size, moving every tile, furniture item and level
 *  through `move` (null = gone). */
function regrid(
  layout: OfficeLayout,
  newCols: number,
  newRows: number,
  move: TileRemap,
): OfficeLayout {
  const tiles = perTile<TileTypeVal>(
    layout,
    layout.tiles,
    newCols,
    newRows,
    TileType.VOID as TileTypeVal,
    move,
  )!;
  const tileColors = perTile<ColorValue | null>(
    layout,
    layout.tileColors ?? new Array(layout.tiles.length).fill(null),
    newCols,
    newRows,
    null,
    move,
  );
  const carpetTiles = perTile<CarpetTile | null>(
    layout,
    layout.carpetTiles,
    newCols,
    newRows,
    null,
    move,
  );
  const areaTiles = perTile<string | null>(layout, layout.areaTiles, newCols, newRows, null, move);
  const furniture: PlacedFurniture[] = [];
  for (const f of layout.furniture) {
    const to = move(f.col, Math.max(0, f.row));
    if (!to) continue;
    furniture.push({ ...f, col: to.col, row: f.row + (to.row - Math.max(0, f.row)) });
  }
  const levels = layout.levels?.map((l) => {
    const to = move(l.col, l.row);
    return to ? { ...l, col: to.col, row: to.row } : l;
  });
  return {
    ...layout,
    cols: newCols,
    rows: newRows,
    tiles,
    tileColors,
    furniture,
    ...(carpetTiles ? { carpetTiles } : {}),
    ...(areaTiles ? { areaTiles } : {}),
    ...(levels ? { levels } : {}),
  };
}

/** Insert `count` VOID columns before column `at`: everything from `at` on moves right. */
export function insertColumns(layout: OfficeLayout, at: number, count: number): OfficeLayout {
  return regrid(layout, layout.cols + count, layout.rows, (c, r) => ({
    col: c >= at ? c + count : c,
    row: r,
  }));
}

/** Remove columns [at, at + count): what stood there is gone, what stood right of it moves left. */
export function removeColumns(layout: OfficeLayout, at: number, count: number): OfficeLayout {
  return regrid(layout, layout.cols - count, layout.rows, (c, r) =>
    c >= at && c < at + count ? null : { col: c >= at + count ? c - count : c, row: r },
  );
}

/** Insert `count` VOID rows before row `at`. */
export function insertRows(layout: OfficeLayout, at: number, count: number): OfficeLayout {
  return regrid(layout, layout.cols, layout.rows + count, (c, r) => ({
    col: c,
    row: r >= at ? r + count : r,
  }));
}

/** Remove rows [at, at + count). */
export function removeRows(layout: OfficeLayout, at: number, count: number): OfficeLayout {
  return regrid(layout, layout.cols, layout.rows - count, (c, r) =>
    r >= at && r < at + count ? null : { col: c, row: r >= at + count ? r - count : r },
  );
}

function withLevel(layout: OfficeLayout, level: OfficeLevel): OfficeLayout {
  return { ...layout, levels: (layout.levels ?? []).map((l) => (l.id === level.id ? level : l)) };
}

// ── Growing a level (the editor's ghost border) ─────────────────────────────

export type LevelEdge = 'left' | 'right' | 'up' | 'down';

/**
 * Grow one level by a tile on one side. The other levels keep their tiles; the
 * ones to the right move over when a column goes in. Returns the new layout,
 * how existing tiles moved (for characters standing on them) and where the
 * clicked ghost tile `ghost` now is. Null when the level would pass the grid
 * limits.
 */
export function expandLevel(
  layout: OfficeLayout,
  levelId: string,
  edge: LevelEdge,
  ghost: { col: number; row: number },
): { layout: OfficeLayout; remap: TileRemap; tile: { col: number; row: number } } | null {
  const level = levelById(layout.levels ?? [], levelId);
  if (!level) return null;
  const same: TileRemap = (c, r) => ({ col: c, row: r });
  if (edge === 'left' || edge === 'right') {
    if (level.cols + 1 > MAX_COLS) return null;
    const at = edge === 'left' ? level.col : level.col + level.cols;
    const grown = insertColumns(layout, at, 1);
    const next = withLevel(grown, { ...level, col: level.col, cols: level.cols + 1 });
    return {
      layout: next,
      remap: (c, r) => ({ col: c >= at ? c + 1 : c, row: r }),
      tile: { col: at, row: ghost.row },
    };
  }
  if (level.rows + 1 > MAX_ROWS) return null;
  if (edge === 'down') {
    const bottom = level.row + level.rows;
    const grown = bottom >= layout.rows ? insertRows(layout, layout.rows, 1) : layout;
    if (grown.rows > MAX_ROWS) return null;
    return {
      layout: withLevel(grown, { ...level, rows: level.rows + 1 }),
      remap: same,
      tile: { col: ghost.col, row: bottom },
    };
  }
  // Up: into the free row above, or push the whole building down a row.
  if (level.row > 0) {
    return {
      layout: withLevel(layout, { ...level, row: level.row - 1, rows: level.rows + 1 }),
      remap: same,
      tile: { col: ghost.col, row: level.row - 1 },
    };
  }
  if (layout.rows + 1 > MAX_ROWS) return null;
  const grown = insertRows(layout, 0, 1);
  return {
    layout: withLevel(grown, { ...level, row: 0, rows: level.rows + 1 }),
    remap: (c, r) => ({ col: c, row: r + 1 }),
    tile: { col: ghost.col, row: 0 },
  };
}

// ── Adding, removing, naming, ordering levels ──────────────────────────────

/** The layout with its implicit single level written out, so levels can be added to it. */
export function withExplicitLevels(layout: OfficeLayout): OfficeLayout {
  if (layout.levels && layout.levels.length > 0) return layout;
  return { ...layout, levels: getLevels(layout) };
}

/**
 * A new level above the highest or below the lowest one. It starts as a copy of
 * `template`'s shell — its walls and floors, not its furniture — the way a
 * building's floors share an outline. Null when the building has MAX_LEVELS.
 */
export function addLevel(
  layout: OfficeLayout,
  where: 'above' | 'below',
  templateId: string,
  newId: string,
): { layout: OfficeLayout; level: OfficeLevel } | null {
  const base = withExplicitLevels(layout);
  const levels = base.levels!;
  if (levels.length >= MAX_LEVELS) return null;
  const template = levelById(levels, templateId) ?? defaultLevel(levels);
  const elevations = levels.map((l) => l.elevation);
  const elevation = where === 'above' ? Math.max(...elevations) + 1 : Math.min(...elevations) - 1;

  const at = base.cols + LEVEL_GAP_COLS;
  let next = insertColumns(base, base.cols, LEVEL_GAP_COLS + template.cols);
  if (next.rows < template.rows) next = insertRows(next, next.rows, template.rows - next.rows);
  const level: OfficeLevel = {
    id: newId,
    name: levelDefaultName(elevation),
    elevation,
    col: at,
    row: 0,
    cols: template.cols,
    rows: template.rows,
  };
  // Copy the template's walls and floors (with their colors).
  const tiles = [...next.tiles];
  const tileColors = [...(next.tileColors ?? new Array(next.tiles.length).fill(null))];
  for (let r = 0; r < template.rows; r++) {
    for (let c = 0; c < template.cols; c++) {
      const src = (template.row + r) * base.cols + (template.col + c);
      const dst = r * next.cols + (at + c);
      tiles[dst] = base.tiles[src] ?? (TileType.VOID as TileTypeVal);
      tileColors[dst] = base.tileColors?.[src] ?? null;
    }
  }
  next = { ...next, tiles, tileColors, levels: [...next.levels!, level] };
  return { layout: next, level };
}

/**
 * Take a level out of the building: its tiles, the gap beside it and everything
 * on it go. Levels to its right close the gap. Portals that led there stay,
 * leading nowhere until they are linked again. Null for the last level.
 */
export function removeLevel(
  layout: OfficeLayout,
  levelId: string,
): { layout: OfficeLayout; remap: TileRemap } | null {
  const levels = layout.levels ?? [];
  const level = levelById(levels, levelId);
  if (!level || levels.length <= 1) return null;
  // Everything standing on the level (wall items may hang above its top row).
  const kept = {
    ...layout,
    furniture: layout.furniture.filter(
      (f) => !(f.col >= level.col && f.col < level.col + level.cols),
    ),
    levels: levels.filter((l) => l.id !== levelId),
  };
  const rightmost = level.col + level.cols >= layout.cols;
  const at = rightmost ? Math.max(0, level.col - LEVEL_GAP_COLS) : level.col;
  const count = rightmost ? layout.cols - at : level.cols + LEVEL_GAP_COLS;
  // Never the whole grid: the levels left must keep their columns (a hand-edited
  // file could have them overlap).
  if (count >= layout.cols) return null;
  let next = removeColumns(kept, at, count);
  let rowShift = 0;
  // Rows no remaining level uses go too (top and bottom).
  const top = Math.min(...next.levels!.map((l) => l.row));
  const bottom = Math.max(...next.levels!.map((l) => l.row + l.rows));
  if (bottom < next.rows) next = removeRows(next, bottom, next.rows - bottom);
  if (top > 0) {
    next = removeRows(next, 0, top);
    rowShift = top;
  }
  const remap: TileRemap = (c, r) => {
    if (c >= at && c < at + count) return null;
    const row = r - rowShift;
    if (row < 0 || row >= next.rows) return null;
    return { col: c >= at + count ? c - count : c, row };
  };
  return { layout: next, remap };
}

export function renameLevel(layout: OfficeLayout, levelId: string, name: string): OfficeLayout {
  const clean = cleanLevelName(name);
  const level = levelById(getLevels(layout), levelId);
  if (!clean || !level || level.name === clean) return layout;
  return withLevel(withExplicitLevels(layout), { ...level, name: clean });
}

/**
 * Move a level one place up or down the building: it swaps elevations with its
 * neighbour. Stairs between them then lead the other way (up becomes down).
 */
export function moveLevel(
  layout: OfficeLayout,
  levelId: string,
  direction: 'up' | 'down',
): OfficeLayout {
  const levels = layout.levels ?? [];
  const order = [...levels].sort((a, b) => a.elevation - b.elevation);
  const i = order.findIndex((l) => l.id === levelId);
  const j = direction === 'up' ? i + 1 : i - 1;
  if (i < 0 || j < 0 || j >= order.length) return layout;
  const a = order[i];
  const b = order[j];
  const rename = (l: OfficeLevel, elevation: number): OfficeLevel => ({
    ...l,
    elevation,
    // A level still wearing its default name gets the one for where it is now.
    name: l.name === levelDefaultName(l.elevation) ? levelDefaultName(elevation) : l.name,
  });
  return {
    ...layout,
    levels: levels.map((l) =>
      l.id === a.id ? rename(a, b.elevation) : l.id === b.id ? rename(b, a.elevation) : l,
    ),
  };
}
