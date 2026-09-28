import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';

import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { defaultRelayUrl, parseMultiplayer } from '../src/configPersistence.js';
import {
  MULTIPLAYER_MAX_AGENTS_PER_PEER,
  MULTIPLAYER_MAX_CHAT_LENGTH,
  MULTIPLAYER_MAX_CHATS_PER_WINDOW,
  MULTIPLAYER_PROTOCOL_VERSION,
} from '../src/constants.js';
import { MultiplayerClient } from '../src/multiplayer/multiplayerClient.js';
import {
  parseClientFrame,
  parseRelayFrame,
  sanitizeLayout,
  sanitizeName,
  sanitizePose,
  sanitizeRelayUrl,
} from '../src/multiplayer/protocol.js';
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

/** Every chatMessage broadcast a store emitted, in order. */
function captureChat(store: AgentStateStore): Array<Record<string, any>> {
  const lines: Array<Record<string, any>> = [];
  store.on('broadcast', (msg) => {
    if (msg.type === 'chatMessage') lines.push(msg.message as Record<string, any>);
  });
  return lines;
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
      desk: null,
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

  it('sanitizes chat text and drops empty messages', () => {
    expect(parseClientFrame(JSON.stringify({ t: 'chat', text: '  oi‮ pessoal  ' }))).toEqual({
      t: 'chat',
      text: 'oi pessoal',
    });
    expect(parseClientFrame(JSON.stringify({ t: 'chat', text: '   ' }))).toBeNull();
    expect(parseClientFrame(JSON.stringify({ t: 'chat', text: 42 }))).toBeNull();
    const long = parseClientFrame(JSON.stringify({ t: 'chat', text: 'x'.repeat(1000) }));
    expect(long).toEqual({ t: 'chat', text: 'x'.repeat(MULTIPLAYER_MAX_CHAT_LENGTH) });
    // A relay is not trusted either.
    expect(
      parseRelayFrame(
        JSON.stringify({ t: 'chat', peerId: 'p', name: '‮Eve', text: 'hi', ts: 'x' }),
      ),
    ).toMatchObject({ t: 'chat', peerId: 'p', name: 'Eve', text: 'hi', ts: expect.any(Number) });
    expect(parseRelayFrame(JSON.stringify({ t: 'chat', peerId: '', text: 'hi' }))).toBeNull();
  });

  it('rejects malformed frames', () => {
    expect(parseClientFrame('not json')).toBeNull();
    expect(parseClientFrame(JSON.stringify({ t: 'hello', room: 'r' }))).toBeNull();
    expect(parseRelayFrame(JSON.stringify({ t: 'peer', peer: { name: 'no id' } }))).toBeNull();
    expect(parseRelayFrame(JSON.stringify([1, 2]))).toBeNull();
  });
});

describe('parseMultiplayer (multiplayer.json)', () => {
  it('needs only the relay: room and name just prefill the join screen', () => {
    expect(parseMultiplayer({ relayUrl: 'wss://relay.example', room: 'r' })).toEqual({
      relayUrl: 'wss://relay.example',
      room: 'r',
      displayName: undefined,
    });
    expect(parseMultiplayer({ relayUrl: 'ws://relay.example', room: '  ' })).toEqual({
      relayUrl: 'ws://relay.example',
      room: undefined,
      displayName: undefined,
    });
  });

  it('reads anything else as multiplayer off', () => {
    expect(parseMultiplayer(undefined)).toBeUndefined();
    expect(parseMultiplayer({ relayUrl: 'http://relay.example', room: 'r' })).toBeUndefined();
    expect(parseMultiplayer({ room: 'r' })).toBeUndefined();
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

  it('fans a chat message out to the whole room, the sender included', async () => {
    relay = await startRelayServer();
    const alice = await startPeer('Alice');
    const bob = await startPeer('Bob');
    const carol = await startPeer('Carol', 'room-b');
    const aliceChat = captureChat(alice.store);
    const bobChat = captureChat(bob.store);
    const carolChat = captureChat(carol.store);
    await waitFor(() => relay!.roomSizes()['room-a'] === 2 && relay!.roomSizes()['room-b'] === 1);

    expect(alice.client.sendChat('bora jogar ping pong?')).toBe(true);
    await waitFor(() => aliceChat.length === 1 && bobChat.length === 1);
    expect(bobChat[0]).toMatchObject({ name: 'Alice', text: 'bora jogar ping pong?', self: false });
    expect(aliceChat[0]).toMatchObject({
      name: 'Alice',
      text: 'bora jogar ping pong?',
      self: true,
    });
    expect(aliceChat[0].peerId).toBe(bobChat[0].peerId);
    // The sender's peerId is the one Bob sees on Alice's characters.
    expect(bob.remote.latest().peers[0].peerId).toBe(bobChat[0].peerId);

    await new Promise((r) => setTimeout(r, 200));
    expect(carolChat).toEqual([]);
  });

  it('replays the chat history to a webview that reconnects', async () => {
    relay = await startRelayServer();
    const alice = await startPeer('Alice');
    const aliceChat = captureChat(alice.store);
    await waitFor(() => relay!.roomSizes()['room-a'] === 1);
    alice.client.sendChat('one');
    alice.client.sendChat('two');
    await waitFor(() => aliceChat.length === 2);

    const sent: Array<Record<string, any>> = [];
    alice.client.resend((m) => sent.push(m));
    const history = sent.find((m) => m.type === 'chatHistory');
    expect(history?.messages.map((m: { text: string }) => m.text)).toEqual(['one', 'two']);
  });

  it('rate-limits chat per peer', async () => {
    relay = await startRelayServer();
    const alice = await startPeer('Alice');
    const bob = await startPeer('Bob');
    const bobChat = captureChat(bob.store);
    await waitFor(() => relay!.roomSizes()['room-a'] === 2);
    for (let i = 0; i < MULTIPLAYER_MAX_CHATS_PER_WINDOW + 3; i++) alice.client.sendChat(`m${i}`);
    await new Promise((r) => setTimeout(r, 300));
    expect(bobChat).toHaveLength(MULTIPLAYER_MAX_CHATS_PER_WINDOW);
  });

  it('refuses to send chat without a live relay connection', () => {
    const client = new MultiplayerClient(
      new AgentStateStore(),
      { relayUrl: 'ws://127.0.0.1:1/', room: 'r', displayName: 'x' },
      READING,
    );
    clients.push(client);
    expect(client.sendChat('hello?')).toBe(false);
  });

  it('only a privileged client may chat as this office', async () => {
    relay = await startRelayServer();
    const alice = await startPeer('Alice');
    const bob = await startPeer('Bob');
    const bobChat = captureChat(bob.store);
    await waitFor(() => relay!.roomSizes()['room-a'] === 2);
    const ctx = { store: alice.store, cache: null, multiplayer: alice.client };

    handleClientMessage({ type: 'sendChat', text: 'forged' }, () => {}, ctx);
    handleClientMessage({ type: 'sendChat', text: 'real' }, () => {}, { ...ctx, privileged: true });
    await waitFor(() => bobChat.length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(bobChat.map((m) => m.text)).toEqual(['real']);
  });
});

describe('shared room: join screen, layout owner, presence', () => {
  let relay: RelayServerHandle | null = null;
  const clients: MultiplayerClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.dispose();
    await relay?.close();
    relay = null;
  });

  const layoutOf = (cols: number) => ({
    version: 1,
    cols,
    rows: 2,
    tiles: new Array(cols * 2).fill(1),
    furniture: [{ uid: 'desk-1', type: 'DESK', col: 0, row: 0 }],
    areas: [{ label: 'secret-folder' }],
  });

  /** An office that has NOT joined yet (no room in its settings), like a fresh page. */
  function office(layout: Record<string, unknown>) {
    const store = new AgentStateStore();
    const messages: Array<Record<string, any>> = [];
    store.on('broadcast', (m) => messages.push(m as Record<string, any>));
    const remembered: Array<Record<string, unknown>> = [];
    const client = new MultiplayerClient(
      store,
      { relayUrl: `ws://127.0.0.1:${relay!.port}/` },
      READING,
      { getLocalLayout: () => layout, rememberProfile: (p) => remembered.push(p) },
    );
    clients.push(client);
    // The newest broadcast of a type (any: tests read optional fields straight off it).
    const last = (type: string): any => [...messages].reverse().find((m) => m.type === type);
    return { store, client, messages, last, remembered };
  }

  it('waits for the join screen, then joins and remembers the answer', async () => {
    relay = await startRelayServer();
    const ana = office(layoutOf(3));
    ana.client.start(); // no room configured: nothing connects
    await new Promise((r) => setTimeout(r, 150));
    expect(relay.roomSizes()).toEqual({});

    expect(ana.client.join('  sala-1 ', 'Ana')).toBe(true);
    await waitFor(() => relay!.roomSizes()['sala-1'] === 1);
    await waitFor(() => ana.last('multiplayerStatus')?.connected === true);
    expect(ana.last('multiplayerStatus')).toMatchObject({
      joined: true,
      room: 'sala-1',
      name: 'Ana',
      layoutOwner: true,
    });
    expect(ana.remembered).toEqual([{ room: 'sala-1', displayName: 'Ana' }]);
    expect(ana.client.join('', 'Ana')).toBe(false);
  });

  it('an office that knows no relay joins the one typed on the join screen, and remembers it', async () => {
    relay = await startRelayServer();
    const store = new AgentStateStore();
    const messages: Array<Record<string, any>> = [];
    store.on('broadcast', (m) => messages.push(m as Record<string, any>));
    const remembered: Array<Record<string, unknown>> = [];
    const client = new MultiplayerClient(store, { relayUrl: '' }, READING, {
      rememberProfile: (p) => remembered.push(p),
    });
    clients.push(client);
    const last = (type: string): any => [...messages].reverse().find((m) => m.type === type);

    client.resend((m) => messages.push(m as Record<string, any>));
    expect(last('multiplayerStatus')).toMatchObject({ available: true, relayUrl: '' });
    // No relay yet, and junk is not one.
    expect(client.join('r', 'Ana')).toBe(false);
    expect(client.join('r', 'Ana', 'https://example.com')).toBe(false);
    expect(relay.roomSizes()).toEqual({});

    const url = `ws://127.0.0.1:${relay.port}/`;
    expect(client.join('r', 'Ana', `  ${url}  `)).toBe(true);
    await waitFor(() => last('multiplayerStatus')?.connected === true);
    expect(last('multiplayerStatus').relayUrl).toBe(url);
    expect(relay.roomSizes()).toEqual({ r: 1 });
    expect(remembered).toEqual([{ room: 'r', displayName: 'Ana', relayUrl: url }]);
  });

  it('reads a relay address as typed: ws(s) URLs only', () => {
    expect(sanitizeRelayUrl(' wss://relay.example.com/ ')).toBe('wss://relay.example.com/');
    expect(sanitizeRelayUrl('ws://192.168.0.10:4100')).toBe('ws://192.168.0.10:4100');
    expect(sanitizeRelayUrl('https://relay.example.com')).toBeNull();
    expect(sanitizeRelayUrl('wss://')).toBeNull();
    expect(sanitizeRelayUrl('wss://a b')).toBeNull();
    expect(sanitizeRelayUrl(`wss://${'a'.repeat(600)}.com`)).toBeNull();
    expect(sanitizeRelayUrl(42)).toBeNull();
  });

  it('a build (or the environment) can name the default relay', () => {
    const before = process.env.PIXEL_AGENTS_DEFAULT_RELAY;
    try {
      process.env.PIXEL_AGENTS_DEFAULT_RELAY = 'wss://team.example.com/';
      expect(defaultRelayUrl()).toBe('wss://team.example.com/');
      process.env.PIXEL_AGENTS_DEFAULT_RELAY = 'not a url';
      expect(defaultRelayUrl()).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.PIXEL_AGENTS_DEFAULT_RELAY;
      else process.env.PIXEL_AGENTS_DEFAULT_RELAY = before;
    }
  });

  it('a new room starts with its creator’s layout, and everyone in it edits that one map', async () => {
    relay = await startRelayServer();
    const ana = office(layoutOf(3));
    const bob = office(layoutOf(9));
    ana.client.join('r', 'Ana');
    // The creator seeds the room; its echo puts the ROOM's map on its screen too.
    await waitFor(() => ana.last('roomLayout')?.rev === 1);
    expect(ana.last('multiplayerStatus').layoutOwner).toBe(true);
    expect(ana.last('roomLayout')).toMatchObject({ editable: true, rev: 1 });
    expect(ana.last('roomLayout').editId).toBeUndefined(); // the seed is nobody's edit
    expect(ana.last('roomLayout').layout.areas).toBeUndefined(); // folder-derived labels stay home
    expect(ana.client.showsRoomLayout()).toBe(true);

    bob.client.join('r', 'Bob');
    await waitFor(() => bob.last('roomLayout')?.rev === 1);
    expect(bob.last('roomLayout')).toMatchObject({ editable: true });
    expect(bob.last('roomLayout').layout.cols).toBe(3); // Ana's map, not Bob's own
    expect(bob.client.showsRoomLayout()).toBe(true);

    // Bob edits revision 1: the whole room gets revision 2, carrying his edit id.
    bob.client.editRoomLayout(layoutOf(5), 1, 'bob-1');
    await waitFor(() => ana.last('roomLayout')?.rev === 2);
    expect(ana.last('roomLayout')).toMatchObject({ editId: 'bob-1', layout: { cols: 5 } });
    await waitFor(() => bob.last('roomLayout')?.editId === 'bob-1');

    // Ana's edit made on revision 1 is refused: the map moved on first.
    ana.client.editRoomLayout(layoutOf(7), 1, 'ana-1');
    await waitFor(() => ana.last('roomLayoutRejected')?.editId === 'ana-1');
    expect(ana.last('roomLayoutRejected')).toMatchObject({ reason: 'stale', rev: 2 });
    expect(bob.last('roomLayout').rev).toBe(2);
    // Made on revision 2 it lands.
    ana.client.editRoomLayout(layoutOf(7), 2, 'ana-2');
    await waitFor(() => bob.last('roomLayout')?.rev === 3);
    expect(bob.last('roomLayout').layout.cols).toBe(7);

    // Edits right behind each other: the first goes out, the next waits its
    // turn, and a newer one supersedes the waiting one (which is refused).
    bob.client.editRoomLayout(layoutOf(4), 3, 'bob-2');
    bob.client.editRoomLayout(layoutOf(5), 4, 'bob-3');
    bob.client.editRoomLayout(layoutOf(6), 4, 'bob-4');
    expect(bob.last('roomLayoutRejected')).toMatchObject({ editId: 'bob-3', reason: 'replaced' });
    await waitFor(() => ana.last('roomLayout')?.editId === 'bob-4');
    expect(ana.last('roomLayout')).toMatchObject({ rev: 5, layout: { cols: 6 } });

    // Nothing of it ever reaches either office's own layout.json.
    expect(bob.client.showsRoomLayout()).toBe(true);
  });

  it('refuses what is not a layout, and a page without the token', async () => {
    relay = await startRelayServer();
    const ana = office(layoutOf(3));
    ana.client.join('r', 'Ana');
    await waitFor(() => ana.last('roomLayout')?.rev === 1);
    ana.client.editRoomLayout({ version: 1, cols: 3 }, 1, 'bad');
    expect(ana.last('roomLayoutRejected')).toMatchObject({ editId: 'bad', reason: 'invalid' });

    const replies: Array<Record<string, any>> = [];
    handleClientMessage(
      { type: 'saveRoomLayout', layout: layoutOf(5), base: 1, editId: 'x' },
      (m) => replies.push(m as Record<string, any>),
      { store: ana.store, cache: null, multiplayer: ana.client },
    );
    expect(replies).toEqual([
      { type: 'roomLayoutRejected', editId: 'x', rev: 0, reason: 'forbidden' },
    ]);
    await new Promise((r) => setTimeout(r, 200));
    expect(ana.last('roomLayout').rev).toBe(1);
  });

  it('a relay with a rooms folder keeps the map after everyone left, and across restarts', async () => {
    const roomsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-rooms-'));
    try {
      relay = await startRelayServer({ roomsDir });
      const ana = office(layoutOf(3));
      ana.client.join('sala', 'Ana');
      await waitFor(() => ana.last('roomLayout')?.rev === 1);
      ana.client.editRoomLayout(layoutOf(5), 1, 'ana-1');
      await waitFor(() => ana.last('roomLayout')?.rev === 2);
      ana.client.leave();
      await waitFor(() => relay!.roomSizes()['sala'] === undefined);
      await relay.close(); // writes what is still waiting for the debounce

      const files = fs.readdirSync(roomsDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/); // the room name stays secret
      expect(fs.readFileSync(path.join(roomsDir, files[0]), 'utf-8')).not.toContain('sala');

      relay = await startRelayServer({ roomsDir });
      const bob = office(layoutOf(9));
      bob.client.join('sala', 'Bob');
      await waitFor(() => bob.last('roomLayout')?.rev === 2);
      expect(bob.last('roomLayout').layout.cols).toBe(5); // Ana's edit, not Bob's own layout
      expect(bob.last('multiplayerStatus').layoutOwner).toBe(false);
    } finally {
      fs.rmSync(roomsDir, { recursive: true, force: true });
    }
  });

  it('on an older relay (no revisions) only the creator edits, as before', async () => {
    const frames: Array<Record<string, any>> = [];
    let welcomeLayout: Record<string, unknown> | null = null;
    const old = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise((r) => old.once('listening', r));
    old.on('connection', (socket) => {
      socket.on('message', (data) => {
        const frame = JSON.parse(data.toString());
        frames.push(frame);
        if (frame.t === 'hello') {
          socket.send(
            JSON.stringify({
              t: 'welcome',
              peerId: 'p1',
              since: 1,
              peers: [],
              layout: welcomeLayout,
              layoutOwner: welcomeLayout === null,
            }),
          );
        }
      });
    });
    const port = (old.address() as { port: number }).port;
    const oldOffice = (layout: Record<string, unknown>) => {
      const store = new AgentStateStore();
      const messages: Array<Record<string, any>> = [];
      store.on('broadcast', (m) => messages.push(m as Record<string, any>));
      const client = new MultiplayerClient(
        store,
        { relayUrl: `ws://127.0.0.1:${port}/` },
        READING,
        {
          getLocalLayout: () => layout,
        },
      );
      clients.push(client);
      const last = (type: string): any => [...messages].reverse().find((m) => m.type === type);
      return { client, last };
    };
    try {
      const ana = oldOffice(layoutOf(3));
      ana.client.join('r', 'Ana');
      await waitFor(() => frames.some((f) => f.t === 'layout'));
      // Published blindly (no revision), and the creator keeps showing its own layout.
      expect(frames.find((f) => f.t === 'layout')?.base).toBeUndefined();
      expect(ana.last('roomLayout')).toEqual({ type: 'roomLayout', layout: null, editable: true });
      expect(ana.client.showsRoomLayout()).toBe(false);
      ana.client.editRoomLayout(layoutOf(5), 0, 'e1');
      expect(ana.last('roomLayoutRejected')).toMatchObject({ editId: 'e1', reason: 'offline' });

      welcomeLayout = sanitizeLayout(layoutOf(3));
      const bob = oldOffice(layoutOf(9));
      bob.client.join('r', 'Bob');
      await waitFor(() => bob.last('roomLayout')?.layout?.cols === 3);
      expect(bob.last('roomLayout').editable).toBe(false);
      expect(bob.last('roomLayout').rev).toBeUndefined();
    } finally {
      for (const socket of old.clients) socket.terminate();
      await new Promise((r) => old.close(r));
    }
  });

  it('an office that sends no revision is heard only as the room’s creator', async () => {
    relay = await startRelayServer();
    const ana = office(layoutOf(3));
    ana.client.join('r', 'Ana');
    await waitFor(() => ana.last('roomLayout')?.rev === 1);
    const bob = office(layoutOf(9));
    bob.client.join('r', 'Bob');
    await waitFor(() => bob.last('roomLayout')?.layout?.cols === 3);

    const intruder = new WebSocket(`ws://127.0.0.1:${relay.port}/`);
    await new Promise((r) => intruder.once('open', r));
    intruder.send(
      JSON.stringify({ t: 'hello', v: MULTIPLAYER_PROTOCOL_VERSION, room: 'r', name: 'x' }),
    );
    await new Promise((r) => setTimeout(r, 100));
    intruder.send(JSON.stringify({ t: 'layout', layout: layoutOf(20) }));
    await new Promise((r) => setTimeout(r, 200));
    intruder.close();
    expect(bob.last('roomLayout').layout.cols).toBe(3);
  });

  it('poses and the claimed desk travel on the shared map; the person alone goes out as id 0', async () => {
    relay = await startRelayServer();
    const ana = office(layoutOf(3));
    const bob = office(layoutOf(9));
    ana.client.join('r', 'Ana');
    await waitFor(() => ana.last('multiplayerStatus')?.layoutOwner === true);
    bob.client.join('r', 'Bob');
    await waitFor(() => bob.last('multiplayerStatus')?.connected === true);

    ana.client.setPresence(
      [
        {
          id: 0,
          isAvatar: true,
          palette: 3,
          hueShift: 0,
          pose: { x: 40, y: 24, dir: 2, state: 'walk' },
        },
      ],
      'desk-1',
    );
    await waitFor(() => bob.last('remotePeers')?.peers[0]?.agents.length === 1);
    const peer = bob.last('remotePeers').peers[0];
    expect(peer.desk).toBe('desk-1');
    expect(typeof peer.since).toBe('number');
    expect(peer.agents[0]).toEqual({
      id: 0,
      palette: 3,
      hueShift: 0,
      status: 'waiting',
      activity: null,
      permission: false,
      awaitingInput: false,
      isAvatar: true,
      pose: { x: 40, y: 24, dir: 2, state: 'walk' },
    });

    // An agent takes over the person's character: same office, the avatar flag moves to it.
    ana.store.set(4, createTestAgent({ id: 4 }));
    ana.client.setPresence(
      [{ id: 4, isAvatar: true, pose: { x: 56, y: 24, dir: 3, state: 'type' } }],
      'desk-1',
    );
    await waitFor(() => bob.last('remotePeers')?.peers[0]?.agents[0]?.id === 4);
    expect(bob.last('remotePeers').peers[0].agents).toHaveLength(1);
    expect(bob.last('remotePeers').peers[0].agents[0]).toMatchObject({
      isAvatar: true,
      pose: { state: 'type' },
    });
  });

  it('leaving puts the office back on its own: no room layout, no remote characters', async () => {
    relay = await startRelayServer();
    const ana = office(layoutOf(3));
    const bob = office(layoutOf(9));
    ana.client.join('r', 'Ana');
    await waitFor(() => ana.last('multiplayerStatus')?.layoutOwner === true);
    bob.client.join('r', 'Bob');
    await waitFor(() => bob.last('roomLayout')?.layout?.cols === 3);
    ana.client.setPresence(
      [{ id: 0, isAvatar: true, pose: { x: 1, y: 1, dir: 0, state: 'idle' } }],
      null,
    );
    await waitFor(() => bob.last('remotePeers')?.peers.length === 1);

    bob.client.leave();
    expect(bob.last('multiplayerStatus')).toMatchObject({ joined: false, connected: false });
    expect(bob.last('roomLayout')).toMatchObject({ layout: null, editable: true });
    expect(bob.last('remotePeers').peers).toEqual([]);
    expect(bob.client.showsRoomLayout()).toBe(false);
    await waitFor(() => relay!.roomSizes()['r'] === 1);
  });

  it('keeps the map when its owner leaves; a fresh room belongs to its new creator', async () => {
    relay = await startRelayServer();
    const ana = office(layoutOf(3));
    const bob = office(layoutOf(9));
    ana.client.join('r', 'Ana');
    await waitFor(() => ana.last('multiplayerStatus')?.layoutOwner === true);
    bob.client.join('r', 'Bob');
    await waitFor(() => bob.last('roomLayout')?.layout?.cols === 3);
    ana.client.leave();
    await waitFor(() => relay!.roomSizes()['r'] === 1);
    expect(bob.last('roomLayout').layout.cols).toBe(3);

    bob.client.leave();
    await waitFor(() => relay!.roomSizes()['r'] === undefined);
    bob.client.join('r', 'Bob');
    await waitFor(() => bob.last('multiplayerStatus')?.layoutOwner === true);
  });

  it('relays known emotes on a pose and drops anything else', () => {
    const pose = { x: 10, y: 10, dir: 1, state: 'idle' };
    expect(sanitizePose({ ...pose, emote: 'dance', emoteSeq: 3 })).toEqual({
      ...pose,
      emote: 'dance',
      emoteSeq: 3,
    });
    expect(sanitizePose({ ...pose, emote: '<script>', emoteSeq: 3 })).toEqual(pose);
    expect(sanitizePose({ ...pose, emote: 'wave', emoteSeq: 'x' })).toEqual({
      ...pose,
      emote: 'wave',
      emoteSeq: 0,
    });
  });

  it('sanitizes a relayed layout and refuses nonsense', () => {
    expect(sanitizeLayout({ ...layoutOf(3), cols: 65 })).toBeNull();
    expect(sanitizeLayout({ ...layoutOf(3), tiles: [1, 2] })).toBeNull();
    expect(sanitizeLayout({ ...layoutOf(3), version: 2 })).toBeNull();
    const clean = sanitizeLayout({
      ...layoutOf(3),
      furniture: [
        { uid: 'a', type: 'DESK', col: 1, row: 1, color: { h: 9999, s: 0, b: 0, c: 0, x: 'y' } },
        { uid: '', type: 'DESK', col: 1, row: 1 },
        'junk',
      ],
      pets: [{ id: 'p' }],
    })!;
    expect(clean.furniture).toEqual([
      { uid: 'a', type: 'DESK', col: 1, row: 1, color: { h: 360, s: 0, b: 0, c: 0 } },
    ]);
    expect(clean.pets).toBeUndefined();
    expect(clean.areas).toBeUndefined();
  });

  it('parses the revision and edit id of a room-map edit, and of its refusal', () => {
    const sent = parseClientFrame(
      JSON.stringify({ t: 'layout', layout: layoutOf(3), base: 4, id: 'page-1' }),
    );
    expect(sent).toMatchObject({ t: 'layout', base: 4, id: 'page-1' });
    // No base (an older office) and a junk one read the same: a blind publish.
    const blind = parseClientFrame(JSON.stringify({ t: 'layout', layout: layoutOf(3), base: -1 }));
    expect(blind && 'base' in blind).toBe(false);

    expect(
      parseRelayFrame(JSON.stringify({ t: 'layoutReject', id: 'page-1', rev: 5, reason: 'busy' })),
    ).toEqual({ t: 'layoutReject', id: 'page-1', rev: 5, reason: 'busy' });
    expect(parseRelayFrame(JSON.stringify({ t: 'layoutReject', id: 'page-1' }))).toBeNull();
    const welcome = parseRelayFrame(
      JSON.stringify({ t: 'welcome', peerId: 'p', since: 1, peers: [], layout: null, rev: 0 }),
    );
    expect(welcome).toMatchObject({ t: 'welcome', rev: 0 });
  });

  it("keeps a building's levels and the stairs' links, and drops levels off the grid", () => {
    // Two 3×3 levels side by side, a column apart: the grid is 7 wide.
    const building = {
      version: 1,
      cols: 7,
      rows: 3,
      tiles: new Array(21).fill(1),
      furniture: [
        { uid: 's1', type: 'STAIRS_UP', col: 0, row: 0, link: 'link-1' },
        { uid: 's2', type: 'STAIRS_UP', col: 4, row: 0, link: 'link-1‮' },
      ],
      levels: [
        { id: 'main', name: 'Ground floor', elevation: 0, col: 0, row: 0, cols: 3, rows: 3 },
        { id: 'up1', name: 'Floor 1', elevation: 1, col: 4, row: 0, cols: 3, rows: 3 },
        { id: 'off', name: 'Nowhere', elevation: 2, col: 6, row: 0, cols: 9, rows: 3 },
        { id: 'main', name: 'Twice', elevation: 3, col: 0, row: 0, cols: 1, rows: 1 },
      ],
    };
    const clean = sanitizeLayout(building)!;
    expect(clean.levels).toEqual([
      { id: 'main', name: 'Ground floor', elevation: 0, col: 0, row: 0, cols: 3, rows: 3 },
      { id: 'up1', name: 'Floor 1', elevation: 1, col: 4, row: 0, cols: 3, rows: 3 },
    ]);
    expect((clean.furniture as Array<{ link?: string }>).map((f) => f.link)).toEqual([
      'link-1',
      'link-1',
    ]);
    // Wider than one level may be (levels stand side by side), never taller.
    const wide = { version: 1, cols: 130, rows: 3, tiles: new Array(390).fill(1), furniture: [] };
    expect(sanitizeLayout(wide)).not.toBeNull();
    expect(sanitizePose({ x: 129 * 16, y: 20, dir: 0, state: 'walk' })).toBeDefined();
  });
});
