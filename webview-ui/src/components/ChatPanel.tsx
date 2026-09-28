import { useEffect, useRef, useState } from 'react';

import type { ChatEntry } from '../../../core/src/messages.js';
import { CHAT_MAX_LENGTH, CHAT_PANEL_WIDTH_PX } from '../constants.js';
import { Button } from './ui/Button.js';

interface ChatPanelProps {
  messages: ChatEntry[];
  onSend: (text: string) => void;
  onClose: () => void;
}

const formatTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Multiplayer room chat, docked on the right. History lives on the server (in
 * memory) and is replayed on reload; each new line also pops a speech bubble
 * over the character of the office that sent it (ChatBubbles).
 */
export function ChatPanel({ messages, onSend, onClose }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Stick to the newest line.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  return (
    <div
      className="absolute top-10 right-10 bottom-80 z-30 pixel-panel flex flex-col"
      style={{ width: CHAT_PANEL_WIDTH_PX, maxWidth: 'calc(100% - 20px)' }}
      data-testid="chat-panel"
      // Typing here must not reach the window-level shortcuts (layout editor R/T/Delete, Intro's Escape).
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-center justify-between px-8 py-4 border-b-2 border-border">
        <span className="text-lg text-accent-bright">Chat</span>
        <Button variant="ghost" size="icon" onClick={onClose} title="Close chat">
          ×
        </Button>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto pixel-scrollbar px-8 py-6 flex flex-col gap-6"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-text-muted m-0">
            No messages yet. Everyone in the room sees what you write here.
          </p>
        ) : (
          messages.map((m, i) => (
            <div key={`${m.ts}:${m.peerId}:${i}`} className="text-sm leading-[1.3]">
              <span className={m.self ? 'text-accent-bright' : 'text-accent'}>{m.name}</span>{' '}
              <span className="text-2xs text-text-muted">{formatTime(m.ts)}</span>
              <div style={{ overflowWrap: 'anywhere' }}>{m.text}</div>
            </div>
          ))
        )}
      </div>

      <form
        className="flex items-center gap-4 p-6 border-t-2 border-border"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          maxLength={CHAT_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Say something..."
          aria-label="Chat message"
          className="flex-1 min-w-0 bg-bg-dark text-text border-2 border-border rounded-none px-6 py-2 text-sm outline-none focus:border-accent"
        />
        <Button type="submit" variant="accent" size="md" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
