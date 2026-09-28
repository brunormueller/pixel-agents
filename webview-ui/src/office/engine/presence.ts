// webview-ui/src/office/engine/presence.ts
//
// Multiplayer room: what this office tells the room about its characters on the
// shared map (poses + claimed desk), and the small rules around it. Pure — the
// webview runs the character simulation, so it is the one that knows where
// everyone stands; useExtensionMessages ships this to the server.

import type { PresenceCharacter, RemotePeer, RemotePose } from '../../../../core/src/messages.js';
import { AVATAR_LOCAL_ID } from '../../constants.js';
import type { Character } from '../types.js';
import { CharacterState, Direction } from '../types.js';
import { isReadingTool } from './characters.js';

/** The pose a character shows the room. */
export function poseOf(ch: Character): RemotePose {
  let state: RemotePose['state'] = 'idle';
  if (ch.state === CharacterState.WALK) state = 'walk';
  else if (ch.state === CharacterState.TYPE)
    state = isReadingTool(ch.currentTool) ? 'read' : 'type';
  const pose: RemotePose = {
    x: Math.round(ch.x * 10) / 10,
    y: Math.round(ch.y * 10) / 10,
    dir: ch.dir,
    state,
  };
  if (ch.emote) {
    pose.emote = ch.emote.kind;
    pose.emoteSeq = ch.emote.seq;
  }
  return pose;
}

/**
 * This office's characters as the room should see them: the person (id 0 while
 * no agent drives it) and its top-level agents. Sub-agents, remote characters
 * and characters still materializing or dissolving are left out.
 */
export function collectPresence(
  characters: Iterable<Character>,
  avatarId: number | null,
): PresenceCharacter[] {
  const out: PresenceCharacter[] = [];
  for (const ch of characters) {
    if (ch.isRemote || ch.isSubagent || ch.matrixEffect === 'despawn') continue;
    const isAvatar = ch.id === avatarId;
    if (ch.id <= 0 && !(isAvatar && ch.id === AVATAR_LOCAL_ID)) continue;
    const entry: PresenceCharacter = {
      id: ch.id === AVATAR_LOCAL_ID ? 0 : ch.id,
      isAvatar,
      pose: poseOf(ch),
    };
    if (isAvatar) {
      entry.palette = ch.palette;
      entry.hueShift = ch.hueShift;
    }
    out.push(entry);
  }
  return out.sort((a, b) => a.id - b.id);
}

/**
 * Another office holds our desk and has the better claim — it joined the room
 * first (earlier `since`, on the relay's clock, so both sides agree). We then
 * give the desk up and pick another. The desk picker never offers a claimed
 * desk, so this only settles two people clicking the same one at once.
 */
export function loseDeskTo(
  desk: string | null,
  mySince: number,
  peers: RemotePeer[],
): RemotePeer | null {
  if (!desk) return null;
  for (const peer of peers) {
    if (peer.desk !== desk) continue;
    const theirs = peer.since ?? 0;
    if (theirs < mySince) return peer;
  }
  return null;
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: Direction.UP,
  ArrowDown: Direction.DOWN,
  ArrowLeft: Direction.LEFT,
  ArrowRight: Direction.RIGHT,
  w: Direction.UP,
  s: Direction.DOWN,
  a: Direction.LEFT,
  d: Direction.RIGHT,
};

/** Movement key → direction (arrows and WASD, either case), or null. */
export function keyToDirection(key: string): Direction | null {
  return KEY_DIRECTIONS[key] ?? KEY_DIRECTIONS[key.toLowerCase()] ?? null;
}
