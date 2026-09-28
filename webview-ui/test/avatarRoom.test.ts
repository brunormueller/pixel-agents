/**
 * Multiplayer room, OfficeState half: the person's own character (avatar),
 * its desk, keyboard movement, and other offices' characters on the shared map.
 * Plus the pure presence helpers the webview ships to the server.
 *
 * The rule under test: the person and their first Claude agent are ONE
 * character. Claude working → it sits at the chosen desk; Claude idle → the
 * keyboard walks it, and nothing else moves it.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { RemotePeer } from '../../core/src/messages.js';
import { AVATAR_LOCAL_ID, REMOTE_AGENT_ID_BASE } from '../src/constants.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { collectPresence, keyToDirection, loseDeskTo } from '../src/office/engine/presence.js';
import { CharacterState, Direction, TILE_SIZE } from '../src/office/types.js';

/** No furniture catalog in tests: inject seats the way layoutToSeats would derive them. */
function officeWithSeats(): OfficeState {
  const os = new OfficeState();
  const seat = (col: number, row: number) => ({
    uid: `seat-${col}-${row}`,
    seatCol: col,
    seatRow: row,
    facingDir: Direction.UP,
    assigned: false,
  });
  for (const s of [seat(3, 3), seat(4, 3), seat(12, 8)]) os.seats.set(s.uid, s);
  return os;
}

/** Run the simulation long enough for the spawn effect and a few steps. */
function tick(os: OfficeState, seconds: number): void {
  for (let t = 0; t < seconds; t += 0.05) os.update(0.05);
}

test('joining puts the person in the office as a character of their own', () => {
  const os = officeWithSeats();
  os.ensureAvatar();
  const ch = os.characters.get(AVATAR_LOCAL_ID);
  assert.ok(ch, 'avatar character exists');
  assert.equal(os.avatarId, AVATAR_LOCAL_ID);
  assert.equal(ch.isAvatar, true);
  assert.equal(ch.isActive, false);
  assert.equal(ch.seatId, null, 'no desk until the person picks one');

  os.ensureAvatar();
  assert.equal(os.characters.size, 1, 'idempotent');
});

test('the first Claude agent IS the person: same character, re-keyed, given a desk', () => {
  const os = officeWithSeats();
  os.ensureAvatar();
  tick(os, 1);
  const person = os.characters.get(AVATAR_LOCAL_ID)!;
  const { x, y } = person;

  os.addAgent(7);
  assert.equal(os.characters.has(AVATAR_LOCAL_ID), false);
  assert.equal(os.characters.get(7), person, 'the very same character object');
  assert.equal(os.avatarId, 7);
  assert.equal(person.id, 7);
  assert.deepEqual({ x: person.x, y: person.y }, { x, y }, 'no teleport, no respawn');
  assert.notEqual(person.seatId, null, 'Claude needs a desk: one was taken');
  assert.equal(person.matrixEffect, null, 'no spawn effect: it was already there');
});

test('the agent closing hands the character back to the person instead of despawning', () => {
  const os = officeWithSeats();
  os.ensureAvatar();
  tick(os, 1);
  os.addAgent(7);
  os.setAgentActive(7, true);
  os.removeAgent(7);
  const person = os.characters.get(AVATAR_LOCAL_ID);
  assert.ok(person, 'back under the avatar id');
  assert.equal(os.characters.has(7), false);
  assert.notEqual(person.matrixEffect, 'despawn', 'not despawning');
  assert.equal(person.isActive, false);
  assert.equal(os.avatarId, AVATAR_LOCAL_ID);
});

test('further agents sit at the free seat closest to the person’s desk', () => {
  const os = officeWithSeats();
  os.ensureAvatar();
  tick(os, 1);
  assert.equal(os.setDesk('seat-3-3'), true);
  os.addAgent(1); // becomes the person
  os.addAgent(2);
  assert.equal(os.characters.get(1)!.seatId, 'seat-3-3');
  assert.equal(os.characters.get(2)!.seatId, 'seat-4-3', 'the neighbour, not the far seat');
});

test('a desk is chosen only when free, and choosing moves the claim', () => {
  const os = officeWithSeats();
  os.ensureAvatar();
  tick(os, 1);
  os.seats.get('seat-12-8')!.assigned = true; // someone else's
  assert.equal(os.setDesk('seat-12-8'), false);
  assert.equal(os.setDesk('seat-3-3'), true);
  assert.equal(os.getDesk(), 'seat-3-3');
  assert.equal(os.setDesk('seat-4-3'), true);
  assert.equal(os.seats.get('seat-3-3')!.assigned, false, 'old desk released');
  assert.equal(os.seats.get('seat-4-3')!.assigned, true);
  assert.equal(os.isDeskAvailable('seat-4-3'), true, 'your own desk stays choosable');
});

test('the keyboard walks the idle person; nothing moves it otherwise', () => {
  const os = officeWithSeats();
  os.ensureAvatar();
  tick(os, 1);
  const ch = os.characters.get(AVATAR_LOCAL_ID)!;
  const start = { col: ch.tileCol, row: ch.tileRow };

  tick(os, 20);
  assert.deepEqual({ col: ch.tileCol, row: ch.tileRow }, start, 'no wandering by itself');

  os.avatarHeldDir = Direction.RIGHT;
  tick(os, 1);
  os.avatarHeldDir = null;
  tick(os, 1);
  assert.equal(ch.tileRow, start.row);
  assert.ok(ch.tileCol > start.col, 'walked right while the key was held');
  assert.equal(ch.dir, Direction.RIGHT);
});

test('while Claude works the keyboard does nothing: the character goes to the desk', () => {
  const os = officeWithSeats();
  os.ensureAvatar();
  tick(os, 1);
  os.setDesk('seat-3-3');
  os.addAgent(1);
  os.setAgentActive(1, true);
  assert.equal(os.avatarIsManual(), false);
  os.avatarHeldDir = Direction.DOWN;
  tick(os, 15);
  const ch = os.characters.get(1)!;
  assert.deepEqual({ col: ch.tileCol, row: ch.tileRow }, { col: 3, row: 3 }, 'at the desk');
  assert.equal(ch.state, CharacterState.TYPE);

  // Claude finishes: the person stays seated until they move.
  os.avatarHeldDir = null;
  os.setAgentActive(1, false);
  tick(os, 20);
  assert.equal(ch.state, CharacterState.TYPE, 'does not get up and wander');
  assert.equal(os.avatarIsManual(), true);
});

test('seats other offices hold are not offered, and free up when released', () => {
  const os = officeWithSeats();
  os.setExternalSeatClaims(['seat-3-3']);
  assert.equal(os.isDeskAvailable('seat-3-3'), false);
  os.setExternalSeatClaims([]);
  assert.equal(os.isDeskAvailable('seat-3-3'), true);
});

test('a remote character on the shared map follows its office’s pose instead of its own FSM', () => {
  const os = officeWithSeats();
  const id = REMOTE_AGENT_ID_BASE;
  os.addAgent(id, 1, 0, undefined, true);
  os.setRemote(id, 'Ana');
  const target = {
    x: 5 * TILE_SIZE + 8,
    y: 5 * TILE_SIZE + 8,
    dir: Direction.LEFT,
    state: 'idle' as const,
  };
  os.setRemotePose(id, target, 'Read', 'remote:typing');
  const ch = os.characters.get(id)!;
  assert.equal(ch.seatId, null, 'holds none of our seats');
  assert.deepEqual({ x: ch.x, y: ch.y }, { x: target.x, y: target.y }, 'appears in place');

  // A short move is walked, not jumped.
  os.setRemotePose(id, { ...target, x: target.x + TILE_SIZE }, 'Read', 'remote:typing');
  os.update(0.05);
  assert.ok(ch.x > target.x && ch.x < target.x + TILE_SIZE, 'moving toward the new pose');
  assert.equal(ch.state, CharacterState.WALK);
  tick(os, 2);
  assert.equal(ch.x, target.x + TILE_SIZE);
  assert.equal(ch.dir, Direction.LEFT, 'faces the way its office says once there');

  // Seated remote characters hold that seat here too.
  const seat = os.seats.get('seat-12-8')!;
  os.setRemotePose(
    id,
    {
      x: seat.seatCol * TILE_SIZE + 8,
      y: seat.seatRow * TILE_SIZE + 8,
      dir: Direction.UP,
      state: 'type',
    },
    'Read',
    'remote:typing',
  );
  os.setExternalSeatClaims([]);
  assert.equal(os.isDeskAvailable('seat-12-8'), false);
});

test('presence: the person goes out as id 0 with its sprite; remote and sub characters stay home', () => {
  const os = officeWithSeats();
  os.ensureAvatar();
  os.addAgent(REMOTE_AGENT_ID_BASE, 0, 0, undefined, true);
  os.setRemote(REMOTE_AGENT_ID_BASE, 'Bob');
  const presence = collectPresence(os.characters.values(), os.avatarId);
  assert.equal(presence.length, 1);
  assert.equal(presence[0].id, 0);
  assert.equal(presence[0].isAvatar, true);
  assert.equal(typeof presence[0].palette, 'number');
  assert.equal(presence[0].pose.state, 'idle');

  os.addAgent(5); // becomes the person
  os.addAgent(6);
  const withAgents = collectPresence(os.characters.values(), os.avatarId);
  assert.deepEqual(
    withAgents.map((c) => [c.id, c.isAvatar]),
    [
      [5, true],
      [6, false],
    ],
  );
});

test('a contested desk goes to whoever joined the room first', () => {
  const peer = (name: string, since: number, desk: string | null): RemotePeer => ({
    peerId: name,
    name,
    agents: [],
    desk,
    since,
  });
  assert.equal(loseDeskTo('d1', 200, [peer('Ana', 100, 'd1')])?.name, 'Ana');
  assert.equal(loseDeskTo('d1', 100, [peer('Bob', 200, 'd1')]), null, 'we were first');
  assert.equal(loseDeskTo('d1', 200, [peer('Ana', 100, 'd2')]), null, 'different desk');
  assert.equal(loseDeskTo(null, 200, [peer('Ana', 100, 'd1')]), null);
});

test('arrows and WASD map to directions, either case', () => {
  assert.equal(keyToDirection('ArrowUp'), Direction.UP);
  assert.equal(keyToDirection('a'), Direction.LEFT);
  assert.equal(keyToDirection('D'), Direction.RIGHT);
  assert.equal(keyToDirection('q'), null);
});
