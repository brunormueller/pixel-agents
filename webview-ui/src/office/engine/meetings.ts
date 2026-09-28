// webview-ui/src/office/engine/meetings.ts
//
// Calendar helpers the panels share: which call a link opens, and which
// meeting deserves the "starting soon" toast. Pure (no DOM).

import type { CalendarEvent, PersonStatus } from '../../../../core/src/messages.js';
import { MEETING_SOON_MS, MEETING_TOAST_GRACE_MS } from '../../constants.js';

export const STATUS_LABELS: Record<PersonStatus, string> = {
  available: 'Available',
  busy: 'Busy',
  meeting: 'In a meeting',
  away: 'Away',
};

/** Where a meeting link goes, for the join button's label. */
export function meetingProvider(url: string): string {
  if (/meet\.google\.com/i.test(url)) return 'Meet';
  if (/teams\.(microsoft|live)\.com/i.test(url)) return 'Teams';
  if (/zoom\.us/i.test(url)) return 'Zoom';
  if (/webex\.com/i.test(url)) return 'Webex';
  return 'call';
}

/** The meeting to announce now: one with a call link starting within a few
 *  minutes, or that started a moment ago (and is not over). */
export function meetingToAnnounce(
  events: CalendarEvent[],
  now: number,
  dismissed: ReadonlySet<string>,
): CalendarEvent | null {
  for (const ev of events) {
    if (ev.allDay || !ev.joinUrl || dismissed.has(ev.id)) continue;
    if (
      ev.start - now <= MEETING_SOON_MS &&
      now - ev.start <= MEETING_TOAST_GRACE_MS &&
      now < ev.end
    ) {
      return ev;
    }
  }
  return null;
}
