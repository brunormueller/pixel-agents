import { useEffect, useState } from 'react';

import type { CalendarEvent, CalendarState } from '../../../core/src/messages.js';
import { MEETING_SOON_MS } from '../constants.js';
import { meetingProvider } from '../office/engine/meetings.js';
import { SidePanel } from './ui/SidePanel.js';

interface CalendarPanelProps {
  calendar: CalendarState | null;
  onConfigure: (change: {
    addFeed?: string;
    removeFeed?: string;
    autoStatus?: boolean;
    refresh?: boolean;
  }) => void;
  onJoin: (event: CalendarEvent) => void;
  onClose: () => void;
}

const time = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

function EventRow({ ev, now, onJoin }: { ev: CalendarEvent; now: number; onJoin: () => void }) {
  const live = !ev.allDay && ev.start <= now && now < ev.end;
  const soon = !ev.allDay && !live && ev.start - now <= MEETING_SOON_MS && ev.start > now;
  return (
    <div
      className={`flex flex-col gap-2 p-6 border-2 ${live ? 'border-accent' : soon ? 'border-warning' : 'border-border'}`}
      data-testid="calendar-event"
    >
      <div className="flex items-center gap-6">
        <span className="text-2xs text-text-muted shrink-0">
          {ev.allDay ? 'All day' : `${time(ev.start)} – ${time(ev.end)}`}
        </span>
        {live && <span className="text-2xs text-accent-bright">now</span>}
        {soon && (
          <span className="text-2xs text-warning">
            in {Math.max(1, Math.round((ev.start - now) / 60_000))} min
          </span>
        )}
      </div>
      <span className="text-sm" style={{ overflowWrap: 'anywhere' }}>
        {ev.title}
      </span>
      {ev.location && (
        <span className="text-2xs text-text-muted" style={{ overflowWrap: 'anywhere' }}>
          {ev.location}
        </span>
      )}
      {ev.joinUrl && (
        <button
          type="button"
          onClick={onJoin}
          className={`self-start py-1 px-10 text-sm border-2 cursor-pointer ${live || soon ? 'bg-accent text-white border-accent' : 'bg-btn-bg text-text border-transparent hover:bg-btn-hover'}`}
          data-testid="join-meeting"
        >
          Join {meetingProvider(ev.joinUrl)}
        </button>
      )}
    </div>
  );
}

/**
 * The person's agenda for the next 24 hours, from the secret iCal address of
 * their Google or Outlook calendar, with a join button on every video call.
 * Nothing about the events leaves the machine; at most the room sees "In a meeting".
 */
export function CalendarPanel({ calendar, onConfigure, onJoin, onClose }: CalendarPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const feeds = calendar?.feeds ?? [];
  const [showSetup, setShowSetup] = useState(feeds.length === 0);
  const [draft, setDraft] = useState('');

  const events = (calendar?.events ?? []).filter((e) => e.end > now || e.allDay);
  const today = events.filter((e) => sameDay(e.start, now) || (e.start < now && e.end > now));
  const later = events.filter((e) => !today.includes(e));

  return (
    <SidePanel title="Calendar" onClose={onClose} testId="calendar-panel">
      {feeds.length > 0 && events.length === 0 && (
        <p className="text-sm text-text-muted m-0">Nothing in the next 24 hours.</p>
      )}
      {today.length > 0 && <span className="text-2xs text-text-muted">Today</span>}
      {today.map((ev) => (
        <EventRow key={ev.id} ev={ev} now={now} onJoin={() => onJoin(ev)} />
      ))}
      {later.length > 0 && <span className="text-2xs text-text-muted">Tomorrow</span>}
      {later.map((ev) => (
        <EventRow key={ev.id} ev={ev} now={now} onJoin={() => onJoin(ev)} />
      ))}

      {feeds.length > 0 && (
        <div className="flex flex-col gap-4 border-t-2 border-border pt-6">
          <label className="flex items-center gap-6 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={calendar?.autoStatus ?? true}
              onChange={(e) => onConfigure({ autoStatus: e.target.checked })}
            />
            Show “In a meeting” to the room during events
          </label>
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => onConfigure({ refresh: true })}
              className="py-0 px-8 text-sm bg-btn-bg text-text border-2 border-transparent cursor-pointer hover:bg-btn-hover"
            >
              Sync now
            </button>
            {calendar?.syncedAt && (
              <span className="text-2xs text-text-muted">synced {time(calendar.syncedAt)}</span>
            )}
          </div>
          {feeds.map((f) => (
            <div key={f.id} className="flex items-center gap-6 text-2xs">
              <span
                className={f.ok ? 'text-text' : 'text-danger'}
                style={{ overflowWrap: 'anywhere' }}
              >
                {f.label}
                {!f.ok && f.error ? ` — ${f.error}` : ''}
              </span>
              <button
                type="button"
                onClick={() => onConfigure({ removeFeed: f.id })}
                className="ml-auto bg-transparent border-none text-text-muted underline p-0 cursor-pointer text-2xs"
              >
                remove
              </button>
            </div>
          ))}
          {!showSetup && (
            <button
              type="button"
              onClick={() => setShowSetup(true)}
              className="self-start bg-transparent border-none text-accent-bright underline p-0 cursor-pointer text-sm"
            >
              Add another calendar
            </button>
          )}
        </div>
      )}

      {showSetup && (
        <form
          className="flex flex-col gap-6 border-t-2 border-border pt-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            onConfigure({ addFeed: draft.trim() });
            setDraft('');
            setShowSetup(false);
          }}
        >
          <span className="text-sm">Connect a calendar</span>
          <div className="text-2xs text-text-muted flex flex-col gap-4">
            <span>
              <b className="text-text">Google Calendar</b>: Settings → your calendar → Integrate
              calendar → copy the <i>Secret address in iCal format</i>.
            </span>
            <span>
              <b className="text-text">Outlook</b>: Settings → Calendar → Shared calendars → Publish
              a calendar (Can view all details) → copy the <i>ICS</i> link.
            </span>
            <span>
              The address is a password to your calendar: it is kept only on this computer. Events
              never leave it — at most the room sees “In a meeting”.
            </span>
          </div>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://… .ics"
            aria-label="Calendar address"
            className="w-full bg-bg-dark text-text border-2 border-border rounded-none px-6 py-2 text-sm outline-none focus:border-accent"
          />
          {calendar?.error && <span className="text-2xs text-danger">{calendar.error}</span>}
          <div className="flex gap-6">
            <button
              type="submit"
              disabled={!draft.trim()}
              className="py-1 px-10 text-sm bg-accent text-white border-2 border-accent cursor-pointer disabled:opacity-[var(--btn-disabled-opacity)] disabled:cursor-default"
            >
              Connect
            </button>
            {feeds.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSetup(false)}
                className="bg-transparent border-none text-text-muted underline p-0 cursor-pointer text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </SidePanel>
  );
}
