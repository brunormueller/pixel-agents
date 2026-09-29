import { afterEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import {
  sanitizeFpsMap,
  sanitizeGameFrame,
  sanitizeGamePresence,
} from '../src/multiplayer/gameProtocol.js';
import { MultiplayerClient } from '../src/multiplayer/multiplayerClient.js';
import { parseClientFrame, parseRelayFrame } from '../src/multiplayer/protocol.js';
import type { RelayServerHandle } from '../src/multiplayer/relayServer.js';
import { startRelayServer } from '../src/multiplayer/relayServer.js';

const READING = new Set(['Read']);

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

function capture(store: AgentStateStore, type: string): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  store.on('broadcast', (msg) => {
    if (msg.type === type) out.push(msg);
  });
  return out;
}

const game = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  game: 'fps',
  title: 'Ana’s match',
  since: 1000,
  cfg: { map: 'arena', bots: 3, difficulty: 'hard', fragLimit: 10, timeLimit: 5 },
  palette: 2,
  hueShift: 0,
  ...extra,
});

const map = (extra: Record<string, unknown> = {}) => ({
  name: 'Tiny',
  cols: 4,
  rows: 3,
  cells: 'AAAAAab0AAAA',
  walls: [{ tex: 'stone' }],
  floors: [{ tex: 'grid' }, { pat: 3, color: { h: 10, s: 20, b: 0, c: 0 } }],
  blocks: [{ h: 0.4, top: 0x886644, side: 0x664422 }],
  props: [{ x: 1.5, y: 1.5, t: 'PLANT', z: 0.4 }],
  solid: [5],
  spawns: [{ x: 2.5, y: 1.5 }],
  items: [{ x: 1.5, y: 1.5, k: 'health' }],
  ceiling: 0xeeeeee,
  fog: 0x111111,
  ...extra,
});

describe('game protocol', () => {
  it('keeps a well-formed match presence and drops what does not belong', () => {
    expect(sanitizeGamePresence({ ...game('fps-1'), title: 'Ana‮', toolName: 'Bash' })).toEqual({
      ...game('fps-1'),
      title: 'Ana',
    });
    // Out-of-range settings fall back rather than pass through.
    expect(
      sanitizeGamePresence(
        game('fps-1', { cfg: { map: 'arena', bots: 99, difficulty: 'godlike', fragLimit: -1 } }),
      )?.cfg,
    ).toEqual({ map: 'arena', bots: 0, difficulty: 'normal', fragLimit: 0, timeLimit: 0 });
    expect(sanitizeGamePresence(game('has space'))).toBeUndefined();
    expect(sanitizeGamePresence(game('fps-1', { game: 'chess' }))).toBeUndefined();
    expect(sanitizeGamePresence(game('fps-1', { cfg: { map: '../../etc' } }))).toBeUndefined();
  });

  it('keeps a frame’s own fields only, each checked', () => {
    expect(
      sanitizeGameFrame({
        k: 'pos',
        x: 3.5,
        y: 2.25,
        a: -Math.PI / 2,
        hp: 80,
        alive: true,
        w: 2,
        shot: 12,
        mv: true,
        text: 'secret.ts',
      }),
    ).toEqual({
      k: 'pos',
      x: 3.5,
      y: 2.25,
      a: (3 * Math.PI) / 2,
      hp: 80,
      alive: true,
      w: 2,
      shot: 12,
      mv: true,
    });
    expect(sanitizeGameFrame({ k: 'pos', x: 1e9, y: 1, a: 0 })).toBeNull();
    expect(sanitizeGameFrame({ k: 'hit', to: 'bot-1', dmg: 20, w: 1, by: 'bot-2' })).toEqual({
      k: 'hit',
      to: 'bot-1',
      dmg: 20,
      w: 1,
      by: 'bot-2',
    });
    expect(sanitizeGameFrame({ k: 'hit', to: 'x', dmg: 5000 })).toBeNull();
    expect(sanitizeGameFrame({ k: 'die', by: 'peer-a', w: 0 })).toEqual({
      k: 'die',
      by: 'peer-a',
      w: 0,
    });
    expect(
      sanitizeGameFrame({
        k: 'score',
        round: 2,
        score: [{ id: 'a', n: 'Ana', f: 3, d: 1 }],
        items: '10x1',
      }),
    ).toMatchObject({
      k: 'score',
      round: 2,
      over: false,
      items: '',
      score: [{ id: 'a', n: 'Ana', f: 3, d: 1 }],
    });
    expect(sanitizeGameFrame({ k: 'take', i: 3 })).toEqual({ k: 'take', i: 3 });
    expect(sanitizeGameFrame({ k: 'teleport' })).toBeNull();
  });

  it('checks a map’s shape and bounds', () => {
    expect(sanitizeFpsMap(map())).toEqual(map());
    expect(sanitizeFpsMap(map({ cells: 'AAAA' }))).toBeNull();
    expect(sanitizeFpsMap(map({ cells: 'AAAAA<b0AAAA' }))).toBeNull();
    expect(sanitizeFpsMap(map({ spawns: [{ x: 99, y: 1 }] }))).toBeNull();
    const trimmed = sanitizeFpsMap(
      map({ props: [{ x: 1, y: 1, t: 'bad type!' }], solid: [5, 5, 99], blocks: [{ h: 9 }] }),
    );
    expect(trimmed?.props).toEqual([]);
    expect(trimmed?.solid).toEqual([5]);
    expect(trimmed?.blocks[0].h).toBe(0.4);
  });

  it('parses the play frames both ways', () => {
    expect(parseClientFrame(JSON.stringify({ t: 'play', ev: { k: 'req' } }))).toEqual({
      t: 'play',
      ev: { k: 'req' },
    });
    expect(
      parseRelayFrame(
        JSON.stringify({ t: 'play', from: 'p1', gameId: 'fps-1', ev: { k: 'take', i: 1 } }),
      ),
    ).toEqual({ t: 'play', from: 'p1', gameId: 'fps-1', ev: { k: 'take', i: 1 } });
    expect(
      parseClientFrame(JSON.stringify({ t: 'state', agents: [], desk: null, game: game('fps-1') })),
    ).toMatchObject({
      game: { id: 'fps-1' },
    });
  });
});

describe('relay: games', () => {
  let relay: RelayServerHandle | null = null;
  const clients: MultiplayerClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.dispose();
    await relay?.close();
    relay = null;
  });

  async function startPeer(name: string, room = 'room-g') {
    const store = new AgentStateStore();
    const client = new MultiplayerClient(
      store,
      { relayUrl: `ws://127.0.0.1:${relay!.port}/`, room, displayName: name },
      READING,
    );
    clients.push(client);
    client.start();
    const status = capture(store, 'multiplayerStatus');
    await waitFor(() => status.some((s) => s.connected));
    return { store, client, id: () => status[status.length - 1].peerId as string };
  }

  it('shows a match presence on the other offices', async () => {
    relay = await startRelayServer();
    const a = await startPeer('Ana');
    const b = await startPeer('Bia');
    const peers = capture(b.store, 'remotePeers');
    a.client.setGame(game('fps-1'));
    await waitFor(() => peers.some((m) => m.peers[0]?.game?.id === 'fps-1'));
    a.client.setGame(null);
    await waitFor(() => peers[peers.length - 1].peers[0]?.game === undefined);
  });

  it('sends a play frame to the other players of that match only, never back', async () => {
    relay = await startRelayServer();
    const a = await startPeer('Ana');
    const b = await startPeer('Bia');
    const c = await startPeer('Caio');
    const frames = [a, b, c].map((p) => capture(p.store, 'gameFrame'));
    b.client.setGame(game('fps-1', { since: 2000 }));
    c.client.setGame(game('other'));
    await new Promise((r) => setTimeout(r, 300)); // their presences reached the relay
    // Joining and sending in the same tick: the presence must reach the relay first.
    a.client.setGame(game('fps-1'));
    expect(
      a.client.sendGameFrame({
        k: 'pos',
        x: 2,
        y: 3,
        a: 0,
        hp: 100,
        alive: true,
        w: 1,
        shot: 0,
        mv: false,
      }),
    ).toBe(true);
    await waitFor(() => frames[1].length === 1);
    expect(frames[1][0]).toMatchObject({
      from: a.id(),
      gameId: 'fps-1',
      frame: { k: 'pos', x: 2, y: 3 },
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(frames[0]).toEqual([]);
    expect(frames[2]).toEqual([]);
  });

  it('an office outside any match cannot play in one', async () => {
    relay = await startRelayServer();
    const a = await startPeer('Ana');
    expect(a.client.sendGameFrame({ k: 'req' })).toBe(false);
  });

  it('match messages need a privileged client', async () => {
    relay = await startRelayServer();
    const a = await startPeer('Ana');
    const ctx = { store: a.store, cache: null, multiplayer: a.client };
    handleClientMessage(
      { type: 'updateGamePresence', game: game('fps-1') as never },
      () => {},
      ctx,
    );
    expect(a.client.currentGame()).toBe(null);
    handleClientMessage({ type: 'updateGamePresence', game: game('fps-1') as never }, () => {}, {
      ...ctx,
      privileged: true,
    });
    expect(a.client.currentGame()?.id).toBe('fps-1');
  });
});
