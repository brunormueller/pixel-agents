import type { OfficeLayout, PlacedFurniture } from '../types.js';

/**
 * Three-way merge of office layouts, for a room map several people edit at
 * once: `mine` and `theirs` both started from `base`; the result keeps both
 * sides' changes. Where both changed the same thing, `mine` wins (it is the
 * edit being carried onto the newer map).
 *
 * - Furniture merges per item (by uid): added on either side stays, removed on
 *   either side goes, changed on either side takes that change.
 * - The grid (tiles, colors, carpet, area labels) merges per tile while both
 *   sides kept its shape. A side that reshaped it (grew a level, added or
 *   removed one) wins the whole grid: tile indexes mean something else there.
 * - Any other field is taken from whichever side changed it.
 */
export function mergeLayouts(
  base: OfficeLayout,
  mine: OfficeLayout,
  theirs: OfficeLayout,
): OfficeLayout {
  const b = base as unknown as Record<string, unknown>;
  const m = mine as unknown as Record<string, unknown>;
  const t = theirs as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(t), ...Object.keys(m)])) {
    if (GRID_KEYS.has(key) || key === 'furniture') continue;
    out[key] = pick(b[key], m[key], t[key]);
  }

  const baseShape = gridShape(base);
  const mineReshaped = gridShape(mine) !== baseShape;
  const theirsReshaped = gridShape(theirs) !== baseShape;
  if (mineReshaped || theirsReshaped) {
    const grid = (theirsReshaped ? t : m) as Record<string, unknown>;
    for (const key of GRID_KEYS) out[key] = grid[key];
  } else {
    out.cols = theirs.cols;
    out.rows = theirs.rows;
    // Same rectangles: names and heights may still differ.
    out.levels = pick(b.levels, m.levels, t.levels);
    const cells = theirs.cols * theirs.rows;
    for (const key of GRID_ARRAYS) {
      out[key] = mergeCells(
        b[key] as unknown[] | undefined,
        m[key] as unknown[] | undefined,
        t[key] as unknown[] | undefined,
        cells,
      );
    }
  }

  out.furniture = mergeFurniture(base.furniture, mine.furniture, theirs.furniture);
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out as unknown as OfficeLayout;
}

/** Same value, whoever serialized it (object key order does not count). */
export function sameLayoutValue(a: unknown, b: unknown): boolean {
  return a === b || canonical(a) === canonical(b);
}

/** Per-tile arrays, parallel to `tiles`. */
const GRID_ARRAYS = ['tiles', 'tileColors', 'carpetTiles', 'areaTiles'] as const;
const GRID_KEYS: ReadonlySet<string> = new Set(['cols', 'rows', 'levels', ...GRID_ARRAYS]);

/** JSON with object keys sorted, so equal values serialize alike. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, obj[k]]),
    );
  });
}

/** The grid's geometry: size and level rectangles (not their names). */
function gridShape(layout: OfficeLayout): string {
  const levels = (layout.levels ?? []).map(({ id, col, row, cols, rows }) => ({
    id,
    col,
    row,
    cols,
    rows,
  }));
  return canonical({ cols: layout.cols, rows: layout.rows, levels });
}

/** Ours when we changed it, else theirs. */
function pick<T>(base: T, mine: T, theirs: T): T {
  return sameLayoutValue(mine, base) ? theirs : mine;
}

function mergeCells(
  base: unknown[] | undefined,
  mine: unknown[] | undefined,
  theirs: unknown[] | undefined,
  cells: number,
): unknown[] | undefined {
  if (!mine && !theirs) return undefined;
  const out = new Array<unknown>(cells);
  for (let i = 0; i < cells; i++) {
    const b = base?.[i] ?? null;
    const m = mine?.[i] ?? null;
    const t = theirs?.[i] ?? null;
    out[i] = sameLayoutValue(m, b) ? t : m;
  }
  return out;
}

function mergeFurniture(
  base: PlacedFurniture[],
  mine: PlacedFurniture[],
  theirs: PlacedFurniture[],
): PlacedFurniture[] {
  const byUid = (list: PlacedFurniture[]) => new Map(list.map((f) => [f.uid, f]));
  const baseByUid = byUid(base);
  const mineByUid = byUid(mine);
  const theirsByUid = byUid(theirs);
  const out: PlacedFurniture[] = [];
  for (const item of theirs) {
    const ours = mineByUid.get(item.uid);
    const before = baseByUid.get(item.uid);
    if (ours) out.push(before && sameLayoutValue(ours, before) ? item : ours);
    else if (!before) out.push(item); // they added it
    // else: we removed it — that stands, even over their change
  }
  for (const item of mine) {
    if (theirsByUid.has(item.uid)) continue;
    const before = baseByUid.get(item.uid);
    // We added it, or they removed what we changed (our change stands).
    if (!before || !sameLayoutValue(item, before)) out.push(item);
  }
  return out;
}
