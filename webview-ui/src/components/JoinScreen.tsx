import { useState } from 'react';

import type { MultiplayerStatus } from '../../../core/src/messages.js';
import { Modal } from './ui/Modal.js';

interface JoinScreenProps {
  status: MultiplayerStatus;
  /** `relayUrl` is set only when the person typed one (else the office's stands). */
  onJoin: (name: string, room: string, relayUrl?: string) => void;
  /** Stay in this office alone (the toolbar's "Join room" brings the screen back). */
  onSolo: () => void;
}

/** Longest name / room / relay the server keeps (MULTIPLAYER_MAX_NAME_LENGTH / _ROOM_LENGTH / _RELAY_URL_LENGTH). */
const MAX_NAME = 32;
const MAX_ROOM = 64;
const MAX_RELAY = 512;

const isRelayUrl = (url: string) => /^wss?:\/\/\S+$/i.test(url);

/** "wss://relay.example.com/" → "relay.example.com", for the one-line summary. */
function relayHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * Multiplayer entry: who you are, which room and — when the office knows none
 * yet — which relay. Prefilled with the last answer. Joining puts your
 * character in the room's shared office; the desk picker follows.
 */
export function JoinScreen({ status, onJoin, onSolo }: JoinScreenProps) {
  const [name, setName] = useState(status.name);
  const [room, setRoom] = useState(status.room);
  const [relay, setRelay] = useState(status.relayUrl);
  // A known relay is a one-line summary; unknown, or asked to change it, a field.
  const [editRelay, setEditRelay] = useState(status.relayUrl === '');
  const relayOk = isRelayUrl(relay.trim());
  const canJoin = name.trim() !== '' && room.trim() !== '' && relayOk;

  const inputClass =
    'w-full bg-bg-dark text-text border-2 border-border rounded-none px-8 py-4 text-base outline-none focus:border-accent';

  return (
    <Modal isOpen onClose={onSolo} title="Join the office" zIndex={52}>
      <form
        className="px-10 pb-8 flex flex-col gap-10"
        style={{ width: 360, maxWidth: 'calc(100vw - 40px)' }}
        data-testid="join-screen"
        // Keep typing out of the window-level shortcuts (movement keys, editor keys).
        onKeyDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!canJoin) return;
          const typed = relay.trim();
          onJoin(name.trim(), room.trim(), typed !== status.relayUrl ? typed : undefined);
        }}
      >
        <p className="text-sm text-text-muted m-0">
          Everyone in the same room shares one office. Your character works at your desk while
          Claude is busy, and walks with the arrow keys when it is not.
        </p>
        <label className="flex flex-col gap-4 text-sm">
          Your name
          <input
            autoFocus
            value={name}
            maxLength={MAX_NAME}
            onChange={(e) => setName(e.target.value)}
            placeholder="How the others see you"
            aria-label="Your name"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-4 text-sm">
          Room
          <input
            value={room}
            maxLength={MAX_ROOM}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="The code your team shares"
            aria-label="Room"
            className={inputClass}
          />
        </label>
        {editRelay ? (
          <label className="flex flex-col gap-4 text-sm">
            Server
            <input
              value={relay}
              maxLength={MAX_RELAY}
              onChange={(e) => setRelay(e.target.value)}
              placeholder="wss://… (the relay address your team uses)"
              aria-label="Server"
              className={inputClass}
            />
            {relay.trim() !== '' && !relayOk && (
              <span className="text-xs text-text-muted">
                Starts with wss:// (or ws:// on a local network).
              </span>
            )}
          </label>
        ) : (
          <div className="flex items-center justify-between gap-8 text-sm text-text-muted">
            <span className="truncate" title={status.relayUrl}>
              Server: {relayHost(status.relayUrl)}
            </span>
            <button
              type="button"
              onClick={() => setEditRelay(true)}
              className="bg-transparent border-none text-text-muted text-sm cursor-pointer underline p-0 shrink-0"
            >
              change
            </button>
          </div>
        )}
        <div className="flex items-center justify-between gap-8 mt-4">
          <button
            type="button"
            onClick={onSolo}
            className="bg-transparent border-none text-text-muted text-sm cursor-pointer underline p-0"
          >
            Work alone
          </button>
          <button
            type="submit"
            disabled={!canJoin}
            className={`py-4 px-20 text-lg bg-accent text-white border-2 border-accent rounded-none shadow-pixel ${canJoin ? 'cursor-pointer' : 'opacity-[var(--btn-disabled-opacity)] cursor-default'}`}
          >
            Join
          </button>
        </div>
      </form>
    </Modal>
  );
}
