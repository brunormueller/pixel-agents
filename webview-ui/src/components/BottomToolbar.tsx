import { useEffect, useRef, useState } from 'react';

import type { MultiplayerStatus, PersonStatus } from '../../../core/src/messages.js';
import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import type { EmoteKind } from '../office/engine/emotes.js';
import { EMOTE_ORDER, EMOTES } from '../office/engine/emotes.js';
import { STATUS_LABELS } from '../office/engine/meetings.js';
import { isBrowserRuntime } from '../runtime.js';
import { transport } from '../transport/index.js';
import { StatusDot, StatusMenu } from './StatusMenu.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

/** The panels docked on the right; one at a time. */
export type SidePanelId = 'chat' | 'people' | 'calendar' | 'music' | 'decor' | 'meet';

interface BottomToolbarProps {
  isEditMode: boolean;
  onOpenClaude: () => void;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
  /** Multiplayer chat is available (the office is in a relay room). */
  chatEnabled: boolean;
  isChatOpen: boolean;
  onToggleChat: () => void;
  /** Messages from other offices since the panel was last open. */
  chatUnread: number;
  /** This office's person is in a call inside the room. */
  inCall: boolean;
  /** Calls going on in the room. */
  meetingCount: number;
  /** Multiplayer room; null when no relay is configured. */
  multiplayer: MultiplayerStatus | null;
  /** False while showing someone else's room layout (only its owner edits it). */
  layoutEditable: boolean;
  onOpenJoin: () => void;
  onLeaveRoom: () => void;
  /** VS Code only: copy a link that opens this office in a browser. */
  onCopyWebLink?: () => void;
  onPickDesk: () => void;
  onEmote: (kind: EmoteKind) => void;
  /** Which right-side panel is open (chat included). */
  sidePanel: SidePanelId | null;
  onToggleSidePanel: (panel: SidePanelId) => void;
  onOpenAvatarEditor: () => void;
  status: PersonStatus;
  statusText: string;
  /** A calendar event is in progress (the room sees "In a meeting" while available). */
  inMeeting: boolean;
  onStatusChange: (status: PersonStatus, statusText: string) => void;
  /** Spotify is playing (a note on the Music button). */
  musicPlaying: boolean;
}

export function BottomToolbar({
  isEditMode,
  onOpenClaude,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
  chatEnabled,
  isChatOpen,
  onToggleChat,
  chatUnread,
  inCall,
  meetingCount,
  multiplayer,
  layoutEditable,
  onOpenJoin,
  onLeaveRoom,
  onCopyWebLink,
  onPickDesk,
  onEmote,
  sidePanel,
  onToggleSidePanel,
  onOpenAvatarEditor,
  status,
  statusText,
  inMeeting,
  onStatusChange,
  musicPlaying,
}: BottomToolbarProps) {
  const [isEmoteMenuOpen, setIsEmoteMenuOpen] = useState(false);
  const emoteMenuRef = useRef<HTMLDivElement>(null);
  const [isYouMenuOpen, setIsYouMenuOpen] = useState(false);
  const youMenuRef = useRef<HTMLDivElement>(null);
  const [isStatusMenuOpen, setIsStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  // Close a menu on a click outside it.
  useEffect(() => {
    if (!isEmoteMenuOpen && !isYouMenuOpen && !isStatusMenuOpen) return;
    const close = (e: MouseEvent) => {
      const inside = (ref: React.RefObject<HTMLDivElement | null>) =>
        !!ref.current && ref.current.contains(e.target as Node);
      if (!inside(emoteMenuRef)) setIsEmoteMenuOpen(false);
      if (!inside(youMenuRef)) setIsYouMenuOpen(false);
      if (!inside(statusMenuRef)) setIsStatusMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [isEmoteMenuOpen, isYouMenuOpen, isStatusMenuOpen]);
  const shownStatus: PersonStatus = inMeeting && status === 'available' ? 'meeting' : status;
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const folderPickerRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);
  // Close folder picker / bypass menu on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isBypassMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
        setIsBypassMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFolderPickerOpen, isBypassMenuOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;

  const handleAgentClick = () => {
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = false;
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      onOpenClaude();
    }
  };

  const handleAgentHover = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(true);
    }
  };

  const handleAgentLeave = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(false);
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const bypassPermissions = pendingBypassRef.current;
    pendingBypassRef.current = false;
    transport.send({ type: 'launchAgent', folderPath: folder.path, bypassPermissions });
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
    } else {
      transport.send({ type: 'launchAgent', bypassPermissions });
    }
  };

  return (
    <div
      className="absolute bottom-10 left-10 z-20 flex flex-wrap items-center gap-4 pixel-panel p-4"
      style={{ maxWidth: 'calc(100% - 20px)' }}
    >
      {/* Hide + Agent in standalone browser mode (no terminal to interact with) */}
      {!isBrowserRuntime && (
        <div
          ref={folderPickerRef}
          className="relative"
          onMouseEnter={handleAgentHover}
          onMouseLeave={handleAgentLeave}
        >
          <Button
            variant="accent"
            onClick={handleAgentClick}
            className={
              isFolderPickerOpen || isBypassMenuOpen
                ? 'bg-accent-bright'
                : 'bg-accent hover:bg-accent-bright'
            }
          >
            + Agent
          </Button>
          <Dropdown isOpen={isBypassMenuOpen}>
            <DropdownItem onClick={() => handleBypassSelect(true)}>
              Skip permissions mode <span className="text-2xs text-warning">⚠</span>
            </DropdownItem>
          </Dropdown>
          <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
            {workspaceFolders.map((folder) => (
              <DropdownItem
                key={folder.path}
                onClick={() => handleFolderSelect(folder)}
                className="text-base"
              >
                {folder.name}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
      )}
      <Button
        variant={isEditMode ? 'active' : 'default'}
        onClick={onToggleEditMode}
        disabled={!layoutEditable && !isEditMode}
        title={
          layoutEditable
            ? 'Edit office layout'
            : 'Only the person who created the room edits its layout'
        }
        className={!layoutEditable && !isEditMode ? 'opacity-[var(--btn-disabled-opacity)]' : ''}
      >
        Layout
      </Button>
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        title="Settings"
      >
        Settings
      </Button>
      {onCopyWebLink && (
        <Button
          onClick={onCopyWebLink}
          title="Copy a link that opens this office in your browser (camera, microphone and screen work there)"
          data-testid="copy-web-link"
        >
          Web
        </Button>
      )}
      {multiplayer?.joined && (
        <>
          <div ref={youMenuRef} className="relative">
            <Button
              variant={isYouMenuOpen ? 'active' : 'default'}
              onClick={() => setIsYouMenuOpen((v) => !v)}
              title="Your character, desk and decoration"
              data-testid="you-menu"
            >
              You
            </Button>
            <Dropdown isOpen={isYouMenuOpen} className="min-w-128">
              <DropdownItem
                onClick={() => {
                  setIsYouMenuOpen(false);
                  onOpenAvatarEditor();
                }}
                className="text-base"
              >
                Customize character
              </DropdownItem>
              <DropdownItem
                onClick={() => {
                  setIsYouMenuOpen(false);
                  onPickDesk();
                }}
                className="text-base"
              >
                Choose desk
              </DropdownItem>
              <DropdownItem
                onClick={() => {
                  setIsYouMenuOpen(false);
                  onToggleSidePanel('decor');
                }}
                className="text-base"
              >
                Decorate desk
              </DropdownItem>
            </Dropdown>
          </div>
          <div ref={statusMenuRef} className="relative">
            <Button
              variant={isStatusMenuOpen ? 'active' : 'default'}
              onClick={() => setIsStatusMenuOpen((v) => !v)}
              title={
                statusText ? `${STATUS_LABELS[shownStatus]} — ${statusText}` : 'Set your status'
              }
              className="flex items-center gap-6"
              data-testid="status-button"
            >
              <StatusDot status={shownStatus} />
              {STATUS_LABELS[shownStatus]}
            </Button>
            <Dropdown isOpen={isStatusMenuOpen}>
              <StatusMenu
                status={status}
                statusText={statusText}
                inMeeting={inMeeting}
                onChange={(s, text) => {
                  onStatusChange(s, text);
                  setIsStatusMenuOpen(false);
                }}
                onClose={() => setIsStatusMenuOpen(false)}
              />
            </Dropdown>
          </div>
          <Button
            variant={sidePanel === 'meet' || inCall ? 'active' : 'default'}
            onClick={() => onToggleSidePanel('meet')}
            title="Video calls inside the room: start one or join one"
            data-testid="meet-toggle"
          >
            {inCall ? '● In call' : meetingCount > 0 ? `Meet (${meetingCount})` : 'Meet'}
          </Button>
          <Button
            variant={sidePanel === 'people' ? 'active' : 'default'}
            onClick={() => onToggleSidePanel('people')}
            title="Who is here — locate, go to or follow someone"
            data-testid="people-toggle"
          >
            People
          </Button>
          <div ref={emoteMenuRef} className="relative">
            <Button
              variant={isEmoteMenuOpen ? 'active' : 'default'}
              onClick={() => setIsEmoteMenuOpen((v) => !v)}
              title="Dance, wave, react (keys 1-8)"
              data-testid="emote-menu"
            >
              Emote
            </Button>
            <Dropdown isOpen={isEmoteMenuOpen} className="min-w-128">
              {EMOTE_ORDER.map((kind) => (
                <DropdownItem
                  key={kind}
                  onClick={() => {
                    onEmote(kind);
                    // Dance keeps going: leave the menu open to stop it as easily.
                    if (kind !== 'dance') setIsEmoteMenuOpen(false);
                  }}
                  className="text-base"
                >
                  <span className="inline-block w-32 mr-4">
                    {EMOTES[kind].emoji ?? (kind === 'jump' ? '⤴️' : '🌀')}
                  </span>
                  {EMOTES[kind].label}
                  <span className="text-2xs text-text-muted ml-8">{EMOTES[kind].key}</span>
                </DropdownItem>
              ))}
            </Dropdown>
          </div>
        </>
      )}
      {multiplayer && !multiplayer.joined && (
        <Button variant="accent" onClick={onOpenJoin} data-testid="open-join">
          Join room
        </Button>
      )}
      {chatEnabled && (
        <Button
          variant={isChatOpen ? 'active' : 'default'}
          onClick={onToggleChat}
          title="Room chat"
          className="relative"
          data-testid="chat-toggle"
        >
          Chat
          {chatUnread > 0 && !isChatOpen && (
            <span className="absolute -top-8 -right-8 min-w-16 h-16 px-2 bg-accent text-white text-2xs leading-none flex items-center justify-center border-2 border-border">
              {chatUnread > 99 ? '99+' : chatUnread}
            </span>
          )}
        </Button>
      )}
      <Button
        variant={sidePanel === 'calendar' ? 'active' : 'default'}
        onClick={() => onToggleSidePanel('calendar')}
        title="Your meetings — join them from the office"
        data-testid="calendar-toggle"
      >
        Calendar
      </Button>
      <Button
        variant={sidePanel === 'music' ? 'active' : 'default'}
        onClick={() => onToggleSidePanel('music')}
        title="Spotify"
        data-testid="music-toggle"
      >
        {musicPlaying ? '♪ Music' : 'Music'}
      </Button>
      {multiplayer?.joined && (
        <Button
          onClick={onLeaveRoom}
          title={`Leave room "${multiplayer.room}"${multiplayer.connected ? '' : ' (reconnecting...)'}`}
          data-testid="leave-room"
        >
          Leave{multiplayer.connected ? '' : '...'}
        </Button>
      )}
    </div>
  );
}
