import { useState } from 'react';

import type { PersonStatus } from '../../../core/src/messages.js';
import { STATUS_COLORS, STATUS_TEXT_MAX_LENGTH } from '../constants.js';
import { STATUS_LABELS } from '../office/engine/meetings.js';

const ORDER: PersonStatus[] = ['available', 'busy', 'meeting', 'away'];

/** Quick messages one click away (they fill the text; the person can edit it). */
const SUGGESTIONS = ['Focusing 🎧', 'Lunch 🍽️', 'Back in 5 min', 'Pairing 👥', 'On a call 📞'];

export function StatusDot({ status, size = 8 }: { status: PersonStatus; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 border border-border"
      style={{ width: size, height: size, background: STATUS_COLORS[status] }}
      aria-hidden
    />
  );
}

interface StatusMenuProps {
  status: PersonStatus;
  statusText: string;
  /** The calendar says a meeting is in progress (shown instead of "available"). */
  inMeeting: boolean;
  onChange: (status: PersonStatus, statusText: string) => void;
  onClose: () => void;
}

/** Set your status — a preset and, optionally, your own words. Everyone in the room sees it. */
export function StatusMenu({ status, statusText, inMeeting, onChange, onClose }: StatusMenuProps) {
  const [draft, setDraft] = useState(statusText);
  return (
    <div
      className="flex flex-col gap-6 p-4"
      style={{ width: 240 }}
      data-testid="status-menu"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
    >
      {ORDER.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s, draft.trim())}
          className={`flex items-center gap-8 w-full text-left py-2 px-8 bg-transparent border-2 cursor-pointer hover:bg-btn-bg ${status === s ? 'border-accent' : 'border-transparent'}`}
        >
          <StatusDot status={s} />
          <span className="text-base">{STATUS_LABELS[s]}</span>
          {s === 'meeting' && inMeeting && status === 'available' && (
            <span className="text-2xs text-text-muted ml-auto">from calendar</span>
          )}
        </button>
      ))}
      <form
        className="flex flex-col gap-4 border-t-2 border-border pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          onChange(status, draft.trim());
          onClose();
        }}
      >
        <input
          value={draft}
          maxLength={STATUS_TEXT_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What are you up to?"
          aria-label="Status message"
          className="w-full bg-bg-dark text-text border-2 border-border rounded-none px-6 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="flex flex-wrap gap-4">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setDraft(s)}
              className="py-0 px-6 text-2xs bg-btn-bg text-text border-none cursor-pointer hover:bg-btn-hover"
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex justify-between gap-6">
          <button
            type="button"
            onClick={() => {
              setDraft('');
              onChange('available', '');
              onClose();
            }}
            className="bg-transparent border-none text-text-muted text-sm underline p-0 cursor-pointer"
          >
            Clear
          </button>
          <button
            type="submit"
            className="py-1 px-10 text-sm bg-accent text-white border-2 border-accent cursor-pointer"
          >
            Set
          </button>
        </div>
      </form>
    </div>
  );
}
