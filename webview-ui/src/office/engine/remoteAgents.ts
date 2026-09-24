// webview-ui/src/office/engine/remoteAgents.ts
//
// Multiplayer: turns `remotePeers` snapshots (other offices' agents, relayed by
// the server) into characters in THIS office. Pure and structural like
// existingAgents.ts so it is unit-testable without React.
//
// Remote agents are simulated locally: each office has its own layout, so what
// travels is state (active/waiting, typing/reading, permission), never a
// position. A remote character takes a free seat here and walks, sits and
// animates with the same FSM as a local one.

import type { RemotePeer } from '../../../../core/src/messages.js';
import { REMOTE_AGENT_ID_BASE } from '../../constants.js';

/** Minimal structural view of OfficeState this reconciler needs. */
export interface RemoteAgentsOffice {
  addAgent: (
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
  ) => void;
  removeAgent: (id: number) => void;
  setRemote: (id: number, peerName: string) => void;
  setAgentActive: (id: number, active: boolean) => void;
  setAgentTool: (id: number, tool: string | null) => void;
  showPermissionBubble: (id: number) => void;
  clearPermissionBubble: (id: number) => void;
  showWaitingBubble: (id: number, awaitingInput?: boolean) => void;
}

/** A remote character as the overlay needs it. */
export interface RemoteCharacter {
  id: number;
  peerName: string;
  status: 'active' | 'waiting';
  activity: 'typing' | 'reading' | null;
  permission: boolean;
  awaitingInput: boolean;
}

export interface RemoteToolNames {
  /** A tool name the character FSM animates as reading, or null if none is known. */
  reading: string | null;
  /** Any tool name the FSM animates as typing. */
  typing: string;
}

/**
 * Stateful mapping from (peerId, remote agent id) to a local character id.
 * Remote ids are only unique within their peer, so the pair is the key; the
 * local id is allocated downward from REMOTE_AGENT_ID_BASE and never reused.
 */
export class RemoteAgentRegistry {
  private readonly ids = new Map<string, number>();
  private readonly current = new Map<number, RemoteCharacter>();
  private nextId = REMOTE_AGENT_ID_BASE;
  private pending: RemotePeer[] | null = null;

  /** Characters currently shown, in stable id order (newest last). */
  characters(): RemoteCharacter[] {
    return [...this.current.values()].sort((a, b) => b.id - a.id);
  }

  isRemote(id: number): boolean {
    return this.current.has(id);
  }

  /**
   * Apply a full snapshot. Before the layout exists there are no seats to take,
   * so the snapshot is held and applied by `flush` on the next layoutLoaded.
   * Returns true when the set of characters or their state changed.
   */
  reconcile(
    os: RemoteAgentsOffice,
    peers: RemotePeer[],
    layoutReady: boolean,
    paletteCount: number,
    tools: RemoteToolNames,
  ): boolean {
    if (!layoutReady) {
      this.pending = peers;
      return false;
    }
    this.pending = null;
    let changed = false;
    const seen = new Set<string>();

    for (const peer of peers) {
      for (const agent of peer.agents) {
        const key = `${peer.peerId}:${agent.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let id = this.ids.get(key);
        const prev = id !== undefined ? this.current.get(id) : undefined;
        if (id === undefined || !prev) {
          id = this.nextId--;
          this.ids.set(key, id);
          const palette = paletteCount > 0 ? Math.abs(agent.palette) % paletteCount : 0;
          os.addAgent(id, palette, agent.hueShift);
          os.setRemote(id, peer.name);
          changed = true;
        }

        const next: RemoteCharacter = {
          id,
          peerName: peer.name,
          status: agent.status === 'active' ? 'active' : 'waiting',
          activity:
            agent.activity === 'typing' || agent.activity === 'reading' ? agent.activity : null,
          permission: agent.permission === true,
          awaitingInput: agent.awaitingInput === true,
        };
        if (applyState(os, prev, next, tools)) changed = true;
        this.current.set(id, next);
      }
    }

    for (const [key, id] of this.ids) {
      if (seen.has(key)) continue;
      this.ids.delete(key);
      this.current.delete(id);
      os.removeAgent(id);
      changed = true;
    }
    return changed;
  }

  /** Apply a snapshot held back while the layout was loading. */
  flush(os: RemoteAgentsOffice, paletteCount: number, tools: RemoteToolNames): boolean {
    if (!this.pending) return false;
    return this.reconcile(os, this.pending, true, paletteCount, tools);
  }
}

/** Move one character from its previous state to the next. True if anything changed. */
function applyState(
  os: RemoteAgentsOffice,
  prev: RemoteCharacter | undefined,
  next: RemoteCharacter,
  tools: RemoteToolNames,
): boolean {
  let changed = false;
  const id = next.id;
  const wasActive = prev?.status === 'active';
  const isActive = next.status === 'active';

  if (!prev || wasActive !== isActive) {
    os.setAgentActive(id, isActive);
    // A finished turn gets the same checkmark a local agent gets.
    if (prev && wasActive && !isActive) os.showWaitingBubble(id, next.awaitingInput);
    changed = true;
  }
  if (!prev || prev.activity !== next.activity) {
    const tool =
      next.activity === 'reading'
        ? (tools.reading ?? tools.typing)
        : next.activity === 'typing'
          ? tools.typing
          : null;
    os.setAgentTool(id, tool);
    changed = true;
  }
  if ((prev?.permission ?? false) !== next.permission) {
    if (next.permission) os.showPermissionBubble(id);
    else os.clearPermissionBubble(id);
    changed = true;
  }
  if (prev && prev.awaitingInput !== next.awaitingInput) changed = true;
  return changed;
}
