import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { AgentStateStore } from '../src/agentStateStore.js';
import { handleClientMessage } from '../src/clientMessageHandler.js';
import { parseMultiplayer } from '../src/configPersistence.js';
import { MULTIPLAYER_PROTOCOL_VERSION } from '../src/constants.js';
import {
  buildNotesPrompt,
  meetingFileName,
  MeetingNotesService,
  sanitizeLines,
} from '../src/integrations/meetingNotes/meetingNotes.js';
import { MultiplayerClient } from '../src/multiplayer/multiplayerClient.js';
import {
  parseClientFrame,
  sanitizeIceServers,
  sanitizeMeetingEvent,
  sanitizeMeetingPresence,
  sanitizeSignal,
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

function capture(store: AgentStateStore, type: string): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  store.on('broadcast', (msg) => {
    if (msg.type === type) out.push(msg);
  });
  return out;
}

const presence = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: 'Standup',
  since: 1000,
  mic: true,
  cam: false,
  screens: [],
  hand: false,
  rec: false,
  captions: false,
  ...extra,
});

describe('meeting protocol', () => {
  it('keeps a well-formed presence and drops what does not belong', () => {
    const p = sanitizeMeetingPresence({
      ...presence('m-1'),
      title: 'Standup‮',
      stream: 'abcDEF123',
      screens: [
        { stream: 's1', label: 'Screen 1', audio: true },
        { stream: 's1' },
        { stream: 'bad id!' },
        { stream: 's2' },
        { stream: 's3' },
        { stream: 's4' },
        { stream: 's5' },
      ],
      hand: true,
      handAt: 1234,
      music: { track: 'lofi', at: 99 },
      transcribe: { on: true, at: 50 },
      toolName: 'Bash',
    });
    expect(p).toEqual({
      id: 'm-1',
      title: 'Standup',
      since: 1000,
      mic: true,
      cam: false,
      stream: 'abcDEF123',
      screens: [
        { stream: 's1', label: 'Screen 1', audio: true },
        { stream: 's2' },
        { stream: 's3' },
        { stream: 's4' },
      ],
      hand: true,
      handAt: 1234,
      rec: false,
      captions: false,
      transcribe: { on: true, at: 50 },
      music: { track: 'lofi', at: 99 },
    });
  });

  it('refuses a presence without a valid id or join time, and a malformed track', () => {
    expect(sanitizeMeetingPresence({ ...presence('has space') })).toBeUndefined();
    expect(sanitizeMeetingPresence({ ...presence('m'), since: -1 })).toBeUndefined();
    expect(
      sanitizeMeetingPresence({ ...presence('m'), music: { track: 'x y', at: 1 } })?.music,
    ).toBe(undefined);
  });

  it('checks signal shape and size, never content', () => {
    expect(
      sanitizeSignal({
        kind: 'sdp',
        sid: 1,
        tsid: 2,
        description: { type: 'offer', sdp: 'v=0\r\n' },
      }),
    ).toEqual({ kind: 'sdp', sid: 1, tsid: 2, description: { type: 'offer', sdp: 'v=0\r\n' } });
    expect(
      sanitizeSignal({
        kind: 'ice',
        sid: 1,
        tsid: 0,
        candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0', sdpMLineIndex: 0, extra: 1 },
      }),
    ).toEqual({
      kind: 'ice',
      sid: 1,
      tsid: 0,
      candidate: { candidate: 'candidate:1 1 udp', sdpMid: '0', sdpMLineIndex: 0 },
    });
    expect(sanitizeSignal({ kind: 'invite', sid: 1, tsid: 0, meetingId: 'm1', title: '' })).toEqual(
      {
        kind: 'invite',
        sid: 1,
        tsid: 0,
        meetingId: 'm1',
        title: 'Meeting',
      },
    );
    expect(
      sanitizeSignal({ kind: 'sdp', sid: 1, tsid: 2, description: { type: 'hack', sdp: '' } }),
    ).toBe(null);
    expect(
      sanitizeSignal({
        kind: 'sdp',
        sid: 1,
        tsid: 2,
        description: { type: 'offer', sdp: 'x'.repeat(70_000) },
      }),
    ).toBe(null);
    expect(sanitizeSignal({ kind: 'exec', sid: 1, tsid: 2 })).toBe(null);
  });

  it('accepts only the fixed reactions; notes keep their line breaks, chat does not', () => {
    expect(sanitizeMeetingEvent({ kind: 'reaction', text: '👍' })).toEqual({
      kind: 'reaction',
      text: '👍',
    });
    expect(sanitizeMeetingEvent({ kind: 'reaction', text: '💣' })).toBe(null);
    expect(sanitizeMeetingEvent({ kind: 'notes', text: '## Summary\r\n- a\n- b' })).toEqual({
      kind: 'notes',
      text: '## Summary\n- a\n- b',
    });
    expect(sanitizeMeetingEvent({ kind: 'chat', text: 'a\nb' })).toEqual({
      kind: 'chat',
      text: 'ab',
    });
    expect(sanitizeMeetingEvent({ kind: 'chat', text: '   ' })).toBe(null);
    expect(sanitizeMeetingEvent({ kind: 'shell', text: 'ls' })).toBe(null);
  });

  it('keeps stun/turn servers only', () => {
    expect(
      sanitizeIceServers([
        { urls: 'stun:stun.example.com:3478' },
        { urls: ['turn:t.example.com:3478', 'http://evil'], username: 'u', credential: 'c' },
        { urls: ['javascript:alert(1)'] },
        'junk',
      ]),
    ).toEqual([
      { urls: ['stun:stun.example.com:3478'] },
      { urls: ['turn:t.example.com:3478'], username: 'u', credential: 'c' },
    ]);
  });

  it('parses the new client frames', () => {
    expect(
      parseClientFrame(JSON.stringify({ t: 'meet', ev: { kind: 'chat', text: 'hi' } })),
    ).toEqual({
      t: 'meet',
      ev: { kind: 'chat', text: 'hi' },
    });
    expect(
      parseClientFrame(JSON.stringify({ t: 'signal', to: 'p2', data: { kind: 'ice', sid: 1 } })),
    ).toBe(null);
  });

  it('multiplayer.json may name ICE servers', () => {
    expect(
      parseMultiplayer({ relayUrl: 'wss://r', iceServers: [{ urls: ['turn:t:3478'] }] })
        ?.iceServers,
    ).toEqual([{ urls: ['turn:t:3478'] }]);
  });
});

describe('relay: meetings', () => {
  let relay: RelayServerHandle | null = null;
  const clients: MultiplayerClient[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.dispose();
    for (const s of sockets.splice(0)) s.close();
    await relay?.close();
    relay = null;
  });

  async function startPeer(name: string, room = 'room-m') {
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
    return { store, client, status };
  }

  it('hands the relay’s ICE servers and a peer id to every office', async () => {
    relay = await startRelayServer({ iceServers: [{ urls: ['turn:turn.example:3478'] }] });
    const a = await startPeer('Ana');
    const last = a.status[a.status.length - 1];
    expect(last.iceServers).toEqual([{ urls: ['turn:turn.example:3478'] }]);
    expect(typeof last.peerId).toBe('string');
    expect(last.peerId.length).toBeGreaterThan(0);
    expect(typeof last.clockOffset).toBe('number');
  });

  it('publishes the meeting presence and shows it on the remote peer', async () => {
    relay = await startRelayServer();
    const a = await startPeer('Ana');
    const b = await startPeer('Bia');
    const peers = capture(b.store, 'remotePeers');
    a.client.setMeeting(presence('m1'));
    await waitFor(() => peers.some((m) => m.peers[0]?.meeting?.id === 'm1'));
    expect(a.client.publishedProfile().status).toBe('meeting');
    a.client.setMeeting(null);
    await waitFor(() => peers[peers.length - 1].peers[0]?.meeting === undefined);
    expect(a.client.publishedProfile().status).toBe('available');
  });

  it('delivers a signal to its one addressee, after the sender’s presence', async () => {
    relay = await startRelayServer();
    const a = await startPeer('Ana');
    const b = await startPeer('Bia');
    const c = await startPeer('Caio');
    const bSignals = capture(b.store, 'meetingSignal');
    const cSignals = capture(c.store, 'meetingSignal');
    const bPeers = capture(b.store, 'remotePeers');
    b.client.setMeeting(presence('m1'));
    const bId = b.status[b.status.length - 1].peerId as string;
    const aId = a.status[a.status.length - 1].peerId as string;
    // Joining and signaling in the same tick: the presence must reach Bia first.
    a.client.setMeeting(presence('m1'));
    expect(
      a.client.sendMeetingSignal(bId, {
        kind: 'sdp',
        sid: 1000,
        tsid: 1000,
        description: { type: 'offer', sdp: 'v=0' },
      }),
    ).toBe(true);
    await waitFor(() => bSignals.length === 1);
    expect(bSignals[0]).toMatchObject({ from: aId, data: { kind: 'sdp' } });
    expect(
      bPeers.some((m) => m.peers.some((p: any) => p.peerId === aId && p.meeting?.id === 'm1')),
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(cSignals).toEqual([]);
  });

  it('fans meeting events out to that meeting only, the sender included', async () => {
    relay = await startRelayServer();
    const a = await startPeer('Ana');
    const b = await startPeer('Bia');
    const c = await startPeer('Caio');
    const events = [a, b, c].map((p) => capture(p.store, 'meetingEvent'));
    a.client.setMeeting(presence('m1'));
    b.client.setMeeting(presence('m1'));
    c.client.setMeeting(presence('other'));
    await new Promise((r) => setTimeout(r, 300));
    expect(a.client.sendMeetingEvent({ kind: 'chat', text: 'bom dia' })).toBe(true);
    await waitFor(() => events[0].length === 1 && events[1].length === 1);
    expect(events[0][0]).toMatchObject({ self: true, name: 'Ana', meetingId: 'm1' });
    expect(events[1][0]).toMatchObject({ self: false, event: { kind: 'chat', text: 'bom dia' } });
    await new Promise((r) => setTimeout(r, 150));
    expect(events[2]).toEqual([]);
  });

  it('an office outside any meeting cannot speak in one', async () => {
    relay = await startRelayServer();
    const a = await startPeer('Ana');
    expect(a.client.sendMeetingEvent({ kind: 'chat', text: 'hi' })).toBe(false);
    // Nor with a raw socket that skips the client's own check.
    const raw = new WebSocket(`ws://127.0.0.1:${relay.port}/`);
    sockets.push(raw);
    const got: string[] = [];
    raw.on('message', (d) => got.push(d.toString()));
    await new Promise((r) => raw.on('open', r));
    raw.send(
      JSON.stringify({ t: 'hello', v: MULTIPLAYER_PROTOCOL_VERSION, room: 'room-m', name: 'X' }),
    );
    await waitFor(() => got.length > 0);
    const events = capture(a.store, 'meetingEvent');
    a.client.setMeeting(presence('m1'));
    await new Promise((r) => setTimeout(r, 250));
    raw.send(JSON.stringify({ t: 'meet', ev: { kind: 'chat', text: 'sneaky' } }));
    await new Promise((r) => setTimeout(r, 200));
    expect(events).toEqual([]);
  });

  it('meeting messages need a privileged client', async () => {
    relay = await startRelayServer();
    const a = await startPeer('Ana');
    const ctx = { store: a.store, cache: null, multiplayer: a.client };
    handleClientMessage({ type: 'updateMeetingPresence', meeting: presence('m1') }, () => {}, ctx);
    expect(a.client.currentMeeting()).toBe(null);
    handleClientMessage({ type: 'updateMeetingPresence', meeting: presence('m1') }, () => {}, {
      ...ctx,
      privileged: true,
    });
    expect(a.client.currentMeeting()?.id).toBe('m1');
  });
});

describe('meeting notes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-notes-'));
  const req = {
    requestId: 'r1',
    title: 'Weekly sync',
    transcript: [
      { name: 'Bia', text: 'vamos lançar sexta', ts: 2000 },
      { name: 'Ana', text: 'bom dia', ts: 1000 },
      { name: 'Ana', text: '', ts: 3000 },
    ],
    chat: [{ name: 'Caio', text: 'link do doc', ts: 1500 }],
  };

  it('orders and cleans the lines, and builds the prompt with every participant', () => {
    const lines = sanitizeLines(req.transcript, 10_000);
    expect(lines.map((l) => l.text)).toEqual(['bom dia', 'vamos lançar sexta']);
    const prompt = buildNotesPrompt(
      { title: 'Weekly sync', transcript: lines, chat: sanitizeLines(req.chat, 10_000) },
      new Date(0),
    );
    expect(prompt).toContain('"Weekly sync"');
    expect(prompt).toContain('Ana, Bia, Caio');
    expect(prompt).toContain('Bia: vamos lançar sexta');
    expect(prompt).toContain('Caio: link do doc');
  });

  it('names the file by date and title', () => {
    expect(meetingFileName('Reunião de Sexta!', new Date(2026, 8, 4, 9, 5))).toBe(
      '2026-09-04-0905-reuniao-de-sexta.md',
    );
  });

  it('writes the notes with Claude and saves notes + transcript', async () => {
    const prompts: string[] = [];
    const service = new MeetingNotesService({
      dir: tmp,
      runClaude: async (prompt) => {
        prompts.push(prompt);
        return '## Resumo\n- lançar sexta\n';
      },
    });
    const replies: Array<Record<string, any>> = [];
    await service.generate(req, (m) => replies.push(m));
    expect(prompts).toHaveLength(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ type: 'meetingNotesResult', requestId: 'r1', ok: true });
    expect(replies[0].text).toBe('## Resumo\n- lançar sexta');
    const saved = fs.readFileSync(replies[0].savedTo, 'utf-8');
    expect(saved).toContain('# Weekly sync');
    expect(saved).toContain('## Resumo');
    expect(saved).toContain('Bia: vamos lançar sexta');
  });

  it('reports failures and refuses an empty meeting', async () => {
    const replies: Array<Record<string, any>> = [];
    const failing = new MeetingNotesService({
      dir: tmp,
      runClaude: async () => {
        throw new Error('Claude Code (the `claude` command) was not found on this machine.');
      },
    });
    await failing.generate(req, (m) => replies.push(m));
    await failing.generate({ requestId: 'r2', title: 'x', transcript: [], chat: [] }, (m) =>
      replies.push(m),
    );
    expect(replies[0]).toMatchObject({ ok: false, error: expect.stringContaining('not found') });
    expect(replies[1]).toMatchObject({ requestId: 'r2', ok: false });
  });

  it('writes one set of notes at a time', async () => {
    let release!: () => void;
    const service = new MeetingNotesService({
      dir: tmp,
      runClaude: () =>
        new Promise((resolve) => {
          release = () => resolve('notes');
        }),
    });
    const replies: Array<Record<string, any>> = [];
    const first = service.generate(req, (m) => replies.push(m));
    await service.generate({ ...req, requestId: 'r3' }, (m) => replies.push(m));
    expect(replies[0]).toMatchObject({ requestId: 'r3', ok: false });
    release();
    await first;
    expect(replies[1]).toMatchObject({ requestId: 'r1', ok: true });
  });
});
