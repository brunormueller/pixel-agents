/**
 * Emotes (dance, jump, spin, reactions): the pure look (engine/emotes.ts) and
 * the OfficeState rules around the person's character — who may play what,
 * what ends a dance, and how a remote office's emote replays here.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { AVATAR_LOCAL_ID, EMOTE_BEAT_SEC, REMOTE_AGENT_ID_BASE } from '../src/constants.js';
import { advanceEmote, emoteForKey, emoteLook, EMOTES } from '../src/office/engine/emotes.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { poseOf } from '../src/office/engine/presence.js';
import { CharacterState, Direction } from '../src/office/types.js';

function joined(): OfficeState {
  const os = new OfficeState();
  os.seats.set('desk', {
    uid: 'desk',
    seatCol: 3,
    seatRow: 3,
    facingDir: Direction.UP,
    assigned: false,
  });
  os.ensureAvatar();
  for (let t = 0; t < 1; t += 0.05) os.update(0.05); // past the spawn effect
  return os;
}
const person = (os: OfficeState) => os.characters.get(os.avatarId!)!;

test('dance sways through facings on the beat, stepping and bouncing in whole pixels', () => {
  const dirs = new Set<number>();
  const frames = new Set<number>();
  for (let t = 0; t < EMOTE_BEAT_SEC * 8; t += EMOTE_BEAT_SEC / 4) {
    const look = emoteLook({ kind: 'dance', t, seq: 1 });
    dirs.add(look.dir!);
    frames.add(look.walkFrame!);
    assert.ok(look.hop <= 0 && Number.isInteger(look.hop), `hop ${look.hop} at ${t}`);
  }
  assert.ok(dirs.size >= 3, 'faces several ways');
  assert.deepEqual([...frames].sort(), [0, 2], 'alternates the stride frames');
});

test('reactions leave the sprite alone and expire; dance loops until stopped', () => {
  assert.equal(emoteLook({ kind: 'heart', t: 1, seq: 1 }).walkFrame, null);
  const wave = { kind: 'wave' as const, t: 0, seq: 1 };
  assert.equal(advanceEmote(wave, EMOTES.wave.duration + 0.1), false);
  const dance = { kind: 'dance' as const, t: 0, seq: 1 };
  assert.equal(advanceEmote(dance, 3600), true);
  assert.equal(emoteForKey('1'), 'dance');
  assert.equal(emoteForKey('9'), null);
});

test('the person dances, and dance toggles', () => {
  const os = joined();
  assert.equal(os.playEmote('dance'), true);
  assert.equal(person(os).emote?.kind, 'dance');
  assert.equal(os.playEmote('dance'), true);
  assert.equal(person(os).emote, null);
});

test('dancing at the desk stands the character up', () => {
  const os = joined();
  os.setDesk('desk');
  for (let t = 0; t < 10; t += 0.05) os.update(0.05);
  assert.equal(person(os).state, CharacterState.TYPE);
  os.playEmote('dance');
  assert.equal(person(os).state, CharacterState.IDLE);
});

test('walking off ends a dance; a reaction keeps floating', () => {
  const os = joined();
  os.playEmote('dance');
  os.avatarHeldDir = Direction.RIGHT;
  os.update(0.05);
  assert.equal(person(os).emote, null);
  os.avatarHeldDir = null;
  os.playEmote('heart');
  os.avatarHeldDir = Direction.LEFT;
  os.update(0.05);
  assert.equal(person(os).emote?.kind, 'heart');
});

test('while Claude works: reactions yes, moves no — and Claude taking over ends a dance', () => {
  const os = joined();
  os.playEmote('dance');
  os.addAgent(1); // becomes the person
  os.setAgentActive(1, true);
  os.update(0.05);
  assert.equal(person(os).emote, null, 'dance ended');
  assert.equal(os.playEmote('jump'), false);
  assert.equal(os.playEmote('wave'), true);
});

test('nobody to emote without a room', () => {
  const os = new OfficeState();
  assert.equal(os.playEmote('wave'), false);
  assert.equal(os.avatarId, null);
  assert.equal(AVATAR_LOCAL_ID < 0, true);
});

test('a remote office’s emote replays here, again on a new seq, and a dance stops with it', () => {
  const os = new OfficeState();
  const id = REMOTE_AGENT_ID_BASE;
  os.addAgent(id, 0, 0, undefined, true);
  os.setRemote(id, 'Ana');
  const base = { x: 40, y: 40, dir: 0, state: 'idle' as const };
  const ch = os.characters.get(id)!;

  os.setRemotePose(id, { ...base, emote: 'wave', emoteSeq: 4 }, null, 't');
  assert.deepEqual([ch.emote?.kind, ch.emote?.seq], ['wave', 4]);
  ch.emote!.t = 1;
  os.setRemotePose(id, { ...base, emote: 'wave', emoteSeq: 4 }, null, 't');
  assert.equal(ch.emote?.t, 1, 'same seq: keeps playing, no restart');
  os.setRemotePose(id, { ...base, emote: 'wave', emoteSeq: 5 }, null, 't');
  assert.equal(ch.emote?.t, 0, 'new seq: plays again');

  os.setRemotePose(id, { ...base, emote: 'dance', emoteSeq: 6 }, null, 't');
  os.setRemotePose(id, base, null, 't');
  assert.equal(ch.emote, null, 'its office stopped dancing');
});

test('the emote travels in the pose', () => {
  const os = joined();
  os.playEmote('party');
  const pose = poseOf(person(os));
  assert.equal(pose.emote, 'party');
  assert.equal(typeof pose.emoteSeq, 'number');
});
