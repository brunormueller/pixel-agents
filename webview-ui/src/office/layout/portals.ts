/**
 * Portals: stairs and elevators, the only way from one level to another.
 *
 * A portal is a furniture item whose catalog group is STAIRS_GROUP_ID or
 * ELEVATOR_GROUP_ID. Portals sharing a `link` id are connected: a staircase is
 * a pair (one end per level), an elevator is one door per level it stops at.
 * A character uses a portal from its ACCESS tiles — the floor tiles right below
 * the footprint (in front of the stairs, in front of the elevator door) — and
 * comes out on the matching access tile of the portal it rides to.
 *
 * Which way a ride goes is not stored anywhere: it is the elevation difference
 * of the two levels, so reordering the levels turns "up" into "down".
 *
 * Pure and DOM-free.
 */

import { ELEVATOR_GROUP_ID, STAIRS_GROUP_ID } from '../../constants.js';
import { canPlaceFurniture } from '../editor/editorActions.js';
import type { OfficeLayout, OfficeLevel, PlacedFurniture, PortalHop } from '../types.js';
import { getCatalogEntry } from './furnitureCatalog.js';
import { getLevels, levelById, levelOfColumn } from './levels.js';
import type { PortalEdge } from './tileMap.js';

export type PortalKind = 'stairs' | 'elevator';

export interface Portal {
  uid: string;
  type: string;
  kind: PortalKind;
  link: string | null;
  level: OfficeLevel | null;
  col: number;
  row: number;
  w: number;
  h: number;
  /** Tiles a character stands on to use it (and comes out on), left to right. */
  access: Array<{ col: number; row: number }>;
}

export function portalKindOf(type: string): PortalKind | null {
  const group = getCatalogEntry(type)?.groupId;
  if (group === STAIRS_GROUP_ID) return 'stairs';
  if (group === ELEVATOR_GROUP_ID) return 'elevator';
  return null;
}

/** Every portal in the layout. */
export function layoutPortals(layout: OfficeLayout): Portal[] {
  const levels = getLevels(layout);
  const out: Portal[] = [];
  for (const f of layout.furniture) {
    const kind = portalKindOf(f.type);
    if (!kind) continue;
    const entry = getCatalogEntry(f.type)!;
    const accessRow = f.row + entry.footprintH;
    const access: Array<{ col: number; row: number }> = [];
    for (let dc = 0; dc < entry.footprintW; dc++) access.push({ col: f.col + dc, row: accessRow });
    out.push({
      uid: f.uid,
      type: f.type,
      kind,
      link: f.link ?? null,
      level: levelOfColumn(levels, f.col),
      col: f.col,
      row: f.row,
      w: entry.footprintW,
      h: entry.footprintH,
      access,
    });
  }
  return out;
}

/** The portals a portal leads to: the others with its link, on other levels, of its kind. */
export function portalDestinations(portals: Portal[], from: Portal): Portal[] {
  if (!from.link || !from.level) return [];
  return portals.filter(
    (p) =>
      p !== from &&
      p.link === from.link &&
      p.kind === from.kind &&
      p.level !== null &&
      p.level.id !== from.level!.id,
  );
}

export function hopBetween(from: Portal, to: Portal): PortalHop {
  return {
    kind: from.kind,
    rise: (to.level?.elevation ?? 0) - (from.level?.elevation ?? 0),
    fromUid: from.uid,
    toUid: to.uid,
    toLevelId: to.level?.id ?? '',
  };
}

/**
 * The pathfinding edges portals add: from each access tile to the matching
 * access tile of every portal it leads to (lane by lane; a narrower end takes
 * the extra lanes on its last one). Keyed "col,row".
 */
export function portalLinks(portals: Portal[]): Map<string, PortalEdge[]> {
  const links = new Map<string, PortalEdge[]>();
  for (const from of portals) {
    for (const to of portalDestinations(portals, from)) {
      const hop = hopBetween(from, to);
      from.access.forEach((a, i) => {
        const b = to.access[Math.min(i, to.access.length - 1)];
        const key = `${a.col},${a.row}`;
        const list = links.get(key) ?? [];
        list.push({ col: b.col, row: b.row, hop });
        links.set(key, list);
      });
    }
  }
  return links;
}

/** The portal whose footprint covers a tile, or null. */
export function portalAt(portals: Portal[], col: number, row: number): Portal | null {
  for (const p of portals) {
    if (col >= p.col && col < p.col + p.w && row >= p.row && row < p.row + p.h) return p;
  }
  return null;
}

/** Stairs are drawn going up or down, by where their other end is. */
export function stairsGoDown(portals: Portal[], stairs: Portal): boolean {
  const [other] = portalDestinations(portals, stairs);
  return !!other && hopBetween(stairs, other).rise < 0;
}

// ── Editor: placing and linking ────────────────────────────────────────────

export function newLinkId(): string {
  return `link-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function newUid(): string {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** The free spot for `type` on `level` nearest to (col, row) — the same place on
 *  another floor when it fits there. */
export function nearestPlacement(
  layout: OfficeLayout,
  type: string,
  level: OfficeLevel,
  col: number,
  row: number,
): { col: number; row: number } | null {
  const entry = getCatalogEntry(type);
  if (!entry) return null;
  const maxR = Math.max(level.cols, level.rows);
  for (let r = 0; r <= maxR; r++) {
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
        const c = col + dc;
        const rr = row + dr;
        if (c < level.col || c + entry.footprintW > level.col + level.cols) continue;
        const bottom = rr + entry.footprintH - 1;
        if (bottom < level.row || bottom >= level.row + level.rows) continue;
        if (canPlaceFurniture(layout, type, c, rr)) return { col: c, row: rr };
      }
    }
  }
  return null;
}

/** Where `item` (on `from`) would stand on level `to`: the same spot relative to the level. */
function sameSpotOn(
  item: PlacedFurniture,
  from: OfficeLevel,
  to: OfficeLevel,
): { col: number; row: number } {
  return { col: to.col + (item.col - from.col), row: to.row + (item.row - from.row) };
}

/** Put a copy of `item` on `level`, as close to the same spot as it fits. */
function placeCopyOn(
  layout: OfficeLayout,
  item: PlacedFurniture,
  from: OfficeLevel,
  level: OfficeLevel,
  link: string,
): OfficeLayout {
  const want = sameSpotOn(item, from, level);
  const at = nearestPlacement(layout, item.type, level, want.col, want.row);
  if (!at) return layout;
  const copy: PlacedFurniture = { uid: newUid(), type: item.type, col: at.col, row: at.row, link };
  if (item.color) copy.color = { ...item.color };
  return { ...layout, furniture: [...layout.furniture, copy] };
}

/**
 * A portal was just placed (already in `layout`): connect it. Stairs get their
 * other end on the level right above (or, on the top floor, right below); an
 * elevator gets a door on every other level. Single-level layouts leave it
 * alone — there is nowhere to go yet.
 */
export function linkNewPortal(layout: OfficeLayout, uid: string): OfficeLayout {
  const item = layout.furniture.find((f) => f.uid === uid);
  const kind = item ? portalKindOf(item.type) : null;
  if (!item || !kind) return layout;
  const levels = getLevels(layout);
  const from = levelOfColumn(levels, item.col);
  if (!from || levels.length < 2) return layout;
  const link = newLinkId();
  let next: OfficeLayout = {
    ...layout,
    furniture: layout.furniture.map((f) => (f.uid === uid ? { ...f, link } : f)),
  };
  if (kind === 'stairs') {
    const above = levels
      .filter((l) => l.elevation > from.elevation)
      .sort((a, b) => a.elevation - b.elevation)[0];
    const below = levels
      .filter((l) => l.elevation < from.elevation)
      .sort((a, b) => b.elevation - a.elevation)[0];
    const target = above ?? below;
    return target ? placeCopyOn(next, { ...item, link }, from, target, link) : next;
  }
  for (const level of levels) {
    if (level.id !== from.id) next = placeCopyOn(next, { ...item, link }, from, level, link);
  }
  return next;
}

/** Delete a portal: stairs go with their other end, an elevator loses just this stop. */
export function removePortal(layout: OfficeLayout, uid: string): OfficeLayout {
  const item = layout.furniture.find((f) => f.uid === uid);
  if (!item) return layout;
  const kind = portalKindOf(item.type);
  const gone = (f: PlacedFurniture) =>
    f.uid === uid || (kind === 'stairs' && !!item.link && f.link === item.link);
  return { ...layout, furniture: layout.furniture.filter((f) => !gone(f)) };
}

/** Stairs lead to `levelId` from now on: their other end moves there (or is made there). */
export function setStairsTarget(layout: OfficeLayout, uid: string, levelId: string): OfficeLayout {
  const item = layout.furniture.find((f) => f.uid === uid);
  if (!item || portalKindOf(item.type) !== 'stairs') return layout;
  const levels = getLevels(layout);
  const from = levelOfColumn(levels, item.col);
  const target = levelById(levels, levelId);
  if (!from || !target || target.id === from.id) return layout;
  const link = item.link ?? newLinkId();
  // Drop the old other end(s), keep this one.
  let next: OfficeLayout = {
    ...layout,
    furniture: layout.furniture
      .filter((f) => f.uid === uid || !item.link || f.link !== item.link)
      .map((f) => (f.uid === uid ? { ...f, link } : f)),
  };
  next = placeCopyOn(next, { ...item, link }, from, target, link);
  return next;
}

/** Turn one of an elevator's stops on (a door appears on that level) or off. */
export function setElevatorStop(
  layout: OfficeLayout,
  uid: string,
  levelId: string,
  stops: boolean,
): OfficeLayout {
  const item = layout.furniture.find((f) => f.uid === uid);
  if (!item || portalKindOf(item.type) !== 'elevator') return layout;
  const levels = getLevels(layout);
  const from = levelOfColumn(levels, item.col);
  const target = levelById(levels, levelId);
  if (!from || !target) return layout;
  const link = item.link ?? newLinkId();
  let next: OfficeLayout = {
    ...layout,
    furniture: layout.furniture.map((f) => (f.uid === uid ? { ...f, link } : f)),
  };
  const doorOn = (l: OfficeLevel) =>
    next.furniture.find((f) => f.link === link && levelOfColumn(levels, f.col)?.id === l.id);
  const existing = doorOn(target);
  if (stops && !existing) {
    next = placeCopyOn(next, { ...item, link }, from, target, link);
  } else if (!stops && existing && existing.uid !== uid) {
    next = { ...next, furniture: next.furniture.filter((f) => f.uid !== existing.uid) };
  }
  return next;
}

/** What the editor shows about a selected portal. */
export interface PortalInfo {
  uid: string;
  kind: PortalKind;
  level: OfficeLevel | null;
  /** Stairs: the level the other end is on (null = leads nowhere yet). */
  target: OfficeLevel | null;
  /** Elevator: the levels it stops at (its own included). */
  stops: string[];
}

export function portalInfo(layout: OfficeLayout, uid: string): PortalInfo | null {
  const portals = layoutPortals(layout);
  const p = portals.find((x) => x.uid === uid);
  if (!p) return null;
  const dests = portalDestinations(portals, p);
  const stops = new Set<string>();
  if (p.level) stops.add(p.level.id);
  for (const d of dests) if (d.level) stops.add(d.level.id);
  return {
    uid,
    kind: p.kind,
    level: p.level,
    target: p.kind === 'stairs' ? (dests[0]?.level ?? null) : null,
    stops: [...stops],
  };
}
