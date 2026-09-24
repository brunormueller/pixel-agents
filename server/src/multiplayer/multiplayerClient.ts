import type { RawData } from 'ws';
import { WebSocket } from 'ws';

import type { AgentStateStore } from '../agentStateStore.js';
import {
  MULTIPLAYER_MAX_FRAME_BYTES,
  MULTIPLAYER_PROTOCOL_VERSION,
  MULTIPLAYER_PUBLISH_DEBOUNCE_MS,
  MULTIPLAYER_RECONNECT_MAX_MS,
  MULTIPLAYER_RECONNECT_MIN_MS,
} from '../constants.js';
import type { PeerSnapshot, RemoteActivity, RemoteAgentState } from './protocol.js';
import { parseRelayFrame, sanitizeName, sanitizeRoom } from './protocol.js';

export interface MultiplayerSettings {
  /** ws:// or wss:// URL of a `pixel-agents relay`. */
  relayUrl: string;
  /** Peers sharing a room see each other's agents. Treat it like a password. */
  room: string;
  /** Shown above this office's characters in everyone else's office. */
  displayName: string;
}

interface LocalAgentActivity {
  status: 'active' | 'waiting';
  awaitingInput: boolean;
  permission: boolean;
  /** Foreground tools in flight, in start order: toolId → toolName. */
  tools: Map<string, string>;
}

type WsSend = (message: Record<string, unknown>) => void;

/**
 * Publishes this office's agents to a multiplayer relay and turns the other
 * peers' agents into a `remotePeers` broadcast for the webview.
 *
 * It reads the same StoreEvents the transports read, so both surfaces get it by
 * constructing one against their store — no change to the runtime. What leaves
 * the machine is `RemoteAgentState`: palette, active/waiting, typing vs reading,
 * permission-pending. Tool arguments, status text and folder names never do.
 */
export class MultiplayerClient {
  private readonly local = new Map<number, LocalAgentActivity>();
  private readonly remote = new Map<string, PeerSnapshot>();
  private socket: WebSocket | null = null;
  private selfPeerId: string | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = MULTIPLAYER_RECONNECT_MIN_MS;
  private disposed = false;
  private lastPublished = '';
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: AgentStateStore,
    private readonly settings: MultiplayerSettings,
    private readonly readingTools: ReadonlySet<string>,
  ) {
    for (const id of store.keys()) this.trackAgent(id);

    const onAdded = (id: number) => {
      this.trackAgent(id);
      this.schedulePublish();
    };
    const onRemoved = (id: number) => {
      this.local.delete(id);
      this.schedulePublish();
    };
    const onBroadcast = (message: Record<string, unknown>) => {
      if (this.applyLocalBroadcast(message)) this.schedulePublish();
    };
    store.on('agentAdded', onAdded);
    store.on('agentRemoved', onRemoved);
    store.on('broadcast', onBroadcast);
    this.unsubscribe = () => {
      store.off('agentAdded', onAdded);
      store.off('agentRemoved', onRemoved);
      store.off('broadcast', onBroadcast);
    };
  }

  /** Open the relay connection (and keep reopening it until disposed). */
  start(): void {
    this.connect();
  }

  /** The current remote picture, for a webview that just (re)connected. */
  resend(send: WsSend): void {
    send(this.remotePeersMessage());
  }

  /** Snapshot of what this peer publishes. Exposed for tests. */
  localSnapshot(): RemoteAgentState[] {
    const out: RemoteAgentState[] = [];
    for (const [id, a] of this.local) {
      const agent = this.store.get(id);
      if (!agent) continue;
      const lastTool = [...a.tools.values()].pop();
      const activity: RemoteActivity | null =
        lastTool === undefined ? null : this.readingTools.has(lastTool) ? 'reading' : 'typing';
      out.push({
        id,
        palette: agent.palette ?? 0,
        hueShift: agent.hueShift ?? 0,
        status: a.status,
        activity: a.status === 'active' ? activity : null,
        permission: a.permission,
        awaitingInput: a.status === 'waiting' && a.awaitingInput,
      });
    }
    return out.sort((x, y) => x.id - y.id);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    if (this.publishTimer) clearTimeout(this.publishTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    if (this.remote.size > 0) {
      this.remote.clear();
      this.emitRemote();
    }
  }

  // ── Local side ──────────────────────────────────────────────

  private trackAgent(id: number): void {
    if (this.local.has(id)) return;
    // Seed from what the store already knows, so an agent restored or adopted
    // before this client existed doesn't read as idle until its next event.
    const agent = this.store.get(id);
    const tools = new Map<string, string>();
    for (const [toolId, toolName] of agent?.activeToolNames ?? []) {
      if (!agent?.backgroundAgentToolIds.has(toolId)) tools.set(toolId, toolName);
    }
    this.local.set(id, {
      status: agent && !agent.isWaiting && tools.size > 0 ? 'active' : 'waiting',
      awaitingInput: false,
      permission: agent?.permissionSent === true,
      tools,
    });
  }

  /** Fold one outgoing broadcast into the local summary. True if it changed anything we publish. */
  private applyLocalBroadcast(msg: Record<string, unknown>): boolean {
    const a = typeof msg.id === 'number' ? this.local.get(msg.id) : undefined;
    if (!a) return false;
    switch (msg.type) {
      case 'agentStatus':
        a.status = msg.status === 'active' ? 'active' : 'waiting';
        a.awaitingInput = msg.awaitingInput === true;
        if (a.status === 'active') a.permission = false;
        return true;
      case 'agentToolStart': {
        // Background spawns outlive the turn and don't describe what the agent
        // itself is doing right now.
        if (msg.runInBackground === true || typeof msg.toolId !== 'string') return false;
        a.tools.delete(msg.toolId);
        a.tools.set(msg.toolId, typeof msg.toolName === 'string' ? msg.toolName : '');
        a.status = 'active';
        if (msg.permissionActive === true) a.permission = true;
        return true;
      }
      case 'agentToolDone':
        return typeof msg.toolId === 'string' && a.tools.delete(msg.toolId);
      case 'agentToolsClear':
        a.tools.clear();
        a.permission = false;
        return true;
      case 'agentToolPermission':
        a.permission = true;
        return true;
      case 'agentToolPermissionClear':
        a.permission = false;
        return true;
      default:
        return false;
    }
  }

  private schedulePublish(): void {
    if (this.publishTimer || this.disposed) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.publish();
    }, MULTIPLAYER_PUBLISH_DEBOUNCE_MS);
  }

  private publish(force = false): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.selfPeerId) return;
    const frame = JSON.stringify({ t: 'state', agents: this.localSnapshot() });
    if (!force && frame === this.lastPublished) return;
    this.lastPublished = frame;
    socket.send(frame);
  }

  // ── Relay connection ────────────────────────────────────────

  private connect(): void {
    if (this.disposed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.settings.relayUrl, {
        maxPayload: MULTIPLAYER_MAX_FRAME_BYTES * 64,
      });
    } catch (err) {
      console.error(`[Pixel Agents] Multiplayer: invalid relay URL: ${err}`);
      return; // a malformed URL will not get better by retrying
    }
    this.socket = socket;

    socket.on('open', () => {
      this.reconnectDelay = MULTIPLAYER_RECONNECT_MIN_MS;
      socket.send(
        JSON.stringify({
          t: 'hello',
          v: MULTIPLAYER_PROTOCOL_VERSION,
          room: sanitizeRoom(this.settings.room),
          name: sanitizeName(this.settings.displayName),
        }),
      );
    });

    socket.on('message', (data: RawData) => {
      const frame = parseRelayFrame(data.toString());
      if (!frame) return;
      switch (frame.t) {
        case 'welcome':
          this.selfPeerId = frame.peerId;
          this.remote.clear();
          for (const peer of frame.peers) this.remote.set(peer.peerId, peer);
          this.emitRemote();
          console.log(
            `[Pixel Agents] Multiplayer: joined room with ${frame.peers.length} other peer(s)`,
          );
          this.publish(true);
          break;
        case 'peer':
          if (frame.peer.peerId === this.selfPeerId) break;
          this.remote.set(frame.peer.peerId, frame.peer);
          this.emitRemote();
          break;
        case 'leave':
          if (this.remote.delete(frame.peerId)) this.emitRemote();
          break;
        case 'error':
          console.warn(`[Pixel Agents] Multiplayer: relay refused: ${frame.reason}`);
          break;
      }
    });

    socket.on('error', (err) => {
      console.warn(`[Pixel Agents] Multiplayer: relay connection error: ${err.message}`);
    });

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null;
      this.selfPeerId = null;
      this.lastPublished = '';
      // Remote characters would otherwise freeze mid-animation while we're cut off.
      if (this.remote.size > 0) {
        this.remote.clear();
        this.emitRemote();
      }
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MULTIPLAYER_RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ── Webview side ────────────────────────────────────────────

  private remotePeersMessage(): Record<string, unknown> {
    return {
      type: 'remotePeers',
      peers: [...this.remote.values()].map((p) => ({
        peerId: p.peerId,
        name: p.name,
        agents: p.agents,
      })),
    };
  }

  private emitRemote(): void {
    this.store.broadcast(this.remotePeersMessage());
  }
}
