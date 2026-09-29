// webview-ui/src/games/model.ts
//
// Matches going on in the room, from the presences every office publishes: a
// match is everyone publishing the same id. The player who joined first hosts
// it (earliest `since`, then peerId — every office agrees without asking).
// Pure; Node-tested (webview-ui/test/gamesModel.test.ts).

import type {
  AvatarLook,
  FpsConfig,
  GamePresence,
  RemotePeer,
} from '../../../core/src/messages.js';
import { FPS_MAX_BOTS, FPS_MAX_FRAG_LIMIT, FPS_MAX_TIME_LIMIT_MIN } from '../constants.js';
import { MAP_CHOICES, mapName } from './fps/maps.js';
import type { FpsDifficulty } from './fps/types.js';
import { DEFAULT_FPS_CONFIG } from './fps/types.js';

export interface MatchPlayer {
  peerId: string;
  name: string;
  self: boolean;
  presence: GamePresence;
  look: AvatarLook | null;
}

export interface RoomMatch {
  id: string;
  title: string;
  cfg: FpsConfig;
  /** Host first, then in the order they joined. */
  players: MatchPlayer[];
  hostId: string;
  startedAt: number;
}

export function roomMatches(self: MatchPlayer | null, peers: readonly RemotePeer[]): RoomMatch[] {
  const byId = new Map<string, MatchPlayer[]>();
  const add = (p: MatchPlayer) => {
    const list = byId.get(p.presence.id) ?? [];
    list.push(p);
    byId.set(p.presence.id, list);
  };
  if (self) add(self);
  for (const peer of peers) {
    if (!peer.game) continue;
    add({
      peerId: peer.peerId,
      name: peer.name,
      self: false,
      presence: peer.game,
      look: peer.profile?.look ?? null,
    });
  }
  const out: RoomMatch[] = [];
  for (const [id, players] of byId) {
    players.sort(
      (a, b) =>
        a.presence.since - b.presence.since ||
        (a.peerId < b.peerId ? -1 : a.peerId > b.peerId ? 1 : 0),
    );
    const host = players[0];
    out.push({
      id,
      title: host.presence.title,
      cfg: host.presence.cfg,
      players,
      hostId: host.peerId,
      startedAt: host.presence.since,
    });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export function newMatchId(): string {
  return `fps-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

const DIFFICULTIES: readonly FpsDifficulty[] = ['easy', 'normal', 'hard'];

/** A config as the page may start a match with: known map, everything in range. */
export function cleanConfig(raw: Partial<FpsConfig>): FpsConfig {
  const int = (v: unknown, max: number, fallback: number) =>
    Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : fallback;
  return {
    map: MAP_CHOICES.some((m) => m.id === raw.map) ? (raw.map as string) : DEFAULT_FPS_CONFIG.map,
    bots: int(raw.bots, FPS_MAX_BOTS, DEFAULT_FPS_CONFIG.bots),
    difficulty: DIFFICULTIES.includes(raw.difficulty as FpsDifficulty)
      ? (raw.difficulty as FpsDifficulty)
      : DEFAULT_FPS_CONFIG.difficulty,
    fragLimit: int(raw.fragLimit, FPS_MAX_FRAG_LIMIT, DEFAULT_FPS_CONFIG.fragLimit),
    timeLimit: int(raw.timeLimit, FPS_MAX_TIME_LIMIT_MIN, DEFAULT_FPS_CONFIG.timeLimit),
  };
}

/** "Arena · 3 normal bots · 10 frags · 5 min" */
export function describeConfig(cfg: FpsConfig): string {
  const parts = [mapName(cfg.map)];
  parts.push(
    cfg.bots === 0 ? 'no bots' : `${cfg.bots} ${cfg.difficulty} bot${cfg.bots === 1 ? '' : 's'}`,
  );
  parts.push(cfg.fragLimit > 0 ? `${cfg.fragLimit} frags` : 'no frag limit');
  parts.push(cfg.timeLimit > 0 ? `${cfg.timeLimit} min` : 'no time limit');
  return parts.join(' · ');
}
