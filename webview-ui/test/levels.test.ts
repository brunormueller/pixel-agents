/**
 * Levels (the floors of a building) and portals (stairs, elevators).
 *
 * The rule under test: every level lives in the ONE layout grid, side by side
 * a VOID column apart, so nothing walks from one level to the next except
 * through a portal — and which way a ride goes (up or down) is the levels'
 * order, never stored on the stairs.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { AVATAR_LOCAL_ID, FALLBACK_FLOOR_COLOR } from '../src/constants.js';
import { canPlaceFurniture } from '../src/office/editor/editorActions.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { transitLook } from '../src/office/engine/transit.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { layoutToTileMap } from '../src/office/layout/layoutSerializer.js';
import {
  addLevel,
  expandLevel,
  getLevels,
  levelAt,
  moveLevel,
  removeLevel,
} from '../src/office/layout/levels.js';
import {
  layoutPortals,
  linkNewPortal,
  portalInfo,
  portalLinks,
  removePortal,
  setElevatorStop,
  setStairsTarget,
  stairsGoDown,
} from '../src/office/layout/portals.js';
import { findPath, setPortalEdges } from '../src/office/layout/tileMap.js';
import type {
  OfficeLayout,
  PlacedFurniture,
  TileType as TileTypeVal,
  Transit,
} from '../src/office/types.js';
import { CharacterState, Direction, TILE_SIZE, TileType } from '../src/office/types.js';

const W = TileType.WALL as TileTypeVal;
const F = TileType.FLOOR_1 as TileTypeVal;

function sprite(w: number, h: number): string[][] {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => FALLBACK_FLOOR_COLOR));
}

beforeAll(() => {
  const asset = (
    id: string,
    groupId: string,
    category: string,
    w: number,
    h: number,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    label: id,
    category,
    width: w * 16,
    height: h * 16,
    footprintW: w,
    footprintH: h,
    isDesk: false,
    groupId,
    ...extra,
  });
  buildDynamicCatalog({
    catalog: [
      asset('STAIRS_UP', 'STAIRS', 'misc', 2, 2, { state: 'off' }),
      asset('STAIRS_DOWN', 'STAIRS', 'misc', 2, 2, { state: 'on' }),
      asset('ELEVATOR_CLOSED', 'ELEVATOR', 'wall', 1, 2, { state: 'off', canPlaceOnWalls: true }),
      asset('ELEVATOR_OPEN', 'ELEVATOR', 'wall', 1, 2, { state: 'on', canPlaceOnWalls: true }),
      asset('CHAIR', 'CHAIR', 'chairs', 1, 1),
    ],
    sprites: {
      STAIRS_UP: sprite(32, 32),
      STAIRS_DOWN: sprite(32, 32),
      ELEVATOR_CLOSED: sprite(16, 32),
      ELEVATOR_OPEN: sprite(16, 32),
      CHAIR: sprite(16, 16),
    },
  });
});

/** One floor: a wall row on top, open floor under it. */
function oneFloor(cols = 6, rows = 5): OfficeLayout {
  const tiles: TileTypeVal[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push(r === 0 ? W : F);
  return {
    version: 1,
    cols,
    rows,
    tiles,
    tileColors: tiles.map(() => null),
    furniture: [],
  };
}

/** Ground floor + the floor above it, each 6×5 (walls on top). */
function twoFloors(): OfficeLayout {
  return addLevel(oneFloor(), 'above', 'main', 'up1')!.layout;
}

const stairs = (uid: string, col: number, row: number, link?: string): PlacedFurniture => ({
  uid,
  type: 'STAIRS_UP',
  col,
  row,
  ...(link ? { link } : {}),
});

// ── Level geometry ──────────────────────────────────────────────

test('a new level stands beside the others, a VOID column apart, with a copy of the shell', () => {
  const base = oneFloor();
  base.furniture = [{ uid: 'chair', type: 'CHAIR', col: 2, row: 2 }];
  const { layout, level } = addLevel(base, 'above', 'main', 'up1')!;
  assert.equal(layout.cols, 6 + 1 + 6);
  assert.deepEqual(
    { col: level.col, row: level.row, cols: level.cols, rows: level.rows },
    { col: 7, row: 0, cols: 6, rows: 5 },
  );
  assert.equal(level.elevation, 1);
  assert.equal(level.name, 'Floor 1');
  // The gap is VOID on every row; the new level got the walls and floors, not the furniture.
  for (let r = 0; r < 5; r++) assert.equal(layout.tiles[r * layout.cols + 6], TileType.VOID);
  assert.equal(layout.tiles[0 * layout.cols + 7], W);
  assert.equal(layout.tiles[2 * layout.cols + 9], F);
  assert.equal(layout.furniture.length, 1);
  assert.equal(getLevels(layout).length, 2);

  const below = addLevel(layout, 'below', 'main', 'b1')!;
  assert.equal(below.level.elevation, -1);
  assert.equal(below.level.name, 'Basement');
});

test('a level grows on its own: the one to its right moves over, nothing else changes', () => {
  const layout = twoFloors();
  const grown = expandLevel(layout, 'main', 'right', { col: 6, row: 2 })!;
  const [ground, up] = grown.layout.levels!;
  assert.equal(ground.cols, 7);
  assert.equal(up.col, 8, 'the next level moved one column right');
  assert.equal(grown.layout.cols, 14);
  assert.deepEqual(grown.tile, { col: 6, row: 2 }, 'the clicked ghost tile is now the level’s');
  assert.deepEqual(grown.remap(9, 2), { col: 10, row: 2 }, 'someone upstairs moves with it');
  assert.deepEqual(grown.remap(3, 2), { col: 3, row: 2 });
  // Its old tiles came along
  assert.equal(grown.layout.tiles[2 * grown.layout.cols + 10], F);

  const left = expandLevel(layout, 'up1', 'left', { col: 6, row: 2 })!;
  const up1 = left.layout.levels!.find((l) => l.id === 'up1')!;
  assert.deepEqual({ col: up1.col, cols: up1.cols }, { col: 7, cols: 7 });
  assert.deepEqual(left.tile, { col: 7, row: 2 });
  assert.deepEqual(left.remap(8, 1), { col: 9, row: 1 }, 'its content shifted right');

  const down = expandLevel(layout, 'up1', 'down', { col: 8, row: 5 })!;
  assert.equal(down.layout.rows, 6);
  assert.equal(down.layout.levels!.find((l) => l.id === 'up1')!.rows, 6);
  assert.equal(
    down.layout.levels!.find((l) => l.id === 'main')!.rows,
    5,
    'the other keeps its size',
  );
});

test('removing a level closes the gap and says who stood where', () => {
  const layout = twoFloors();
  layout.furniture = [
    { uid: 'up-chair', type: 'CHAIR', col: 9, row: 2 },
    { uid: 'down-chair', type: 'CHAIR', col: 2, row: 2 },
  ];
  const three = addLevel(layout, 'above', 'up1', 'up2')!.layout; // up2 at col 14
  const removed = removeLevel(three, 'up1')!;
  assert.equal(removed.layout.cols, 13);
  assert.deepEqual(
    removed.layout.levels!.map((l) => [l.id, l.col]),
    [
      ['main', 0],
      ['up2', 7],
    ],
  );
  assert.deepEqual(
    removed.layout.furniture.map((f) => f.uid),
    ['down-chair'],
    'what stood on it went with it',
  );
  assert.equal(removed.remap(9, 2), null, 'someone on it has nowhere to stand');
  assert.deepEqual(removed.remap(15, 2), { col: 8, row: 2 });
  assert.equal(removeLevel(oneFloor(), 'main'), null, 'the last level stays');
});

test('reordering levels swaps their heights (and the default names follow)', () => {
  const layout = twoFloors();
  const swapped = moveLevel(layout, 'up1', 'down');
  const byId = Object.fromEntries(swapped.levels!.map((l) => [l.id, l]));
  assert.equal(byId.up1.elevation, 0);
  assert.equal(byId.main.elevation, 1);
  assert.equal(byId.up1.name, 'Ground floor');
  assert.equal(byId.main.name, 'Floor 1');
});

test('furniture never straddles two levels', () => {
  const layout = twoFloors();
  assert.equal(canPlaceFurniture(layout, 'STAIRS_UP', 4, 2), true);
  assert.equal(
    canPlaceFurniture(layout, 'STAIRS_UP', 5, 2),
    false,
    'its right half would be the gap',
  );
  assert.equal(canPlaceFurniture(layout, 'STAIRS_UP', 7, 2), true);
});

test('stairs need the tiles in front of them free, and nothing may block them later', () => {
  const layout = twoFloors();
  const chairInFront = { ...layout, furniture: [{ uid: 'c', type: 'CHAIR', col: 2, row: 3 }] };
  assert.equal(canPlaceFurniture(chairInFront, 'STAIRS_UP', 1, 1), false, 'the way in is blocked');
  const withStairs = { ...layout, furniture: [stairs('s1', 1, 1)] };
  assert.equal(canPlaceFurniture(withStairs, 'CHAIR', 1, 3), false, 'not in front of the stairs');
  assert.equal(canPlaceFurniture(withStairs, 'CHAIR', 2, 2), false, 'not on them');
  assert.equal(canPlaceFurniture(withStairs, 'CHAIR', 4, 3), true);
  assert.equal(canPlaceFurniture(withStairs, 'STAIRS_UP', 1, 1, 's1'), true, 'moving in place');
});

// ── Portals ──────────────────────────────────────────────────────

test('stairs placed downstairs get their other end on the floor above, same spot', () => {
  const layout = twoFloors();
  const placed = { ...layout, furniture: [stairs('s1', 1, 1)] };
  const linked = linkNewPortal(placed, 's1');
  assert.equal(linked.furniture.length, 2);
  const [a, b] = linked.furniture;
  assert.ok(a.link && a.link === b.link, 'both ends share a link');
  assert.deepEqual({ col: b.col, row: b.row }, { col: 8, row: 1 });
  const portals = layoutPortals(linked);
  assert.equal(stairsGoDown(portals, portals[0]), false, 'the ground-floor end goes up');
  assert.equal(stairsGoDown(portals, portals[1]), true, 'the upstairs end goes down');
  assert.equal(portalInfo(linked, 's1')!.target!.id, 'up1');

  // Reordering the floors turns up into down.
  const flipped = layoutPortals(moveLevel(linked, 'up1', 'down'));
  assert.equal(stairsGoDown(flipped, flipped[0]), true);

  // Deleting one end takes the other with it.
  assert.equal(removePortal(linked, 's1').furniture.length, 0);
});

test('stairs can be pointed at another floor: the other end moves there', () => {
  const three = addLevel(twoFloors(), 'above', 'up1', 'up2')!.layout;
  const linked = linkNewPortal({ ...three, furniture: [stairs('s1', 1, 1)] }, 's1');
  const moved = setStairsTarget(linked, 's1', 'up2');
  assert.equal(moved.furniture.length, 2);
  assert.equal(portalInfo(moved, 's1')!.target!.id, 'up2');
});

test('an elevator gets a door on every floor; stops can be switched off', () => {
  const three = addLevel(twoFloors(), 'above', 'up1', 'up2')!.layout;
  const door: PlacedFurniture = { uid: 'e1', type: 'ELEVATOR_CLOSED', col: 4, row: -1 };
  const linked = linkNewPortal({ ...three, furniture: [door] }, 'e1');
  assert.equal(linked.furniture.length, 3);
  assert.deepEqual(portalInfo(linked, 'e1')!.stops.sort(), ['main', 'up1', 'up2']);
  const fewer = setElevatorStop(linked, 'e1', 'up1', false);
  assert.deepEqual(portalInfo(fewer, 'e1')!.stops.sort(), ['main', 'up2']);
  // Deleting a door takes away that stop only.
  const other = fewer.furniture.find((f) => f.uid !== 'e1')!;
  assert.equal(removePortal(fewer, other.uid).furniture.length, 1);
});

test('paths go up the stairs: the step through them says so; pets stay downstairs', () => {
  const layout = linkNewPortal({ ...twoFloors(), furniture: [stairs('s1', 1, 1)] }, 's1');
  const tileMap = layoutToTileMap(layout);
  const blocked = new Set<string>(['1,1', '2,1', '1,2', '2,2', '8,1', '9,1', '8,2', '9,2']);
  setPortalEdges(tileMap, portalLinks(layoutPortals(layout)));
  const path = findPath(4, 4, 11, 4, tileMap, blocked);
  assert.ok(path.length > 0, 'there is a way upstairs');
  const ride = path.find((s) => s.portal);
  assert.ok(ride, 'one step is through the stairs');
  assert.equal(ride.portal!.kind, 'stairs');
  assert.ok(ride.portal!.rise > 0, 'going up');
  assert.equal(levelAt(getLevels(layout), ride.col, ride.row)!.id, 'up1');
  assert.deepEqual(findPath(4, 4, 11, 4, tileMap, blocked, false), [], 'no portals, no way');
});

// ── Riding ───────────────────────────────────────────────────────

/** An office on two floors with stairs between them and a chair upstairs. */
function building(): OfficeState {
  const layout = linkNewPortal(
    {
      ...twoFloors(),
      furniture: [stairs('s1', 1, 1), { uid: 'up-chair', type: 'CHAIR', col: 11, row: 3 }],
    },
    's1',
  );
  return new OfficeState(layout);
}

function tick(os: OfficeState, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.05) os.update(0.05);
}

test('an agent whose desk is upstairs takes the stairs and sits down there', () => {
  const os = building();
  assert.equal(os.getViewLevel().id, 'main', 'the ground floor is on screen');
  os.addAgent(1, 0, 0, undefined, true);
  const ch = os.characters.get(1)!;
  assert.equal(ch.seatId, 'up-chair', 'the only seat is upstairs');
  // Put it downstairs, working: it must walk to its desk.
  Object.assign(ch, { tileCol: 4, tileRow: 4, x: 4 * 16 + 8, y: 4 * 16 + 8 });
  ch.state = CharacterState.IDLE;
  let rode = false;
  let label = false;
  const seated = () => (ch.state as CharacterState) === CharacterState.TYPE;
  for (let t = 0; t < 20 && !seated(); t += 0.05) {
    os.update(0.05);
    if (ch.transit) {
      rode = true;
      if (os.getViewLevel().id === os.levelOf(ch)?.id && os.getTransitLabels().length > 0) {
        label = os.getTransitLabels()[0].up;
      }
    }
  }
  assert.equal(rode, true, 'it rode the stairs');
  assert.equal(label, true, 'the label said up');
  assert.equal(ch.state, CharacterState.TYPE);
  assert.deepEqual({ col: ch.tileCol, row: ch.tileRow }, { col: 11, row: 3 });
  assert.equal(os.levelOf(ch)!.id, 'up1');
  assert.equal(os.isOnView(ch), false, 'upstairs is not on screen');
});

test('the person walks into the stairs, comes out upstairs, and the view goes with them', () => {
  const os = building();
  os.ensureAvatar();
  tick(os, 1);
  const me = os.characters.get(AVATAR_LOCAL_ID)!;
  // Stand in front of the stairs (their access tile) and push up into them.
  Object.assign(me, { tileCol: 1, tileRow: 3, x: 1 * 16 + 8, y: 3 * 16 + 8, path: [] });
  me.state = CharacterState.IDLE;
  os.avatarHeldDir = Direction.UP;
  tick(os, 0.3);
  assert.ok(me.transit, 'riding');
  assert.equal(me.transit!.hop.rise > 0, true);
  const look = transitLook(me)!;
  assert.ok(look.dy <= 0 && look.alpha <= 1, 'climbing');
  tick(os, 2);
  assert.equal(me.transit, null);
  assert.equal(os.levelOf(me)!.id, 'up1', 'upstairs');
  assert.deepEqual({ col: me.tileCol, row: me.tileRow }, { col: 8, row: 3 });
  assert.equal(os.getViewLevel().id, 'up1', 'the view followed');
  // Still holding the key: no riding straight back down.
  tick(os, 1);
  assert.equal(os.levelOf(me)!.id, 'up1');
  // Let go, push again: back down.
  os.avatarHeldDir = null;
  tick(os, 0.1);
  os.avatarHeldDir = Direction.UP;
  tick(os, 0.3);
  const back = me.transit as Transit | null | undefined;
  assert.ok(back && back.hop.rise < 0, 'going down now');
  assert.ok(back.t < 0.5, 'still leaving the upper floor');
  assert.notEqual(
    transitLook(me)!.clipDy,
    null,
    'going down a stairwell hides what is below its edge',
  );
  tick(os, 0.35);
  assert.equal(transitLook(me)!.clipDy, null, 'downstairs it steps down the flight, in full');
  tick(os, 1);
  assert.equal(os.levelOf(me)!.id, 'main');
  assert.equal(os.getViewLevel().id, 'main');
});

test('an elevator with several stops asks where to', () => {
  const three = addLevel(twoFloors(), 'above', 'up1', 'up2')!.layout;
  const layout = linkNewPortal(
    { ...three, furniture: [{ uid: 'e1', type: 'ELEVATOR_CLOSED', col: 3, row: -1 }] },
    'e1',
  );
  const os = new OfficeState(layout);
  os.ensureAvatar();
  tick(os, 1);
  const me = os.characters.get(AVATAR_LOCAL_ID)!;
  Object.assign(me, { tileCol: 3, tileRow: 1, x: 3 * 16 + 8, y: 1 * 16 + 8, path: [] });
  me.state = CharacterState.IDLE;
  os.avatarHeldDir = Direction.UP;
  tick(os, 0.2);
  const prompt = os.elevatorPrompt;
  assert.ok(prompt, 'asked');
  assert.deepEqual(
    prompt.stops.map((s) => [s.levelId, s.uid !== null]),
    [
      ['up2', true],
      ['up1', true],
      ['main', false],
    ],
    'top floor first; the one you are on is not a choice',
  );
  os.avatarHeldDir = null;
  assert.equal(os.rideElevator(prompt.stops[0].uid!), true);
  tick(os, 0.3);
  assert.ok(me.transit?.hop.kind === 'elevator');
  tick(os, 4);
  assert.equal(os.levelOf(me)!.id, 'up2');
  assert.equal(me.tileCol * TILE_SIZE + TILE_SIZE / 2, me.x);
});

test('one-level offices are untouched: everything is on screen', () => {
  const os = new OfficeState(oneFloor());
  assert.equal(os.isMultiLevel(), false);
  assert.deepEqual(os.getView(), { col: 0, row: 0, cols: 6, rows: 5 });
  os.addAgent(1, 0, 0, undefined, true);
  assert.equal(os.isOnView(os.characters.get(1)!), true);
});
