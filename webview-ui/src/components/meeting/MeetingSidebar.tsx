import { useEffect, useRef, useState } from 'react';

import { MEETING_CHAT_MAX_LENGTH, MEETING_SIDEBAR_WIDTH_PX } from '../../constants.js';
import type { MeetingLine } from '../../meeting/model.js';
import { formatClock, handQueue } from '../../meeting/model.js';
import { TRANSCRIPT_LANGUAGES } from '../../meeting/transcriber.js';
import type { MeetingController } from '../../meeting/useMeeting.js';
import { Button } from '../ui/Button.js';
import { Markdown } from './Markdown.js';
import type { SidebarTab } from './MeetingControls.js';

interface MeetingSidebarProps {
  m: MeetingController;
  tab: SidebarTab;
  onClose: () => void;
  /** People in the room but not in this call (to invite). */
  roomPeople: Array<{ peerId: string; name: string }>;
}

const TITLES: Record<SidebarTab, string> = {
  chat: 'Meeting chat',
  transcript: 'Transcript',
  notes: 'Notes',
  people: 'People',
};

function Lines({
  lines,
  empty,
  tail,
}: {
  lines: MeetingLine[];
  empty: string;
  /** Words still being said (your own transcription, not final yet). */
  tail?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, tail]);
  return (
    <div
      ref={ref}
      className="flex-1 min-h-0 overflow-y-auto pixel-scrollbar flex flex-col gap-6 pr-2"
    >
      {lines.length === 0 && !tail ? (
        <p className="text-sm text-text-muted m-0">{empty}</p>
      ) : (
        lines.map((l, i) => (
          <div key={`${l.ts}:${l.peerId}:${i}`} className="text-sm leading-[1.3]">
            <span className={l.self ? 'text-accent-bright' : 'text-accent'}>{l.name}</span>{' '}
            <span className="text-2xs text-text-muted">{formatClock(l.ts)}</span>
            <div style={{ overflowWrap: 'anywhere' }}>{l.text}</div>
          </div>
        ))
      )}
      {tail && (
        <div className="text-sm leading-[1.3] text-text-muted">
          <span className="text-accent-bright">You</span> {tail}…
        </div>
      )}
    </div>
  );
}

function ChatTab({ m }: { m: MeetingController }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <>
      <Lines lines={m.chat} empty="Only the people in this call see what you write here." />
      <form
        className="flex items-center gap-4 pt-6 border-t-2 border-border"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          m.sendChat(draft);
          setDraft('');
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          maxLength={MEETING_CHAT_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the call..."
          aria-label="Meeting chat message"
          className="flex-1 min-w-0 bg-bg-dark text-text border-2 border-border rounded-none px-6 py-2 text-sm outline-none focus:border-accent"
        />
        <Button type="submit" variant="accent" size="md" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </>
  );
}

function TranscriptTab({ m }: { m: MeetingController }) {
  let mine: string;
  if (!m.transcribeOn) mine = 'Transcription is off.';
  else if (!m.transcribeSupported) {
    mine =
      'This browser cannot transcribe your voice (Chrome and Edge can). You still see everyone else.';
  } else if (m.captionsChoice === 'no') mine = 'Your voice is not being transcribed.';
  else if (m.captionsChoice === 'ask')
    mine = 'Answer the question on the call to transcribe your voice.';
  else if (!m.micOn) mine = 'You are muted: nothing of yours is transcribed.';
  else mine = 'Your voice is being transcribed.';
  return (
    <>
      <div className="flex flex-col gap-4 text-2xs text-text-muted">
        <span>{mine}</span>
        <div className="flex items-center gap-4 flex-wrap">
          <Button
            size="sm"
            variant={m.transcribeOn ? 'active' : 'default'}
            onClick={() => m.setTranscription(!m.transcribeOn)}
          >
            {m.transcribeOn ? 'Turn off for everyone' : 'Turn on'}
          </Button>
          {m.transcribeOn && m.captionsChoice === 'no' && (
            <Button size="sm" onClick={() => m.answerCaptions(true)}>
              Transcribe me
            </Button>
          )}
          {m.transcribeOn && m.captionsChoice === 'yes' && (
            <Button size="sm" onClick={() => m.answerCaptions(false)}>
              Stop transcribing me
            </Button>
          )}
          <select
            value={m.transcriptLang}
            onChange={(e) => m.setTranscriptLang(e.target.value)}
            title="The language you speak"
            className="bg-bg-dark text-text border-2 border-border rounded-none text-2xs px-2 py-1"
          >
            {TRANSCRIPT_LANGUAGES.some((l) => l.code === m.transcriptLang) ? null : (
              <option value={m.transcriptLang}>{m.transcriptLang}</option>
            )}
            {TRANSCRIPT_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Lines lines={m.transcript} tail={m.interim} empty="Nothing transcribed yet." />
      <div className="pt-6 border-t-2 border-border flex gap-4">
        <Button
          size="sm"
          onClick={m.downloadTranscript}
          disabled={m.transcript.length === 0 && m.chat.length === 0}
        >
          Download (.md)
        </Button>
      </div>
    </>
  );
}

function NotesTab({ m }: { m: MeetingController }) {
  const nothing = m.transcript.length === 0 && m.chat.length === 0;
  return (
    <>
      <div className="flex flex-col gap-4 text-2xs text-text-muted">
        <span>
          Claude writes the notes (summary, decisions, action items) from the transcript and chat,
          using your own Claude Code. The notes are shared with the call and saved in
          ~/.pixel-agents/meetings.
        </span>
        <Button
          variant="accent"
          size="md"
          onClick={m.generateNotes}
          disabled={m.notesPending || nothing}
          title={nothing ? 'Turn on transcription (CC) or chat first' : undefined}
          data-testid="meeting-generate-notes"
        >
          {m.notesPending
            ? 'Claude is writing…'
            : m.notes.length > 0
              ? 'Write new notes'
              : 'Write notes with Claude'}
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pixel-scrollbar flex flex-col gap-10 pr-2">
        {m.notes.length === 0 ? (
          <p className="text-sm text-text-muted m-0">No notes yet.</p>
        ) : (
          [...m.notes].reverse().map((n) => (
            <div
              key={`${n.ts}:${n.by}`}
              className="flex flex-col gap-4 border-b-2 border-border pb-8"
            >
              <span className="text-2xs text-text-muted">
                by {n.by}'s Claude · {formatClock(n.ts)}
              </span>
              <Markdown text={n.text} />
            </div>
          ))
        )}
      </div>
      {m.notes.length > 0 && (
        <div className="pt-6 border-t-2 border-border">
          <Button size="sm" onClick={m.downloadTranscript}>
            Download notes + transcript
          </Button>
        </div>
      )}
    </>
  );
}

function PeopleTab({
  m,
  roomPeople,
}: {
  m: MeetingController;
  roomPeople: Array<{ peerId: string; name: string }>;
}) {
  const participants = m.current?.participants ?? [];
  const hands = handQueue(participants);
  const [invited, setInvited] = useState<Set<string>>(() => new Set());
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pixel-scrollbar flex flex-col gap-6 pr-2">
      {hands.length > 0 && (
        <div className="flex flex-col gap-2 border-2 border-accent p-6">
          <span className="text-2xs text-text-muted">Raised hands, in order</span>
          {hands.map((p, i) => (
            <span key={p.peerId} className="text-sm">
              {i + 1}. ✋ {p.self ? 'You' : p.name}
            </span>
          ))}
        </div>
      )}
      {participants.map((p) => {
        const state = p.self ? 'connected' : m.peerStates[p.peerId];
        return (
          <div key={p.peerId} className="flex items-center gap-6 text-sm">
            <span
              className={m.speaking.has(p.self ? 'self' : p.peerId) ? 'text-accent-bright' : ''}
            >
              {p.self ? `${p.name} (you)` : p.name}
            </span>
            <span className="ml-auto flex gap-4 text-2xs">
              {p.presence.hand && <span title="Hand raised">✋</span>}
              {p.presence.rec && (
                <span title="Recording" className="text-danger">
                  ⏺
                </span>
              )}
              {p.presence.screens.length > 0 && (
                <span title="Sharing">🖥{p.presence.screens.length}</span>
              )}
              <span title={p.presence.cam ? 'Camera on' : 'Camera off'}>
                {p.presence.cam ? '📷' : '🚫'}
              </span>
              <span title={p.presence.mic ? 'Mic on' : 'Muted'}>
                {p.presence.mic ? '🎤' : '🔇'}
              </span>
              {state && state !== 'connected' && <span className="text-warning">{state}</span>}
            </span>
          </div>
        );
      })}
      {roomPeople.length > 0 && (
        <div className="flex flex-col gap-4 border-t-2 border-border pt-8 mt-4">
          <span className="text-2xs text-text-muted">In the room, not in the call</span>
          {roomPeople.map((p) => (
            <div key={p.peerId} className="flex items-center gap-6 text-sm">
              <span>{p.name}</span>
              <Button
                size="sm"
                className="ml-auto"
                disabled={invited.has(p.peerId)}
                onClick={() => {
                  m.invite(p.peerId);
                  setInvited((s) => new Set(s).add(p.peerId));
                }}
              >
                {invited.has(p.peerId) ? 'Invited' : 'Invite'}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The call's side panel: chat, live transcript, Claude's notes, who is here. */
export function MeetingSidebar({ m, tab, onClose, roomPeople }: MeetingSidebarProps) {
  return (
    <div
      className="flex flex-col min-h-0 border-l-2 border-border px-8 py-6 gap-6"
      style={{ width: MEETING_SIDEBAR_WIDTH_PX, maxWidth: '45%' }}
      data-testid={`meeting-sidebar-${tab}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-lg text-accent-bright">{TITLES[tab]}</span>
        <Button variant="ghost" size="icon" onClick={onClose} title="Close">
          ×
        </Button>
      </div>
      {tab === 'chat' && <ChatTab m={m} />}
      {tab === 'transcript' && <TranscriptTab m={m} />}
      {tab === 'notes' && <NotesTab m={m} />}
      {tab === 'people' && <PeopleTab m={m} roomPeople={roomPeople} />}
    </div>
  );
}
