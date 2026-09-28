import { useState } from 'react';

import { MEETING_TITLE_MAX_LENGTH } from '../../constants.js';
import { defaultMeetingTitle, formatElapsed } from '../../meeting/model.js';
import type { MeetingController } from '../../meeting/useMeeting.js';
import { Button } from '../ui/Button.js';
import { Checkbox } from '../ui/Checkbox.js';
import { SidePanel } from '../ui/SidePanel.js';

interface MeetingsPanelProps {
  m: MeetingController;
  selfName: string;
  onClose: () => void;
}

/**
 * Calls inside the room: start one, or join one already going on. Joining
 * walks your character to the office's meeting place; the call itself opens
 * over the office.
 */
export function MeetingsPanel({ m, selfName, onClose }: MeetingsPanelProps) {
  const [title, setTitle] = useState('');
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(false);
  const capture = m.support.capture;
  const opts = { mic: capture && mic, cam: capture && cam };
  const now = m.relayNow();

  return (
    <SidePanel title="Meet" onClose={onClose} testId="meetings-panel">
      {!m.available && (
        <p className="text-sm text-warning m-0">
          Meetings need the room: join one and wait for the connection.
        </p>
      )}
      {m.support.reason && <p className="text-2xs text-warning m-0">{m.support.reason}</p>}

      {m.current ? (
        <div className="flex flex-col gap-6 border-2 border-accent p-8">
          <span className="text-2xs text-text-muted">You are in</span>
          <span className="text-base text-accent-bright">{m.current.title}</span>
          <span className="text-2xs text-text-muted">
            {m.current.participants.map((p) => (p.self ? 'you' : p.name)).join(', ')}
          </span>
          <Button variant="default" size="md" onClick={m.leave}>
            Leave the call
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-6 border-2 border-border p-8"
          onSubmit={(e) => {
            e.preventDefault();
            m.start(title, opts);
            setTitle('');
          }}
        >
          <span className="text-base text-text">Start a meeting</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MEETING_TITLE_MAX_LENGTH}
            placeholder={defaultMeetingTitle(selfName)}
            aria-label="Meeting title"
            className="bg-bg-dark text-text border-2 border-border rounded-none px-6 py-2 text-sm outline-none focus:border-accent"
          />
          {capture && (
            <div className="flex flex-col">
              <Checkbox
                checked={mic}
                onChange={() => setMic((v) => !v)}
                label="Join with microphone on"
              />
              <Checkbox
                checked={cam}
                onChange={() => setCam((v) => !v)}
                label="Join with camera on"
              />
            </div>
          )}
          <Button
            type="submit"
            variant="accent"
            size="md"
            disabled={!m.available}
            data-testid="start-meeting"
          >
            Start
          </Button>
        </form>
      )}

      <div className="flex flex-col gap-6">
        <span className="text-sm text-text-muted">
          {m.meetings.length === 0 ? 'No meetings going on in the room.' : 'Going on in the room'}
        </span>
        {m.meetings.map((meeting) => {
          const mine = meeting.id === m.current?.id;
          return (
            <div
              key={meeting.id}
              className="flex flex-col gap-4 border-b-2 border-border pb-6"
              data-testid="room-meeting"
            >
              <div className="flex items-center gap-6">
                <span className="text-base text-text" style={{ overflowWrap: 'anywhere' }}>
                  {meeting.title}
                </span>
                <span className="text-2xs text-text-muted ml-auto">
                  {formatElapsed(now - meeting.startedAt)}
                </span>
              </div>
              <span className="text-2xs text-text-muted" style={{ overflowWrap: 'anywhere' }}>
                {meeting.participants
                  .map(
                    (p) =>
                      `${p.self ? 'you' : p.name}${p.presence.hand ? ' ✋' : ''}${p.presence.screens.length > 0 ? ' 🖥' : ''}${p.presence.mic ? '' : ' 🔇'}`,
                  )
                  .join(', ')}
              </span>
              {meeting.participants.some((p) => p.presence.rec) && (
                <span className="text-2xs text-danger">● Being recorded</span>
              )}
              {!mine && (
                <Button
                  variant="accent"
                  size="sm"
                  disabled={!m.available}
                  onClick={() => m.join(meeting.id, opts)}
                  data-testid="join-meeting"
                >
                  {m.current ? 'Switch to this call' : 'Join'}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-2xs text-text-muted m-0">
        Audio, video and screens go straight between browsers (encrypted); the relay only passes the
        call's setup, its chat and its captions along, and keeps none of it.
      </p>
    </SidePanel>
  );
}
