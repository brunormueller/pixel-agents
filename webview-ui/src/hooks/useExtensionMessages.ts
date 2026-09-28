import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  CalendarState,
  ChatEntry,
  HooksConsentRequest,
  MultiplayerStatus,
  ProfileLoaded,
  RemotePeer,
  SpotifyStatus,
} from '../../../core/src/messages.js';
import {
  CHAT_HISTORY_LIMIT,
  PRESENCE_SEND_INTERVAL_MS,
  REMOTE_TYPING_TOOL_NAME,
} from '../constants.js';
import { playDoneSound, playPermissionSound, setSoundEnabled } from '../notificationSound.js';
import type { ChatBubble } from '../office/engine/chat.js';
import { bubbleDurationMs, pickLocalSpeaker, pushBubble } from '../office/engine/chat.js';
import type { ExistingAgentMeta, PendingAgent } from '../office/engine/existingAgents.js';
import { reconcileExistingAgents } from '../office/engine/existingAgents.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { collectPresence, loseDeskTo } from '../office/engine/presence.js';
import type { RemoteCharacter, RemoteToolNames } from '../office/engine/remoteAgents.js';
import { RemoteAgentRegistry } from '../office/engine/remoteAgents.js';
import { setGhostHeadlessAgents as setRendererGhostHeadlessAgents } from '../office/engine/renderer.js';
import { setFloorSprites } from '../office/floorTiles.js';
import { buildDynamicCatalog } from '../office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from '../office/layout/layoutSerializer.js';
import type { RoomLayoutRejectReason, RoomLayoutSync } from '../office/layout/roomLayoutSync.js';
import { setCarpetSprites } from '../office/sprites/carpetTiles.js';
import { setPetTemplates } from '../office/sprites/petSpriteData.js';
import { getLoadedCharacterCount, setCharacterTemplates } from '../office/sprites/spriteData.js';
import {
  anyReadingToolName,
  extractToolName,
  isSubagentToolName,
  setProviderCapabilities,
} from '../office/toolUtils.js';
import type { OfficeLayout, ToolActivity } from '../office/types.js';
import { setWallSprites } from '../office/wallTiles.js';
import { isBrowserRuntime, isE2E } from '../runtime.js';
import { transport } from '../transport/index.js';

/**
 * A Headless agent is one the office adopted from outside (`claude -p`, a session
 * picked up by Watch All Sessions) and therefore has no terminal to focus. Its
 * character renders translucent so it reads as untouchable at a glance.
 *
 * Standalone is exempt: that adapter has no terminals at all, so every agent
 * would qualify and the cue would distinguish nothing.
 */
const isHeadlessAgent = (isExternal: boolean | undefined): boolean =>
  isExternal === true && !isBrowserRuntime;

export interface SubagentCharacter {
  id: number;
  parentAgentId: number;
  parentToolId: string;
  label: string;
}

interface FurnitureAsset {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

/** A `roomLayout` message. `rev` = the map is everyone's (null: an older relay's, creator-only). */
interface RoomLayoutUpdate {
  layout: OfficeLayout | null;
  editable: boolean;
  rev: number | null;
  editId?: string;
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

interface ExtensionMessageState {
  agents: number[];
  selectedAgent: number | null;
  agentTools: Record<number, ToolActivity[]>;
  agentStatuses: Record<number, string>;
  subagentTools: Record<number, Record<string, ToolActivity[]>>;
  subagentCharacters: SubagentCharacter[];
  /** Other offices' agents in the multiplayer room (empty when multiplayer is off). */
  remoteCharacters: RemoteCharacter[];
  /** Multiplayer chat is available: the server replayed a chatHistory (only sent when multiplayer is configured). */
  chatEnabled: boolean;
  /** Room chat, oldest first, capped at CHAT_HISTORY_LIMIT. */
  chatMessages: ChatEntry[];
  /** Live speech bubbles over the characters that spoke. */
  chatBubbles: ChatBubble[];
  /** Multiplayer room state; null when no relay is configured (no join screen). */
  multiplayer: MultiplayerStatus | null;
  /** False while this office shows someone else's room layout. */
  layoutEditable: boolean;
  /** VS Code: this office is open in a browser page, which is the person's page meanwhile. */
  officeInBrowser: boolean;
  /** Name of the office that took our desk (it joined first); the UI asks for another. */
  deskLostTo: string | null;
  clearDeskLost: () => void;
  /** This office's saved profile (look, status, desk decoration, music sharing); null without multiplayer. */
  profile: ProfileLoaded | null;
  /** Calendar feeds and the next events; null until the server reported. */
  calendar: CalendarState | null;
  /** Spotify connection and what is playing; null until the server reported. */
  spotify: SpotifyStatus | null;
  layoutReady: boolean;
  layoutWasReset: boolean;
  loadedAssets?: { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> };
  workspaceFolders: WorkspaceFolder[];
  /** Distinct folderNames seen across agents this session — source for the Areas folder dropdown. */
  agentFolderNames: string[];
  externalAssetDirectories: string[];
  lastSeenVersion: string;
  extensionVersion: string;
  watchAllSessions: boolean;
  setWatchAllSessions: (v: boolean) => void;
  alwaysShowLabels: boolean;
  ghostHeadlessAgents: boolean;
  setGhostHeadlessAgents: (v: boolean) => void;
  hooksEnabled: boolean;
  setHooksEnabled: (v: boolean) => void;
  /** Actual install state per provider (hooksStatus messages) — absent/false
   *  while first-run consent is pending, unlike hooksEnabled which defaults
   *  true. Keyed by providerId; today's Settings checkbox reads 'claude'. */
  hooksInstalled: Record<string, boolean>;
  /** Bumped per provider on every hooksStatus message. `hooksInstalled` alone cannot say "the server answered": a
   *  failed install re-reports the `false` already held, so no effect runs. The Intro needs the ARRIVAL to tell a
   *  pending install from a failed one, per provider — A's status is never a verdict on B's install. */
  hooksStatusSeq: Record<string, number>;
  hooksInfoShown: boolean;
  /** First-run consent ask (hooksConsentRequest). Non-null while the server waits on an answer; carries the provider
   *  and the server's exact disclosure copy, so the consent step renders the terms being approved with no client
   *  duplicate to drift. Cleared on answer/dismissal, and by a matching provider's hooksStatus installed=true. */
  consentRequest: HooksConsentRequest | null;
  dismissConsentRequest: (providerId: string | null) => void;
  // Areas
  areaMappings: Record<string, string[]>;
  setAreaMappings: (m: Record<string, string[]>) => void;
  showAreas: boolean;
  setShowAreas: (v: boolean) => void;
}

function saveAgentSeats(os: OfficeState): void {
  transport.send({ type: 'saveAgentSeats', seats: os.getPersistableSeats() });
}

export function useExtensionMessages(
  getOfficeState: () => OfficeState,
  onLayoutLoaded?: (layout: OfficeLayout) => void,
  isEditDirty?: () => boolean,
  /** A room map everyone edits: its revisions go through here (it puts them on screen). */
  roomLayoutSync?: RoomLayoutSync,
): ExtensionMessageState {
  const [agents, setAgents] = useState<number[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [agentTools, setAgentTools] = useState<Record<number, ToolActivity[]>>({});
  const [agentStatuses, setAgentStatuses] = useState<Record<number, string>>({});
  const [subagentTools, setSubagentTools] = useState<
    Record<number, Record<string, ToolActivity[]>>
  >({});
  const [subagentCharacters, setSubagentCharacters] = useState<SubagentCharacter[]>([]);
  const [remoteCharacters, setRemoteCharacters] = useState<RemoteCharacter[]>([]);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [chatBubbles, setChatBubbles] = useState<ChatBubble[]>([]);
  const [multiplayer, setMultiplayer] = useState<MultiplayerStatus | null>(null);
  const [layoutEditable, setLayoutEditable] = useState(true);
  const [officeInBrowser, setOfficeInBrowser] = useState(false);
  const officeInBrowserRef = useRef(false);
  const [deskLostTo, setDeskLostTo] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileLoaded | null>(null);
  const [calendar, setCalendar] = useState<CalendarState | null>(null);
  const [spotify, setSpotify] = useState<SpotifyStatus | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutWasReset, setLayoutWasReset] = useState(false);
  const [loadedAssets, setLoadedAssets] = useState<
    { catalog: FurnitureAsset[]; sprites: Record<string, string[][]> } | undefined
  >();
  const [workspaceFolders, setWorkspaceFolders] = useState<WorkspaceFolder[]>([]);
  const [agentFolderNames, setAgentFolderNames] = useState<string[]>([]);
  const [externalAssetDirectories, setExternalAssetDirectories] = useState<string[]>([]);
  const [lastSeenVersion, setLastSeenVersion] = useState('');
  const [extensionVersion, setExtensionVersion] = useState('');
  const [watchAllSessions, setWatchAllSessions] = useState(false);
  const [alwaysShowLabels, setAlwaysShowLabels] = useState(false);
  const [ghostHeadlessAgents, setGhostHeadlessAgentsState] = useState(false);
  const [hooksEnabled, setHooksEnabled] = useState(true);
  const [hooksInstalled, setHooksInstalled] = useState<Record<string, boolean>>({});
  const [hooksStatusSeq, setHooksStatusSeq] = useState<Record<string, number>>({});
  const [hooksInfoShown, setHooksInfoShown] = useState(true);
  // FIFO of pending consent asks, at most one per provider (a re-ask replaces that provider's entry in place). The
  // HEAD is what the Intro renders; answering, dismissing, or mooting it advances to the next provider's ask rather
  // than dropping it — the server sends one request per provider on the same handshake.
  const [consentQueue, setConsentQueue] = useState<HooksConsentRequest[]>([]);
  const consentRequest = consentQueue[0] ?? null;
  const [areaMappings, setAreaMappings] = useState<Record<string, string[]>>({});
  const [showAreas, setShowAreas] = useState(false);

  // The renderer keeps its own module-level copy (read every rAF frame), so both
  // sources of truth move together — the persisted value on settingsLoaded and
  // the user's click in Settings.
  const applyGhostHeadlessAgents = useCallback((enabled: boolean) => {
    setGhostHeadlessAgentsState(enabled);
    setRendererGhostHeadlessAgents(enabled);
  }, []);

  // Track whether initial layout has been loaded (ref to avoid re-render)
  const layoutReadyRef = useRef(false);

  // Multiplayer: (peerId, remote agent id) → local character. Lives for the
  // panel's lifetime so a character keeps its id (and seat) across snapshots.
  const remoteRegistryRef = useRef(new RemoteAgentRegistry());
  const chatBubbleKeyRef = useRef(0);
  // Multiplayer room. While joined as a guest the office shows the ROOM's layout;
  // this office's own is kept aside (and kept current from layoutLoaded) so
  // leaving puts it back without a round trip.
  const joinedRef = useRef(false);
  const mySinceRef = useRef(0);
  const guestLayoutRef = useRef(false);
  const localLayoutRef = useRef<OfficeLayout | null>(null);
  const pendingRoomLayoutRef = useRef<RoomLayoutUpdate | null>(null);
  // The song on the person's character: what Spotify plays, while they share it.
  const shareMusicRef = useRef(false);
  const nowPlayingRef = useRef<SpotifyStatus['nowPlaying']>(null);

  // Live background spawn tools per agent (runInBackground agentToolStart, or a
  // lazily-created watched sub). Their sub-characters outlive the parent's turn:
  // agentToolsClear must NOT remove them — despawning and re-creating moved the
  // character to a new tile every turn. Cleared by subagentClear/agentClosed.
  const backgroundParentToolIdsRef = useRef<Record<number, Set<string>>>({});

  useEffect(() => {
    // Buffer agents from existingAgents until layout is loaded
    let pendingAgents: PendingAgent[] = [];

    // Accumulate distinct folderNames seen across agents (never removed during the
    // session): the source for the Areas folder-mapping dropdown, so a folder stays
    // editable even after its agents close.
    const noteFolderName = (name?: string) => {
      if (!name) return;
      setAgentFolderNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
    };

    const remoteToolNames = (): RemoteToolNames => ({
      reading: anyReadingToolName(),
      typing: REMOTE_TYPING_TOOL_NAME,
    });

    const asLayout = (raw: unknown): OfficeLayout | null => {
      const layout = raw as OfficeLayout | null;
      return layout && layout.version === 1 ? migrateLayoutColors(layout) : null;
    };

    const syncLocalMusic = (os: OfficeState) => {
      const np = nowPlayingRef.current;
      os.setLocalProfile({
        music:
          shareMusicRef.current && np?.isPlaying
            ? {
                title: np.title,
                artist: np.artist,
                ...(np.trackUrl ? { trackUrl: np.trackUrl } : {}),
              }
            : null,
      });
    };

    // Joined = the person has a character; left = it goes.
    const syncAvatar = (os: OfficeState) => {
      if (!layoutReadyRef.current) return;
      if (joinedRef.current) os.ensureAvatar();
      else os.removeAvatar();
    };

    const applyRoomLayout = (os: OfficeState, room: RoomLayoutUpdate) => {
      setLayoutEditable(room.editable);
      if (room.layout) {
        if (!guestLayoutRef.current) localLayoutRef.current = os.getLayout();
        guestLayoutRef.current = true;
        if (room.rev !== null && roomLayoutSync) {
          roomLayoutSync.receive(room.layout, room.rev, room.editId);
        } else {
          // An older relay's map: only the room's creator edits it.
          roomLayoutSync?.reset();
          os.rebuildFromLayout(room.layout);
          onLayoutLoaded?.(room.layout);
        }
      } else if (guestLayoutRef.current) {
        roomLayoutSync?.reset();
        guestLayoutRef.current = false;
        const local = localLayoutRef.current;
        localLayoutRef.current = null;
        if (local) {
          os.rebuildFromLayout(local);
          onLayoutLoaded?.(local);
        }
      }
      syncAvatar(os);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (msg: any) => {
      const os = getOfficeState();
      // CI / e2e diagnostic: record every received transport message on the
      // window-side log. The fixture reads window.__pixelAgentsTestHooks.
      // messageLog and attaches as JSON so CI failures can see the exact
      // sequence of messages the webview actually processed. Gated on the e2e
      // harness flag so this unbounded log never grows in a real session.
      if (isE2E && typeof window !== 'undefined') {
        if (!window.__pixelAgentsTestHooks) window.__pixelAgentsTestHooks = {};
        if (!window.__pixelAgentsTestHooks.messageLog) {
          window.__pixelAgentsTestHooks.messageLog = [];
        }
        window.__pixelAgentsTestHooks.messageLog.push({
          at: Date.now(),
          type: msg.type,
          id: msg.id,
          toolName: msg.toolName,
          status: msg.status,
          toolId: msg.toolId,
          parentToolId: msg.parentToolId,
        });
      }

      if (msg.type === 'providerCapabilities') {
        setProviderCapabilities({
          readingTools: msg.readingTools,
          subagentToolNames: msg.subagentToolNames,
        });
        return;
      }

      if (msg.type === 'layoutLoaded') {
        // Showing a room's layout: this office's own changed underneath — keep it
        // for when we leave, don't swap the shared map out from under everyone.
        if (layoutReadyRef.current && guestLayoutRef.current) {
          localLayoutRef.current = asLayout(msg.layout) ?? localLayoutRef.current;
          return;
        }
        // Skip external layout updates while editor has unsaved changes
        if (layoutReadyRef.current && isEditDirty?.()) {
          console.log('[Webview] Skipping external layout update — editor has unsaved changes');
          return;
        }
        const rawLayout = msg.layout as OfficeLayout | null;
        const layout = rawLayout && rawLayout.version === 1 ? migrateLayoutColors(rawLayout) : null;
        if (layout) {
          os.rebuildFromLayout(layout);
          onLayoutLoaded?.(layout);
        } else {
          // Default layout — snapshot whatever OfficeState built
          onLayoutLoaded?.(os.getLayout());
        }
        // Add buffered agents now that layout (and seats) are correct
        for (const p of pendingAgents) {
          os.addAgent(p.id, p.palette, p.hueShift, p.seatId, true, p.folderName);
          if (p.isHeadless) os.setHeadless(p.id, true);
        }
        pendingAgents = [];
        // Remote characters take whatever seats the local agents left.
        if (remoteRegistryRef.current.flush(os, getLoadedCharacterCount(), remoteToolNames())) {
          setRemoteCharacters(remoteRegistryRef.current.characters());
        }
        layoutReadyRef.current = true;
        setLayoutReady(true);
        // A room layout that arrived before the first layout waits for it.
        const pendingRoom = pendingRoomLayoutRef.current;
        pendingRoomLayoutRef.current = null;
        if (pendingRoom) applyRoomLayout(os, pendingRoom);
        else syncAvatar(os);
        if (msg.wasReset) {
          setLayoutWasReset(true);
        }
        if (os.characters.size > 0) {
          saveAgentSeats(os);
        }
      } else if (msg.type === 'multiplayerStatus') {
        const status = msg as MultiplayerStatus;
        setMultiplayer(status);
        joinedRef.current = status.joined;
        mySinceRef.current = status.since ?? 0;
        syncAvatar(os);
      } else if (msg.type === 'roomLayout') {
        const room: RoomLayoutUpdate = {
          layout: asLayout(msg.layout),
          editable: msg.editable !== false,
          rev: typeof msg.rev === 'number' ? msg.rev : null,
          editId: typeof msg.editId === 'string' ? msg.editId : undefined,
        };
        // Before the first layout only the newest map matters: it arrives as a fresh one.
        if (!layoutReadyRef.current) pendingRoomLayoutRef.current = { ...room, editId: undefined };
        else applyRoomLayout(os, room);
      } else if (msg.type === 'officeInBrowser') {
        officeInBrowserRef.current = msg.open === true;
        setOfficeInBrowser(msg.open === true);
      } else if (msg.type === 'roomLayoutRejected') {
        roomLayoutSync?.rejected(String(msg.editId), msg.reason as RoomLayoutRejectReason);
      } else if (msg.type === 'remotePeers') {
        const registry = remoteRegistryRef.current;
        const peers = (Array.isArray(msg.peers) ? msg.peers : []) as RemotePeer[];
        // Someone who joined first holds our desk: give it up BEFORE their claim
        // is applied below, and ask the person for another.
        const winner = loseDeskTo(os.getDesk(), mySinceRef.current, peers);
        if (winner) {
          os.setDesk(null);
          setDeskLostTo(winner.name);
        }
        const changed = registry.reconcile(
          os,
          peers,
          layoutReadyRef.current,
          getLoadedCharacterCount(),
          remoteToolNames(),
        );
        if (changed) setRemoteCharacters(registry.characters());
      } else if (msg.type === 'chatHistory') {
        // History only: replayed lines already had their moment, no bubbles.
        setChatEnabled(true);
        const messages = (Array.isArray(msg.messages) ? msg.messages : []) as ChatEntry[];
        setChatMessages(messages.slice(-CHAT_HISTORY_LIMIT));
      } else if (msg.type === 'chatMessage') {
        const entry = msg.message as ChatEntry | undefined;
        if (!entry || typeof entry.text !== 'string') return;
        setChatEnabled(true);
        setChatMessages((prev) => [...prev, entry].slice(-CHAT_HISTORY_LIMIT));
        const speaker = entry.self
          ? (os.avatarId ?? pickLocalSpeaker(os.characters.keys(), os.selectedAgentId))
          : remoteRegistryRef.current.speakerOf(entry.peerId);
        if (speaker !== null) {
          const now = Date.now();
          const bubble: ChatBubble = {
            key: chatBubbleKeyRef.current++,
            charId: speaker,
            text: entry.text,
            startedAt: now,
            durationMs: bubbleDurationMs(entry.text),
          };
          setChatBubbles((prev) => pushBubble(prev, bubble, now));
        }
      } else if (msg.type === 'profileLoaded') {
        const p = msg as ProfileLoaded;
        setProfile(p);
        os.setLocalProfile({
          look: p.look ?? null,
          status: p.status,
          statusText: p.statusText,
        });
        os.setLocalDecor(Array.isArray(p.decor) ? p.decor : []);
        os.setLocalDressing({
          deskStyle: p.deskStyle ?? null,
          hidden: Array.isArray(p.hidden) ? p.hidden : [],
        });
        shareMusicRef.current = p.shareMusic === true;
        syncLocalMusic(os);
      } else if (msg.type === 'calendarState') {
        setCalendar(msg as CalendarState);
      } else if (msg.type === 'spotifyStatus') {
        const status = msg as SpotifyStatus;
        setSpotify(status);
        nowPlayingRef.current = status.nowPlaying ?? null;
        syncLocalMusic(os);
      } else if (msg.type === 'openExternalUrl') {
        // Standalone: the server asks this page to open a sign-in in a new tab.
        const url = typeof msg.url === 'string' ? msg.url : '';
        if (url.startsWith('https://')) window.open(url, '_blank', 'noopener,noreferrer');
      } else if (msg.type === 'agentCreated') {
        const id = msg.id as number;
        const folderName = msg.folderName as string | undefined;
        const isTeammate = msg.isTeammate as boolean | undefined;
        const teammateName = msg.teammateName as string | undefined;
        const teammateParentId = msg.parentAgentId as number | undefined;
        const teamName = msg.teamName as string | undefined;
        setAgents((prev) => (prev.includes(id) ? prev : [...prev, id]));
        // Don't auto-select teammates (keep focus on lead)
        if (!isTeammate) {
          setSelectedAgent(id);
        }
        if (isTeammate && teammateParentId !== undefined) {
          // Teammate: inherit parent's palette and workspace folderName (teammate runs
          // in the same workspace as the lead). Name shown via agentName (teamRoleLabel).
          // Seat them at the free seat closest to the lead so the team clusters.
          const parentCh = os.characters.get(teammateParentId);
          const palette = parentCh ? parentCh.palette : undefined;
          const hueShift = parentCh ? parentCh.hueShift : undefined;
          os.addAgent(
            id,
            palette,
            hueShift,
            undefined,
            undefined,
            parentCh?.folderName,
            teammateParentId,
          );
          noteFolderName(parentCh?.folderName);
          // Set team metadata on the character
          const ch = os.characters.get(id);
          if (ch) {
            ch.leadAgentId = teammateParentId;
            ch.teamName = teamName ?? parentCh?.teamName;
            ch.agentName = teammateName;
          }
        } else {
          const palette = msg.palette as number | undefined;
          const hueShift = msg.hueShift as number | undefined;
          os.addAgent(id, palette, hueShift, undefined, undefined, folderName);
          noteFolderName(folderName);
          if (isHeadlessAgent(msg.isExternal as boolean | undefined)) {
            os.setHeadless(id, true);
          }
        }
        saveAgentSeats(os);
      } else if (msg.type === 'agentClosed') {
        const id = msg.id as number;
        setAgents((prev) => prev.filter((a) => a !== id));
        setSelectedAgent((prev) => (prev === id ? null : prev));
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setAgentStatuses((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSubagentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Remove all sub-agent characters belonging to this agent
        delete backgroundParentToolIdsRef.current[id];
        os.removeAllSubagents(id);
        setSubagentCharacters((prev) => prev.filter((s) => s.parentAgentId !== id));
        os.removeAgent(id);
      } else if (msg.type === 'existingAgents') {
        const incoming = msg.agents as number[];
        const meta = (msg.agentMeta || {}) as Record<number, ExistingAgentMeta>;
        const folderNames = (msg.folderNames || {}) as Record<number, string>;
        const externalAgents = (msg.externalAgents || {}) as Record<number, boolean>;
        const headlessAgents: Record<number, boolean> = {};
        for (const id of incoming) {
          noteFolderName(folderNames[id]);
          if (isHeadlessAgent(externalAgents[id])) headlessAgents[id] = true;
        }
        // Order-independent restore: add agents now if the layout (and its seats)
        // is already built, otherwise buffer them for the next layoutLoaded.
        // Depending on layoutLoaded always arriving last stranded restored agents
        // on surfaces that send layout first (issue #334).
        if (
          reconcileExistingAgents(
            os,
            incoming,
            meta,
            folderNames,
            layoutReadyRef.current,
            pendingAgents,
            headlessAgents,
          )
        ) {
          saveAgentSeats(os);
        }
        setAgents((prev) => {
          const ids = new Set(prev);
          const merged = [...prev];
          for (const id of incoming) {
            if (!ids.has(id)) {
              merged.push(id);
            }
          }
          return merged.sort((a, b) => a - b);
        });
      } else if (msg.type === 'agentToolStart') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        const permissionActive = msg.permissionActive as boolean | undefined;
        setAgentTools((prev) => {
          const list = prev[id] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return {
            ...prev,
            [id]: [
              ...list,
              { toolId, status, done: false, permissionWait: permissionActive || false },
            ],
          };
        });
        const toolName = (msg.toolName as string | undefined) ?? extractToolName(status);
        os.setAgentTool(id, toolName);
        os.setAgentActive(id, true);
        // Don't clear the permission bubble if the hook already confirmed permission is needed
        if (!permissionActive) {
          os.clearPermissionBubble(id);
        }
        // Create sub-agent character for Task/Agent tool subtasks.
        // agentToolStart for Task/Agent is always emitted via JSONL (with the stable
        // toolu_* id), never from the hook path — handlePreToolUse skips these tools.
        // runInBackground routing:
        //   - parent HAS teamName: teammate path (onTeammateDetected) creates the
        //     teammate; we skip here so we don't spawn a ghost sub-agent alongside.
        //   - parent has NO teamName: no teammate path exists, so we must still
        //     create the Subtask sub-character or the background task is invisible.
        const runInBackground = msg.runInBackground as boolean | undefined;
        if (runInBackground) {
          const set = (backgroundParentToolIdsRef.current[id] ??= new Set());
          set.add(toolId);
        }
        // Named spawns are Teammates-to-be: a teammate character will represent
        // them, so never create the Subtask ghost the teammate would replace.
        const isTeammateSpawn = msg.isTeammateSpawn as boolean | undefined;
        const parentChar = os.characters.get(id);
        const parentHasTeam = !!parentChar?.teamName;
        if (
          isSubagentToolName(toolName) &&
          !isTeammateSpawn &&
          (!runInBackground || !parentHasTeam)
        ) {
          const label = status.startsWith('Subtask:') ? status.slice('Subtask:'.length).trim() : '';
          const subId = os.addSubagent(id, toolId);
          setSubagentCharacters((prev) => {
            if (prev.some((s) => s.id === subId)) return prev;
            return [...prev, { id: subId, parentAgentId: id, parentToolId: toolId, label }];
          });
        }
      } else if (msg.type === 'agentToolDone') {
        const id = msg.id as number;
        const toolId = msg.toolId as string;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
          };
        });
      } else if (msg.type === 'agentToolsClear') {
        const id = msg.id as number;
        const bgSet = backgroundParentToolIdsRef.current[id];
        setAgentTools((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Keep sub-tool rows of live background spawns: their sub-characters
        // survive the parent's turn end and stay animated by their own activity.
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs) return prev;
          const kept: Record<string, ToolActivity[]> = {};
          for (const [parentToolId, rows] of Object.entries(agentSubs)) {
            if (bgSet?.has(parentToolId)) kept[parentToolId] = rows;
          }
          const next = { ...prev };
          if (Object.keys(kept).length === 0) {
            delete next[id];
          } else {
            next[id] = kept;
          }
          return next;
        });
        // Remove this agent's sub-agent characters, EXCEPT:
        // - team leads with inline teammates: their sub-agents represent real
        //   teammates, removed only by SubagentStop/subagentClear;
        // - live background spawns: removing + re-creating them on every turn
        //   end teleported the character (subagentClear removes them for real).
        const clearCh = os.characters.get(id);
        const hasInlineTeammates =
          clearCh?.teamName && clearCh?.isTeamLead && !clearCh?.teamUsesTmux;
        if (!hasInlineTeammates) {
          const doomed: string[] = [];
          for (const meta of os.subagentMeta.values()) {
            if (meta.parentAgentId === id && !bgSet?.has(meta.parentToolId)) {
              doomed.push(meta.parentToolId);
            }
          }
          for (const parentToolId of doomed) {
            os.removeSubagent(id, parentToolId);
          }
          setSubagentCharacters((prev) =>
            prev.filter((s) => s.parentAgentId !== id || bgSet?.has(s.parentToolId)),
          );
        }
        os.setAgentTool(id, null);
        os.clearPermissionBubble(id);
      } else if (msg.type === 'agentSelected') {
        const id = msg.id as number;
        setSelectedAgent(id);
      } else if (msg.type === 'agentStatus') {
        const id = msg.id as number;
        const status = msg.status as string;
        setAgentStatuses((prev) => {
          if (status === 'active') {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          }
          return { ...prev, [id]: status };
        });
        os.setAgentActive(id, status === 'active');
        if (status === 'waiting') {
          os.showWaitingBubble(id, msg.awaitingInput === true);
          playDoneSound();
        }
      } else if (msg.type === 'agentToolPermission') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.done ? t : { ...t, permissionWait: true })),
          };
        });
        os.showPermissionBubble(id);
        playPermissionSound();
      } else if (msg.type === 'subagentToolPermission') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        // Show permission bubble on the sub-agent character
        const subId = os.getSubagentId(id, parentToolId);
        if (subId !== null) {
          os.showPermissionBubble(subId);
        }
      } else if (msg.type === 'agentToolPermissionClear') {
        const id = msg.id as number;
        setAgentTools((prev) => {
          const list = prev[id];
          if (!list) return prev;
          const hasPermission = list.some((t) => t.permissionWait);
          if (!hasPermission) return prev;
          return {
            ...prev,
            [id]: list.map((t) => (t.permissionWait ? { ...t, permissionWait: false } : t)),
          };
        });
        os.clearPermissionBubble(id);
        // Also clear permission bubbles on all sub-agent characters of this parent
        for (const [subId, meta] of os.subagentMeta) {
          if (meta.parentAgentId === id) {
            os.clearPermissionBubble(subId);
          }
        }
      } else if (msg.type === 'subagentToolStart') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        const status = msg.status as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id] || {};
          const list = agentSubs[parentToolId] || [];
          if (list.some((t) => t.toolId === toolId)) return prev;
          return {
            ...prev,
            [id]: { ...agentSubs, [parentToolId]: [...list, { toolId, status, done: false }] },
          };
        });
        // Update sub-agent character's tool and active state. The sub-agent is
        // usually created by an earlier agentToolStart from JSONL using the same
        // (real) parentToolId. When it's missing — a teamed lead's background
        // spawn (the creation gate above suppressed the Subtask) or a reloaded
        // panel that lost it — create it lazily; addSubagent is idempotent.
        let subId = os.getSubagentId(id, parentToolId);
        if (subId === null) {
          subId = os.addSubagent(id, parentToolId);
          const newSubId = subId;
          setSubagentCharacters((prev) => {
            if (prev.some((s) => s.id === newSubId)) return prev;
            return [...prev, { id: newSubId, parentAgentId: id, parentToolId, label: '' }];
          });
          // Only watched background spawns are created lazily -- mark the
          // parent tool as background so agentToolsClear preserves the sub.
          const set = (backgroundParentToolIdsRef.current[id] ??= new Set());
          set.add(parentToolId);
        }
        const subToolName = extractToolName(status);
        os.setAgentTool(subId, subToolName);
        os.setAgentActive(subId, true);
      } else if (msg.type === 'subagentToolDone') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        const toolId = msg.toolId as string;
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs) return prev;
          const list = agentSubs[parentToolId];
          if (!list) return prev;
          return {
            ...prev,
            [id]: {
              ...agentSubs,
              [parentToolId]: list.map((t) => (t.toolId === toolId ? { ...t, done: true } : t)),
            },
          };
        });
      } else if (msg.type === 'subagentClear') {
        const id = msg.id as number;
        const parentToolId = msg.parentToolId as string;
        backgroundParentToolIdsRef.current[id]?.delete(parentToolId);
        setSubagentTools((prev) => {
          const agentSubs = prev[id];
          if (!agentSubs || !(parentToolId in agentSubs)) return prev;
          const next = { ...agentSubs };
          delete next[parentToolId];
          if (Object.keys(next).length === 0) {
            const outer = { ...prev };
            delete outer[id];
            return outer;
          }
          return { ...prev, [id]: next };
        });
        // Remove sub-agent character
        os.removeSubagent(id, parentToolId);
        setSubagentCharacters((prev) =>
          prev.filter((s) => !(s.parentAgentId === id && s.parentToolId === parentToolId)),
        );
      } else if (msg.type === 'characterSpritesLoaded') {
        const characters = msg.characters as Array<{
          down: string[][][];
          up: string[][][];
          right: string[][][];
        }>;
        console.log(`[Webview] Received ${characters.length} pre-colored character sprites`);
        setCharacterTemplates(characters);
      } else if (msg.type === 'petSpritesLoaded') {
        const pets = msg.pets;
        if (!Array.isArray(pets)) {
          return;
        }
        const petNames = Array.isArray(msg.petNames) ? (msg.petNames as string[]) : undefined;
        console.log(`[Webview] Received ${pets.length} pet sprites`);
        setPetTemplates(
          pets as Array<{
            walkDown: string[][][];
            idleDown: string[][][];
            walkUp: string[][][];
            idleUp: string[][][];
            walkRight: string[][][];
          }>,
          petNames,
        );
      } else if (msg.type === 'floorTilesLoaded') {
        const sprites = msg.sprites as string[][][];
        console.log(`[Webview] Received ${sprites.length} floor tile patterns`);
        setFloorSprites(sprites);
      } else if (msg.type === 'wallTilesLoaded') {
        const sets = msg.sets as string[][][][];
        console.log(`[Webview] Received ${sets.length} wall tile set(s)`);
        setWallSprites(sets);
      } else if (msg.type === 'carpetTilesLoaded') {
        const sets = msg.sets as string[][][][];
        console.log(`[Webview] Received ${sets.length} carpet variant(s)`);
        setCarpetSprites(sets);
      } else if (msg.type === 'areaMappingsLoaded') {
        const mappings = (msg.mappings ?? {}) as Record<string, string[]>;
        setAreaMappings(mappings);
        os.setAreaMappings(mappings);
      } else if (msg.type === 'workspaceFolders') {
        const folders = msg.folders as WorkspaceFolder[];
        setWorkspaceFolders(folders);
      } else if (msg.type === 'settingsLoaded') {
        const soundOn = msg.soundEnabled as boolean;
        setSoundEnabled(soundOn);
        if (typeof msg.watchAllSessions === 'boolean') {
          setWatchAllSessions(msg.watchAllSessions as boolean);
        }
        if (typeof msg.alwaysShowLabels === 'boolean') {
          setAlwaysShowLabels(msg.alwaysShowLabels as boolean);
        }
        if (typeof msg.ghostHeadlessAgents === 'boolean') {
          applyGhostHeadlessAgents(msg.ghostHeadlessAgents as boolean);
        }
        if (typeof msg.hooksEnabled === 'boolean') {
          setHooksEnabled(msg.hooksEnabled as boolean);
        }
        if (typeof msg.hooksInfoShown === 'boolean') {
          setHooksInfoShown(msg.hooksInfoShown as boolean);
        }
        if (typeof msg.showAreas === 'boolean') {
          setShowAreas(msg.showAreas as boolean);
        }
        if (Array.isArray(msg.externalAssetDirectories)) {
          setExternalAssetDirectories(msg.externalAssetDirectories as string[]);
        }
        if (typeof msg.lastSeenVersion === 'string') {
          setLastSeenVersion(msg.lastSeenVersion as string);
        }
        if (typeof msg.extensionVersion === 'string') {
          setExtensionVersion(msg.extensionVersion as string);
        }
      } else if (msg.type === 'hooksStatus') {
        if (typeof msg.installed === 'boolean' && typeof msg.providerId === 'string') {
          const providerId = msg.providerId as string;
          const installed = msg.installed as boolean;
          setHooksInstalled((m) => ({ ...m, [providerId]: installed }));
          setHooksStatusSeq((m) => ({ ...m, [providerId]: (m[providerId] ?? 0) + 1 }));
          if (installed) {
            // Moot once THIS provider's hooks are installed — the Settings toggle or another tab granted consent
            // while the dialog was open. Drop it from the queue (head or queued) rather than let a stale approval
            // re-install; another provider's status is not about this ask.
            setConsentQueue((q) => q.filter((r) => r.providerId !== providerId));
          }
        }
      } else if (msg.type === 'hooksConsentRequest') {
        if (
          typeof msg.providerId === 'string' &&
          typeof msg.headline === 'string' &&
          typeof msg.disclosure === 'string'
        ) {
          const request: HooksConsentRequest = {
            type: 'hooksConsentRequest',
            providerId: msg.providerId as string,
            headline: msg.headline as string,
            disclosure: msg.disclosure as string,
          };
          setConsentQueue((q) => {
            const i = q.findIndex((r) => r.providerId === request.providerId);
            if (i === -1) return [...q, request];
            const next = q.slice();
            next[i] = request; // a re-ask carries the freshest copy
            return next;
          });
        }
      } else if (msg.type === 'externalAssetDirectoriesUpdated') {
        if (Array.isArray(msg.dirs)) {
          setExternalAssetDirectories(msg.dirs as string[]);
        }
      } else if (msg.type === 'furnitureAssetsLoaded') {
        try {
          const catalog = msg.catalog as FurnitureAsset[];
          const sprites = msg.sprites as Record<string, string[][]>;
          console.log(`📦 Webview: Loaded ${catalog.length} furniture assets`);
          // Build dynamic catalog immediately so getCatalogEntry() works when layoutLoaded arrives next
          buildDynamicCatalog({ catalog, sprites });
          setLoadedAssets({ catalog, sprites });
        } catch (err) {
          console.error(`❌ Webview: Error processing furnitureAssetsLoaded:`, err);
        }
      } else if (msg.type === 'agentTeamInfo') {
        const id = msg.id as number;
        os.setTeamInfo(
          id,
          msg.teamName as string | undefined,
          msg.agentName as string | undefined,
          msg.isTeamLead as boolean | undefined,
          msg.leadAgentId as number | undefined,
          msg.teamUsesTmux as boolean | undefined,
        );
      } else if (msg.type === 'agentContextUsage') {
        const id = msg.id as number;
        os.setAgentContext(id, msg.contextTokens as number, msg.maxContextTokens as number);
      }
    };
    const unsubscribe = transport.onMessage(handler);

    // Multiplayer: report where this office's characters stand on the shared
    // map, and its desk. Only when something changed; the server folds it into
    // what it publishes (and drops the poses when the room has no shared map).
    let lastPresence = '';
    const presenceTimer = setInterval(() => {
      // Open in a browser page (VS Code): that page reports the person's character.
      if (!joinedRef.current || !layoutReadyRef.current || officeInBrowserRef.current) {
        lastPresence = '';
        return;
      }
      const os = getOfficeState();
      const message = {
        type: 'presenceUpdate' as const,
        characters: collectPresence(os.characters.values(), os.avatarId),
        desk: os.getDesk(),
      };
      const json = JSON.stringify(message);
      if (json === lastPresence) return;
      lastPresence = json;
      transport.send(message);
    }, PRESENCE_SEND_INTERVAL_MS);
    transport.send({ type: 'webviewReady' });
    return () => {
      clearInterval(presenceTimer);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getOfficeState]);

  // Idle sub-agent characters between their turns: when every tracked tool row
  // for a sub is done, stop its typing animation (a later subagentToolStart
  // reactivates it). Watched background sub-agents get a synthesized done for
  // each live tool at their turn end, so they sit idle instead of typing forever.
  useEffect(() => {
    const os = getOfficeState();
    for (const sub of subagentCharacters) {
      const rows = subagentTools[sub.parentAgentId]?.[sub.parentToolId];
      if (rows && rows.length > 0 && rows.every((t) => t.done)) {
        os.setAgentTool(sub.id, null);
        os.setAgentActive(sub.id, false);
      }
    }
  }, [subagentTools, subagentCharacters, getOfficeState]);

  return {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    subagentTools,
    subagentCharacters,
    remoteCharacters,
    chatEnabled,
    chatMessages,
    chatBubbles,
    multiplayer,
    layoutEditable,
    officeInBrowser,
    deskLostTo,
    clearDeskLost: useCallback(() => setDeskLostTo(null), []),
    profile,
    calendar,
    spotify,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
    agentFolderNames,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels,
    ghostHeadlessAgents,
    setGhostHeadlessAgents: applyGhostHeadlessAgents,
    hooksEnabled,
    hooksInstalled,
    hooksStatusSeq,
    setHooksEnabled,
    hooksInfoShown,
    consentRequest,
    // Called when a tour ends (answer + Let's Go, the X, Escape) with the providerId that tour was ABOUT, removing
    // that entry so the next provider's ask becomes the head. Keyed by id, not a blind shift: an answered ask's own
    // installed:true moot may already have removed the head, and a shift would then drop the NEXT provider's ask
    // unanswered. An aborted ask returns on the next connect; the queue never re-adds it here.
    dismissConsentRequest: useCallback(
      (providerId: string | null) =>
        setConsentQueue((q) =>
          providerId === null ? q.slice(1) : q.filter((r) => r.providerId !== providerId),
        ),
      [],
    ),
    areaMappings,
    setAreaMappings,
    showAreas,
    setShowAreas,
  };
}
