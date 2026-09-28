// webview-ui/src/office/engine/remoteAgents.ts
//
// Multiplayer: turns `remotePeers` snapshots (other offices' agents, relayed by
// the server) into characters in THIS office. Pure and structural like
// existingAgents.ts so it is unit-testable without React.
//
// Two modes, picked per agent by whether it carries a `pose`:
// - own layouts (no pose): what travels is state (active/waiting, typing/reading,
//   permission). A remote character takes a free seat here and walks, sits and
//   animates with the same FSM as a local one.
// - shared room map (pose): every office renders the same layout, so the owning
//   office's position is authoritative; the character follows it, holds none of
//   our seats, and the desk its office claimed is kept free for it.

import type {
  DeskDecorItem,
  PeerProfile,
  RemotePeer,
  RemotePose,
} from '../../../../core/src/messages.js';
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
  setRemote: (id: number, peerName: string, peerId?: string) => void;
  setAgentActive: (id: number, active: boolean) => void;
  setAgentTool: (id: number, tool: string | null) => void;
  showPermissionBubble: (id: number) => void;
  clearPermissionBubble: (id: number) => void;
  showWaitingBubble: (id: number, awaitingInput?: boolean) => void;
  /** Shared room map only (optional so a state-only office fake needs none of it). */
  setRemotePose?: (
    id: number,
    pose: RemotePose,
    readingTool: string | null,
    typingTool: string,
  ) => void;
  setRemoteAvatar?: (id: number, isAvatar: boolean) => void;
  setExternalSeatClaims?: (desks: Iterable<string>) => void;
  /** The person's profile (look, status, song) on their character. */
  setRemoteProfile?: (id: number, profile: PeerProfile | undefined) => void;
  setRemoteDecor?: (
    list: Array<{
      desk: string | null | undefined;
      items: DeskDecorItem[] | undefined;
      deskStyle?: string | null;
      hidden?: string[];
    }>,
  ) => void;
}

/** A remote character as the overlay needs it. */
export interface RemoteCharacter {
  id: number;
  /** The office it belongs to — chat bubbles land on that office's characters. */
  peerId: string;
  peerName: string;
  status: 'active' | 'waiting';
  activity: 'typing' | 'reading' | null;
  permission: boolean;
  awaitingInput: boolean;
  /** The office's person (its first agent, or the person alone). */
  isAvatar: boolean;
  /** Avatars only: what the person shows about themselves. */
  profile?: PeerProfile;
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

  /** The character that speaks for an office: its person, else its oldest
   *  character, or null when it shows none. */
  speakerOf(peerId: string): number | null {
    let best: number | null = null;
    for (const c of this.current.values()) {
      if (c.peerId !== peerId) continue;
      if (c.isAvatar) return c.id;
      if (best === null || c.id > best) best = c.id;
    }
    return best;
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
        // The person keeps one character while agents come and go under it (its
        // id is 0 alone, then the driving agent's): key it by office, not by id.
        const key = agent.isAvatar ? `${peer.peerId}:avatar` : `${peer.peerId}:${agent.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        let id = this.ids.get(key);
        const prev = id !== undefined ? this.current.get(id) : undefined;
        if (id === undefined || !prev) {
          id = this.nextId--;
          this.ids.set(key, id);
          const palette = paletteCount > 0 ? Math.abs(agent.palette) % paletteCount : 0;
          os.addAgent(id, palette, agent.hueShift);
          os.setRemote(id, peer.name, peer.peerId);
          changed = true;
        }

        const next: RemoteCharacter = {
          id,
          peerId: peer.peerId,
          peerName: peer.name,
          status: agent.status === 'active' ? 'active' : 'waiting',
          activity:
            agent.activity === 'typing' || agent.activity === 'reading' ? agent.activity : null,
          permission: agent.permission === true,
          awaitingInput: agent.awaitingInput === true,
          isAvatar: agent.isAvatar === true,
        };
        if (next.isAvatar && peer.profile) next.profile = peer.profile;
        if (applyState(os, prev, next, tools)) changed = true;
        if (prev?.isAvatar !== next.isAvatar) {
          os.setRemoteAvatar?.(id, next.isAvatar);
          changed = true;
        }
        if (JSON.stringify(prev?.profile) !== JSON.stringify(next.profile)) {
          os.setRemoteProfile?.(id, next.profile);
          changed = true;
        }
        if (agent.pose) os.setRemotePose?.(id, agent.pose, tools.reading, tools.typing);
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
    // Desks the other offices claimed on the shared map stay free for them.
    const desks: string[] = [];
    for (const peer of peers) if (peer.desk) desks.push(peer.desk);
    os.setExternalSeatClaims?.(desks);
    // Their desk decoration, around those desks.
    os.setRemoteDecor?.(
      peers.map((p) => ({
        desk: p.desk,
        items: p.profile?.decor,
        deskStyle: p.profile?.deskStyle ?? null,
        hidden: p.profile?.hidden,
      })),
    );
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
