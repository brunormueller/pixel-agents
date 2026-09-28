import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentStateStore } from '../../agentStateStore.js';
import {
  CALENDAR_FETCH_TIMEOUT_MS,
  CALENDAR_FILE_NAME,
  CALENDAR_MAX_EVENTS,
  CALENDAR_MAX_FEED_BYTES,
  CALENDAR_MAX_FEEDS,
  CALENDAR_SYNC_INTERVAL_MS,
  CALENDAR_TICK_MS,
  CALENDAR_WINDOW_MS,
  LAYOUT_FILE_DIR,
} from '../../constants.js';
import type { CalendarOccurrence } from './ics.js';
import { expandEvents, parseIcs } from './ics.js';

type WsSend = (message: Record<string, unknown>) => void;
type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}>;

interface FeedConfig {
  id: string;
  url: string;
}

interface CalendarConfig {
  feeds: FeedConfig[];
  /** Tell the room "in a meeting" while an event is in progress. */
  autoStatus: boolean;
}

interface FeedState {
  ok: boolean;
  error?: string;
  events: CalendarOccurrence[];
}

export interface CalendarServiceOptions {
  /** Defaults to ~/.pixel-agents/calendar.json. */
  filePath?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  /** A meeting started or ended — only reported while autoStatus is on (off = always false). */
  onMeetingChange?: (inMeeting: boolean) => void;
}

/** The feed as the person pasted it → the https URL to fetch, or null. webcal:// is the same feed over https. */
export function normalizeFeedUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  // The URL is the credential: never send it in the clear.
  if (url.protocol !== 'https:' || !url.hostname) return null;
  return url.toString();
}

const feedId = (url: string): string =>
  crypto.createHash('sha256').update(url).digest('hex').slice(0, 12);

/**
 * The calendar integration. The person pastes the secret iCal address of their
 * Google or Outlook calendar; this fetches it every few minutes, keeps the
 * next 24 hours of events in memory, and tells the webview (`calendarState`)
 * what is coming up and how to join it.
 *
 * Privacy: the feed URL is a read credential for the whole calendar, so it is
 * stored mode 0600 and never sent to the webview (only its host). Events never
 * leave the machine; the most the room learns is the "in a meeting" status,
 * and only while `autoStatus` is on.
 */
export class CalendarService {
  private config: CalendarConfig = { feeds: [], autoStatus: true };
  private readonly feedState = new Map<string, FeedState>();
  private syncedAt: number | null = null;
  private inMeeting = false;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private syncing: Promise<void> | null = null;
  private disposed = false;
  private readonly filePath: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(
    private readonly store: AgentStateStore,
    private readonly options: CalendarServiceOptions = {},
  ) {
    this.filePath =
      options.filePath ?? path.join(os.homedir(), LAYOUT_FILE_DIR, CALENDAR_FILE_NAME);
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
    this.now = options.now ?? Date.now;
  }

  /** Load the saved feeds and start syncing. */
  start(): void {
    this.config = this.readConfig();
    this.syncTimer = setInterval(() => void this.sync(), CALENDAR_SYNC_INTERVAL_MS);
    this.syncTimer.unref?.();
    this.tickTimer = setInterval(() => this.evaluate(), CALENDAR_TICK_MS);
    this.tickTimer.unref?.();
    if (this.config.feeds.length > 0) void this.sync();
  }

  /** `configureCalendar` from the webview. Resolves once the resulting sync settled. */
  async configure(msg: Record<string, unknown>): Promise<void> {
    let changed = false;
    if (typeof msg.addFeed === 'string') {
      const url = normalizeFeedUrl(msg.addFeed);
      if (!url) {
        this.store.broadcast({
          ...this.stateMessage(),
          error: 'That is not an https:// or webcal:// calendar address.',
        });
        return;
      }
      const id = feedId(url);
      if (!this.config.feeds.some((f) => f.id === id)) {
        if (this.config.feeds.length >= CALENDAR_MAX_FEEDS) {
          this.store.broadcast({
            ...this.stateMessage(),
            error: `At most ${CALENDAR_MAX_FEEDS} calendars.`,
          });
          return;
        }
        this.config.feeds.push({ id, url });
        changed = true;
      }
    }
    if (typeof msg.removeFeed === 'string') {
      const before = this.config.feeds.length;
      this.config.feeds = this.config.feeds.filter((f) => f.id !== msg.removeFeed);
      this.feedState.delete(msg.removeFeed);
      changed ||= this.config.feeds.length !== before;
    }
    if (typeof msg.autoStatus === 'boolean' && msg.autoStatus !== this.config.autoStatus) {
      this.config.autoStatus = msg.autoStatus;
      changed = true;
    }
    if (changed) this.writeConfig();
    if (changed || msg.refresh === true) await this.sync();
    else this.broadcast();
  }

  /** Everything a (re)connected webview needs. */
  resend(send: WsSend): void {
    send(this.stateMessage());
  }

  /** Upcoming events across all feeds (exposed for tests). */
  events(): CalendarOccurrence[] {
    const now = this.now();
    const seen = new Set<string>();
    const all: CalendarOccurrence[] = [];
    for (const feed of this.config.feeds) {
      for (const ev of this.feedState.get(feed.id)?.events ?? []) {
        // Still to come, or in progress; the same event in two feeds (a shared calendar) once.
        if (ev.end <= now && !(ev.end === ev.start && ev.start >= now)) continue;
        const key = `${ev.title}|${ev.start}|${ev.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(ev);
      }
    }
    return all.sort((a, b) => a.start - b.start).slice(0, CALENDAR_MAX_EVENTS);
  }

  dispose(): void {
    this.disposed = true;
    if (this.syncTimer) clearInterval(this.syncTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  // ── Sync ───────────────────────────────────────────────────

  /** Fetch every feed again. Concurrent callers share one run. */
  sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      const from = this.now();
      const to = from + CALENDAR_WINDOW_MS;
      await Promise.all(
        this.config.feeds.map(async (feed) => {
          try {
            const text = await this.fetchFeed(feed.url);
            // Include events that started before now and are still going.
            const events = expandEvents(parseIcs(text), from - CALENDAR_WINDOW_MS, to).filter(
              (e) => e.end > from || (e.end === e.start && e.start >= from),
            );
            this.feedState.set(feed.id, { ok: true, events });
          } catch (err) {
            const prev = this.feedState.get(feed.id);
            // Keep the last good events: a flaky network shouldn't empty the agenda.
            this.feedState.set(feed.id, {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              events: prev?.events ?? [],
            });
          }
        }),
      );
      this.syncedAt = this.now();
    })().finally(() => {
      this.syncing = null;
    });
    return this.syncing.then(() => {
      if (!this.disposed) this.evaluate(true);
    });
  }

  private async fetchFeed(url: string): Promise<string> {
    const res = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(CALENDAR_FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1' },
    });
    if (!res.ok) {
      throw new Error(
        res.status === 401 || res.status === 403 || res.status === 404
          ? `The calendar refused the address (HTTP ${res.status}) — was it reset?`
          : `HTTP ${res.status}`,
      );
    }
    if (!res.body) return res.text();
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > CALENDAR_MAX_FEED_BYTES) {
        await reader.cancel();
        throw new Error('The calendar is too large to read.');
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf-8');
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That address is not an iCal calendar.');
    return text;
  }

  /** Re-derive "in a meeting" (it changes with the clock, not only with syncs) and broadcast. */
  private evaluate(forceBroadcast = false): void {
    const now = this.now();
    const inMeeting = this.events().some(
      (e) => !e.allDay && !e.free && e.start <= now && now < e.end,
    );
    const report = this.config.autoStatus && inMeeting;
    const changed = inMeeting !== this.inMeeting;
    this.inMeeting = inMeeting;
    if (changed || forceBroadcast) this.broadcast();
    if (changed || forceBroadcast) this.options.onMeetingChange?.(report);
  }

  private broadcast(): void {
    if (!this.disposed) this.store.broadcast(this.stateMessage());
  }

  private stateMessage(): Record<string, unknown> {
    const msg: Record<string, unknown> = {
      type: 'calendarState',
      feeds: this.config.feeds.map((f) => {
        const state = this.feedState.get(f.id);
        const info: Record<string, unknown> = {
          id: f.id,
          label: safeHost(f.url),
          ok: state ? state.ok : true,
        };
        if (state?.error) info.error = state.error;
        return info;
      }),
      events: this.events().map((e) => {
        const out: Record<string, unknown> = {
          id: e.id,
          title: e.title,
          start: e.start,
          end: e.end,
          allDay: e.allDay,
        };
        if (e.joinUrl) out.joinUrl = e.joinUrl;
        if (e.location) out.location = e.location;
        return out;
      }),
      autoStatus: this.config.autoStatus,
      inMeeting: this.inMeeting,
    };
    if (this.syncedAt !== null) msg.syncedAt = this.syncedAt;
    return msg;
  }

  // ── Persistence ────────────────────────────────────────────

  private readConfig(): CalendarConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Record<string, unknown>;
      const feeds: FeedConfig[] = [];
      for (const f of Array.isArray(raw.feeds) ? raw.feeds : []) {
        const url = normalizeFeedUrl((f as Record<string, unknown> | null)?.url);
        if (url && feeds.length < CALENDAR_MAX_FEEDS && !feeds.some((x) => x.url === url)) {
          feeds.push({ id: feedId(url), url });
        }
      }
      return { feeds, autoStatus: raw.autoStatus !== false };
    } catch {
      return { feeds: [], autoStatus: true };
    }
  }

  /** Atomic, owner-only: the file holds read credentials for the person's calendars. */
  private writeConfig(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(
        tmp,
        JSON.stringify(
          {
            feeds: this.config.feeds.map((f) => ({ url: f.url })),
            autoStatus: this.config.autoStatus,
          },
          null,
          2,
        ),
        { encoding: 'utf-8', mode: 0o600 },
      );
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.warn('[Pixel Agents] Calendar: could not save the calendar settings:', err);
    }
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'calendar';
  }
}
