import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';

import {
  MULTIPLAYER_CLOSE_BAD_HELLO,
  MULTIPLAYER_CLOSE_ROOM_FULL,
  MULTIPLAYER_HEARTBEAT_MS,
  MULTIPLAYER_MAX_FRAME_BYTES,
  MULTIPLAYER_MAX_FRAMES_PER_SEC,
  MULTIPLAYER_MAX_PEERS_PER_ROOM,
  MULTIPLAYER_PROTOCOL_VERSION,
} from '../constants.js';
import type { PeerSnapshot, RelayFrame, RemoteAgentState } from './protocol.js';
import { parseClientFrame } from './protocol.js';

interface RelayPeer {
  peerId: string;
  name: string;
  agents: RemoteAgentState[];
  socket: WebSocket;
  alive: boolean;
  /** Rate limiting: frames seen in the current one-second window. */
  windowStart: number;
  windowFrames: number;
}

export interface RelayServerOptions {
  host?: string;
  /** 0 = OS-assigned. */
  port?: number;
  /** Log joins/leaves to the console. */
  verbose?: boolean;
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
});

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
 * a room name. It keeps only the last snapshot each connected peer published
 * (so a late joiner sees everyone at once) and forgets a peer the moment its
 * socket closes. Nothing is persisted.
 *
 * The room name is the only access control, so a shared room should use a long
 * random name. Run it behind TLS (wss://) when it is reachable beyond a LAN.
 */
export async function startRelayServer(opts: RelayServerOptions = {}): Promise<RelayServerHandle> {
  const rooms = new Map<string, Map<string, RelayPeer>>();
  const log = (msg: string) => {
    if (opts.verbose) console.log(`[Pixel Agents Relay] ${msg}`);
  };

  const broadcast = (room: string, frame: RelayFrame, exceptPeerId?: string) => {
    const peers = rooms.get(room);
    if (!peers) return;
    for (const p of peers.values()) {
      if (p.peerId !== exceptPeerId) send(p.socket, frame);
    }
  };

  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket, { options: { maxPayload: MULTIPLAYER_MAX_FRAME_BYTES } });

  app.get('/health', async () => ({
    ok: true,
    protocol: MULTIPLAYER_PROTOCOL_VERSION,
    rooms: rooms.size,
  }));

  app.get('/', { websocket: true }, (socket) => {
    let room: string | null = null;
    let peer: RelayPeer | null = null;

    socket.on('message', (data: Buffer | string) => {
      const frame = parseClientFrame(data.toString());
      if (!frame) return;

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
        const peers = rooms.get(frame.room) ?? new Map<string, RelayPeer>();
        if (peers.size >= MULTIPLAYER_MAX_PEERS_PER_ROOM) {
          send(socket, { t: 'error', reason: 'room is full' });
          socket.close(MULTIPLAYER_CLOSE_ROOM_FULL, 'room full');
          return;
        }
        room = frame.room;
        rooms.set(room, peers);
        peer = {
          peerId: crypto.randomUUID(),
          name: frame.name || 'Guest',
          agents: [],
          socket,
          alive: true,
          windowStart: Date.now(),
          windowFrames: 0,
        };
        send(socket, {
          t: 'welcome',
          peerId: peer.peerId,
          peers: [...peers.values()].map(snapshotOf),
        });
        peers.set(peer.peerId, peer);
        broadcast(room, { t: 'peer', peer: snapshotOf(peer) }, peer.peerId);
        log(`${peer.name} joined (${peers.size} in room)`);
        return;
      }

      if (frame.t !== 'state' || !room) return;
      const now = Date.now();
      if (now - peer.windowStart >= 1000) {
        peer.windowStart = now;
        peer.windowFrames = 0;
      }
      if (++peer.windowFrames > MULTIPLAYER_MAX_FRAMES_PER_SEC) return;
      peer.agents = frame.agents;
      broadcast(room, { t: 'peer', peer: snapshotOf(peer) }, peer.peerId);
    });

    socket.on('pong', () => {
      if (peer) peer.alive = true;
    });

    socket.on('close', () => {
      if (!peer || !room) return;
      const peers = rooms.get(room);
      peers?.delete(peer.peerId);
      if (peers && peers.size === 0) rooms.delete(room);
      broadcast(room, { t: 'leave', peerId: peer.peerId });
      log(`${peer.name} left`);
    });
  });

  // Drop peers whose connection went silent (sleeping laptop, dead NAT entry)
  // so their characters don't linger in everyone else's office.
  const heartbeat = setInterval(() => {
    for (const peers of rooms.values()) {
      for (const p of peers.values()) {
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
    roomSizes: () => Object.fromEntries([...rooms].map(([name, peers]) => [name, peers.size])),
    close: async () => {
      clearInterval(heartbeat);
      await app.close();
    },
  };
}
