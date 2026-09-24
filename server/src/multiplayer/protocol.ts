/**
 * Relay wire protocol for multiplayer offices.
 *
 * A peer is one Pixel Agents surface (a VS Code window or a standalone server).
 * Peers in the same room publish a SUMMARY of their agents to a relay, which
 * forwards it to every other peer in the room. The summary carries only what the
 * office needs to animate a character — never tool arguments, file names,
 * commands, prompts or folder names. Those stay on the machine that produced them.
 *
 * Every frame is JSON with a `t` discriminator. Both ends sanitize everything
 * they receive: the relay does not trust peers, and peers do not trust the relay.
 */

import type { RemoteActivity, RemoteAgent } from '../../../core/src/messages.js';
import {
  HUE_SHIFT_MAX_DEG,
  MULTIPLAYER_MAX_AGENTS_PER_PEER,
  MULTIPLAYER_MAX_NAME_LENGTH,
  MULTIPLAYER_MAX_ROOM_LENGTH,
} from '../constants.js';

/** One agent as published to the room — the same shape the webview receives in `remotePeers`
 *  (core/asyncapi.yaml `RemoteAgent`), so the relay frames and the UI contract cannot drift. */
export type RemoteAgentState = RemoteAgent;
export type { RemoteActivity };

export interface PeerSnapshot {
  peerId: string;
  name: string;
  agents: RemoteAgentState[];
}

// ── Frames ───────────────────────────────────────────────────

export interface HelloFrame {
  t: 'hello';
  v: number;
  room: string;
  name: string;
}
export interface StateFrame {
  t: 'state';
  agents: RemoteAgentState[];
}
export type ClientFrame = HelloFrame | StateFrame;

export interface WelcomeFrame {
  t: 'welcome';
  peerId: string;
  peers: PeerSnapshot[];
}
export interface PeerFrame {
  t: 'peer';
  peer: PeerSnapshot;
}
export interface LeaveFrame {
  t: 'leave';
  peerId: string;
}
export interface ErrorFrame {
  t: 'error';
  reason: string;
}
export type RelayFrame = WelcomeFrame | PeerFrame | LeaveFrame | ErrorFrame;

// ── Sanitizers ───────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keep printable characters only (no control or bidi-override characters), trim, cap length. */
export function sanitizeText(raw: unknown, maxLength: number): string {
  if (typeof raw !== 'string') return '';

  const cleaned = raw.replace(
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
    '',
  );
  return Array.from(cleaned.trim()).slice(0, maxLength).join('');
}

export const sanitizeName = (raw: unknown): string =>
  sanitizeText(raw, MULTIPLAYER_MAX_NAME_LENGTH);

export const sanitizeRoom = (raw: unknown): string =>
  sanitizeText(raw, MULTIPLAYER_MAX_ROOM_LENGTH);

/** Palette index as sent; the webview clamps it to the palettes it loaded. */
const MAX_PALETTE_INDEX = 255;

function sanitizeAgent(raw: unknown): RemoteAgentState | null {
  if (!isObject(raw)) return null;
  const { id, palette, hueShift, status, activity } = raw;
  if (!Number.isSafeInteger(id)) return null;
  return {
    id: id as number,
    palette:
      Number.isInteger(palette) &&
      (palette as number) >= 0 &&
      (palette as number) <= MAX_PALETTE_INDEX
        ? (palette as number)
        : 0,
    hueShift:
      Number.isInteger(hueShift) &&
      (hueShift as number) >= 0 &&
      (hueShift as number) <= HUE_SHIFT_MAX_DEG
        ? (hueShift as number)
        : 0,
    status: status === 'active' ? 'active' : 'waiting',
    activity: activity === 'typing' || activity === 'reading' ? activity : null,
    permission: raw.permission === true,
    awaitingInput: raw.awaitingInput === true,
  };
}

/** Validate an agent list: drop malformed entries and duplicate ids, cap the count. */
export function sanitizeAgents(raw: unknown): RemoteAgentState[] {
  if (!Array.isArray(raw)) return [];
  const out: RemoteAgentState[] = [];
  const seen = new Set<number>();
  for (const entry of raw) {
    if (out.length >= MULTIPLAYER_MAX_AGENTS_PER_PEER) break;
    const agent = sanitizeAgent(entry);
    if (!agent || seen.has(agent.id)) continue;
    seen.add(agent.id);
    out.push(agent);
  }
  return out;
}

function sanitizePeer(raw: unknown): PeerSnapshot | null {
  if (!isObject(raw)) return null;
  const peerId = sanitizeText(raw.peerId, MULTIPLAYER_MAX_ROOM_LENGTH);
  if (!peerId) return null;
  return {
    peerId,
    name: sanitizeName(raw.name) || 'Guest',
    agents: sanitizeAgents(raw.agents),
  };
}

/** Parse a frame a peer sent to the relay. Null = malformed, ignore it. */
export function parseClientFrame(data: string): ClientFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  if (raw.t === 'hello') {
    if (typeof raw.v !== 'number') return null;
    return { t: 'hello', v: raw.v, room: sanitizeRoom(raw.room), name: sanitizeName(raw.name) };
  }
  if (raw.t === 'state') return { t: 'state', agents: sanitizeAgents(raw.agents) };
  return null;
}

/** Parse a frame the relay sent to a peer. Null = malformed, ignore it. */
export function parseRelayFrame(data: string): RelayFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  switch (raw.t) {
    case 'welcome': {
      const peerId = sanitizeText(raw.peerId, MULTIPLAYER_MAX_ROOM_LENGTH);
      if (!peerId || !Array.isArray(raw.peers)) return null;
      const peers = raw.peers.map(sanitizePeer).filter((p): p is PeerSnapshot => p !== null);
      return { t: 'welcome', peerId, peers };
    }
    case 'peer': {
      const peer = sanitizePeer(raw.peer);
      return peer ? { t: 'peer', peer } : null;
    }
    case 'leave': {
      const peerId = sanitizeText(raw.peerId, MULTIPLAYER_MAX_ROOM_LENGTH);
      return peerId ? { t: 'leave', peerId } : null;
    }
    case 'error':
      return { t: 'error', reason: sanitizeText(raw.reason, 200) };
    default:
      return null;
  }
}
