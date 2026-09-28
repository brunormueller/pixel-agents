import { useEffect, useState } from 'react';

import type { PersonStatus, SharedTrack } from '../../../core/src/messages.js';
import { STATUS_LABELS } from '../office/engine/meetings.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { RemoteCharacter } from '../office/engine/remoteAgents.js';
import { StatusDot } from './StatusMenu.js';
import { SidePanel } from './ui/SidePanel.js';

interface PeoplePanelProps {
  officeState: OfficeState;
  selfName: string;
  /** Other offices' characters (re-renders the list when the room changes). */
  remoteCharacters: RemoteCharacter[];
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}

interface Person {
  key: string;
  /** The character that is them in the office, or null when their office shows none yet. */
  charId: number | null;
  name: string;
  self: boolean;
  status: PersonStatus;
  statusText: string;
  music: SharedTrack | null;
  /** Their agents working right now. */
  working: number;
}

function people(os: OfficeState, selfName: string, remote: RemoteCharacter[]): Person[] {
  const out: Person[] = [];
  const me = os.avatarId !== null ? os.characters.get(os.avatarId) : undefined;
  if (me) {
    const working = [...os.characters.values()].filter(
      (c) => !c.isRemote && !c.isSubagent && c.id > 0 && c.isActive,
    ).length;
    out.push({
      key: 'self',
      charId: me.id,
      name: selfName || 'You',
      self: true,
      status: me.personStatus ?? 'available',
      statusText: me.statusText ?? '',
      music: me.music ?? null,
      working,
    });
  }
  const byPeer = new Map<string, RemoteCharacter[]>();
  for (const c of remote) {
    const list = byPeer.get(c.peerId);
    if (list) list.push(c);
    else byPeer.set(c.peerId, [c]);
  }
  for (const [peerId, chars] of byPeer) {
    const avatar = chars.find((c) => c.isAvatar) ?? chars[0];
    const ch = os.characters.get(avatar.id);
    out.push({
      key: peerId,
      charId: ch && ch.matrixEffect !== 'despawn' ? ch.id : null,
      name: avatar.peerName,
      self: false,
      status: avatar.profile?.status ?? 'available',
      statusText: avatar.profile?.statusText ?? '',
      music: avatar.profile?.music ?? null,
      working: chars.filter((c) => c.status === 'active').length,
    });
  }
  return out;
}

/**
 * Who is in the room, with their status and what they listen to. Locate
 * brings the camera to someone; Go to walks your character over; Follow keeps
 * walking after them until you take the keyboard.
 */
export function PeoplePanel({
  officeState,
  selfName,
  remoteCharacters,
  onOpenUrl,
  onClose,
}: PeoplePanelProps) {
  // Following ends on its own (arrived, keyboard, they left): poll to keep the buttons honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  const list = people(officeState, selfName, remoteCharacters);
  const manual = officeState.avatarIsManual();
  const following = officeState.avatarFollowId;

  return (
    <SidePanel title={`People (${list.length})`} onClose={onClose} testId="people-panel">
      {list.length <= 1 && (
        <p className="text-sm text-text-muted m-0">
          Nobody else is here yet. Share the room name with your team.
        </p>
      )}
      {!manual && officeState.avatarId !== null && (
        <p className="text-2xs text-warning m-0">
          Claude is working at your desk: you can walk again when it finishes.
        </p>
      )}
      {list.map((p) => (
        <div
          key={p.key}
          className="flex flex-col gap-2 border-b-2 border-border pb-6"
          data-testid="person"
        >
          <div className="flex items-center gap-6">
            <StatusDot status={p.status} />
            <span className={`text-base ${p.self ? 'text-accent-bright' : 'text-text'}`}>
              {p.name}
              {p.self ? ' (you)' : ''}
            </span>
            {p.working > 0 && (
              <span className="text-2xs text-text-muted ml-auto" title="Agents working">
                {p.working} working
              </span>
            )}
          </div>
          <span className="text-2xs text-text-muted" style={{ overflowWrap: 'anywhere' }}>
            {STATUS_LABELS[p.status]}
            {p.statusText ? ` — ${p.statusText}` : ''}
          </span>
          {p.music && (
            <span className="text-2xs text-text" style={{ overflowWrap: 'anywhere' }}>
              ♪ {p.music.artist ? `${p.music.artist} – ` : ''}
              {p.music.title}
              {p.music.trackUrl && (
                <button
                  type="button"
                  onClick={() => onOpenUrl(p.music!.trackUrl!)}
                  className="ml-6 bg-transparent border-none text-accent-bright underline p-0 cursor-pointer text-2xs"
                >
                  listen
                </button>
              )}
            </span>
          )}
          {!p.self && p.charId !== null && (
            <div className="flex gap-4 mt-2">
              <button
                type="button"
                onClick={() => {
                  officeState.cameraFollowId = p.charId;
                }}
                className="py-0 px-8 text-sm bg-btn-bg text-text border-2 border-transparent cursor-pointer hover:bg-btn-hover"
                title="Center the view on them"
              >
                Locate
              </button>
              <button
                type="button"
                disabled={!manual}
                onClick={() => {
                  if (officeState.followCharacter(p.charId!, true)) {
                    officeState.cameraFollowId = officeState.avatarId;
                  }
                }}
                className="py-0 px-8 text-sm bg-btn-bg text-text border-2 border-transparent cursor-pointer hover:bg-btn-hover disabled:opacity-[var(--btn-disabled-opacity)] disabled:cursor-default"
                title="Walk over to them"
              >
                Go to
              </button>
              <button
                type="button"
                disabled={!manual}
                onClick={() => {
                  if (following === p.charId) officeState.stopFollowing();
                  else if (officeState.followCharacter(p.charId!)) {
                    officeState.cameraFollowId = officeState.avatarId;
                  }
                  setTick((n) => n + 1);
                }}
                className={`py-0 px-8 text-sm text-text border-2 cursor-pointer hover:bg-btn-hover disabled:opacity-[var(--btn-disabled-opacity)] disabled:cursor-default ${following === p.charId ? 'bg-active-bg border-accent' : 'bg-btn-bg border-transparent'}`}
                title="Keep walking after them (arrow keys stop it)"
              >
                {following === p.charId ? 'Following' : 'Follow'}
              </button>
            </div>
          )}
        </div>
      ))}
    </SidePanel>
  );
}
