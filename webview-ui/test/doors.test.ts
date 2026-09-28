/**
 * Doors: they sit in a wall (the wall tile under them becomes their doorway),
 * never block walking, and open by themselves while someone goes through.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeAll, test } from 'vitest';

import { FALLBACK_FLOOR_COLOR } from '../src/constants.js';
import {
  canPlaceFurniture,
  getWallPlacementRow,
  openDoorway,
} from '../src/office/editor/editorActions.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { doorFrameType, doorTypeFor } from '../src/office/layout/doors.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { getBlockedTiles } from '../src/office/layout/layoutSerializer.js';
import type { OfficeLayout, TileType as TileTypeVal } from '../src/office/types.js';
import { CharacterState, TileType } from '../src/office/types.js';

const W = TileType.WALL as TileTypeVal;
const F = TileType.FLOOR_2 as TileTypeVal;

beforeAll(() => {
  const sprite = Array.from({ length: 32 }, () =>
    Array.from({ length: 16 }, () => FALLBACK_FLOOR_COLOR),
  );
  const door = (id: string, orientation: string, state: string) => ({
    id,
    label: 'Door',
    category: 'wall',
    width: 16,
    height: 32,
    footprintW: 1,
    footprintH: 2,
    isDesk: false,
    groupId: 'DOOR',
    orientation,
    state,
    backgroundTiles: 1,
    rotationScheme: '2-way',
  });
  const ids = [
    ['DOOR_FRONT', 'front', 'off'],
    ['DOOR_FRONT_HALF', 'front', 'on'],
    ['DOOR_FRONT_OPEN', 'front', 'on'],
    ['DOOR_SIDE', 'side', 'off'],
    ['DOOR_SIDE_HALF', 'side', 'on'],
    ['DOOR_SIDE_OPEN', 'side', 'on'],
  ];
  buildDynamicCatalog({
    catalog: ids.map(([id, o, st]) => door(id, o, st)),
    sprites: Object.fromEntries(ids.map(([id]) => [id, sprite])),
  });
});

/** 5×7 floor with a wall across row 3 (left-right). */
function splitAcross(): OfficeLayout {
  const cols = 5;
  const rows = 7;
  const tiles: TileTypeVal[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push(r === 3 ? W : F);
  return {
    version: 1,
    cols,
    rows,
    tiles,
    tileColors: tiles.map((t) => (t === F ? { h: 120, s: 20, b: 0, c: 0 } : null)),
    furniture: [],
  };
}

/** 7×5 floor with a wall down column 3 (up-down). */
function splitDown(): OfficeLayout {
  const cols = 7;
  const rows = 5;
  const tiles: TileTypeVal[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) tiles.push(c === 3 ? W : F);
  return { version: 1, cols, rows, tiles, tileColors: tiles.map(() => null), furniture: [] };
}

test('a door turns to fit the wall: front in a left-right wall, side in an up-down one', () => {
  assert.equal(doorTypeFor(splitAcross(), 'DOOR_FRONT', 2, 3), 'DOOR_FRONT');
  assert.equal(doorTypeFor(splitDown(), 'DOOR_FRONT', 3, 2), 'DOOR_SIDE');
  assert.equal(doorTypeFor(splitDown(), 'CHAIR', 3, 2), 'CHAIR', 'other furniture is left alone');
  assert.equal(doorFrameType('DOOR_SIDE', 2), 'DOOR_SIDE_OPEN');
  assert.equal(doorFrameType('DOOR_FRONT_OPEN', 0), 'DOOR_FRONT');
});

test('a door goes between two wall tiles; its wall tile becomes floor like the way through', () => {
  const layout = splitAcross();
  const row = getWallPlacementRow('DOOR_FRONT', 3);
  assert.equal(row, 2, 'the lintel hangs over the doorway');
  assert.equal(canPlaceFurniture(layout, 'DOOR_FRONT', 2, row), true);
  assert.equal(canPlaceFurniture(layout, 'DOOR_FRONT', 0, row), false, 'no wall to its left');
  assert.equal(canPlaceFurniture(layout, 'DOOR_SIDE', 2, row), false, 'wrong way round');
  assert.equal(canPlaceFurniture(layout, 'DOOR_FRONT', 2, 3), false, 'not in open floor');
  const opened = openDoorway(layout, 'DOOR_FRONT', 2, row);
  assert.equal(opened.tiles[3 * 5 + 2], F);
  assert.deepEqual(opened.tileColors![3 * 5 + 2], { h: 120, s: 20, b: 0, c: 0 });
  assert.equal(canPlaceFurniture(opened, 'DOOR_FRONT', 2, row), true, 'a doorway already open');
  // A doorway never blocks walking.
  const withDoor = { ...opened, furniture: [{ uid: 'd', type: 'DOOR_FRONT', col: 2, row }] };
  assert.equal(getBlockedTiles(withDoor.furniture).has('2,3'), false);
});

test('the door opens while someone walks through, and closes after', () => {
  const layout = openDoorway(splitAcross(), 'DOOR_FRONT', 2, 2);
  layout.furniture = [{ uid: 'door', type: 'DOOR_FRONT', col: 2, row: 2 }];
  const os = new OfficeState(layout);
  os.addAgent(1, 0, 0, undefined, true);
  const ch = os.characters.get(1)!;
  Object.assign(ch, { tileCol: 2, tileRow: 0, x: 2 * 16 + 8, y: 8, isActive: false });
  ch.state = CharacterState.IDLE;
  assert.equal(os.walkToTile(1, 2, 6), true, 'the way through the wall is the door');
  let widest = 0;
  for (let t = 0; t < 4; t += 0.05) {
    os.update(0.05);
    widest = Math.max(widest, os.doorOpenness('door'));
    if (ch.tileRow === 6 && ch.path.length === 0) break;
  }
  assert.equal(ch.tileRow, 6, 'got through');
  assert.equal(widest, 1, 'it opened all the way');
  for (let t = 0; t < 2; t += 0.05) os.update(0.05);
  assert.equal(os.doorOpenness('door'), 0, 'and closed behind them');
});
