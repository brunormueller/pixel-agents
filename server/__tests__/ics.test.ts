import { describe, expect, it } from 'vitest';

import { expandEvents, findJoinUrl, parseIcs } from '../src/integrations/calendar/ics.js';

const cal = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');

const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

const DAY = 86_400_000;
const utc = (y: number, mo: number, d: number, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

describe('iCalendar feed parsing', () => {
  it('reads a UTC event with its title, location and Meet link', () => {
    const text = cal(
      vevent(
        'UID:1@x',
        'DTSTART:20260924T130000Z',
        'DTEND:20260924T133000Z',
        'SUMMARY:Daily standup',
        'LOCATION:Sala 3',
        'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
      ),
    );
    const [ev] = expandEvents(parseIcs(text), utc(2026, 9, 24), utc(2026, 9, 25));
    expect(ev).toMatchObject({
      title: 'Daily standup',
      start: utc(2026, 9, 24, 13),
      end: utc(2026, 9, 24, 13, 30),
      allDay: false,
      location: 'Sala 3',
      joinUrl: 'https://meet.google.com/abc-defg-hij',
    });
  });

  it('places TZID times on the timeline, IANA and Windows names alike', () => {
    const text = cal(
      vevent(
        'UID:a',
        'DTSTART;TZID=America/Sao_Paulo:20260924T100000',
        'DURATION:PT1H',
        'SUMMARY:A',
      ),
      vevent(
        'UID:b',
        'DTSTART;TZID=E. South America Standard Time:20260924T110000',
        'DTEND;TZID=E. South America Standard Time:20260924T113000',
        'SUMMARY:B',
      ),
    );
    const events = expandEvents(parseIcs(text), utc(2026, 9, 24), utc(2026, 9, 25));
    // São Paulo is UTC-3.
    expect(events.map((e) => [e.title, e.start, e.end])).toEqual([
      ['A', utc(2026, 9, 24, 13), utc(2026, 9, 24, 14)],
      ['B', utc(2026, 9, 24, 14), utc(2026, 9, 24, 14, 30)],
    ]);
  });

  it('falls back to a VTIMEZONE offset for a zone name it does not know', () => {
    const text = cal(
      [
        'BEGIN:VTIMEZONE',
        'TZID:Customax Time',
        'BEGIN:STANDARD',
        'DTSTART:16010101T000000',
        'TZOFFSETFROM:-0300',
        'TZOFFSETTO:-0300',
        'END:STANDARD',
        'END:VTIMEZONE',
      ].join('\r\n'),
      vevent('UID:c', 'DTSTART;TZID=Customax Time:20260924T090000', 'DURATION:PT30M', 'SUMMARY:C'),
    );
    const [ev] = expandEvents(parseIcs(text), utc(2026, 9, 24), utc(2026, 9, 25));
    expect(ev.start).toBe(utc(2026, 9, 24, 12));
  });

  it('unfolds long lines and unescapes text', () => {
    const text = cal(
      vevent(
        'UID:d',
        'DTSTART:20260924T150000Z',
        'SUMMARY:Planning\\, Q4 \\; roadmap',
        'DESCRIPTION:Join: https://teams.microsoft.com/l/meetup-join/19%3ameet',
        ' ing_abc%40thread.v2/0?context=%7b%22Tid%22%7d',
      ),
    );
    const [ev] = expandEvents(parseIcs(text), utc(2026, 9, 24), utc(2026, 9, 25));
    expect(ev.title).toBe('Planning, Q4 ; roadmap');
    expect(ev.joinUrl).toBe(
      'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0?context=%7b%22Tid%22%7d',
    );
  });

  it('expands a weekly series with EXDATE and a moved occurrence', () => {
    const text = cal(
      vevent(
        'UID:weekly',
        'DTSTART:20260907T120000Z',
        'DTEND:20260907T123000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO,WE',
        'EXDATE:20260916T120000Z',
        'SUMMARY:Sync',
      ),
      vevent(
        'UID:weekly',
        'RECURRENCE-ID:20260921T120000Z',
        'DTSTART:20260921T150000Z',
        'DTEND:20260921T153000Z',
        'SUMMARY:Sync (moved)',
      ),
    );
    const events = expandEvents(parseIcs(text), utc(2026, 9, 14), utc(2026, 9, 24));
    expect(events.map((e) => [e.title, new Date(e.start).toISOString()])).toEqual([
      ['Sync', '2026-09-14T12:00:00.000Z'],
      ['Sync (moved)', '2026-09-21T15:00:00.000Z'],
      ['Sync', '2026-09-23T12:00:00.000Z'],
    ]);
  });

  it('honors COUNT and UNTIL, and finds a years-old daily series today', () => {
    const text = cal(
      vevent(
        'UID:count',
        'DTSTART:20260920T090000Z',
        'DURATION:PT15M',
        'RRULE:FREQ=DAILY;COUNT=3',
        'SUMMARY:Three',
      ),
      vevent(
        'UID:until',
        'DTSTART:20260920T100000Z',
        'DURATION:PT15M',
        'RRULE:FREQ=DAILY;UNTIL=20260922T235959Z',
        'SUMMARY:Until',
      ),
      vevent(
        'UID:old',
        'DTSTART:20150105T110000Z',
        'DURATION:PT15M',
        'RRULE:FREQ=DAILY',
        'SUMMARY:Old daily',
      ),
    );
    const events = expandEvents(parseIcs(text), utc(2026, 9, 20), utc(2026, 9, 25));
    const count = (title: string) => events.filter((e) => e.title === title).length;
    expect(count('Three')).toBe(3);
    expect(count('Until')).toBe(3);
    expect(count('Old daily')).toBe(5);
  });

  it('monthly by weekday: the second Tuesday', () => {
    const text = cal(
      vevent(
        'UID:m',
        'DTSTART:20260113T170000Z',
        'DURATION:PT1H',
        'RRULE:FREQ=MONTHLY;BYDAY=2TU',
        'SUMMARY:Review',
      ),
    );
    const events = expandEvents(parseIcs(text), utc(2026, 9, 1), utc(2026, 11, 1));
    expect(events.map((e) => new Date(e.start).toISOString().slice(0, 10))).toEqual([
      '2026-09-08',
      '2026-10-13',
    ]);
  });

  it('drops cancelled events, marks free ones, and keeps all-day events whole', () => {
    const text = cal(
      vevent(
        'UID:x',
        'DTSTART:20260924T120000Z',
        'DURATION:PT1H',
        'STATUS:CANCELLED',
        'SUMMARY:Gone',
      ),
      vevent(
        'UID:y',
        'DTSTART:20260924T140000Z',
        'DURATION:PT1H',
        'TRANSP:TRANSPARENT',
        'SUMMARY:Focus',
      ),
      vevent(
        'UID:z',
        'DTSTART;VALUE=DATE:20260924',
        'DTEND;VALUE=DATE:20260925',
        'SUMMARY:Holiday',
      ),
    );
    const events = expandEvents(parseIcs(text), utc(2026, 9, 23), utc(2026, 9, 26));
    expect(events.map((e) => e.title).sort()).toEqual(['Focus', 'Holiday']);
    expect(events.find((e) => e.title === 'Focus')!.free).toBe(true);
    const holiday = events.find((e) => e.title === 'Holiday')!;
    expect(holiday.allDay).toBe(true);
    expect(holiday.start).toBe(new Date(2026, 8, 24).getTime());
    expect(holiday.end - holiday.start).toBe(DAY);
  });

  it('only video-call links count as the way in', () => {
    expect(findJoinUrl('see https://docs.example.com/agenda')).toBeUndefined();
    expect(findJoinUrl('Zoom: https://us02web.zoom.us/j/123456789?pwd=abc).')).toBe(
      'https://us02web.zoom.us/j/123456789?pwd=abc',
    );
    expect(findJoinUrl('', 'https://meet.google.com/xyz-abcd-efg')).toBe(
      'https://meet.google.com/xyz-abcd-efg',
    );
  });
});
