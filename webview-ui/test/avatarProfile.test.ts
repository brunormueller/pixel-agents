/**
 * Multiplayer profile, webview half: the customized character sprite
 * (recolored hair and clothes, an accessory that follows the head), desk
 * decoration placed from the desk's chair, following someone around the
 * shared map, the seasonal decoration calendar and the meeting toast rule.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { CalendarEvent, RemotePeer } from '../../core/src/messages.js';
import { AVATAR_LOCAL_ID, HAIR_SWATCHES, MEETING_SOON_MS } from '../src/constants.js';
import { rgbToHsl } from '../src/office/colorize.js';
import { DECOR_ITEMS, decorItem, isAvailable } from '../src/office/engine/decorCatalog.js';
import { meetingProvider, meetingToAnnounce } from '../src/office/engine/meetings.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { RemoteAgentRegistry } from '../src/office/engine/remoteAgents.js';
import { buildDynamicCatalog, getCatalogEntry } from '../src/office/layout/furnitureCatalog.js';
import parts from '../src/office/sprites/avatar-parts.json';
import type { CharacterSheet } from '../src/office/sprites/avatarLook.js';
import {
  applyLook,
  DEFAULT_LOOK,
  EYE_COLOR,
  isOnePiece,
} from '../src/office/sprites/avatarLook.js';
import type { OfficeLayout, SpriteData } from '../src/office/types.js';
import { Direction, TILE_SIZE, TileType } from '../src/office/types.js';

// ── Avatar look ──────────────────────────────────────────────

/** Body 1's sheet colors (see avatar-parts.json): hair, dress; plus a color no part owns (skin), and the eyes. */
const HAIR = parts.roles[1].hair[0];
const DRESS = parts.roles[1].top[1];
const SKIN = parts.palette.g;
const EYE = EYE_COLOR;

/** A 16x32 frame: hair rows 2-11, eyes on row 13, skin face, dress below — `shift` rows lower. */
function frame(shift: number): SpriteData {
  return Array.from({ length: 32 }, (_, y) =>
    Array.from({ length: 16 }, (_, x) => {
      const r = y - shift;
      if (x < 2 || x > 13) return '';
      if (r >= 2 && r <= 11) return HAIR;
      if (r === 13 && (x === 5 || x === 10)) return EYE;
      if (r >= 12 && r <= 16) return SKIN;
      if (r >= 17 && r <= 27) return DRESS;
      return '';
    }),
  );
}

function sheet(): CharacterSheet {
  // Frames 3-6 sit lower (typing/reading), like the real sheets.
  const frames = [0, 1, 0, 5, 5, 5, 6].map(frame);
  return { down: frames, up: frames.map((f) => f.map((r) => [...r])), right: frames };
}

const hueOf = (hex: string) =>
  rgbToHsl(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  )[0];

test('a look recolors hair and clothes, and leaves skin and eyes alone', () => {
  const blonde = HAIR_SWATCHES.findIndex((s) => s.label === 'Blonde');
  const out = applyLook(sheet(), { ...DEFAULT_LOOK, body: 1, hair: blonde, top: 0 });
  const f = out.down[0];
  assert.notEqual(f[5][6], HAIR, 'hair recolored');
  assert.ok(
    Math.abs(hueOf(f[5][6]) - hueOf(HAIR_SWATCHES[blonde].color)) < 12,
    'toward the swatch hue',
  );
  assert.notEqual(f[20][6], DRESS, 'dress recolored');
  assert.equal(f[14][6], SKIN, 'skin untouched');
  assert.equal(f[13][5], EYE, 'eyes untouched');
});

test('-1 swatches keep the sprite exactly as drawn', () => {
  const base = sheet();
  const out = applyLook(base, { ...DEFAULT_LOOK, body: 1 });
  assert.deepEqual(out.down, base.down);
});

test('an accessory is drawn on the head and follows it into the sitting frames', () => {
  const out = applyLook(sheet(), { ...DEFAULT_LOOK, body: 1, accessory: 'sunglasses' });
  // Sunglasses sit on the eye row (13) in the walking frame...
  const walk = out.down[0];
  assert.notEqual(walk[13][5], EYE, 'lens over the eye');
  // ...and 5 rows lower where the head is 5 rows lower.
  const typing = out.down[3];
  assert.notEqual(typing[18][5], EYE);
  assert.equal(out.up[0][13][5], EYE, 'no sunglasses seen from behind');
});

test('a hat hides the hair poking out above it', () => {
  const tall = sheet();
  // Spiky hair on row 0, above where the cap starts (row 1).
  tall.down[0][0][7] = HAIR;
  const out = applyLook(tall, { ...DEFAULT_LOOK, body: 1, accessory: 'cap' });
  assert.equal(out.down[0][0][7], '', 'hair above the cap cleared');
  assert.notEqual(out.down[0][2][7], HAIR, 'cap drawn over the hair');
});

test('suits and dresses are one piece; other bodies have separate bottoms', () => {
  assert.equal(isOnePiece(0), true);
  assert.equal(isOnePiece(1), true);
  assert.equal(isOnePiece(2), false);
});

// ── Office: catalog, desk, decoration, following ─────────────

const { K, W, k, D } = parts.palette;

/** A w x h sprite, opaque (in `color`) only inside the given box. */
function sprite(
  w: number,
  h: number,
  box: [number, number, number, number],
  color = HAIR,
): SpriteData {
  const [x0, y0, x1, y1] = box;
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? color : '')),
  );
}

/** A 2-tile desk: outline, a flat top (rows 1-10, x 1-30), a front edge, legs. */
function deskSprite(): SpriteData {
  return Array.from({ length: 16 }, (_, y) =>
    Array.from({ length: 32 }, (_, x) => {
      if (y === 0) return K;
      if (y <= 10) return x === 0 || x === 31 ? K : W;
      if (y === 11) return k;
      return x === 1 || x === 2 || x === 29 || x === 30 ? D : '';
    }),
  );
}

/** A tiny catalog: a desk, a chair, a desk plant, a monitor that turns, a floor pot, a wall clock. */
function loadCatalog(): void {
  const entry = (id: string, category: string, extra: Record<string, unknown> = {}) => ({
    id,
    label: id,
    category,
    width: 16,
    height: 16,
    footprintW: 1,
    footprintH: 1,
    isDesk: category === 'desks',
    ...extra,
  });
  const monitor = (orientation: string, extra: Record<string, unknown> = {}) =>
    entry(`MONITOR_${orientation.toUpperCase()}`, 'decor', {
      canPlaceOnSurfaces: true,
      groupId: 'MONITOR',
      orientation,
      rotationScheme: '3-way-mirror',
      ...extra,
    });
  const monitorSprite = sprite(16, 16, [3, 0, 12, 9]);
  buildDynamicCatalog({
    catalog: [
      entry('TEST_DESK', 'desks', { footprintW: 2, width: 32 }),
      entry('TEST_CHAIR', 'chairs'),
      entry('SUCCULENT', 'decor', { canPlaceOnSurfaces: true }),
      monitor('front'),
      monitor('back'),
      monitor('side', { mirrorSide: true }),
      entry('POT', 'decor'),
      entry('CLOCK', 'wall', { canPlaceOnWalls: true }),
      // The curved desk style in this desk's size, and the one-tile office chair seen from behind.
      entry('CURVED_DESK_2', 'desks', { footprintW: 2, width: 32 }),
      entry('OFFICE_CHAIR_SMALL_BACK', 'chairs', { orientation: 'back' }),
    ],
    sprites: {
      TEST_DESK: deskSprite(),
      TEST_CHAIR: sprite(16, 16, [0, 0, 15, 15]),
      SUCCULENT: sprite(16, 16, [5, 0, 10, 3]),
      MONITOR_FRONT: monitorSprite,
      MONITOR_BACK: monitorSprite,
      MONITOR_SIDE: sprite(16, 16, [6, 0, 9, 9]),
      POT: sprite(16, 16, [4, 4, 11, 15]),
      CLOCK: sprite(16, 16, [4, 4, 11, 11]),
      CURVED_DESK_2: deskSprite().map((row) => row.map((px) => (px === W ? k : px))),
      OFFICE_CHAIR_SMALL_BACK: sprite(16, 16, [2, 2, 13, 15], D),
    },
  });
}

/** 8x6 room: wall row on top, a desk at (3..4, 1); chairs below it (3,2), left (2,1) and right (5,1). */
function office(): OfficeState {
  loadCatalog();
  const cols = 8;
  const rows = 6;
  const tiles: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.push(r === 0 ? TileType.WALL : TileType.FLOOR_1);
  }
  const layout: OfficeLayout = {
    version: 1,
    cols,
    rows,
    tiles: tiles as OfficeLayout['tiles'],
    furniture: [
      { uid: 'desk', type: 'TEST_DESK', col: 3, row: 1 },
      { uid: 'chair', type: 'TEST_CHAIR', col: 3, row: 2 },
      { uid: 'chairL', type: 'TEST_CHAIR', col: 2, row: 1 },
      { uid: 'chairR', type: 'TEST_CHAIR', col: 5, row: 1 },
    ],
  };
  return new OfficeState(layout);
}

/** The same room with things the room put on the desk: a plant on it, and one elsewhere. */
function officeWithDeskItems(): OfficeState {
  const os = office();
  const layout = os.getLayout();
  os.rebuildFromLayout({
    ...layout,
    furniture: [
      ...layout.furniture,
      { uid: 'roomPlant', type: 'SUCCULENT', col: 4, row: 1 },
      { uid: 'farPlant', type: 'SUCCULENT', col: 6, row: 4 },
    ],
  });
  return os;
}

/** 8x7 room: the desk at (3..4, 2), its chair BEHIND it at (3,1) — the person facing us. */
function officeChairBehind(): OfficeState {
  loadCatalog();
  const cols = 8;
  const rows = 7;
  const tiles: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.push(r === 0 ? TileType.WALL : TileType.FLOOR_1);
  }
  return new OfficeState({
    version: 1,
    cols,
    rows,
    tiles: tiles as OfficeLayout['tiles'],
    furniture: [
      { uid: 'desk', type: 'TEST_DESK', col: 3, row: 2 },
      { uid: 'chair', type: 'TEST_CHAIR', col: 3, row: 1 },
    ],
  });
}

const drawnSprites = (os: OfficeState) => os.furniture.map((f) => f.sprite);

function tick(os: OfficeState, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.05) os.update(0.05);
}

// The desk's tabletop in world px: x 49..78, y 17..26.

test('desk items go anywhere on the tabletop, to the pixel; the rest snap to floor or wall', () => {
  const os = office();
  os.ensureAvatar();
  assert.equal(os.setDesk('chair'), true);
  const p = os.decorPlacementAt('SUCCULENT', 60, 25)!;
  assert.equal(p.valid, true);
  // Relative to the chair's tile (3,2) = world (48,32): tile (0,-1), pixel (12,9).
  assert.deepEqual(p.item, { type: 'SUCCULENT', dc: 0, dr: -1, px: 12, py: 9 });
  // Its base's middle is the point: the 6x4 plant is drawn above and around it.
  assert.deepEqual([p.instance.x, p.instance.y], [52, 21]);
  assert.equal(os.decorPlacementAt('SUCCULENT', 60, 40)!.valid, false, 'not on the floor');
  assert.equal(os.decorPlacementAt('SUCCULENT', 50, 25)!.valid, false, 'not over the edge');
  assert.equal(os.decorPlacementAt('SUCCULENT', 60, 17)!.valid, false, 'not behind the back edge');
  assert.equal(os.decorPlacementAt('POT', 2 * 16 + 8, 2 * 16 + 8)!.valid, true, 'free floor');
  assert.equal(os.decorPlacementAt('POT', 3 * 16 + 8, 2 * 16 + 8)!.valid, false, 'not the chair');
  assert.equal(os.decorPlacementAt('POT', 3 * 16 + 8, 16 + 8)!.valid, false, 'not in the desk');
  assert.equal(os.decorPlacementAt('CLOCK', 3 * 16 + 8, 8)!.valid, true, 'on the wall');
  assert.deepEqual(os.decorSurfaces(), [{ x0: 49, y0: 17, x1: 78, y1: 26 }]);
});

test('several items share a tabletop, sorted front to back, and follow the desk', () => {
  const os = office();
  os.ensureAvatar();
  os.setDesk('chair');
  const before = os.furniture.length;
  const front = os.decorPlacementAt('SUCCULENT', 60, 25)!.item;
  const back = os.decorPlacementAt('SUCCULENT', 70, 22)!.item;
  os.setLocalDecor([front, back]);
  assert.equal(os.furniture.length, before + 2);
  const [a, b] = os.decorPieces();
  assert.ok(a.instance.zY > b.instance.zY, 'the one nearer the front edge draws over');
  assert.ok(a.instance.zY > 16 + 16, 'both in front of the desk');
  assert.equal(os.decorAt(58, 23), 0, 'the item under the pointer');
  assert.equal(os.decorAt(40, 40), null);
  // No desk, nothing to put them on.
  os.setDesk(null);
  assert.equal(os.decorPieces().length, 0);
  assert.equal(os.furniture.length, before);
});

test("another office's decoration shows on the desk it claimed; what doesn't fit is skipped", () => {
  const os = office();
  os.setRemoteDecor([
    {
      desk: 'chair',
      items: [
        { type: 'SUCCULENT', dc: 0, dr: -1, px: 12, py: 9 },
        { type: 'SUCCULENT', dc: 0, dr: 0, px: 8, py: 8 }, // on the floor
        { type: 'UNKNOWN_THING', dc: -1, dr: 0 },
      ],
    },
  ]);
  const pieces = os.decorPieces();
  assert.equal(pieces.length, 1);
  assert.deepEqual([pieces[0].instance.x, pieces[0].instance.y], [52, 21]);
});

test('a desk item turns to face the chair: front, side, mirrored side', () => {
  const os = office();
  os.ensureAvatar();
  os.setDesk('chair');
  assert.equal(os.decorVariantForDesk('MONITOR_FRONT'), 'MONITOR_FRONT');
  os.setDesk('chairL');
  assert.equal(os.decorVariantForDesk('MONITOR_FRONT'), 'MONITOR_SIDE');
  os.setDesk('chairR');
  const variant = os.decorVariantForDesk('MONITOR_FRONT');
  assert.equal(variant, 'MONITOR_SIDE:left');
  const p = os.decorPlacementAt(variant, 68, 26)!;
  assert.equal(p.valid, true);
  assert.equal(p.instance.mirrored, true);
  assert.equal(os.decorVariantForDesk('SUCCULENT'), 'SUCCULENT', 'no variants, no change');
});

test('the look and status apply to the person, and survive the character being re-created', () => {
  const os = office();
  const look = { ...DEFAULT_LOOK, body: 3, accessory: 'crown' as const };
  os.setLocalProfile({ look, status: 'busy', statusText: 'deep work' });
  os.ensureAvatar();
  const ch = os.characters.get(AVATAR_LOCAL_ID)!;
  assert.deepEqual(ch.look, look);
  assert.equal(ch.personStatus, 'busy');
  assert.equal(ch.statusText, 'deep work');
  os.removeAvatar();
  tick(os, 1);
  os.ensureAvatar();
  assert.deepEqual(os.characters.get(AVATAR_LOCAL_ID)!.look, look);
});

test('remote people carry their profile onto their character', () => {
  const os = office();
  const registry = new RemoteAgentRegistry();
  const peers: RemotePeer[] = [
    {
      peerId: 'p1',
      name: 'Ana',
      desk: null,
      since: 1,
      agents: [
        {
          id: 0,
          palette: 2,
          hueShift: 0,
          status: 'waiting',
          activity: null,
          permission: false,
          awaitingInput: false,
          isAvatar: true,
          pose: { x: 24, y: 40, dir: 0, state: 'idle' },
        },
      ],
      profile: {
        look: { body: 2, hair: 1, top: 3, bottom: 4, accessory: 'beanie' },
        status: 'meeting',
        statusText: 'Standup',
        music: { title: 'Song', artist: 'Band' },
      },
    },
  ];
  registry.reconcile(os, peers, true, 6, { reading: null, typing: 'remote:typing' });
  const [c] = registry.characters();
  const ch = os.characters.get(c.id)!;
  assert.equal(ch.look?.accessory, 'beanie');
  assert.equal(ch.personStatus, 'meeting');
  assert.equal(ch.music?.title, 'Song');
  assert.equal(ch.remotePeerId, 'p1');
});

test('following walks the person next to someone; the keyboard takes over', () => {
  const os = office();
  os.ensureAvatar();
  tick(os, 1);
  const me = os.characters.get(AVATAR_LOCAL_ID)!;
  // Someone standing at the far corner.
  os.addAgent(-1_000_001, 0, 0, undefined, true);
  const other = os.characters.get(-1_000_001)!;
  other.isRemote = true;
  other.seatId = null;
  other.x = 7 * TILE_SIZE + TILE_SIZE / 2;
  other.y = 5 * TILE_SIZE + TILE_SIZE / 2;
  other.tileCol = 7;
  other.tileRow = 5;
  other.remoteTarget = { x: other.x, y: other.y, dir: Direction.DOWN, state: 'idle' };

  assert.equal(os.followCharacter(-1_000_001, true), true);
  tick(os, 8);
  const d = Math.abs(me.tileCol - 7) + Math.abs(me.tileRow - 5);
  assert.ok(d <= 1, `ended next to them (distance ${d})`);
  assert.equal(os.avatarFollowId, null, '"Go to" stops once there');

  os.followCharacter(-1_000_001);
  os.avatarHeldDir = Direction.UP;
  tick(os, 0.2);
  assert.equal(os.avatarFollowId, null, 'an arrow key ends following');
  os.avatarHeldDir = null;
  assert.equal(os.followCharacter(AVATAR_LOCAL_ID), false, 'not yourself');
});

test('a desk style draws your desk and chair in it; unknown styles and other desks are left alone', () => {
  const os = office();
  os.ensureAvatar();
  os.setDesk('chair');
  const curved = getCatalogEntry('CURVED_DESK_2')!.sprite;
  const officeChair = getCatalogEntry('OFFICE_CHAIR_SMALL_BACK')!.sprite;
  assert.ok(!drawnSprites(os).includes(curved));
  os.setLocalDressing({ deskStyle: 'CURVED_DESK' });
  assert.ok(drawnSprites(os).includes(curved), 'the desk in the style, in its size');
  assert.ok(drawnSprites(os).includes(officeChair), 'the chair too, seen from behind');
  os.setLocalDressing({ deskStyle: 'NOT_A_STYLE' });
  assert.ok(!drawnSprites(os).includes(curved));
});

test('a styled desk turns to face the room: the chair goes to its front, you sit with your back to us', () => {
  const os = officeChairBehind();
  os.ensureAvatar();
  os.setDesk('chair');
  tick(os, 3);
  const me = os.characters.get(AVATAR_LOCAL_ID)!;
  assert.deepEqual([me.tileCol, me.tileRow], [3, 1], 'seated behind the desk');
  // Behind the desk, a screen facing you shows its back to the room.
  assert.equal(os.decorVariantForDesk('MONITOR_FRONT'), 'MONITOR_BACK');
  const monitor = os.decorPlacementAt('MONITOR_BACK', 60, 36)!;
  const pot = os.decorPlacementAt('POT', 1 * 16 + 8, 1 * 16 + 8)!;
  assert.equal(monitor.valid, true);
  assert.equal(pot.valid, true);
  os.setLocalDecor([monitor.item, pot.item]);

  os.setLocalDressing({ deskStyle: 'CURVED_DESK' });
  const seat = os.seats.get('chair')!;
  assert.deepEqual([seat.seatCol, seat.seatRow, seat.facingDir], [3, 3, Direction.UP]);
  const officeChair = getCatalogEntry('OFFICE_CHAIR_SMALL_BACK')!.sprite;
  const chair = os.furniture.find((f) => f.sprite === officeChair)!;
  assert.deepEqual([chair.x, chair.y], [3 * 16, 3 * 16], 'the office chair in front of the desk');
  assert.equal(os.blockedTiles.has('3,1'), false, 'the tile it left is free');
  assert.equal(os.blockedTiles.has('3,3'), true);
  assert.equal(os.decorVariantForDesk('MONITOR_FRONT'), 'MONITOR_FRONT', 'screens face the room');
  // What was on it went round with the desk: kept as it was, drawn half-turned.
  assert.deepEqual(os.getLocalDecor(), [monitor.item, pot.item]);
  assert.equal(os.drawnDecorType(monitor.item), 'MONITOR_FRONT');
  const [screen, plant] = os.decorPieces();
  assert.deepEqual(
    [screen.instance.x, screen.instance.y],
    [60, 34],
    'other side of the (curved) tabletop',
  );
  assert.deepEqual(
    [plant.instance.x, plant.instance.y],
    [5 * 16, 3 * 16],
    'still beside the chair',
  );
  // Placing on the turned desk keeps items the unturned way round.
  assert.deepEqual(os.decorPlacementAt('MONITOR_FRONT', 68, 44)!.item, monitor.item);
  tick(os, 5);
  assert.deepEqual([me.tileCol, me.tileRow, me.dir], [3, 3, Direction.UP], 'walked round to it');

  // As built again: the chair back behind the desk, everything where it was.
  os.setLocalDressing({ deskStyle: null });
  assert.deepEqual([seat.seatCol, seat.seatRow, seat.facingDir], [3, 1, Direction.DOWN]);
  const [screen2] = os.decorPieces();
  assert.deepEqual(
    [screen2.instance.x, screen2.instance.y],
    [monitor.instance.x, monitor.instance.y],
  );
  tick(os, 5);
  assert.deepEqual([me.tileCol, me.tileRow], [3, 1]);
});

test("a desk turns only onto free floor, other offices' desks too, and never while editing", () => {
  const os = officeChairBehind();
  const layout = os.getLayout();
  // Something in front of the desk: the chair stays behind it.
  os.rebuildFromLayout({
    ...layout,
    furniture: [...layout.furniture, { uid: 'pot', type: 'POT', col: 3, row: 3 }],
  });
  os.setRemoteDecor([{ desk: 'chair', items: [], deskStyle: 'CURVED_DESK' }]);
  assert.deepEqual([os.seats.get('chair')!.seatCol, os.seats.get('chair')!.seatRow], [3, 1]);
  // Free floor: another office's styled desk turns here too.
  os.rebuildFromLayout(layout);
  assert.equal(os.seats.get('chair')!.seatRow, 3);
  os.setTurnsPaused(true);
  assert.equal(os.seats.get('chair')!.seatRow, 1, 'the editor edits the chair where it was built');
  os.setTurnsPaused(false);
  assert.equal(os.seats.get('chair')!.seatRow, 3);
});

test('items that came with the desk can be taken off — only from your own desk', () => {
  const os = officeWithDeskItems();
  os.ensureAvatar();
  os.setDesk('chair');
  const before = os.furniture.length;
  // The room's plant on the desk: 16x16 at (64,16), visible x 69..74, y 16..19.
  assert.equal(os.deskLayoutItemAt(71, 18)?.uid, 'roomPlant');
  assert.equal(os.deskLayoutItemAt(6 * 16 + 8, 4 * 16 + 2), null, 'not on your desk');
  os.setLocalDressing({ hidden: ['roomPlant', 'farPlant'] });
  assert.equal(os.furniture.length, before - 1, 'only the one on your desk goes');
  assert.equal(os.deskLayoutItemAt(71, 18), null);
  // Another office can do the same to its own desk.
  const other = officeWithDeskItems();
  other.setRemoteDecor([{ desk: 'chair', items: [], hidden: ['roomPlant', 'farPlant'] }]);
  assert.equal(other.furniture.length, before - 1);
});

test('a desk preset: style, the desk cleared, the setup placed on it and a plant beside it', () => {
  const os = officeWithDeskItems();
  os.ensureAvatar();
  os.setDesk('chair');
  const result = os.applyDeskPreset({
    id: 't',
    label: 't',
    description: '',
    deskStyle: 'CURVED_DESK',
    items: [
      { type: 'MONITOR_FRONT', fx: 0.3, fy: 0.5 },
      { type: 'SUCCULENT', fx: 0.8, fy: 0.9 },
    ],
    floor: ['POT'],
  })!;
  assert.equal(result.deskStyle, 'CURVED_DESK');
  assert.deepEqual(result.hidden, ['roomPlant']);
  assert.deepEqual(
    result.decor.map((d) => d.type),
    ['MONITOR_FRONT', 'SUCCULENT', 'POT'],
  );
  assert.equal(os.decorPieces().length, 3, 'everything placed fits');
  const pot = os.decorPieces().find((p) => p.item.type === 'POT')!;
  assert.ok(pot.instance.x < 3 * 16, 'the plant stands on the left of the desk');
});

// ── Seasonal catalog, meetings ───────────────────────────────

test('seasonal items are offered only around their date; the rest always', () => {
  const pumpkin = decorItem('PUMPKIN')!;
  assert.equal(isAvailable(pumpkin, new Date(2026, 9, 15)), true);
  assert.equal(isAvailable(pumpkin, new Date(2026, 8, 24)), false);
  const tree = decorItem('XMAS_TREE')!;
  assert.equal(isAvailable(tree, new Date(2027, 0, 3)), true, 'window wraps the new year');
  assert.equal(isAvailable(tree, new Date(2027, 0, 10)), false);
  assert.equal(isAvailable(decorItem('TROPHY')!, new Date(2026, 3, 1)), true);
  assert.ok(
    DECOR_ITEMS.some((i) => i.season && isAvailable(i, new Date(2026, 8, 24))),
    'something in season now',
  );
});

test('the meeting toast announces a call starting soon, once per event', () => {
  const now = Date.UTC(2026, 8, 24, 12, 0);
  const ev = (id: string, startIn: number, joinUrl?: string): CalendarEvent => ({
    id,
    title: id,
    start: now + startIn,
    end: now + startIn + 30 * 60_000,
    allDay: false,
    ...(joinUrl ? { joinUrl } : {}),
  });
  const events = [
    ev('no-link', 60_000),
    ev('later', MEETING_SOON_MS + 60_000, 'https://meet.google.com/abc-defg-hij'),
    ev('soon', 2 * 60_000, 'https://teams.microsoft.com/l/meetup-join/x'),
  ];
  assert.equal(meetingToAnnounce(events, now, new Set())?.id, 'soon');
  assert.equal(meetingToAnnounce(events, now, new Set(['soon'])), null);
  assert.equal(meetingProvider('https://teams.microsoft.com/l/meetup-join/x'), 'Teams');
  assert.equal(meetingProvider('https://us02web.zoom.us/j/123'), 'Zoom');
});
