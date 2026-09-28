/**
 * Minimal iCalendar (RFC 5545) reader for the calendar integration.
 *
 * Covers what the secret iCal feeds of Google Calendar and Outlook publish:
 * VEVENTs with UTC, floating, all-day and TZID times (IANA names, Windows
 * names, or a VTIMEZONE block), recurring series (RRULE with the common
 * DAILY / WEEKLY / MONTHLY / YEARLY shapes, EXDATE, and RECURRENCE-ID
 * overrides), cancelled events, and the video-call link hidden somewhere in
 * the event (Google's X-GOOGLE-CONFERENCE, the location, the description).
 *
 * Pure: no I/O. `expandEvents` turns a parsed feed into the concrete
 * occurrences inside a time window.
 */

import { CALENDAR_MAX_OCCURRENCES } from '../../constants.js';

export interface CalendarOccurrence {
  /** Stable per occurrence: the series uid plus its start. */
  id: string;
  title: string;
  /** ms since epoch */
  start: number;
  end: number;
  allDay: boolean;
  joinUrl?: string;
  location?: string;
  /** TRANSP:TRANSPARENT — the event does not make the person busy. */
  free: boolean;
}

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** A calendar time as written, before it is placed on the timeline. */
interface IcsTime {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** YYYYMMDD with VALUE=DATE: a whole day. */
  dateOnly: boolean;
  /** Ends in Z. */
  utc: boolean;
  tzid?: string;
}

interface IcsRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: number;
  byDay: Array<{ day: number; nth: number }>;
  byMonthDay: number[];
  byMonth: number[];
}

interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  conference: string;
  url: string;
  start: IcsTime;
  end?: IcsTime;
  durationMs?: number;
  rule?: IcsRule;
  exdates: number[];
  recurrenceId?: number;
  cancelled: boolean;
  free: boolean;
}

/** STANDARD offset of a VTIMEZONE (DST rules are not modeled: a fallback for unknown names only). */
type ZoneOffsets = Map<string, number>;

export interface ParsedCalendar {
  events: IcsEvent[];
  zones: ZoneOffsets;
}

// ── Lines ────────────────────────────────────────────────────

/** Unfold (a line starting with a space or tab continues the previous one) and split into properties. */
function contentLines(text: string): IcsProperty[] {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.trim() !== '') {
      lines.push(line);
    }
  }
  const out: IcsProperty[] = [];
  for (const line of lines) {
    // The value starts at the first ':' outside a quoted parameter value.
    let inQuotes = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === ':' && !inQuotes) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const parts = head.split(';');
    const params: Record<string, string> = {};
    for (const p of parts.slice(1)) {
      const eq = p.indexOf('=');
      if (eq < 0) continue;
      params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    }
    out.push({ name: parts[0].toUpperCase(), params, value });
  }
  return out;
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_m, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

// ── Times ────────────────────────────────────────────────────

function parseTime(prop: IcsProperty): IcsTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(prop.value.trim());
  if (!m) return null;
  const dateOnly = m[4] === undefined;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: dateOnly ? 0 : Number(m[4]),
    mi: dateOnly ? 0 : Number(m[5]),
    s: dateOnly || m[6] === undefined ? 0 : Number(m[6]),
    dateOnly: dateOnly || prop.params.VALUE === 'DATE',
    utc: m[7] === 'Z',
    tzid: prop.params.TZID,
  };
}

/** Windows time zone names Outlook writes, mapped to IANA. Not exhaustive: the common ones, Brazil's in full. */
const WINDOWS_ZONES: Record<string, string> = {
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Bahia Standard Time': 'America/Bahia',
  'Tocantins Standard Time': 'America/Araguaina',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Western Standard Time': 'America/Manaus',
  'SA Eastern Standard Time': 'America/Fortaleza',
  'SA Pacific Standard Time': 'America/Bogota',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'Pacific SA Standard Time': 'America/Santiago',
  'Montevideo Standard Time': 'America/Montevideo',
  'Paraguay Standard Time': 'America/Asuncion',
  'Venezuela Standard Time': 'America/Caracas',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Atlantic Standard Time': 'America/Halifax',
  'Canada Central Standard Time': 'America/Regina',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'Egypt Standard Time': 'Africa/Cairo',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Singapore Standard Time': 'Asia/Singapore',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'W. Australia Standard Time': 'Australia/Perth',
  'New Zealand Standard Time': 'Pacific/Auckland',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC',
};

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatterFor(tz: string): Intl.DateTimeFormat | null {
  if (formatters.has(tz)) return formatters.get(tz)!;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    f = null;
  }
  formatters.set(tz, f);
  return f;
}

/** Offset of an IANA zone at an instant, in ms (local = utc + offset). */
function zoneOffsetMs(utcMs: number, f: Intl.DateTimeFormat): number {
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000) * 60_000;
}

/** Wall-clock time in a zone → epoch ms. Unknown zone: the VTIMEZONE's standard offset, else the machine's zone. */
function wallToEpoch(
  t: Omit<IcsTime, 'dateOnly' | 'utc'>,
  tzid: string | undefined,
  zones: ZoneOffsets,
): number {
  const naive = Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi, t.s);
  if (!tzid) return new Date(t.y, t.mo - 1, t.d, t.h, t.mi, t.s).getTime();
  const clean = tzid.replace(/^\//, '');
  const iana = WINDOWS_ZONES[clean] ?? clean;
  const f = formatterFor(iana);
  if (f) {
    // Two passes settle the offset across a DST change.
    let guess = naive - zoneOffsetMs(naive, f);
    guess = naive - zoneOffsetMs(guess, f);
    return guess;
  }
  const fixed = zones.get(tzid);
  if (fixed !== undefined) return naive - fixed;
  return new Date(t.y, t.mo - 1, t.d, t.h, t.mi, t.s).getTime();
}

function toEpoch(t: IcsTime, zones: ZoneOffsets): number {
  if (t.utc) return Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi, t.s);
  // All-day and floating times are the person's own local day / clock.
  if (t.dateOnly) return new Date(t.y, t.mo - 1, t.d).getTime();
  return wallToEpoch(t, t.tzid, zones);
}

/** ISO 8601 duration (P1DT2H30M, PT45M, P1W) → ms. */
function parseDuration(value: string): number | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!m) return undefined;
  const n = (i: number) => (m[i] ? Number(m[i]) : 0);
  const ms = ((((n(2) * 7 + n(3)) * 24 + n(4)) * 60 + n(5)) * 60 + n(6)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

function parseOffset(value: string): number | undefined {
  const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec(value.trim());
  if (!m) return undefined;
  const ms = ((Number(m[2]) * 60 + Number(m[3])) * 60 + Number(m[4] ?? 0)) * 1000;
  return m[1] === '-' ? -ms : ms;
}

const WEEKDAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(value: string, zones: ZoneOffsets): IcsRule | undefined {
  const parts: Record<string, string> = {};
  for (const kv of value.split(';')) {
    const eq = kv.indexOf('=');
    if (eq > 0) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  const freq = parts.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY')
    return undefined;
  const rule: IcsRule = {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL) || 1),
    byDay: [],
    byMonthDay: [],
    byMonth: [],
  };
  if (parts.COUNT) rule.count = Math.max(1, Number(parts.COUNT) || 1);
  if (parts.UNTIL) {
    const t = parseTime({ name: 'UNTIL', params: {}, value: parts.UNTIL });
    // A date-only UNTIL includes that whole day.
    if (t) rule.until = toEpoch(t, zones) + (t.dateOnly ? 86_400_000 - 1 : 0);
  }
  for (const d of (parts.BYDAY ?? '').split(',')) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d.trim().toUpperCase());
    if (m) rule.byDay.push({ day: WEEKDAYS[m[2]], nth: m[1] ? Number(m[1]) : 0 });
  }
  for (const d of (parts.BYMONTHDAY ?? '').split(',')) {
    const n = Number(d);
    if (Number.isInteger(n) && n !== 0 && Math.abs(n) <= 31) rule.byMonthDay.push(n);
  }
  for (const d of (parts.BYMONTH ?? '').split(',')) {
    const n = Number(d);
    if (Number.isInteger(n) && n >= 1 && n <= 12) rule.byMonth.push(n);
  }
  return rule;
}

// ── Links ────────────────────────────────────────────────────

/** Video-call links, most specific first. Only these: a random link in a description is not "the meeting". */
const JOIN_PATTERNS: RegExp[] = [
  /https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^\s"'<>]*)?/i,
  /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>]+/i,
  /https:\/\/teams\.live\.com\/meet\/[^\s"'<>]+/i,
  /https:\/\/(?:[a-z0-9-]+\.)?zoom\.us\/(?:j|my|w|s)\/[^\s"'<>]+/i,
  /https:\/\/[a-z0-9-]+\.webex\.com\/[^\s"'<>]+/i,
  /https:\/\/whereby\.com\/[^\s"'<>]+/i,
  /https:\/\/meet\.jit\.si\/[^\s"'<>]+/i,
  /https:\/\/(?:app\.)?gather\.town\/[^\s"'<>]+/i,
  /https:\/\/[a-z0-9.-]*chime\.aws\/[^\s"'<>]+/i,
];

export function findJoinUrl(...texts: string[]): string | undefined {
  for (const pattern of JOIN_PATTERNS) {
    for (const text of texts) {
      const m = text ? pattern.exec(text) : null;
      if (m) return m[0].replace(/[)\].,;>]+$/, '');
    }
  }
  return undefined;
}

// ── Parse ────────────────────────────────────────────────────

export function parseIcs(text: string): ParsedCalendar {
  const events: IcsEvent[] = [];
  const zones: ZoneOffsets = new Map();
  const stack: string[] = [];
  let ev: Partial<IcsEvent> | null = null;
  let zoneId: string | null = null;
  let standardOffset: number | undefined;
  let anyOffset: number | undefined;
  // Properties whose parsing needs the zones collected so far (VTIMEZONE usually comes first, not always).
  const pending: Array<{ ev: Partial<IcsEvent>; prop: IcsProperty }> = [];

  for (const prop of contentLines(text)) {
    if (prop.name === 'BEGIN') {
      const what = prop.value.trim().toUpperCase();
      stack.push(what);
      if (what === 'VEVENT' && stack.length === 2) {
        ev = {
          summary: '',
          description: '',
          location: '',
          conference: '',
          url: '',
          exdates: [],
          cancelled: false,
          free: false,
        };
      } else if (what === 'VTIMEZONE') {
        zoneId = null;
        standardOffset = undefined;
        anyOffset = undefined;
      }
      continue;
    }
    if (prop.name === 'END') {
      const what = stack.pop();
      if (what === 'VEVENT' && ev && stack.length === 1) {
        if (ev.uid && ev.start) events.push(ev as IcsEvent);
        ev = null;
      } else if (what === 'VTIMEZONE' && zoneId) {
        const off = standardOffset ?? anyOffset;
        if (off !== undefined) zones.set(zoneId, off);
      }
      continue;
    }
    const inside = stack[stack.length - 1];
    if (inside === 'VTIMEZONE' && prop.name === 'TZID') zoneId = prop.value.trim();
    if ((inside === 'STANDARD' || inside === 'DAYLIGHT') && prop.name === 'TZOFFSETTO') {
      const off = parseOffset(prop.value);
      if (off !== undefined) {
        anyOffset ??= off;
        if (inside === 'STANDARD') standardOffset = off;
      }
    }
    if (!ev || inside !== 'VEVENT') continue;
    switch (prop.name) {
      case 'UID':
        ev.uid = prop.value.trim();
        break;
      case 'SUMMARY':
        ev.summary = unescapeText(prop.value);
        break;
      case 'DESCRIPTION':
        ev.description = unescapeText(prop.value);
        break;
      case 'LOCATION':
        ev.location = unescapeText(prop.value);
        break;
      case 'URL':
        ev.url = prop.value.trim();
        break;
      case 'X-GOOGLE-CONFERENCE':
      case 'X-MICROSOFT-SKYPETEAMSMEETINGURL':
      case 'X-MICROSOFT-ONLINEMEETINGEXTERNALLINK':
        ev.conference = prop.value.trim();
        break;
      case 'DTSTART': {
        const t = parseTime(prop);
        if (t) ev.start = t;
        break;
      }
      case 'DTEND': {
        const t = parseTime(prop);
        if (t) ev.end = t;
        break;
      }
      case 'DURATION':
        ev.durationMs = parseDuration(prop.value);
        break;
      case 'STATUS':
        if (prop.value.trim().toUpperCase() === 'CANCELLED') ev.cancelled = true;
        break;
      case 'TRANSP':
        if (prop.value.trim().toUpperCase() === 'TRANSPARENT') ev.free = true;
        break;
      case 'RRULE':
      case 'EXDATE':
      case 'RECURRENCE-ID':
        pending.push({ ev, prop });
        break;
    }
  }

  for (const { ev: target, prop } of pending) {
    if (prop.name === 'RRULE') {
      target.rule = parseRule(prop.value, zones);
    } else if (prop.name === 'EXDATE') {
      for (const v of prop.value.split(',')) {
        const t = parseTime({ ...prop, value: v });
        if (t) target.exdates!.push(toEpoch(t, zones));
      }
    } else {
      const t = parseTime(prop);
      if (t) target.recurrenceId = toEpoch(t, zones);
    }
  }
  return { events, zones };
}

// ── Expand ───────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** Weekday (0 = Sunday) of a calendar date. */
function weekday(y: number, mo: number, d: number): number {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

const dayNumber = (y: number, mo: number, d: number): number => Date.UTC(y, mo - 1, d) / DAY_MS;

function dateOfDay(day: number): { y: number; mo: number; d: number } {
  const dt = new Date(day * DAY_MS);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/**
 * Calendar dates (in the event's own zone) of a series, in order. Bounded:
 * nothing after `lastDay` is generated, and without a COUNT (which must be
 * counted from the first occurrence) iteration starts near `skipBeforeDay`,
 * so a daily standup created years ago costs no more than a new one.
 */
function* seriesDates(
  start: IcsTime,
  rule: IcsRule,
  skipBeforeDay: number,
  lastDay: number,
): Generator<{ y: number; mo: number; d: number }> {
  const first = { y: start.y, mo: start.mo, d: start.d };
  const firstDay = dayNumber(first.y, first.mo, first.d);
  const skip = rule.count === undefined ? skipBeforeDay : -Infinity;

  if (rule.freq === 'DAILY') {
    const k0 = skip > firstDay ? Math.floor((skip - firstDay) / rule.interval) * rule.interval : 0;
    for (let k = k0; firstDay + k <= lastDay; k += rule.interval) {
      const cand = dateOfDay(firstDay + k);
      if (rule.byMonth.length && !rule.byMonth.includes(cand.mo)) continue;
      if (
        rule.byDay.length &&
        !rule.byDay.some((b) => b.day === weekday(cand.y, cand.mo, cand.d))
      ) {
        continue;
      }
      yield cand;
    }
    return;
  }

  if (rule.freq === 'WEEKLY') {
    const days = rule.byDay.length
      ? [...new Set(rule.byDay.map((b) => b.day))]
      : [weekday(first.y, first.mo, first.d)];
    // Weeks start on Monday (WKST default) — only matters with INTERVAL > 1.
    const weekStart = firstDay - ((weekday(first.y, first.mo, first.d) + 6) % 7);
    const order = days.map((d) => (d + 6) % 7).sort((a, b) => a - b);
    const span = 7 * rule.interval;
    const w0 = skip > weekStart ? Math.floor((skip - weekStart) / span) * rule.interval : 0;
    for (let w = w0; weekStart + w * 7 <= lastDay; w += rule.interval) {
      for (const offset of order) {
        const day = weekStart + w * 7 + offset;
        if (day < firstDay) continue;
        if (day > lastDay) return;
        const cand = dateOfDay(day);
        if (rule.byMonth.length && !rule.byMonth.includes(cand.mo)) continue;
        yield cand;
      }
    }
    return;
  }

  // MONTHLY / YEARLY: walk month by month (YEARLY = every 12*interval months, or the BYMONTH list).
  const byMonthList = rule.freq === 'YEARLY' && rule.byMonth.length > 0;
  const step = byMonthList ? 1 : rule.freq === 'MONTHLY' ? rule.interval : 12 * rule.interval;
  const firstMonth = first.y * 12 + (first.mo - 1);
  let k0 = 0;
  if (skip > firstDay) {
    const s = dateOfDay(skip);
    const monthsAhead = s.y * 12 + (s.mo - 1) - firstMonth - 1;
    if (monthsAhead > 0) k0 = byMonthList ? monthsAhead : Math.floor(monthsAhead / step) * step;
  }
  for (let k = k0; ; k += step) {
    const monthIndex = firstMonth + k;
    const y = Math.floor(monthIndex / 12);
    const mo = (monthIndex % 12) + 1;
    if (dayNumber(y, mo, 1) > lastDay) return;
    if (byMonthList) {
      if ((y - first.y) % rule.interval !== 0 || !rule.byMonth.includes(mo)) continue;
    }
    const dim = daysInMonth(y, mo);
    const dates = new Set<number>();
    for (const md of rule.byMonthDay) {
      const d = md > 0 ? md : dim + md + 1;
      if (d >= 1 && d <= dim) dates.add(d);
    }
    for (const b of rule.byDay) {
      const matches: number[] = [];
      for (let d = 1; d <= dim; d++) if (weekday(y, mo, d) === b.day) matches.push(d);
      if (b.nth === 0) matches.forEach((d) => dates.add(d));
      else {
        const d = b.nth > 0 ? matches[b.nth - 1] : matches[matches.length + b.nth];
        if (d !== undefined) dates.add(d);
      }
    }
    if (dates.size === 0) {
      if (first.d > dim) continue; // e.g. the 31st in a 30-day month: skipped, per RFC 5545
      dates.add(first.d);
    }
    for (const d of [...dates].sort((a, b) => a - b)) {
      const day = dayNumber(y, mo, d);
      if (day < firstDay) continue;
      if (day > lastDay) return;
      yield { y, mo, d };
    }
  }
}

/**
 * Concrete occurrences overlapping [from, to), sorted by start. Cancelled
 * events and EXDATEs are dropped; a RECURRENCE-ID override replaces the
 * occurrence it names.
 */
export function expandEvents(cal: ParsedCalendar, from: number, to: number): CalendarOccurrence[] {
  const out: CalendarOccurrence[] = [];
  const overrides = new Map<string, Set<number>>();
  for (const ev of cal.events) {
    if (ev.recurrenceId === undefined) continue;
    let set = overrides.get(ev.uid);
    if (!set) overrides.set(ev.uid, (set = new Set()));
    set.add(ev.recurrenceId);
  }

  for (const ev of cal.events) {
    const start = toEpoch(ev.start, cal.zones);
    let durationMs: number;
    if (ev.end) durationMs = toEpoch(ev.end, cal.zones) - start;
    else if (ev.durationMs !== undefined) durationMs = ev.durationMs;
    else durationMs = ev.start.dateOnly ? DAY_MS : 0;
    if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;

    const push = (occStart: number) => {
      const occEnd = occStart + durationMs;
      if (ev.cancelled) return;
      // Overlaps the window (a zero-length event counts at its instant).
      if (occStart >= to || (occEnd <= from && !(durationMs === 0 && occStart >= from))) return;
      const occurrence: CalendarOccurrence = {
        id: `${ev.uid}@${occStart}`,
        title: ev.summary.trim() || '(no title)',
        start: occStart,
        end: occEnd,
        allDay: ev.start.dateOnly,
        free: ev.free,
      };
      const joinUrl = findJoinUrl(ev.conference, ev.url, ev.location, ev.description);
      if (joinUrl) occurrence.joinUrl = joinUrl;
      const location = ev.location.trim();
      if (location && location !== joinUrl) occurrence.location = location;
      out.push(occurrence);
    };

    if (ev.recurrenceId !== undefined || !ev.rule) {
      push(start);
      continue;
    }

    const rule = ev.rule;
    const excluded = new Set(ev.exdates);
    const replaced = overrides.get(ev.uid);
    // Day bounds in UTC day numbers, with slack for the zone offset and the event's own length.
    const slackDays = 2 + Math.ceil(durationMs / DAY_MS);
    const skipBeforeDay = Math.floor(from / DAY_MS) - slackDays;
    const lastDay = Math.floor(to / DAY_MS) + 2;
    let produced = 0;
    let generated = 0;
    for (const date of seriesDates(ev.start, rule, skipBeforeDay, lastDay)) {
      if (++generated > CALENDAR_MAX_OCCURRENCES) break;
      const occStart = ev.start.dateOnly
        ? new Date(date.y, date.mo - 1, date.d).getTime()
        : ev.start.utc
          ? Date.UTC(date.y, date.mo - 1, date.d, ev.start.h, ev.start.mi, ev.start.s)
          : wallToEpoch({ ...ev.start, ...date }, ev.start.tzid, cal.zones);
      if (occStart < start) continue;
      if (rule.until !== undefined && occStart > rule.until) break;
      produced++;
      if (rule.count !== undefined && produced > rule.count) break;
      if (occStart >= to) break;
      if (excluded.has(occStart) || replaced?.has(occStart)) continue;
      push(occStart);
    }
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}
