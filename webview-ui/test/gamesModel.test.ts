/**
 * Matches in the room, from everyone's presences: grouping, who hosts, and the
 * match setup a page may start with.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { GamePresence, RemotePeer } from '../../core/src/messages.js';
import type { MatchPlayer } from '../src/games/model.js';
import { cleanConfig, describeConfig, newMatchId, roomMatches } from '../src/games/model.js';

const cfg = { map: 'arena', bots: 2, difficulty: 'hard' as const, fragLimit: 10, timeLimit: 5 };

const presence = (id: string, since: number, extra: Partial<GamePresence> = {}): GamePresence => ({
  id,
  game: 'fps',
  title: `${id} match`,
  since,
  cfg,
  palette: 1,
  hueShift: 0,
  ...extra,
});

const peer = (peerId: string, game?: GamePresence): RemotePeer => ({
  peerId,
  name: peerId.toUpperCase(),
  agents: [],
  ...(game ? { game } : {}),
});

test('a match is everyone publishing its id; the first to join hosts it', () => {
  const self: MatchPlayer = {
    peerId: 'me',
    name: 'Me',
    self: true,
    presence: presence('m1', 300),
    look: null,
  };
  const matches = roomMatches(self, [
    peer('bb', presence('m1', 100, { title: 'BB’s match', cfg: { ...cfg, map: 'maze' } })),
    peer('cc', presence('m2', 50)),
    peer('dd'),
    peer('aa', presence('m1', 100)),
  ]);
  assert.deepEqual(
    matches.map((m) => m.id),
    ['m2', 'm1'],
  );
  const m1 = matches[1];
  // Same join time: the lower peerId goes first, on every office alike.
  assert.deepEqual(
    m1.players.map((p) => p.peerId),
    ['aa', 'bb', 'me'],
  );
  assert.equal(m1.hostId, 'aa');
  assert.equal(m1.cfg.map, 'arena', 'the host’s setup is the match’s');
  assert.equal(m1.title, 'm1 match');
});

test('no presences, no matches', () => {
  assert.deepEqual(roomMatches(null, [peer('aa'), peer('bb')]), []);
});

test('a setup is cleaned before a match starts with it', () => {
  assert.deepEqual(cleanConfig({ map: 'nowhere', bots: 40, difficulty: 'hard', fragLimit: -2 }), {
    map: 'arena',
    bots: 3,
    difficulty: 'hard',
    fragLimit: 10,
    timeLimit: 5,
  });
  assert.equal(cleanConfig({ map: 'office', bots: 0 }).bots, 0);
});

test('a setup reads as one line', () => {
  assert.equal(describeConfig(cfg), 'Arena · 2 hard bots · 10 frags · 5 min');
  assert.equal(
    describeConfig({ ...cfg, bots: 0, fragLimit: 0, timeLimit: 0, map: 'office' }),
    'Your office · no bots · no frag limit · no time limit',
  );
});

test('match ids are what the relay accepts', () => {
  for (let i = 0; i < 20; i++) assert.match(newMatchId(), /^[A-Za-z0-9_-]{1,64}$/);
});
