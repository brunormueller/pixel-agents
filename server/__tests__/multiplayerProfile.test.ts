import { afterEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { MULTIPLAYER_MAX_DECOR_ITEMS, MULTIPLAYER_MAX_STATUS_LENGTH } from '../src/constants.js';
import { MultiplayerClient } from '../src/multiplayer/multiplayerClient.js';
import {
  parseClientFrame,
  parseRelayFrame,
  sanitizeDecor,
  sanitizeLook,
  sanitizeProfile,
  sanitizeTrack,
} from '../src/multiplayer/protocol.js';
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

describe('profile sanitizing (relay and peers alike)', () => {
  it('keeps a well-formed look and clamps the rest', () => {
    expect(sanitizeLook({ body: 2, hair: 5, top: 99, bottom: -7, accessory: 'crown' })).toEqual({
      body: 2,
      hair: 5,
      top: -1,
      bottom: -1,
      accessory: 'crown',
    });
    expect(sanitizeLook({ body: 1, accessory: '<script>' })?.accessory).toBe('none');
    expect(sanitizeLook({ body: -1 })).toBeUndefined();
    expect(sanitizeLook('crown')).toBeUndefined();
  });

  it('strips control characters from the status message and caps it', () => {
    const profile = sanitizeProfile({
      status: 'busy',
      statusText: `‮Deep\u0007 work${'!'.repeat(200)}`,
    })!;
    expect(profile.status).toBe('busy');
    expect(profile.statusText!.startsWith('Deep work')).toBe(true);
    expect([...profile.statusText!]).toHaveLength(MULTIPLAYER_MAX_STATUS_LENGTH);
    expect(sanitizeProfile({ status: 'on fire' })!.status).toBe('available');
  });

  it('keeps decoration near the desk, one item per tile, capped', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      type: 'PLANT',
      dc: (i % 7) - 3,
      dr: Math.floor(i / 7) - 3,
    }));
    expect(sanitizeDecor(many)).toHaveLength(MULTIPLAYER_MAX_DECOR_ITEMS);
    expect(
      sanitizeDecor([
        { type: 'PLANT', dc: 1, dr: 0 },
        { type: 'CACTUS', dc: 1, dr: 0 }, // same tile
        { type: 'PLANT', dc: 9, dr: 0 }, // too far
        { type: '', dc: 0, dr: 1 },
        { type: 'POT', dc: 0.5, dr: 1 },
      ]),
    ).toEqual([{ type: 'PLANT', dc: 1, dr: 0 }]);
  });

  it('desk items keep their pixel position and may share a tile', () => {
    expect(
      sanitizeDecor([
        { type: 'MONITOR_FRONT', dc: 0, dr: -1, px: 4, py: 9 },
        { type: 'KEYBOARD_FRONT', dc: 0, dr: -1, px: 8, py: 13 },
        { type: 'MOUSE', dc: 0, dr: -1, px: 8, py: 13 }, // the same spot again
        { type: 'PIE', dc: 1, dr: -1, px: 16, py: 3 }, // pixel out of the tile: dropped, tile kept
      ]),
    ).toEqual([
      { type: 'MONITOR_FRONT', dc: 0, dr: -1, px: 4, py: 9 },
      { type: 'KEYBOARD_FRONT', dc: 0, dr: -1, px: 8, py: 13 },
      { type: 'PIE', dc: 1, dr: -1 },
    ]);
  });

  it('a desk style is a plain id; taken-off items are a short list of ids', () => {
    expect(sanitizeProfile({ deskStyle: 'CURVED_DESK', hidden: ['f-1', 'f-1', 'f-2', 7] })).toEqual(
      {
        deskStyle: 'CURVED_DESK',
        hidden: ['f-1', 'f-2'],
      },
    );
    expect(sanitizeProfile({ deskStyle: '<img src=x>' })!.deskStyle).toBeUndefined();
  });

  it('a shared song carries only a Spotify track link', () => {
    expect(
      sanitizeTrack({
        title: 'Song',
        artist: 'Band',
        trackUrl: 'https://open.spotify.com/track/abc123',
      }),
    ).toEqual({ title: 'Song', artist: 'Band', trackUrl: 'https://open.spotify.com/track/abc123' });
    expect(
      sanitizeTrack({ title: 'Song', artist: 'Band', trackUrl: 'https://evil.example/x' }),
    ).toEqual({
      title: 'Song',
      artist: 'Band',
    });
    expect(sanitizeTrack({ artist: 'no title' })).toBeNull();
  });

  it('state and peer frames carry the sanitized profile', () => {
    const state = parseClientFrame(
      JSON.stringify({
        t: 'state',
        agents: [],
        desk: null,
        profile: {
          status: 'away',
          look: { body: 1, hair: 0, top: 0, bottom: 0, accessory: 'cap' },
          junk: 1,
        },
      }),
    );
    expect(state).toMatchObject({
      t: 'state',
      profile: { status: 'away', look: { accessory: 'cap' } },
    });
    expect((state as unknown as { profile: Record<string, unknown> }).profile.junk).toBeUndefined();
    const peer = parseRelayFrame(
      JSON.stringify({
        t: 'peer',
        peer: {
          peerId: 'p',
          name: 'Ana',
          agents: [],
          desk: null,
          since: 1,
          profile: { statusText: 'hi' },
        },
      }),
    );
    expect(peer).toMatchObject({ t: 'peer', peer: { profile: { statusText: 'hi' } } });
  });
});

describe('the profile over a relay', () => {
  let relay: RelayServerHandle | null = null;
  const clients: MultiplayerClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.dispose();
    await relay?.close();
    relay = null;
  });

  function office(name: string, initialProfile = {}) {
    const store = new AgentStateStore();
    const messages: Array<Record<string, any>> = [];
    store.on('broadcast', (m) => messages.push(m as Record<string, any>));
    const saved: Array<Record<string, unknown>> = [];
    const client = new MultiplayerClient(
      store,
      { relayUrl: `ws://127.0.0.1:${relay!.port}/`, room: 'r', displayName: name },
      READING,
      { rememberProfile: (p) => saved.push(p), initialProfile },
    );
    clients.push(client);
    client.start();
    const last = (type: string): any => [...messages].reverse().find((m) => m.type === type);
    return { store, client, messages, last, saved };
  }

  it('look, status and decoration reach the other office; the look is the avatar’s sprite too', async () => {
    relay = await startRelayServer();
    const ana = office('Ana');
    const bob = office('Bob');
    await waitFor(
      () => ana.last('multiplayerStatus')?.connected && bob.last('multiplayerStatus')?.connected,
    );

    ana.client.setPresence(
      [
        {
          id: 0,
          isAvatar: true,
          palette: 1,
          hueShift: 90,
          pose: { x: 8, y: 8, dir: 0, state: 'idle' },
        },
      ],
      'desk-1',
    );
    ana.client.updateProfile({
      look: { body: 4, hair: 2, top: 3, bottom: 1, accessory: 'headphones' },
      status: 'busy',
      statusText: 'shipping',
      decor: [{ type: 'PLANT', dc: 1, dr: 0 }],
    });

    await waitFor(() => bob.last('remotePeers')?.peers[0]?.profile?.status === 'busy');
    const peer = bob.last('remotePeers').peers[0];
    expect(peer.profile).toEqual({
      look: { body: 4, hair: 2, top: 3, bottom: 1, accessory: 'headphones' },
      status: 'busy',
      statusText: 'shipping',
      decor: [{ type: 'PLANT', dc: 1, dr: 0 }],
    });
    // Offices too old to read the profile still draw the right body.
    expect(peer.agents[0]).toMatchObject({ isAvatar: true, palette: 4, hueShift: 0 });

    // Saved, and echoed to Ana's own webview.
    expect(ana.saved.at(-1)).toMatchObject({ status: 'busy', statusText: 'shipping' });
    expect(ana.last('profileLoaded')).toMatchObject({ status: 'busy', shareMusic: false });
  });

  it('the song is shared only with sharing on, and only while it plays', async () => {
    relay = await startRelayServer();
    const ana = office('Ana');
    const bob = office('Bob');
    await waitFor(
      () => ana.last('multiplayerStatus')?.connected && bob.last('multiplayerStatus')?.connected,
    );
    const song = { title: 'Song', artist: 'Band', isPlaying: true };

    ana.client.setMusic(song);
    await new Promise((r) => setTimeout(r, 300));
    expect(ana.client.publishedProfile().music).toBeUndefined();

    ana.client.updateProfile({ shareMusic: true });
    await waitFor(() => bob.last('remotePeers')?.peers[0]?.profile?.music?.title === 'Song');

    ana.client.setMusic({ ...song, isPlaying: false });
    await waitFor(() => bob.last('remotePeers')?.peers[0]?.profile?.music === undefined);
  });

  it('an event in progress reads as "in a meeting" unless the person said something stronger', () => {
    relay = null;
    const store = new AgentStateStore();
    const client = new MultiplayerClient(store, { relayUrl: 'ws://127.0.0.1:1/' }, READING);
    clients.push(client);
    client.setInMeeting(true);
    expect(client.publishedProfile().status).toBe('meeting');
    client.updateProfile({ status: 'away' });
    expect(client.publishedProfile().status).toBe('away');
    client.updateProfile({ status: 'available' });
    client.setInMeeting(false);
    expect(client.publishedProfile().status).toBe('available');
  });

  it('starts from the saved profile and replays it to a reconnecting webview', () => {
    const store = new AgentStateStore();
    const client = new MultiplayerClient(store, { relayUrl: 'ws://127.0.0.1:1/' }, READING, {
      initialProfile: { status: 'away', statusText: 'lunch', shareMusic: true },
    });
    clients.push(client);
    const sent: Array<Record<string, any>> = [];
    client.resend((m) => sent.push(m));
    expect(sent.find((m) => m.type === 'profileLoaded')).toEqual({
      type: 'profileLoaded',
      look: null,
      status: 'away',
      statusText: 'lunch',
      decor: [],
      shareMusic: true,
      desk: null,
      deskStyle: null,
      hidden: [],
    });
  });

  it('remembers the desk claimed in each room and offers it back on return', async () => {
    relay = await startRelayServer();
    const ana = office('Ana', { desks: { other: 'seat-9' } });
    await waitFor(() => ana.last('multiplayerStatus')?.connected === true);
    expect(ana.last('profileLoaded')?.desk ?? null).toBe(null);
    ana.client.setPresence([], 'seat-3');
    ana.client.setPresence([], 'seat-3'); // unchanged: saved once
    expect(ana.saved.filter((p) => 'desks' in p)).toEqual([
      { desks: { other: 'seat-9', r: 'seat-3' } },
    ]);
    // Back in the other room: its desk is offered.
    ana.client.join('other', 'Ana');
    expect(ana.last('profileLoaded')?.desk).toBe('seat-9');
  });

  it('only a privileged client may change the profile (standalone)', () => {
    const store = new AgentStateStore();
    const client = new MultiplayerClient(store, { relayUrl: 'ws://127.0.0.1:1/' }, READING);
    clients.push(client);
    const msg = { type: 'updateProfile', status: 'busy' };
    handleClientMessage(msg, () => undefined, { store, cache: null, multiplayer: client });
    expect(client.publishedProfile().status).toBe('available');
    handleClientMessage(msg, () => undefined, {
      store,
      cache: null,
      multiplayer: client,
      privileged: true,
    });
    expect(client.publishedProfile().status).toBe('busy');
  });
});
