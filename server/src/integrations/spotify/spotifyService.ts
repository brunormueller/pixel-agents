import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import type { AgentStateStore } from '../../agentStateStore.js';
import {
  LAYOUT_FILE_DIR,
  SPOTIFY_AUTH_TIMEOUT_MS,
  SPOTIFY_CALLBACK_PAGE_STYLE,
  SPOTIFY_CALLBACK_PATH,
  SPOTIFY_CALLBACK_PORT,
  SPOTIFY_FETCH_TIMEOUT_MS,
  SPOTIFY_FILE_NAME,
  SPOTIFY_POLL_MS,
  SPOTIFY_SCOPES,
} from '../../constants.js';

type WsSend = (message: Record<string, unknown>) => void;

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponse>;

export interface SpotifyTrack {
  title: string;
  artist: string;
  album?: string;
  isPlaying: boolean;
  trackUrl?: string;
  progressMs?: number;
  durationMs?: number;
}

interface SavedTokens {
  clientId: string;
  accessToken?: string;
  refreshToken?: string;
  /** ms since epoch */
  expiresAt?: number;
}

interface PendingAuth {
  verifier: string;
  state: string;
  clientId: string;
  server: http.Server;
  timer: ReturnType<typeof setTimeout>;
}

export interface SpotifyServiceOptions {
  /** Defaults to ~/.pixel-agents/spotify.json. */
  filePath?: string;
  fetchImpl?: FetchLike;
  /** Port of the loopback OAuth redirect (tests pick a free one). */
  callbackPort?: number;
  /** The surface can open a browser itself (VS Code). Standalone leaves it unset and the requesting page opens it. */
  openUrl?: (url: string) => void;
  /** What is playing changed (null = nothing, paused, or disconnected). */
  onTrack?: (track: SpotifyTrack | null) => void;
  pollMs?: number;
}

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
/** A Spotify app client id: 32 hex characters. */
const CLIENT_ID = /^[0-9a-f]{32}$/i;
const TRACK_ID = /^[A-Za-z0-9]{1,64}$/;

const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** PKCE pair (RFC 7636, S256). */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The Spotify integration: "now playing" for the person's character and the
 * music panel, plus play/pause/next/previous (those need Spotify Premium).
 *
 * Sign-in is OAuth 2 with PKCE against the person's OWN Spotify app — Pixel
 * Agents ships no client secret, and Spotify only redirects to URIs registered
 * in the app, so the person registers `redirectUri` (a fixed loopback port,
 * listened on only while a sign-in is in progress) once in their dashboard.
 *
 * The tokens stay in ~/.pixel-agents/spotify.json (mode 0600); the webview only
 * ever sees whether it is connected and what is playing. What the room sees is
 * decided elsewhere (MultiplayerClient, and only with sharing turned on).
 */
export class SpotifyService {
  private tokens: SavedTokens | null = null;
  private pending: PendingAuth | null = null;
  private nowPlaying: SpotifyTrack | null = null;
  private error: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly filePath: string;
  private readonly fetchImpl: FetchLike;
  private readonly callbackPort: number;

  constructor(
    private readonly store: AgentStateStore,
    private readonly options: SpotifyServiceOptions = {},
  ) {
    this.filePath = options.filePath ?? path.join(os.homedir(), LAYOUT_FILE_DIR, SPOTIFY_FILE_NAME);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
    this.callbackPort = options.callbackPort ?? SPOTIFY_CALLBACK_PORT;
  }

  get redirectUri(): string {
    return `http://127.0.0.1:${this.callbackPort}${SPOTIFY_CALLBACK_PATH}`;
  }

  start(): void {
    this.tokens = this.readTokens();
    if (this.isConnected()) this.startPolling();
  }

  isConnected(): boolean {
    return !!this.tokens?.refreshToken;
  }

  /** `spotifyCommand` from the webview. `reply` reaches only the client that asked. */
  async command(msg: Record<string, unknown>, reply?: WsSend): Promise<void> {
    try {
      this.error = null;
      switch (msg.action) {
        case 'connect':
          await this.connect(msg.clientId, reply);
          break;
        case 'disconnect':
          this.disconnect();
          break;
        case 'play':
          await this.api('PUT', '/me/player/play');
          await this.pollNow();
          break;
        case 'pause':
          await this.api('PUT', '/me/player/pause');
          await this.pollNow();
          break;
        case 'next':
          await this.api('POST', '/me/player/next');
          await this.pollNow(600);
          break;
        case 'previous':
          await this.api('POST', '/me/player/previous');
          await this.pollNow(600);
          break;
        case 'refresh':
          await this.pollNow();
          break;
      }
    } catch (err) {
      this.error = describeError(err);
    }
    this.broadcast();
  }

  resend(send: WsSend): void {
    send(this.statusMessage());
  }

  dispose(): void {
    this.disposed = true;
    this.stopPolling();
    this.cancelPending();
  }

  // ── Sign-in ────────────────────────────────────────────────

  private async connect(rawClientId: unknown, reply?: WsSend): Promise<void> {
    const clientId = typeof rawClientId === 'string' ? rawClientId.trim() : this.tokens?.clientId;
    if (!clientId || !CLIENT_ID.test(clientId)) {
      throw new Error('Paste the Client ID of your Spotify app (32 letters and numbers).');
    }
    this.cancelPending();
    const { verifier, challenge } = createPkce();
    const state = base64url(crypto.randomBytes(16));
    const server = http.createServer((req, res) => void this.onCallback(req, res));
    await new Promise<void>((resolve, reject) => {
      server.once('error', (err: NodeJS.ErrnoException) =>
        reject(
          new Error(
            err.code === 'EADDRINUSE'
              ? `Port ${this.callbackPort} is busy — another Pixel Agents window may be signing in.`
              : err.message,
          ),
        ),
      );
      server.listen(this.callbackPort, '127.0.0.1', () => resolve());
    });
    const timer = setTimeout(() => {
      this.cancelPending();
      this.error = 'Spotify sign-in timed out. Try again.';
      this.broadcast();
    }, SPOTIFY_AUTH_TIMEOUT_MS);
    timer.unref?.();
    this.pending = { verifier, state, clientId, server, timer };

    const url = new URL(`${ACCOUNTS}/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SPOTIFY_SCOPES.join(' '),
      redirect_uri: this.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    }).toString();
    if (this.options.openUrl) this.options.openUrl(url.toString());
    else reply?.({ type: 'openExternalUrl', url: url.toString() });
  }

  private async onCallback(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const pending = this.pending;
    const url = new URL(req.url ?? '/', this.redirectUri);
    if (url.pathname !== SPOTIFY_CALLBACK_PATH || !pending) {
      res.writeHead(404).end();
      return;
    }
    const page = (title: string, body: string) => {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
          `<body style="${SPOTIFY_CALLBACK_PAGE_STYLE}">` +
          `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></body>`,
      );
    };
    // A redirect that doesn't carry our state is not the answer to our request.
    if (url.searchParams.get('state') !== pending.state) {
      page(
        'Pixel Agents',
        'This sign-in link is not the one Pixel Agents started. Try again from the app.',
      );
      return;
    }
    this.cancelPending();
    const code = url.searchParams.get('code');
    if (!code) {
      const reason = url.searchParams.get('error') ?? 'no code';
      this.error =
        reason === 'access_denied' ? 'Spotify access was not granted.' : `Spotify: ${reason}`;
      page('Spotify not connected', 'You can close this tab.');
      this.broadcast();
      return;
    }
    try {
      const tokens = await this.tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        client_id: pending.clientId,
        code_verifier: pending.verifier,
      });
      this.tokens = { clientId: pending.clientId, ...tokens };
      this.writeTokens();
      this.error = null;
      page(
        'Spotify connected',
        'Pixel Agents can now see what you are playing. You can close this tab.',
      );
      this.startPolling();
      await this.pollNow();
    } catch (err) {
      this.error = describeError(err);
      page('Spotify not connected', this.error);
    }
    this.broadcast();
  }

  private cancelPending(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    clearTimeout(p.timer);
    p.server.close();
  }

  private disconnect(): void {
    this.cancelPending();
    this.stopPolling();
    const clientId = this.tokens?.clientId;
    // Keep the client id so reconnecting doesn't mean pasting it again.
    this.tokens = clientId ? { clientId } : null;
    this.writeTokens();
    this.setTrack(null);
  }

  // ── Tokens ─────────────────────────────────────────────────

  private async tokenRequest(
    form: Record<string, string>,
  ): Promise<Pick<SavedTokens, 'accessToken' | 'refreshToken' | 'expiresAt'>> {
    const res = await this.fetchImpl(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof data.access_token !== 'string') {
      const reason = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
      throw new SpotifyError(`Spotify refused the sign-in (${reason}).`, res.status);
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;
    return {
      accessToken: data.access_token,
      // Refresh tokens may rotate; keep the old one when none comes back.
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : this.tokens?.refreshToken,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    };
  }

  private async accessToken(forceRefresh = false): Promise<string> {
    if (!this.tokens?.refreshToken) throw new SpotifyError('Spotify is not connected.', 401);
    if (!forceRefresh && this.tokens.accessToken && (this.tokens.expiresAt ?? 0) > Date.now()) {
      return this.tokens.accessToken;
    }
    // Another window may have refreshed (and rotated the refresh token) meanwhile.
    const onDisk = this.readTokens();
    if (
      !forceRefresh &&
      onDisk?.accessToken &&
      onDisk.refreshToken &&
      (onDisk.expiresAt ?? 0) > Date.now()
    ) {
      this.tokens = onDisk;
      return onDisk.accessToken;
    }
    if (onDisk?.refreshToken) this.tokens = onDisk;
    try {
      const next = await this.tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken!,
        client_id: this.tokens.clientId,
      });
      this.tokens = { ...this.tokens, ...next };
      this.writeTokens();
      return this.tokens.accessToken!;
    } catch (err) {
      if (err instanceof SpotifyError && err.status === 400) {
        // invalid_grant: access was revoked, or the refresh token was replaced elsewhere.
        this.disconnect();
        throw new SpotifyError('Spotify access expired. Connect again.', 401);
      }
      throw err;
    }
  }

  /** One Web API call, retried once with a fresh token on 401. */
  private async api(method: string, pathname: string, retried = false): Promise<unknown> {
    const token = await this.accessToken(retried);
    const res = await this.fetchImpl(`${API}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
    });
    if (res.status === 401 && !retried) return this.api(method, pathname, true);
    if (res.status === 204 || res.status === 202) return null;
    if (res.status === 403 && method !== 'GET') {
      throw new SpotifyError('Controlling playback needs Spotify Premium.', 403);
    }
    if (res.status === 404 && method !== 'GET') {
      throw new SpotifyError(
        'No active Spotify device — start playing in a Spotify app first.',
        404,
      );
    }
    if (res.status === 429)
      throw new SpotifyError('Spotify is rate limiting. Try again shortly.', 429);
    if (!res.ok) throw new SpotifyError(`Spotify answered HTTP ${res.status}.`, res.status);
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  // ── Now playing ────────────────────────────────────────────

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      this.pollNow().then(
        () => this.broadcast(),
        (err: unknown) => {
          const message = describeError(err);
          if (message !== this.error) {
            this.error = message;
            this.broadcast();
          }
        },
      );
    }, this.options.pollMs ?? SPOTIFY_POLL_MS);
    this.pollTimer.unref?.();
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** Ask what is playing (optionally after a short delay, for skip to land). */
  private async pollNow(delayMs = 0): Promise<void> {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    if (!this.isConnected() || this.disposed) return;
    const data = await this.api(
      'GET',
      '/me/player/currently-playing?additional_types=track,episode',
    );
    this.setTrack(parseCurrentlyPlaying(data));
  }

  private setTrack(track: SpotifyTrack | null): void {
    // Progress ticks every poll; only a different song or play/pause is news for the room.
    const key = (t: SpotifyTrack | null) =>
      t ? `${t.title}|${t.artist}|${t.isPlaying}|${t.trackUrl ?? ''}` : '';
    const changed = key(this.nowPlaying) !== key(track);
    this.nowPlaying = track;
    if (changed) this.options.onTrack?.(track);
  }

  // ── Webview ────────────────────────────────────────────────

  private statusMessage(): Record<string, unknown> {
    const msg: Record<string, unknown> = {
      type: 'spotifyStatus',
      clientId: this.tokens?.clientId ?? '',
      redirectUri: this.redirectUri,
      connected: this.isConnected(),
      pendingAuth: this.pending !== null,
      nowPlaying: this.nowPlaying,
    };
    if (this.error) msg.error = this.error;
    return msg;
  }

  private broadcast(): void {
    if (!this.disposed) this.store.broadcast(this.statusMessage());
  }

  // ── Persistence ────────────────────────────────────────────

  private readTokens(): SavedTokens | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Record<string, unknown>;
      if (typeof raw.clientId !== 'string' || !CLIENT_ID.test(raw.clientId)) return null;
      const tokens: SavedTokens = { clientId: raw.clientId };
      if (typeof raw.accessToken === 'string') tokens.accessToken = raw.accessToken;
      if (typeof raw.refreshToken === 'string') tokens.refreshToken = raw.refreshToken;
      if (typeof raw.expiresAt === 'number') tokens.expiresAt = raw.expiresAt;
      return tokens;
    } catch {
      return null;
    }
  }

  /** Atomic, owner-only: the refresh token is a long-lived credential. */
  private writeTokens(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.tokens ?? {}, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.warn('[Pixel Agents] Spotify: could not save the sign-in:', err);
    }
  }
}

/** Web API `currently-playing` → what the panel shows. Null when nothing is loaded. */
export function parseCurrentlyPlaying(data: unknown): SpotifyTrack | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const item = d.item as Record<string, unknown> | null | undefined;
  if (!item || typeof item.name !== 'string') return null;
  let artist = '';
  if (Array.isArray(item.artists)) {
    artist = item.artists
      .map((a) =>
        a && typeof (a as { name?: unknown }).name === 'string' ? (a as { name: string }).name : '',
      )
      .filter(Boolean)
      .join(', ');
  } else if (item.show && typeof (item.show as { name?: unknown }).name === 'string') {
    artist = (item.show as { name: string }).name; // a podcast episode
  }
  const track: SpotifyTrack = { title: item.name, artist, isPlaying: d.is_playing === true };
  const album = (item.album as { name?: unknown } | undefined)?.name;
  if (typeof album === 'string') track.album = album;
  if (typeof d.progress_ms === 'number') track.progressMs = Math.round(d.progress_ms);
  if (typeof item.duration_ms === 'number') track.durationMs = Math.round(item.duration_ms);
  if (item.type === 'track' && typeof item.id === 'string' && TRACK_ID.test(item.id)) {
    track.trackUrl = `https://open.spotify.com/track/${item.id}`;
  }
  return track;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError')
      return 'Spotify did not answer in time.';
    return err.message;
  }
  return String(err);
}
