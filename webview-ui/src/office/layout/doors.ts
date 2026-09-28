/**
 * Doors: furniture that sits IN a wall — the wall tile it is placed on becomes
 * its doorway (floor) — and opens by itself when someone walks through.
 *
 * A door is 1×2 like a wall piece: its bottom row is the doorway tile, its top
 * row the lintel over it (a background row). It never blocks walking. Front
 * doors go in walls running left-right (walls left and right of the doorway),
 * side doors in walls running up-down (walls above and below it); the editor
 * picks the one that fits where the pointer is.
 *
 * Pure and DOM-free.
 */

import { DOOR_GROUP_ID } from '../../constants.js';
import type { OfficeLayout, PlacedFurniture } from '../types.js';
import { TileType } from '../types.js';
import { getCatalogEntry, getFrontVariant, getVariantForOrientation } from './furnitureCatalog.js';

/** Door animation frames: closed, half open, open. */
export type DoorFrame = 0 | 1 | 2;

const FRAME_SUFFIX = ['', '_HALF', '_OPEN'] as const;

export function isDoorType(type: string): boolean {
  return getCatalogEntry(type)?.groupId === DOOR_GROUP_ID;
}

/** Side doors (in an up-down wall) are walked through left-right; front doors up-down. */
export function isSideDoor(type: string): boolean {
  return /^DOOR_SIDE/.test(type) || getCatalogEntry(type)?.orientation === 'side';
}

/** The closed door of the same orientation (the type the layout keeps). */
export function closedDoorType(type: string): string {
  return type.replace(/_(HALF|OPEN)$/, '');
}

/** The type a door is drawn as for an animation frame. */
export function doorFrameType(type: string, frame: DoorFrame): string {
  return `${closedDoorType(type)}${FRAME_SUFFIX[frame]}`;
}

/** The frame a door shows at `openness` (0 closed … 1 open). */
export function doorFrameAt(openness: number): DoorFrame {
  return openness < 0.34 ? 0 : openness < 0.8 ? 1 : 2;
}

/** The doorway tile of a placed door: its bottom row. */
export function doorTile(item: Pick<PlacedFurniture, 'type' | 'col' | 'row'>): {
  col: number;
  row: number;
} {
  const h = getCatalogEntry(item.type)?.footprintH ?? 2;
  return { col: item.col, row: item.row + h - 1 };
}

function isWallAt(layout: OfficeLayout, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return false;
  return layout.tiles[row * layout.cols + col] === TileType.WALL;
}

/**
 * The door variant that fits a doorway at (col, row): front between walls left
 * and right, side between walls above and below. Anything else keeps `type`.
 */
export function doorTypeFor(layout: OfficeLayout, type: string, col: number, row: number): string {
  if (!isDoorType(type)) return type;
  const leftRight = isWallAt(layout, col - 1, row) && isWallAt(layout, col + 1, row);
  const upDown = isWallAt(layout, col, row - 1) && isWallAt(layout, col, row + 1);
  const base = getFrontVariant(closedDoorType(type));
  if (leftRight && !upDown) return getVariantForOrientation(base, 'front');
  if (upDown && !leftRight) return getVariantForOrientation(base, 'right');
  return closedDoorType(type);
}

/**
 * Whether a door of `type` can stand with its top-left at (col, row): its
 * doorway on a wall or floor tile with walls on both sides (in the direction
 * the variant needs) and no other furniture on that tile.
 */
export function canPlaceDoor(
  layout: OfficeLayout,
  type: string,
  col: number,
  row: number,
  occupied: Set<string>,
): boolean {
  const { col: c, row: r } = doorTile({ type, col, row });
  if (c < 0 || r < 0 || c >= layout.cols || r >= layout.rows) return false;
  const tile = layout.tiles[r * layout.cols + c];
  if (tile === TileType.VOID) return false;
  const between = isSideDoor(type)
    ? isWallAt(layout, c, r - 1) && isWallAt(layout, c, r + 1)
    : isWallAt(layout, c - 1, r) && isWallAt(layout, c + 1, r);
  if (!between) return false;
  return !occupied.has(`${c},${r}`);
}
