import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';

import {
  MULTIPLAYER_CHAT_WINDOW_MS,
  MULTIPLAYER_CLOSE_BAD_HELLO,
  MULTIPLAYER_CLOSE_ROOM_FULL,
  MULTIPLAYER_HEARTBEAT_MS,
  MULTIPLAYER_LAYOUT_WINDOW_MS,
  MULTIPLAYER_MAX_CHATS_PER_WINDOW,
  MULTIPLAYER_MAX_FRAME_BYTES,
  MULTIPLAYER_MAX_FRAMES_PER_SEC,
  MULTIPLAYER_MAX_LAYOUT_BYTES,
  MULTIPLAYER_MAX_LAYOUTS_PER_WINDOW,
  MULTIPLAYER_MAX_MEET_EVENTS_PER_WINDOW,
  MULTIPLAYER_MAX_MEET_FRAME_BYTES,
  MULTIPLAYER_MAX_PEERS_PER_ROOM,
  MULTIPLAYER_MAX_PLAY_FRAME_BYTES,
  MULTIPLAYER_MAX_PLAY_FRAMES_PER_WINDOW,
  MULTIPLAYER_MAX_SIGNAL_BYTES,
  MULTIPLAYER_MAX_SIGNALS_PER_WINDOW,
  MULTIPLAYER_MEET_WINDOW_MS,
  MULTIPLAYER_PLAY_WINDOW_MS,
  MULTIPLAYER_PROTOCOL_VERSION,
  MULTIPLAYER_SIGNAL_WINDOW_MS,
} from '../constants.js';
import type {
  ClientFrame,
  GamePresence,
  IceServer,
  MeetingPresence,
  PeerProfile,
  PeerSnapshot,
  RelayFrame,
  RemoteAgentState,
  SharedLayout,
} from './protocol.js';
import { parseClientFrame, sanitizeIceServers } from './protocol.js';
import { RoomLayoutStore } from './roomLayoutStore.js';

interface RelayPeer {
  peerId: string;
  name: string;
  agents: RemoteAgentState[];
  desk: string | null;
  since: number;
  profile?: PeerProfile;
  /** The meeting this peer's person is in (from its last state frame). */
  meeting?: MeetingPresence;
  /** The match this peer's person plays (from its last state frame). */
  game?: GamePresence;
  socket: WebSocket;
  alive: boolean;
  /** Rate limiting: frames seen in the current one-second window. */
  windowStart: number;
  windowFrames: number;
  /** Chat rate limiting: a slower, separate window — a chatty person must not starve state frames. */
  chatWindowStart: number;
  chatWindowCount: number;
  /** WebRTC signals and meeting events: their own windows, for the same reason. */
  signalWindowStart: number;
  signalWindowCount: number;
  meetWindowStart: number;
  meetWindowCount: number;
  layoutWindowStart: number;
  layoutWindowCount: number;
  playWindowStart: number;
  playWindowCount: number;
}

interface RelayRoom {
  peers: Map<string, RelayPeer>;
  /** The room's shared map as last edited, by anyone in the room. Gone with the
   *  room unless the relay keeps maps on disk (`roomsDir`). */
  layout: SharedLayout | null;
  /** Revision of `layout`: every accepted edit bumps it; 0 = no map yet. */
  rev: number;
  /** The peer that created the room while it had no map: it seeds the map. An
   *  office too old to send revisions is heard only when it is this peer. */
  layoutOwner: string | null;
}

export interface RelayServerOptions {
  host?: string;
  /** 0 = OS-assigned. */
  port?: number;
  /** Log joins/leaves to the console. */
  verbose?: boolean;
  /** STUN/TURN servers handed to every peer for meeting media (a TURN server
   *  gets calls through networks where browsers cannot reach each other). */
  iceServers?: IceServer[];
  /** Keep room maps in this folder, so a room keeps its map after everyone left
   *  and across restarts. Absent = memory only. */
  roomsDir?: string;
}

export interface RelayServerHandle {
  app: FastifyInstance;
  port: number;
  /** Peers per room, for tests and diagnostics. */
  roomSizes(): Record<string, number>;
  close(): Promise<void>;
}

const snapshotOf = (p: RelayPeer): PeerSnapshot => ({
  peerId: p.peerId,
  name: p.name,
  agents: p.agents,
  desk: p.desk,
  since: p.since,
  ...(p.profile ? { profile: p.profile } : {}),
  ...(p.meeting ? { meeting: p.meeting } : {}),
  ...(p.game ? { game: p.game } : {}),
});

/** Largest accepted frame of each kind: layouts and SDP offers are the big ones. */
function frameLimit(frame: ClientFrame): number {
  if (frame.t === 'layout') return MULTIPLAYER_MAX_LAYOUT_BYTES;
  if (frame.t === 'signal') return MULTIPLAYER_MAX_SIGNAL_BYTES;
  if (frame.t === 'meet') return MULTIPLAYER_MAX_MEET_FRAME_BYTES;
  if (frame.t === 'play') return MULTIPLAYER_MAX_PLAY_FRAME_BYTES;
  return MULTIPLAYER_MAX_FRAME_BYTES;
}

/** Sliding-window rate limit shared by the per-kind counters: true = over the limit. */
function overLimit(
  peer: RelayPeer,
  kind: 'chat' | 'signal' | 'meet' | 'layout' | 'play',
  now: number,
  windowMs: number,
  max: number,
): boolean {
  const startKey = `${kind}WindowStart` as const;
  const countKey = `${kind}WindowCount` as const;
  if (now - peer[startKey] >= windowMs) {
    peer[startKey] = now;
    peer[countKey] = 0;
  }
  return ++peer[countKey] > max;
}

function send(socket: WebSocket, frame: RelayFrame): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(frame));
  } catch {
    /* socket died between the check and the write */
  }
}

/**
 * The multiplayer relay: a stateless-by-design fan-out between peers that share
 * a room name. It keeps, in memory only, the last snapshot each connected peer
 * published (so a late joiner sees everyone at once), and forgets it the moment
 * nobody is left. The one exception is the room's map: anyone in the room may
 * edit it (optimistic revisions: an edit made on an older revision is refused
 * and the office merges and retries), and with `roomsDir` it is kept on disk.
 *
 * The room name is the only access control, so a shared room should use a long
 * random name. Run it behind TLS (wss://) when it is reachable beyond a LAN.
 *
 * Meetings pass through only as signaling: a `signal` goes to the one peer it
 * names, a `meet` event to the peers whose last state names the sender's
 * meeting. Audio and video never touch the relay. Games pass through the same
 * way: a `play` frame goes to the other peers whose last state names the
 * sender's match.
 */
export async function startRelayServer(opts: RelayServerOptions = {}): Promise<RelayServerHandle> {
  const rooms = new Map<string, RelayRoom>();
  const iceServers = sanitizeIceServers(opts.iceServers);
  const savedLayouts = opts.roomsDir ? new RoomLayoutStore(opts.roomsDir) : null;
  const log = (msg: string) => {
    if (opts.verbose) console.log(`[Pixel Agents Relay] ${msg}`);
  };

  const broadcast = (room: RelayRoom, frame: RelayFrame, exceptPeerId?: string) => {
    for (const p of room.peers.values()) {
      if (p.peerId !== exceptPeerId) send(p.socket, frame);
    }
  };

  const app = Fastify({ logger: false });
  // The socket cap fits a layout; every other frame is held to the small cap below.
  await app.register(fastifyWebsocket, { options: { maxPayload: MULTIPLAYER_MAX_LAYOUT_BYTES } });

  app.get('/health', async () => ({
    ok: true,
    protocol: MULTIPLAYER_PROTOCOL_VERSION,
    rooms: rooms.size,
  }));

  app.get('/', { websocket: true }, (socket) => {
    let roomName: string | null = null;
    let room: RelayRoom | null = null;
    let peer: RelayPeer | null = null;

    socket.on('message', (data: Buffer | string) => {
      const text = data.toString();
      const frame = parseClientFrame(text);
      if (!frame) return;
      if (Buffer.byteLength(text) > frameLimit(frame)) return;

      if (!peer) {
        // The first frame must be a valid hello; anything else ends the connection.
        if (frame.t !== 'hello' || frame.v !== MULTIPLAYER_PROTOCOL_VERSION || !frame.room) {
          send(socket, {
            t: 'error',
            reason: 'expected hello with a room and a supported version',
          });
          socket.close(MULTIPLAYER_CLOSE_BAD_HELLO, 'bad hello');
          return;
        }
        const existing = rooms.get(frame.room);
        if (existing && existing.peers.size >= MULTIPLAYER_MAX_PEERS_PER_ROOM) {
          send(socket, { t: 'error', reason: 'room is full' });
          socket.close(MULTIPLAYER_CLOSE_ROOM_FULL, 'room full');
          return;
        }
        const now = Date.now();
        peer = {
          peerId: crypto.randomUUID(),
          name: frame.name || 'Guest',
          agents: [],
          desk: null,
          since: now,
          socket,
          alive: true,
          windowStart: now,
          windowFrames: 0,
          chatWindowStart: now,
          chatWindowCount: 0,
          signalWindowStart: now,
          signalWindowCount: 0,
          meetWindowStart: now,
          meetWindowCount: 0,
          layoutWindowStart: now,
          layoutWindowCount: 0,
          playWindowStart: now,
          playWindowCount: 0,
        };
        if (existing) {
          room = existing;
        } else {
          const saved = savedLayouts?.load(frame.room) ?? null;
          room = {
            peers: new Map(),
            layout: saved?.layout ?? null,
            rev: saved?.rev ?? 0,
            layoutOwner: null,
          };
        }
        // A room with no map takes the first joiner's.
        if (!room.layout && !room.layoutOwner) room.layoutOwner = peer.peerId;
        roomName = frame.room;
        rooms.set(roomName, room);
        send(socket, {
          t: 'welcome',
          peerId: peer.peerId,
          since: peer.since,
          peers: [...room.peers.values()].map(snapshotOf),
          layout: room.layout,
          layoutOwner: room.layoutOwner === peer.peerId,
          rev: room.rev,
          ...(iceServers.length > 0 ? { iceServers } : {}),
        });
        room.peers.set(peer.peerId, peer);
        broadcast(room, { t: 'peer', peer: snapshotOf(peer) }, peer.peerId);
        log(`${peer.name} joined (${room.peers.size} in room)`);
        return;
      }

      if (!room) return;
      const now = Date.now();

      if (frame.t === 'chat') {
        if (
          overLimit(peer, 'chat', now, MULTIPLAYER_CHAT_WINDOW_MS, MULTIPLAYER_MAX_CHATS_PER_WINDOW)
        ) {
          send(socket, { t: 'error', reason: 'chat rate limit: message dropped' });
          return;
        }
        // No exceptPeerId: the sender gets its own message back as the delivery receipt.
        broadcast(room, {
          t: 'chat',
          peerId: peer.peerId,
          name: peer.name,
          text: frame.text,
          ts: now,
        });
        return;
      }

      if (frame.t === 'signal') {
        // One peer, same room — the receiver ignores signals from outside its call.
        const target = room.peers.get(frame.to);
        if (!target || target === peer) return;
        if (
          overLimit(
            peer,
            'signal',
            now,
            MULTIPLAYER_SIGNAL_WINDOW_MS,
            MULTIPLAYER_MAX_SIGNALS_PER_WINDOW,
          )
        ) {
          return;
        }
        send(target.socket, { t: 'signal', from: peer.peerId, data: frame.data });
        return;
      }

      if (frame.t === 'meet') {
        const meeting = peer.meeting;
        if (!meeting) return; // speaking in a meeting you are not in
        if (
          overLimit(
            peer,
            'meet',
            now,
            MULTIPLAYER_MEET_WINDOW_MS,
            MULTIPLAYER_MAX_MEET_EVENTS_PER_WINDOW,
          )
        ) {
          send(socket, { t: 'error', reason: 'meeting rate limit: event dropped' });
          return;
        }
        const out: RelayFrame = {
          t: 'meet',
          from: peer.peerId,
          name: peer.name,
          meetingId: meeting.id,
          ev: frame.ev,
          ts: now,
        };
        // The sender included: its echo is the delivery receipt, like chat.
        for (const p of room.peers.values()) {
          if (p.meeting?.id === meeting.id) send(p.socket, out);
        }
        return;
      }

      if (frame.t === 'play') {
        const game = peer.game;
        if (!game) return; // playing in a match you are not in
        if (
          overLimit(
            peer,
            'play',
            now,
            MULTIPLAYER_PLAY_WINDOW_MS,
            MULTIPLAYER_MAX_PLAY_FRAMES_PER_WINDOW,
          )
        ) {
          return;
        }
        const out: RelayFrame = { t: 'play', from: peer.peerId, gameId: game.id, ev: frame.ev };
        // Not back to the sender: it already applied its own frame.
        for (const p of room.peers.values()) {
          if (p !== peer && p.game?.id === game.id) send(p.socket, out);
        }
        return;
      }

      if (frame.t === 'layout') {
        const refuse = (reason: 'stale' | 'busy') => {
          if (frame.id) send(socket, { t: 'layoutReject', id: frame.id, rev: room!.rev, reason });
        };
        if (frame.base === undefined) {
          // An office from before shared editing knows no revisions: only the
          // room's creator is heard, as before.
          if (room.layoutOwner !== peer.peerId) return;
        } else if (frame.base !== room.rev) {
          // Made on a map that has moved on: the office merges the newer map in and retries.
          return refuse('stale');
        }
        if (
          overLimit(
            peer,
            'layout',
            now,
            MULTIPLAYER_LAYOUT_WINDOW_MS,
            MULTIPLAYER_MAX_LAYOUTS_PER_WINDOW,
          )
        ) {
          return refuse('busy');
        }
        room.rev += 1;
        room.layout = frame.layout;
        if (roomName) savedLayouts?.save(roomName, { rev: room.rev, layout: frame.layout });
        // No exceptPeerId: the echo (with the editor's id) is its receipt.
        broadcast(room, {
          t: 'layout',
          layout: frame.layout,
          rev: room.rev,
          ...(frame.id ? { id: frame.id } : {}),
        });
        return;
      }

      if (frame.t !== 'state') return;
      if (now - peer.windowStart >= 1000) {
        peer.windowStart = now;
        peer.windowFrames = 0;
      }
      if (++peer.windowFrames > MULTIPLAYER_MAX_FRAMES_PER_SEC) return;
      peer.agents = frame.agents;
      peer.desk = frame.desk;
      peer.profile = frame.profile;
      peer.meeting = frame.meeting;
      peer.game = frame.game;
      broadcast(room, { t: 'peer', peer: snapshotOf(peer) }, peer.peerId);
    });

    socket.on('pong', () => {
      if (peer) peer.alive = true;
    });

    socket.on('close', () => {
      if (!peer || !room || !roomName) return;
      room.peers.delete(peer.peerId);
      // The map stays as it is; everyone left may still edit it.
      if (room.layoutOwner === peer.peerId) room.layoutOwner = null;
      if (room.peers.size === 0) rooms.delete(roomName);
      broadcast(room, { t: 'leave', peerId: peer.peerId });
      log(`${peer.name} left`);
    });
  });

  // Drop peers whose connection went silent (sleeping laptop, dead NAT entry)
  // so their characters don't linger in everyone else's office.
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const p of room.peers.values()) {
        if (!p.alive) {
          p.socket.terminate();
          continue;
        }
        p.alive = false;
        try {
          p.socket.ping();
        } catch {
          /* closing */
        }
      }
    }
  }, MULTIPLAYER_HEARTBEAT_MS);
  heartbeat.unref();

  await app.listen({ host: opts.host ?? '127.0.0.1', port: opts.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : (opts.port ?? 0);

  return {
    app,
    port,
    roomSizes: () => Object.fromEntries([...rooms].map(([name, room]) => [name, room.peers.size])),
    close: async () => {
      clearInterval(heartbeat);
      await app.close();
      savedLayouts?.flush();
    },
  };
}
