import type { PathStep, PortalHop } from '../types.js';
import { TileType } from '../types.js';

/** A way through a portal from a tile: where it comes out, and the ride (see portals.ts). */
export interface PortalEdge {
  col: number;
  row: number;
  hop: PortalHop;
}

/**
 * Portal edges travel WITH the tile map they belong to: every caller already
 * passes OfficeState's tileMap to findPath, so attaching the stairs/elevator
 * graph to that array (instead of a new parameter on every call site) makes
 * every path — to a seat, a game, a person being followed — use them.
 */
const portalEdges = new WeakMap<TileType[][], Map<string, PortalEdge[]>>();

export function setPortalEdges(tileMap: TileType[][], edges: Map<string, PortalEdge[]>): void {
  portalEdges.set(tileMap, edges);
}

export function getPortalEdges(tileMap: TileType[][]): Map<string, PortalEdge[]> | undefined {
  return portalEdges.get(tileMap);
}

/** Check if a tile is walkable (floor, carpet, or doorway, and not blocked by furniture) */
export function isWalkable(
  col: number,
  row: number,
  tileMap: TileType[][],
  blockedTiles: Set<string>,
): boolean {
  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  if (row < 0 || row >= rows || col < 0 || col >= cols) return false;
  const t = tileMap[row][col];
  if (t === TileType.WALL || t === TileType.VOID) return false;
  if (blockedTiles.has(`${col},${row}`)) return false;
  return true;
}

/** Get walkable tile positions (grid coords) for wandering */
export function getWalkableTiles(
  tileMap: TileType[][],
  blockedTiles: Set<string>,
): Array<{ col: number; row: number }> {
  const rows = tileMap.length;
  const cols = rows > 0 ? tileMap[0].length : 0;
  const tiles: Array<{ col: number; row: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isWalkable(c, r, tileMap, blockedTiles)) {
        tiles.push({ col: c, row: r });
      }
    }
  }
  return tiles;
}

/** BFS pathfinding on 4-connected grid (no diagonals), plus the stairs and
 *  elevators attached to the tile map (a step reached through one carries
 *  `portal`). Returns path excluding start, including end. */
export function findPath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  tileMap: TileType[][],
  blockedTiles: Set<string>,
  /** False keeps the path on the start's level (pets never take the stairs). */
  usePortals = true,
): PathStep[] {
  if (startCol === endCol && startRow === endRow) return [];

  const key = (c: number, r: number) => `${c},${r}`;
  const startKey = key(startCol, startRow);
  const endKey = key(endCol, endRow);

  // End must be walkable (or be a chair tile which may be adjacent to desk)
  // We allow the end tile even if it's not strictly walkable for chair positions
  const endWalkable = isWalkable(endCol, endRow, tileMap, blockedTiles);
  if (!endWalkable) {
    // If the end is a desk tile, we still can't path there
    return [];
  }

  const edges = usePortals ? portalEdges.get(tileMap) : undefined;
  const visited = new Set<string>();
  visited.add(startKey);

  const parent = new Map<string, string>();
  /** Tiles reached by riding a portal, and the ride. */
  const rides = new Map<string, PortalHop>();
  const queue: Array<{ col: number; row: number }> = [{ col: startCol, row: startRow }];

  const dirs = [
    { dc: 0, dr: -1 }, // up
    { dc: 0, dr: 1 }, // down
    { dc: -1, dr: 0 }, // left
    { dc: 1, dr: 0 }, // right
  ];

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++];
    const currKey = key(curr.col, curr.row);

    if (currKey === endKey) {
      // Reconstruct path
      const path: PathStep[] = [];
      let k = endKey;
      while (k !== startKey) {
        const [c, r] = k.split(',').map(Number);
        const hop = rides.get(k);
        path.unshift(hop ? { col: c, row: r, portal: hop } : { col: c, row: r });
        k = parent.get(k)!;
      }
      return path;
    }

    for (const d of dirs) {
      const nc = curr.col + d.dc;
      const nr = curr.row + d.dr;
      const nk = key(nc, nr);

      if (visited.has(nk)) continue;
      if (!isWalkable(nc, nr, tileMap, blockedTiles)) continue;

      visited.add(nk);
      parent.set(nk, currKey);
      queue.push({ col: nc, row: nr });
    }

    const through = edges?.get(currKey);
    if (!through) continue;
    for (const e of through) {
      const nk = key(e.col, e.row);
      if (visited.has(nk)) continue;
      if (!isWalkable(e.col, e.row, tileMap, blockedTiles)) continue;
      visited.add(nk);
      parent.set(nk, currKey);
      rides.set(nk, e.hop);
      queue.push({ col: e.col, row: e.row });
    }
  }

  // No path found
  return [];
}
