import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { CalendarService, normalizeFeedUrl } from '../src/integrations/calendar/calendarService.js';
import { isOpenableUrl } from '../src/integrations/index.js';
import {
  createPkce,
  parseCurrentlyPlaying,
  SpotifyService,
} from '../src/integrations/spotify/spotifyService.js';

const tmpDirs: string[] = [];
function tmpFile(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-integrations-'));
  tmpDirs.push(dir);
  return path.join(dir, name);
}

const disposables: Array<{ dispose(): void }> = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d.dispose();
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function captured(store: AgentStateStore, type: string) {
  const messages: Array<Record<string, any>> = [];
  store.on('broadcast', (m) => {
    if (m.type === type) messages.push(m as Record<string, any>);
  });
  return { last: () => messages.at(-1), all: messages };
}

// ── Calendar ─────────────────────────────────────────────────

const NOW = Date.UTC(2026, 8, 24, 13, 10);

function ics(): string {
  return [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:standup',
    'DTSTART:20260924T130000Z',
    'DTEND:20260924T133000Z',
    'SUMMARY:Standup',
    'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:later',
    'DTSTART:20260924T160000Z',
    'DTEND:20260924T170000Z',
    'SUMMARY:1:1',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:past',
    'DTSTART:20260924T080000Z',
    'DTEND:20260924T090000Z',
    'SUMMARY:Gone',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function fakeFeedFetch(body: string, status = 200) {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    return { ok: status < 400, status, body: null, text: async () => body };
  };
  return { fetchImpl, urls };
}

describe('calendar integration', () => {
  it('accepts https and webcal addresses only', () => {
    expect(normalizeFeedUrl('webcal://calendar.google.com/calendar/ical/x/basic.ics')).toBe(
      'https://calendar.google.com/calendar/ical/x/basic.ics',
    );
    expect(normalizeFeedUrl('http://example.com/cal.ics')).toBeNull();
    expect(normalizeFeedUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeFeedUrl(42)).toBeNull();
  });

  it('syncs a feed, reports upcoming events, and never shows the secret address', async () => {
    const store = new AgentStateStore();
    const state = captured(store, 'calendarState');
    const meeting: boolean[] = [];
    const { fetchImpl, urls } = fakeFeedFetch(ics());
    const filePath = tmpFile('calendar.json');
    const cal = new CalendarService(store, {
      filePath,
      fetchImpl,
      now: () => NOW,
      onMeetingChange: (m) => meeting.push(m),
    });
    disposables.push(cal);
    cal.start();

    await cal.configure({
      addFeed: 'webcal://calendar.google.com/calendar/ical/secret123/basic.ics',
    });
    expect(urls).toEqual(['https://calendar.google.com/calendar/ical/secret123/basic.ics']);
    const msg = state.last()!;
    expect(JSON.stringify(msg)).not.toContain('secret123');
    expect(msg.feeds).toEqual([{ id: expect.any(String), label: 'calendar.google.com', ok: true }]);
    expect(msg.events.map((e: any) => e.title)).toEqual(['Standup', '1:1']);
    expect(msg.events[0].joinUrl).toBe('https://meet.google.com/abc-defg-hij');
    expect(msg.inMeeting).toBe(true);
    expect(meeting.at(-1)).toBe(true);

    // The address is kept, owner-only.
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(saved.feeds[0].url).toContain('secret123');
    if (process.platform !== 'win32') expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);

    // Turning the automatic status off tells the room nothing anymore.
    await cal.configure({ autoStatus: false });
    expect(meeting.at(-1)).toBe(false);
    expect(state.last()!.inMeeting).toBe(true);

    await cal.configure({ removeFeed: msg.feeds[0].id });
    expect(state.last()!.feeds).toEqual([]);
    expect(state.last()!.events).toEqual([]);
  });

  it('refuses a malformed address and reports a feed that stopped working', async () => {
    const store = new AgentStateStore();
    const state = captured(store, 'calendarState');
    const { fetchImpl } = fakeFeedFetch('nope', 404);
    const cal = new CalendarService(store, {
      filePath: tmpFile('calendar.json'),
      fetchImpl,
      now: () => NOW,
    });
    disposables.push(cal);
    cal.start();
    await cal.configure({ addFeed: 'not a url' });
    expect(state.last()!.error).toMatch(/https/);
    await cal.configure({ addFeed: 'https://outlook.office365.com/owa/calendar/x/calendar.ics' });
    expect(state.last()!.feeds[0]).toMatchObject({ label: 'outlook.office365.com', ok: false });
    expect(state.last()!.feeds[0].error).toMatch(/404/);
  });
});

// ── Spotify ──────────────────────────────────────────────────

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

interface FakeCall {
  url: string;
  method: string;
  body?: string;
}

function fakeSpotify(opts: { playStatus?: number } = {}) {
  const calls: FakeCall[] = [];
  const json = (status: number, data: unknown) => ({
    ok: status < 400,
    status,
    json: async () => data,
    text: async () => (data === null ? '' : JSON.stringify(data)),
  });
  const fetchImpl = async (url: string, init: { method?: string; body?: string } = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body });
    if (url.endsWith('/api/token')) {
      return json(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 });
    }
    if (url.includes('/me/player/currently-playing')) {
      return json(200, {
        is_playing: true,
        progress_ms: 1000,
        item: {
          type: 'track',
          id: 'track123',
          name: 'Song',
          duration_ms: 200000,
          artists: [{ name: 'Band' }, { name: 'Guest' }],
          album: { name: 'Album' },
        },
      });
    }
    if (url.includes('/me/player/')) return json(opts.playStatus ?? 204, null);
    return json(404, {});
  };
  return { fetchImpl, calls };
}

describe('Spotify integration', () => {
  it('PKCE: the challenge is the SHA-256 of the verifier, base64url', () => {
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const expected = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });

  it('reads what is playing: tracks, podcast episodes, nothing', () => {
    expect(
      parseCurrentlyPlaying({
        is_playing: false,
        item: { type: 'track', id: 'abc', name: 'Song', artists: [{ name: 'A' }] },
      }),
    ).toEqual({
      title: 'Song',
      artist: 'A',
      isPlaying: false,
      trackUrl: 'https://open.spotify.com/track/abc',
    });
    expect(
      parseCurrentlyPlaying({
        is_playing: true,
        item: { type: 'episode', name: 'Ep 1', show: { name: 'Pod' } },
      }),
    ).toMatchObject({ title: 'Ep 1', artist: 'Pod', isPlaying: true });
    expect(parseCurrentlyPlaying(null)).toBeNull();
  });

  it('signs in through the loopback redirect, then reports the song; tokens never reach the webview', async () => {
    const store = new AgentStateStore();
    const status = captured(store, 'spotifyStatus');
    const tracks: unknown[] = [];
    const opened: string[] = [];
    const port = await freePort();
    const filePath = tmpFile('spotify.json');
    const { fetchImpl, calls } = fakeSpotify();
    const spotify = new SpotifyService(store, {
      filePath,
      fetchImpl,
      callbackPort: port,
      openUrl: (u) => opened.push(u),
      onTrack: (t) => tracks.push(t),
      pollMs: 60_000,
    });
    disposables.push(spotify);
    spotify.start();

    await spotify.command({ action: 'connect', clientId: '0123456789abcdef0123456789abcdef' });
    expect(status.last()).toMatchObject({ connected: false, pendingAuth: true });
    const auth = new URL(opened[0]);
    expect(auth.origin).toBe('https://accounts.spotify.com');
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(auth.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${port}/spotify/callback`);

    // A redirect with someone else's state is not our answer.
    const bad = await fetch(`http://127.0.0.1:${port}/spotify/callback?code=x&state=wrong`);
    expect(await bad.text()).toContain('not the one');
    expect(calls.some((c) => c.url.endsWith('/api/token'))).toBe(false);

    const res = await fetch(
      `http://127.0.0.1:${port}/spotify/callback?code=CODE&state=${auth.searchParams.get('state')}`,
    );
    expect(await res.text()).toContain('Spotify connected');
    const tokenCall = calls.find((c) => c.url.endsWith('/api/token'))!;
    expect(tokenCall.body).toContain('code_verifier=');
    expect(tokenCall.body).not.toContain('client_secret');

    const last = status.last()!;
    expect(last).toMatchObject({
      connected: true,
      pendingAuth: false,
      nowPlaying: { title: 'Song', artist: 'Band, Guest', isPlaying: true },
    });
    expect(JSON.stringify(status.all)).not.toContain('AT');
    expect(JSON.stringify(status.all)).not.toContain('"RT"');
    expect(tracks.at(-1)).toMatchObject({
      title: 'Song',
      trackUrl: 'https://open.spotify.com/track/track123',
    });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toMatchObject({ refreshToken: 'RT' });

    await spotify.command({ action: 'disconnect' });
    expect(status.last()).toMatchObject({ connected: false, nowPlaying: null });
    expect(tracks.at(-1)).toBeNull();
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8')).refreshToken).toBeUndefined();
  });

  it('explains why playback control failed (Premium)', async () => {
    const store = new AgentStateStore();
    const status = captured(store, 'spotifyStatus');
    const filePath = tmpFile('spotify.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        clientId: '0123456789abcdef0123456789abcdef',
        accessToken: 'AT',
        refreshToken: 'RT',
        expiresAt: Date.now() + 3_600_000,
      }),
    );
    const { fetchImpl } = fakeSpotify({ playStatus: 403 });
    const spotify = new SpotifyService(store, { filePath, fetchImpl, pollMs: 60_000 });
    disposables.push(spotify);
    spotify.start();
    await spotify.command({ action: 'pause' });
    expect(status.last()!.error).toMatch(/Premium/);
  });

  it('refuses a malformed client id', async () => {
    const store = new AgentStateStore();
    const status = captured(store, 'spotifyStatus');
    const spotify = new SpotifyService(store, {
      filePath: tmpFile('spotify.json'),
      fetchImpl: fakeSpotify().fetchImpl,
    });
    disposables.push(spotify);
    await spotify.command({ action: 'connect', clientId: 'hello' });
    expect(status.last()!.error).toMatch(/Client ID/);
  });
});

describe('opening links', () => {
  it('only https links are opened for the person', () => {
    expect(isOpenableUrl('https://meet.google.com/abc')).toBe(true);
    expect(isOpenableUrl('http://example.com')).toBe(false);
    expect(isOpenableUrl('file:///etc/passwd')).toBe(false);
    expect(isOpenableUrl('vscode://settings')).toBe(false);
    expect(isOpenableUrl(null)).toBe(false);
  });
});
