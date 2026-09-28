import { useEffect, useState } from 'react';

import type { CalendarEvent } from '../../../core/src/messages.js';
import { meetingProvider, meetingToAnnounce } from '../office/engine/meetings.js';

interface MeetingToastProps {
  events: CalendarEvent[];
  onJoin: (event: CalendarEvent) => void;
}

/** "Standup starts in 3 min — Join". Dismissed per event; joining dismisses it too. */
export function MeetingToast({ events, onJoin }: MeetingToastProps) {
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const ev = meetingToAnnounce(events, now, dismissed);
  if (!ev || !ev.joinUrl) return null;
  const minutes = Math.round((ev.start - now) / 60_000);
  const dismiss = () => setDismissed((d) => new Set(d).add(ev.id));
  return (
    <div
      className="absolute top-10 left-1/2 -translate-x-1/2 z-40 pixel-panel py-6 px-12 flex items-center gap-10 text-sm"
      style={{ maxWidth: 'calc(100% - 20px)' }}
      data-testid="meeting-toast"
    >
      <span style={{ overflowWrap: 'anywhere' }}>
        <span className="text-accent-bright">{ev.title}</span>{' '}
        {minutes > 0 ? `starts in ${minutes} min` : 'is starting'}
      </span>
      <button
        type="button"
        onClick={() => {
          dismiss();
          onJoin(ev);
        }}
        className="py-1 px-10 text-sm bg-accent text-white border-2 border-accent cursor-pointer shrink-0"
      >
        Join {meetingProvider(ev.joinUrl)}
      </button>
      <button
        type="button"
        onClick={dismiss}
        title="Dismiss"
        className="bg-transparent border-none text-text-muted cursor-pointer text-base p-0"
      >
        ×
      </button>
    </div>
  );
}
