/**
 * Pixel Frag (the first-person game): maps, movement, shots, bots, rounds, and
 * a match between two offices over a fake relay.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { beforeAll, describe, test } from 'vitest';

import type { GameFrameBody } from '../../core/src/messages.js';
import { FALLBACK_FLOOR_COLOR, FPS_MAX_HP, FPS_PLAYER_RADIUS } from '../src/constants.js';
import {
  builtinMap,
  MAP_CHOICES,
  officeMap,
  openCellCount,
  seededRng,
} from '../src/games/fps/maps.js';
import type { FpsNet } from '../src/games/fps/session.js';
import { FpsSession } from '../src/games/fps/session.js';
import {
  angleDiff,
  compileWorld,
  findPath,
  fireWeapon,
  hasLineOfSight,
  moveCircle,
  rayToWall,
  traceShot,
} from '../src/games/fps/sim.js';
import type { Actor, FpsConfig, FpsInput } from '../src/games/fps/types.js';
import { Cell, NO_INPUT } from '../src/games/fps/types.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import type { OfficeLayout, TileType as TileTypeVal } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

/** A little map: `#` wall, `.` floor, `x` a crate. */
function tinyMap(rows: string[]) {
  const cells = rows
    .join('')
    .split('')
    .map((ch) => (ch === '#' ? 'A' : ch === 'x' ? '0' : 'a'))
    .join('');
  return compileWorld({
    name: 'Tiny',
    cols: rows[0].length,
    rows: rows.length,
    cells,
    walls: [{ tex: 'stone' }],
    floors: [{ tex: 'concrete' }],
    blocks: [{ h: 0.4, top: 0x886644, side: 0x664422 }],
    props: [],
    solid: [],
    spawns: [{ x: 1.5, y: 1.5 }],
    items: [],
    ceiling: 0x333333,
    fog: 0x000000,
  });
}

function actor(id: string, x: number, y: number, a = 0): Actor {
  return {
    id,
    name: id,
    bot: false,
    x,
    y,
    a,
    hp: FPS_MAX_HP,
    alive: true,
    weapon: 0,
    shells: 8,
    bullets: 50,
    cooldown: 0,
    shot: 0,
    moving: false,
    respawnIn: 0,
    guard: 0,
    palette: 0,
    hueShift: 0,
    look: null,
    walkPhase: 0,
    flash: 0,
  };
}

const ROOM = ['#########', '#.......#', '#.......#', '#...x...#', '#.......#', '#########'];

describe('maps', () => {
  test('every built-in map is closed, and all of its floor is one reachable area', () => {
    for (const choice of MAP_CHOICES.filter((m) => m.id !== 'office')) {
      const data = builtinMap(choice.id);
      assert.ok(data, choice.id);
      assert.equal(data.cells.length, data.cols * data.rows);
      const world = compileWorld(data);
      assert.ok(data.spawns.length >= 4, `${choice.id} has spawns`);
      let open = 0;
      let reached = 0;
      for (let i = 0; i < world.kind.length; i++) {
        if (world.solid[i]) continue;
        open++;
        if (world.reachable[i]) reached++;
      }
      assert.equal(reached, open, `${choice.id}: no shut-off floor`);
      assert.equal(open, openCellCount(data));
      for (const it of data.items) {
        assert.equal(
          world.reachable[Math.floor(it.y) * data.cols + Math.floor(it.x)],
          1,
          `${choice.id} item`,
        );
      }
    }
  });

  test('built-in maps are the same on every office (seeded)', () => {
    assert.deepEqual(builtinMap('maze'), builtinMap('maze'));
    assert.deepEqual(builtinMap('warehouse'), builtinMap('warehouse'));
    const a = seededRng(3);
    const b = seededRng(3);
    assert.equal(a(), b());
  });

  test('the border of a compiled map is always wall', () => {
    const w = compileWorld({ ...builtinMap('arena')!, cells: 'a'.repeat(26 * 20) });
    assert.equal(w.kind[0], Cell.WALL);
    assert.equal(w.kind[26 * 20 - 1], Cell.WALL);
    assert.equal(w.kind[27], Cell.FLOOR);
  });
});

describe('movement and shots', () => {
  test('walking into a wall stops flush against it, and slides along it', () => {
    const w = tinyMap(ROOM);
    const p = { x: 2, y: 1.5 };
    moveCircle(w, p, 0, -3, FPS_PLAYER_RADIUS);
    assert.ok(Math.abs(p.y - (1 + FPS_PLAYER_RADIUS)) < 0.01, `flush: ${p.y}`);
    moveCircle(w, p, 1.5, -1, FPS_PLAYER_RADIUS);
    assert.ok(Math.abs(p.x - 3.5) < 1e-9, 'slid along the wall');
    // A crate blocks walking too.
    const q = { x: 4.5, y: 2.5 };
    moveCircle(w, q, 0, 1, FPS_PLAYER_RADIUS);
    assert.ok(q.y < 3 - FPS_PLAYER_RADIUS + 0.01);
  });

  test('rays stop at walls, not at crates', () => {
    const w = tinyMap(ROOM);
    assert.ok(Math.abs(rayToWall(w, 1.5, 3.5, 1, 0, 50) - 6.5) < 1e-9);
    assert.ok(hasLineOfSight(w, 1.5, 3.5, 7.5, 3.5), 'over the crate');
    assert.ok(!hasLineOfSight(w, 1.5, 1.5, 1.5, 7.5), 'through the outer wall');
  });

  test('a shot hits the nearest one in line, not one behind a wall', () => {
    const w = tinyMap(ROOM);
    const near = { id: 'near', x: 4, y: 1.5 };
    const far = { id: 'far', x: 6, y: 1.5 };
    assert.equal(traceShot(w, 1.5, 1.5, 0, 40, [far, near]).hit?.id, 'near');
    assert.equal(traceShot(w, 1.5, 1.5, Math.PI / 2, 40, [far, near]).hit, null);
  });

  test('firing spends ammo, starts the cooldown and damages the target', () => {
    const w = tinyMap(ROOM);
    const shooter = actor('me', 1.5, 2.5, 0);
    const target = actor('them', 3, 2.5);
    shooter.weapon = 1;
    const res = fireWeapon(w, shooter, [target], () => 0.5);
    assert.ok(res);
    assert.equal(shooter.shells, 7);
    assert.equal(shooter.shot, 1);
    assert.ok((res.damage.get('them') ?? 0) > 30, 'all pellets land point blank');
    assert.equal(
      fireWeapon(w, shooter, [target], () => 0.5),
      null,
      'cooling down',
    );
    shooter.cooldown = 0;
    shooter.shells = 0;
    assert.equal(
      fireWeapon(w, shooter, [target], () => 0.5),
      null,
      'empty',
    );
  });

  test('paths go round crates', () => {
    const w = tinyMap(ROOM);
    const path = findPath(w, 3.5, 3.5, 5.5, 3.5);
    assert.ok(path && path.length >= 2);
    assert.ok(!path.some((p) => p.x === 4.5 && p.y === 3.5));
    assert.equal(findPath(w, 1.5, 1.5, 0.5, 0.5), null, 'no path into a wall');
  });

  test('angles wrap the short way round', () => {
    assert.ok(Math.abs(angleDiff(0.1, Math.PI * 2 - 0.1) + 0.2) < 1e-9);
  });
});

// ── Whole matches ───────────────────────────────────────────

class Clock {
  t = 1_000_000;
  now = () => this.t;
}

const CFG: FpsConfig = { map: 'arena', bots: 3, difficulty: 'hard', fragLimit: 0, timeLimit: 0 };

function run(
  sessions: FpsSession[],
  clock: Clock,
  seconds: number,
  input: FpsInput = NO_INPUT,
  step = 1 / 30,
) {
  for (let t = 0; t < seconds; t += step) {
    clock.t += step * 1000;
    for (const s of sessions) s.update(step, input);
  }
}

describe('a solo match', () => {
  test('bots hunt the player down and score', () => {
    const clock = new Clock();
    const s = new FpsSession({
      self: { id: 'me', name: 'Me', palette: 0, hueShift: 0, look: null },
      cfg: CFG,
      map: builtinMap('arena'),
      net: null,
      now: clock.now,
      rng: seededRng(42),
    });
    assert.equal(s.isHost, true);
    assert.equal(s.others().length, 3);
    run([s], clock, 90);
    const board = s.scoreboard();
    const me = board.find((r) => r.self)!;
    assert.ok(me.deaths > 0, 'the idle player got fragged');
    assert.ok(board.filter((r) => r.bot).reduce((n, r) => n + r.frags, 0) > 0, 'bots scored');
  });

  test('the round ends at the frag limit and a new one starts', () => {
    const clock = new Clock();
    const s = new FpsSession({
      self: { id: 'me', name: 'Me', palette: 0, hueShift: 0, look: null },
      cfg: { ...CFG, fragLimit: 1, bots: 4 },
      map: builtinMap('arena'),
      net: null,
      now: clock.now,
      rng: seededRng(7),
    });
    let sawOver = false;
    for (let i = 0; i < 180 * 30 && !sawOver; i++) {
      clock.t += 1000 / 30;
      s.update(1 / 30, NO_INPUT);
      sawOver = s.over;
    }
    assert.ok(sawOver, 'someone reached the limit');
    assert.equal(s.round, 1);
    run([s], clock, 9);
    assert.equal(s.round, 2);
    assert.equal(s.over, false);
    assert.ok(s.scoreboard().every((r) => r.frags === 0 || r.frags === 1));
  });

  test('a paused solo match stands still', () => {
    const clock = new Clock();
    const s = new FpsSession({
      self: { id: 'me', name: 'Me', palette: 0, hueShift: 0, look: null },
      cfg: CFG,
      map: builtinMap('arena'),
      net: null,
      now: clock.now,
      rng: seededRng(1),
    });
    s.paused = true;
    const before = s.others().map((a) => [a.x, a.y]);
    run([s], clock, 5, { ...NO_INPUT, forward: 1 });
    assert.deepEqual(
      s.others().map((a) => [a.x, a.y]),
      before,
    );
  });
});

/** Offices in one match over a fake relay: frames go to every other session, in order. */
function room(ids: string[], clock: Clock, cfg: FpsConfig) {
  const queue: Array<{ from: string; frame: GameFrameBody }> = [];
  const sessions = ids.map((id, i) => {
    const net: FpsNet = {
      send: (frame) => queue.push({ from: id, frame: JSON.parse(JSON.stringify(frame)) }),
    };
    return new FpsSession({
      self: { id, name: id.toUpperCase(), palette: i, hueShift: 0, look: null },
      cfg,
      map: builtinMap(cfg.map),
      net,
      now: clock.now,
      rng: seededRng(100 + i),
    });
  });
  const hostId = ids[0];
  const info = (id: string, i: number) => ({
    id,
    name: id.toUpperCase(),
    palette: i,
    hueShift: 0,
    look: null,
  });
  sessions.forEach((s) => s.setParticipants(ids.map(info), hostId));
  const deliver = () => {
    while (queue.length > 0) {
      const { from, frame } = queue.shift()!;
      sessions.forEach((s, i) => {
        if (ids[i] !== from) s.receive(from, frame);
      });
    }
  };
  return { sessions, deliver };
}

describe('a match between offices', () => {
  test('the host runs the bots and everyone sees them', () => {
    const clock = new Clock();
    const { sessions, deliver } = room(['aa', 'bb'], clock, {
      ...CFG,
      bots: 2,
      difficulty: 'easy',
    });
    const [a, b] = sessions;
    assert.equal(a.isHost, true);
    assert.equal(b.isHost, false);
    for (let i = 0; i < 15; i++) {
      clock.t += 33;
      a.update(1 / 30, NO_INPUT);
      b.update(1 / 30, NO_INPUT);
      deliver();
    }
    assert.equal(b.others().filter((o) => o.bot).length, 2, 'B sees the host’s bots');
    assert.ok(
      b.others().some((o) => o.id === 'aa'),
      'B sees A',
    );
    assert.ok(
      a.others().some((o) => o.id === 'bb'),
      'A sees B',
    );
    assert.equal(b.round, a.round, 'B follows the host’s round');
  });

  test('a hit is the target’s to take, a frag the host’s to count', () => {
    const clock = new Clock();
    const { sessions, deliver } = room(['aa', 'bb'], clock, { ...CFG, bots: 0 });
    const [a, b] = sessions;
    for (let i = 0; i < 10; i++) {
      clock.t += 33;
      a.update(1 / 30, NO_INPUT);
      b.update(1 / 30, NO_INPUT);
      deliver();
    }
    // Nobody can be hurt just after spawning.
    assert.ok(b.me.guard > 0);
    b.me.guard = 0;
    // A sees B one step ahead of it, where it looks.
    const seen = a.others().find((o) => o.id === 'bb')!;
    for (let i = 0; i < 20 && b.me.alive; i++) {
      seen.x = a.me.x + Math.cos(a.me.a);
      seen.y = a.me.y + Math.sin(a.me.a);
      seen.alive = true;
      a.me.cooldown = 0;
      clock.t += 70;
      a.update(0.001, { ...NO_INPUT, fire: true });
      deliver();
    }
    assert.equal(b.me.alive, false, 'B went down');
    assert.ok(b.me.hp <= 0);
    clock.t += 100;
    a.update(1 / 30, NO_INPUT);
    deliver();
    assert.equal(a.scoreboard().find((r) => r.id === 'aa')?.frags, 1, 'A scored, on the host');
    assert.equal(b.scoreboard().find((r) => r.id === 'aa')?.frags, 1, 'B sees the score');
    assert.equal(b.scoreboard().find((r) => r.id === 'bb')?.deaths, 1);
    assert.ok(
      b.feed.some((l) => l.killer === 'AA' && l.victim === 'BB'),
      'kill feed',
    );
    assert.equal(b.killedBy, 'aa');
  });

  test('when the host leaves, the next player takes the bots over', () => {
    const clock = new Clock();
    const { sessions, deliver } = room(['aa', 'bb'], clock, { ...CFG, bots: 2 });
    const [a, b] = sessions;
    for (let i = 0; i < 20; i++) {
      clock.t += 33;
      a.update(1 / 30, NO_INPUT);
      b.update(1 / 30, NO_INPUT);
      deliver();
    }
    const round = b.round;
    b.setParticipants([], 'bb');
    assert.equal(b.isHost, true);
    assert.equal(b.others().filter((o) => o.bot).length, 2);
    run([b], clock, 2);
    assert.equal(b.round, round, 'the round goes on');
  });

  test('a newcomer on an office map waits for the host to send it', () => {
    const clock = new Clock();
    const map = builtinMap('arena')!;
    const queue: Array<{ from: string; frame: GameFrameBody }> = [];
    const cfg: FpsConfig = { ...CFG, map: 'office', bots: 0 };
    const host = new FpsSession({
      self: { id: 'aa', name: 'A', palette: 0, hueShift: 0, look: null },
      cfg,
      map,
      net: { send: (frame) => queue.push({ from: 'aa', frame }) },
      now: clock.now,
    });
    const guest = new FpsSession({
      self: { id: 'bb', name: 'B', palette: 1, hueShift: 0, look: null },
      cfg,
      map: null,
      net: { send: (frame) => queue.push({ from: 'bb', frame }) },
      now: clock.now,
    });
    const both = [
      { id: 'aa', name: 'A', palette: 0, hueShift: 0, look: null },
      { id: 'bb', name: 'B', palette: 1, hueShift: 0, look: null },
    ];
    host.setParticipants(both, 'aa');
    guest.setParticipants(both, 'aa');
    assert.equal(guest.waiting, true);
    while (queue.length > 0) {
      const { from, frame } = queue.shift()!;
      (from === 'aa' ? guest : host).receive(from, frame);
    }
    assert.equal(guest.waiting, false);
    assert.equal(guest.world?.data.cells, map.cells);
  });
});

// ── The office as a map ─────────────────────────────────────

const W = TileType.WALL as TileTypeVal;
const F = TileType.FLOOR_1 as TileTypeVal;

beforeAll(() => {
  const sprite = (w: number, h: number) =>
    Array.from({ length: h }, () => Array.from({ length: w }, () => FALLBACK_FLOOR_COLOR));
  const asset = (
    id: string,
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
    groupId: id,
    ...extra,
  });
  buildDynamicCatalog({
    catalog: [
      asset('DESK', 'desks', 2, 1, { isDesk: true }),
      asset('CHAIR', 'chairs', 1, 1),
      asset('PLANT', 'decor', 1, 1),
      asset('LAPTOP', 'electronics', 1, 1, { canPlaceOnSurfaces: true }),
      asset('PAINTING', 'wall', 1, 1, { canPlaceOnWalls: true }),
    ],
    sprites: {
      DESK: sprite(32, 16),
      CHAIR: sprite(16, 16),
      PLANT: sprite(16, 16),
      LAPTOP: sprite(16, 16),
      PAINTING: sprite(16, 16),
    },
  });
});

test('the floor on screen becomes a map: walls stand, desks are blocks, furniture stands in the room', () => {
  const cols = 10;
  const rows = 8;
  const tiles: TileTypeVal[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) tiles.push(r === 0 || c === 0 ? W : F);
  }
  const layout: OfficeLayout = {
    version: 1,
    cols,
    rows,
    tiles,
    tileColors: tiles.map(() => null),
    furniture: [
      { uid: 'desk', type: 'DESK', col: 3, row: 3 },
      { uid: 'laptop', type: 'LAPTOP', col: 3, row: 3 },
      { uid: 'chair', type: 'CHAIR', col: 3, row: 4 },
      { uid: 'plant', type: 'PLANT', col: 8, row: 6 },
      { uid: 'painting', type: 'PAINTING', col: 4, row: 0 },
    ],
  };
  const os = new OfficeState(layout);
  const map = officeMap(os);
  assert.ok(map);
  // A wall is put round the floor.
  assert.equal(map.cols, cols + 2);
  assert.equal(map.rows, rows + 2);
  const cell = (c: number, r: number) => map.cells[(r + 1) * map.cols + (c + 1)];
  assert.match(cell(0, 0), /[A-Z]/);
  assert.match(cell(5, 5), /[a-z]/);
  assert.match(cell(3, 3), /[0-9]/, 'desk → block');
  assert.match(cell(4, 3), /[0-9]/, 'both desk tiles');
  assert.equal(map.blocks.length, 1);
  const types = map.props.map((p) => p.t).sort();
  assert.deepEqual(types, ['CHAIR', 'LAPTOP', 'PLANT'], 'the painting stays on the wall');
  assert.equal(map.props.find((p) => p.t === 'LAPTOP')?.z, 0.4, 'the laptop stands on the desk');
  assert.ok(map.solid.includes(7 * map.cols + 9), 'the plant is in the way');
  assert.ok(!map.solid.includes(5 * map.cols + 4), 'chairs are not');
  const world = compileWorld(map);
  for (const s of map.spawns) {
    const i: number = Math.floor(s.y) * map.cols + Math.floor(s.x);
    assert.equal(world.solid[i], 0);
    assert.equal(world.reachable[i], 1);
  }
});
