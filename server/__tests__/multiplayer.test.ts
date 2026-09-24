import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { AgentStateStore } from '../src/agentStateStore.js';
import { parseMultiplayer } from '../src/configPersistence.js';
import { MULTIPLAYER_MAX_AGENTS_PER_PEER, MULTIPLAYER_PROTOCOL_VERSION } from '../src/constants.js';
import { MultiplayerClient } from '../src/multiplayer/multiplayerClient.js';
import { parseClientFrame, parseRelayFrame, sanitizeName } from '../src/multiplayer/protocol.js';
import type { RelayServerHandle } from '../src/multiplayer/relayServer.js';
import { startRelayServer } from '../src/multiplayer/relayServer.js';
import type { AgentState } from '../src/types.js';

const READING = new Set(['Read', 'Grep']);

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 0,
    sessionId: 'test-session',
    isExternal: false,
    projectDir: '/test',
    jsonlFile: '/test/session.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    contextTokens: 0,
    maxContextTokens: 200_000,
    palette: 2,
    hueShift: 90,
    ...overrides,
  } as AgentState;
}

/** Resolve once `predicate` holds, polling — relay traffic is async and debounced. */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The latest remotePeers broadcast a store emitted. */
function captureRemotePeers(store: AgentStateStore): { latest: () => any } {
  let latest: any = null;
  store.on('broadcast', (msg) => {
    if (msg.type === 'remotePeers') latest = msg;
  });
  return { latest: () => latest };
}

describe('multiplayer protocol', () => {
  it('sanitizes agent lists: drops malformed and duplicate entries, clamps fields', () => {
    const frame = parseClientFrame(
      JSON.stringify({
        t: 'state',
        agents: [
          {
            id: 1,
            palette: 3,
            hueShift: 45,
            status: 'active',
            activity: 'reading',
            permission: true,
          },
          { id: 1, palette: 0, hueShift: 0, status: 'active' },
          { id: 'x' },
          {
            id: 2,
            palette: -5,
            hueShift: 9999,
            status: 'bogus',
            activity: 'hacking',
            toolName: 'rm -rf',
          },
        ],
      }),
    );
    expect(frame).toEqual({
      t: 'state',
      agents: [
        {
          id: 1,
          palette: 3,
          hueShift: 45,
          status: 'active',
          activity: 'reading',
          permission: true,
          awaitingInput: false,
        },
        {
          id: 2,
          palette: 0,
          hueShift: 0,
          status: 'waiting',
          activity: null,
          permission: false,
          awaitingInput: false,
        },
      ],
    });
  });

  it('caps the agents a peer can publish', () => {
    const agents = Array.from({ length: MULTIPLAYER_MAX_AGENTS_PER_PEER + 10 }, (_, id) => ({
      id,
    }));
    const frame = parseClientFrame(JSON.stringify({ t: 'state', agents }));
    expect(frame?.t === 'state' && frame.agents.length).toBe(MULTIPLAYER_MAX_AGENTS_PER_PEER);
  });

  it('strips control and bidi-override characters from names and caps their length', () => {
    expect(sanitizeName('  Ana‮\u0007 ')).toBe('Ana');
    expect(sanitizeName('x'.repeat(100))).toHaveLength(32);
    expect(sanitizeName(42)).toBe('');
  });

  it('rejects malformed frames', () => {
    expect(parseClientFrame('not json')).toBeNull();
    expect(parseClientFrame(JSON.stringify({ t: 'hello', room: 'r' }))).toBeNull();
    expect(parseRelayFrame(JSON.stringify({ t: 'peer', peer: { name: 'no id' } }))).toBeNull();
    expect(parseRelayFrame(JSON.stringify([1, 2]))).toBeNull();
  });
});

describe('parseMultiplayer (multiplayer.json)', () => {
  it('accepts a complete block and defaults the name', () => {
    expect(parseMultiplayer({ relayUrl: 'wss://relay.example', room: 'r' })).toEqual({
      relayUrl: 'wss://relay.example',
      room: 'r',
      displayName: 'Guest',
    });
  });

  it('reads anything else as multiplayer off', () => {
    expect(parseMultiplayer(undefined)).toBeUndefined();
    expect(parseMultiplayer({ relayUrl: 'http://relay.example', room: 'r' })).toBeUndefined();
    expect(parseMultiplayer({ relayUrl: 'ws://relay.example', room: '  ' })).toBeUndefined();
    expect(parseMultiplayer(['ws://x', 'r'])).toBeUndefined();
  });
});

describe('relay + MultiplayerClient', () => {
  let relay: RelayServerHandle | null = null;
  const clients: MultiplayerClient[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.dispose();
    for (const s of sockets.splice(0)) s.close();
    await relay?.close();
    relay = null;
  });

  async function startPeer(name: string, room = 'room-a') {
    const store = new AgentStateStore();
    const remote = captureRemotePeers(store);
    const client = new MultiplayerClient(
      store,
      { relayUrl: `ws://127.0.0.1:${relay!.port}/`, room, displayName: name },
      READING,
    );
    clients.push(client);
    client.start();
    return { store, remote, client };
  }

  it('relays one office’s agent activity to another office in the same room', async () => {
    relay = await startRelayServer();
    const alice = await startPeer('Alice');
    const bob = await startPeer('Bob');
    await waitFor(() => relay!.roomSizes()['room-a'] === 2);

    alice.store.set(7, createTestAgent({ id: 7 }));
    alice.store.broadcast({
      type: 'agentToolStart',
      id: 7,
      toolId: 't1',
      toolName: 'Read',
      status: 'Reading secret.ts',
    });

    await waitFor(() => bob.remote.latest()?.peers[0]?.agents[0]?.activity === 'reading');
    const peer = bob.remote.latest().peers[0];
    expect(peer.name).toBe('Alice');
    expect(peer.agents[0]).toEqual({
      id: 7,
      palette: 2,
      hueShift: 90,
      status: 'active',
      activity: 'reading',
      permission: false,
      awaitingInput: false,
    });
    // The status text (file names, commands) never leaves the machine.
    expect(JSON.stringify(bob.remote.latest())).not.toContain('secret');

    alice.store.broadcast({ type: 'agentToolDone', id: 7, toolId: 't1' });
    alice.store.broadcast({ type: 'agentToolPermission', id: 7 });
    alice.store.broadcast({ type: 'agentStatus', id: 7, status: 'waiting', awaitingInput: true });
    await waitFor(() => bob.remote.latest()?.peers[0]?.agents[0]?.status === 'waiting');
    expect(bob.remote.latest().peers[0].agents[0]).toMatchObject({
      activity: null,
      permission: true,
      awaitingInput: true,
    });

    alice.store.delete(7);
    await waitFor(() => bob.remote.latest()?.peers[0]?.agents.length === 0);
  });

  it('gives a late joiner everyone already in the room', async () => {
    relay = await startRelayServer();
    const alice = await startPeer('Alice');
    alice.store.set(1, createTestAgent({ id: 1 }));
    await waitFor(() => relay!.roomSizes()['room-a'] === 1);

    const bob = await startPeer('Bob');
    await waitFor(() => bob.remote.latest()?.peers[0]?.agents.length === 1);
    expect(bob.remote.latest().peers[0].name).toBe('Alice');
  });

  it('keeps rooms apart', async () => {
    relay = await startRelayServer();
    const alice = await startPeer('Alice', 'room-a');
    const carol = await startPeer('Carol', 'room-b');
    await waitFor(() => relay!.roomSizes()['room-a'] === 1 && relay!.roomSizes()['room-b'] === 1);
    alice.store.set(1, createTestAgent({ id: 1 }));
    await new Promise((r) => setTimeout(r, 300));
    expect(carol.remote.latest()?.peers ?? []).toEqual([]);
  });

  it('removes a peer’s characters when it disconnects', async () => {
    relay = await startRelayServer();
    const alice = await startPeer('Alice');
    const bob = await startPeer('Bob');
    alice.store.set(1, createTestAgent({ id: 1 }));
    await waitFor(() => bob.remote.latest()?.peers.length === 1);

    alice.client.dispose();
    await waitFor(() => bob.remote.latest()?.peers.length === 0);
  });

  it('seeds an agent that existed before the client started', async () => {
    relay = await startRelayServer();
    const store = new AgentStateStore();
    store.set(
      3,
      createTestAgent({
        id: 3,
        activeToolNames: new Map([
          ['t1', 'Bash'],
          ['bg', 'Agent'],
        ]),
        backgroundAgentToolIds: new Set(['bg']),
      }),
    );
    const client = new MultiplayerClient(
      store,
      { relayUrl: 'ws://127.0.0.1:1/', room: 'r', displayName: 'x' },
      READING,
    );
    clients.push(client);
    expect(client.localSnapshot()).toEqual([
      expect.objectContaining({ id: 3, status: 'active', activity: 'typing' }),
    ]);
  });

  it('closes a connection whose first frame is not a valid hello', async () => {
    relay = await startRelayServer();
    const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/`);
    sockets.push(ws);
    await new Promise((r) => ws.once('open', r));
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)));
    ws.send(
      JSON.stringify({ t: 'hello', v: MULTIPLAYER_PROTOCOL_VERSION + 1, room: 'r', name: 'x' }),
    );
    expect(await closed).toBe(4400);
    expect(relay.roomSizes()).toEqual({});
  });

  it('does not echo a peer’s own state back to it', async () => {
    relay = await startRelayServer();
    const alice = await startPeer('Alice');
    alice.store.set(1, createTestAgent({ id: 1 }));
    await waitFor(() => relay!.roomSizes()['room-a'] === 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(alice.remote.latest()?.peers ?? []).toEqual([]);
  });
});
