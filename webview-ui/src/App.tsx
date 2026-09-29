import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AvatarLook,
  CalendarEvent,
  DeskDecorItem,
  PersonStatus,
} from '../../core/src/messages.js';
import { toMajorMinor } from './changelogData.js';
import { AvatarEditor } from './components/AvatarEditor.js';
import type { SidePanelId } from './components/BottomToolbar.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { CalendarPanel } from './components/CalendarPanel.js';
import { ChangelogModal } from './components/ChangelogModal.js';
import { ChatPanel } from './components/ChatPanel.js';
import { ConnectionIndicator } from './components/ConnectionIndicator.js';
import { DebugView } from './components/DebugView.js';
import { DecorPanel } from './components/DecorPanel.js';
import { EditActionBar } from './components/EditActionBar.js';
import { ElevatorPicker } from './components/ElevatorPicker.js';
import { FpsGame } from './components/games/FpsGame.js';
import { GamesPanel } from './components/games/GamesPanel.js';
import { IntroBubble } from './components/IntroBubble.js';
import { JoinScreen } from './components/JoinScreen.js';
import { LevelSwitcher } from './components/LevelSwitcher.js';
import { MeetingInviteToast } from './components/meeting/MeetingInviteToast.js';
import { MeetingsPanel } from './components/meeting/MeetingsPanel.js';
import { MeetingView } from './components/meeting/MeetingView.js';
import { MeetingToast } from './components/MeetingToast.js';
import { MigrationNotice } from './components/MigrationNotice.js';
import { MusicPanel } from './components/MusicPanel.js';
import { PeoplePanel } from './components/PeoplePanel.js';
import { PortalPanel } from './components/PortalPanel.js';
import { SettingsModal } from './components/SettingsModal.js';
import { Tooltip } from './components/Tooltip.js';
import { Modal } from './components/ui/Modal.js';
import { VersionIndicator } from './components/VersionIndicator.js';
import { ZoomControls } from './components/ZoomControls.js';
import { DECOR_MAX_ITEMS } from './constants.js';
import { useGames } from './games/useGames.js';
import { useAvatarKeyboard } from './hooks/useAvatarKeyboard.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { useIntroTour } from './hooks/useIntroTour.js';
import { useMeeting } from './meeting/useMeeting.js';
import { ChatBubbles } from './office/components/ChatBubbles.js';
import { DecorPlacer } from './office/components/DecorPlacer.js';
import { DeskPicker } from './office/components/DeskPicker.js';
import { EmoteOverlay } from './office/components/EmoteOverlay.js';
import { NameTags } from './office/components/NameTags.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import type { DeskPreset } from './office/engine/decorCatalog.js';
import { OfficeState } from './office/engine/officeState.js';
import { exportLayoutToFile } from './office/layout/exportLayout.js';
import { getRotatedType, isRotatable } from './office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from './office/layout/layoutSerializer.js';
import { portalInfo } from './office/layout/portals.js';
import { RoomLayoutSync } from './office/layout/roomLayoutSync.js';
import { DEFAULT_LOOK } from './office/sprites/avatarLook.js';
import { getPetCount } from './office/sprites/petSpriteData.js';
import { EditTool, type OfficeLayout } from './office/types.js';
import { isBrowserRuntime, isE2E } from './runtime.js';
import { installTestHooks } from './testHooks.js';
import { transport } from './transport/index.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();
// A multiplayer room's map, which everyone in the room edits.
const roomLayoutSync = new RoomLayoutSync();

// Test-only observability hooks (message/sound logs, addAgent wrapper, selectAgent).
// Installed only under the e2e harness so they never patch prototypes or grow
// unbounded logs in a real user's session.
if (isE2E) installTestHooks(officeStateRef);

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

/** The person's desk decoration as the office has it — current the moment it changes,
 *  where the profile only catches up once the server echoes it. */
function liveDecor(): DeskDecorItem[] {
  return getOfficeState().getLocalDecor();
}

/** Open an https link (a meeting, a song): the standalone page opens a tab, VS Code asks the extension. */
function openUrl(url: string): void {
  if (!url.startsWith('https://')) return;
  if (isBrowserRuntime) window.open(url, '_blank', 'noopener,noreferrer');
  else transport.send({ type: 'openExternal', url });
}

function App() {
  // Browser runtime (dev or static dist): dispatch mock messages after the
  // useExtensionMessages listener has been registered.
  useEffect(() => {
    // browserMock is for Vite dev mode only (UI prototyping without a server).
    // In standalone server mode, the server sends all state over WebSocket.
    // In VS Code mode, the extension sends all state via postMessage.
    if (isBrowserRuntime && import.meta.env.DEV) {
      void import('./browserMock.js').then(({ dispatchMockMessages }) => dispatchMockMessages());
    }
  }, []);

  const editor = useEditorActions(getOfficeState, editorState, roomLayoutSync);

  // Declared before useExtensionMessages: the host is in place before any room map arrives.
  const { showRoomLayout } = editor;
  useEffect(() => {
    roomLayoutSync.setHost({
      send: (layout, base, editId) =>
        transport.send({
          type: 'saveRoomLayout',
          layout: layout as unknown as Record<string, unknown>,
          base,
          editId,
        }),
      show: showRoomLayout,
    });
    return () => roomLayoutSync.setHost(null);
  }, [showRoomLayout]);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
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
    clearDeskLost,
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
    setGhostHeadlessAgents,
    hooksEnabled,
    hooksInstalled,
    hooksStatusSeq,
    hooksInfoShown,
    consentRequest,
    dismissConsentRequest,
    areaMappings,
    setAreaMappings,
    showAreas,
    setShowAreas,
    profile,
    calendar,
    spotify,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty, roomLayoutSync);

  // Show migration notice once layout reset is detected
  const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false);
  const showMigrationNotice = layoutWasReset && !migrationNoticeDismissed;

  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // One panel docked on the right at a time: chat, people, calendar, music, decorate.
  const [sidePanel, setSidePanel] = useState<SidePanelId | null>(null);
  const isChatOpen = sidePanel === 'chat';
  const toggleSidePanel = useCallback(
    (panel: SidePanelId) => setSidePanel((open) => (open === panel ? null : panel)),
    [],
  );
  // Other offices' lines newer than this are unread. Starts at mount, so a
  // replayed history doesn't greet a reload with a badge.
  const [chatSeenTs, setChatSeenTs] = useState(() => Date.now());
  const latestChatTs = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1].ts : 0;
  useEffect(() => {
    if (isChatOpen && latestChatTs > chatSeenTs) setChatSeenTs(latestChatTs);
  }, [isChatOpen, latestChatTs, chatSeenTs]);
  const chatUnread = isChatOpen
    ? 0
    : chatMessages.filter((m) => !m.self && m.ts > chatSeenTs).length;
  const [isHooksInfoOpen, setIsHooksInfoOpen] = useState(false);
  const [hooksTooltipDismissed, setHooksTooltipDismissed] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [alwaysShowOverlay, setAlwaysShowOverlay] = useState(false);

  const currentMajorMinor = toMajorMinor(extensionVersion);

  const handleWhatsNewDismiss = useCallback(() => {
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  const handleOpenChangelog = useCallback(() => {
    setIsChangelogOpen(true);
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  // Sync alwaysShowOverlay from persisted settings
  useEffect(() => {
    setAlwaysShowOverlay(alwaysShowLabels);
  }, [alwaysShowLabels]);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);
  const handleToggleAlwaysShowOverlay = useCallback(() => {
    setAlwaysShowOverlay((prev) => {
      const newVal = !prev;
      transport.send({ type: 'setAlwaysShowLabels', enabled: newVal });
      return newVal;
    });
  }, []);

  // Toggle "Display headless as ghosts". setGhostHeadlessAgents also updates the
  // renderer's module copy, so the office redraws on the next frame.
  const handleToggleGhostHeadlessAgents = useCallback(() => {
    const next = !ghostHeadlessAgents;
    setGhostHeadlessAgents(next);
    transport.send({ type: 'setGhostHeadlessAgents', enabled: next });
  }, [ghostHeadlessAgents, setGhostHeadlessAgents]);

  const handleSelectAgent = useCallback((id: number) => {
    transport.send({ type: 'focusAgent', id });
  }, []);

  // The Intro's wire-facing state machine — which asks survive being mooted,
  // when a hooksStatus is this tour's install verdict — lives in useIntroTour
  // (pure reducer in introTourState.ts); the App only wires it to the bubble.
  const {
    intro,
    installFailed,
    installPending,
    onChoice: handleConsentChoice,
    onClose: handleIntroClose,
  } = useIntroTour({ consentRequest, hooksInstalled, hooksStatusSeq, dismissConsentRequest });

  // The Settings surface renders one provider today; its checkbox binds to
  // the Claude row of the per-provider install-state map.
  const claudeHooksInstalled = hooksInstalled['claude'] === true;

  // Mutate folder→Area mappings locally + send to server. Updates OfficeState in
  // the same tick so a follow-up agentCreated picks up the new mapping.
  const handleAreaMappingChange = useCallback(
    (folderName: string, areaLabel: string, action: 'add' | 'remove') => {
      const current = areaMappings[folderName] ?? [];
      let nextLabels: string[];
      if (action === 'add') {
        if (current.includes(areaLabel)) return;
        nextLabels = [...current, areaLabel];
      } else {
        nextLabels = current.filter((l) => l !== areaLabel);
      }
      const next = { ...areaMappings };
      if (nextLabels.length === 0) {
        delete next[folderName];
      } else {
        next[folderName] = nextLabels;
      }
      setAreaMappings(next);
      getOfficeState().setAreaMappings(next);
      transport.send({ type: 'saveAreaMappings', mappings: next });
    },
    [areaMappings, setAreaMappings],
  );

  // Toggle global Show Areas — persisted via setShowAreas message; runs server-
  // side through configPersistence.
  const onToggleShowAreas = useCallback(() => {
    const next = !showAreas;
    setShowAreas(next);
    transport.send({ type: 'setShowAreas', enabled: next });
  }, [showAreas, setShowAreas]);

  // When AREA_PAINT is active in the editor, force the overlay on even if the
  // user has toggled Show Areas off globally — they need to see what they're
  // editing. The selected area's overlay is alpha-bumped via activeAreaLabel.
  const isEditingAreas = editor.isEditMode && editorState.activeTool === EditTool.AREA_PAINT;
  const effectiveShowAreas = isEditingAreas || showAreas;
  const activeAreaLabel = isEditingAreas ? editor.selectedAreaLabel : null;

  // e2e: register the component-scoped editor-action drivers + the effective
  // show-areas gate on the test-hooks namespace (module-load installTestHooks
  // can't reach these React callbacks). Bypasses only canvas pixel→tile
  // geometry — the handlers still own undo/dirty/rebuild. Guarded on isE2E.
  useEffect(() => {
    if (!isE2E || typeof window === 'undefined') return;
    const hooks = (window.__pixelAgentsTestHooks ??= {});
    hooks.editorTileAction = (col, row) => editor.handleEditorTileAction(col, row);
    hooks.editorEraseAction = (col, row) => editor.handleEditorEraseAction(col, row);
    hooks.getShowAreas = () => effectiveShowAreas;
  }, [editor.handleEditorTileAction, editor.handleEditorEraseAction, effectiveShowAreas]);

  const containerRef = useRef<HTMLDivElement>(null);

  // ── Games (Pixel Frag: solo against bots, or a match in the room) ──
  const games = useGames(getOfficeState, multiplayer?.name ?? '');
  const inGame = games.session !== null;

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    // The game takes the keyboard while it is open.
    editor.isEditMode && !inGame,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  // ── Multiplayer room: join screen, desk, keyboard ─────────────
  const joined = multiplayer?.joined === true;
  const [joinDismissed, setJoinDismissed] = useState(false);
  // The join screen greets the person only when the office knows a relay;
  // without one it waits for "Join room" (which asks for the relay too).
  const joinGreetCheckedRef = useRef(false);
  useEffect(() => {
    if (!multiplayer || joinGreetCheckedRef.current) return;
    joinGreetCheckedRef.current = true;
    if (multiplayer.relayUrl === '') setJoinDismissed(true);
  }, [multiplayer]);
  const [isDeskPicking, setIsDeskPicking] = useState(false);
  // After joining, ask for a desk once the character exists (and has none).
  const [deskPromptPending, setDeskPromptPending] = useState(false);
  const [avatarBusyHint, setAvatarBusyHint] = useState(false);
  const [isAvatarEditorOpen, setIsAvatarEditorOpen] = useState(false);
  // ── Meetings (calls inside the room) ──────────────────────────
  const meeting = useMeeting(getOfficeState, multiplayer?.name ?? '');
  const [meetingStageOpen, setMeetingStageOpen] = useState(false);
  const inCall = meeting.current !== null;
  /** Who is in a call or a match, per character: 'self' or the office's peerId. */
  const meetingBadges = useMemo(() => {
    const out: Record<string, string> = {};
    for (const mt of meeting.meetings) {
      for (const p of mt.participants) {
        const extra = `${p.presence.hand ? '✋' : ''}${p.presence.screens.length > 0 ? '🖥' : ''}`;
        out[p.self ? 'self' : p.peerId] = `${extra}📞`;
      }
    }
    for (const match of games.matches) {
      for (const p of match.players) {
        const key = p.self ? 'self' : p.peerId;
        out[key] = `${out[key] ?? ''}🎮`;
      }
    }
    return out;
  }, [meeting.meetings, games.matches]);
  /** People in the room who are not in our call (the Invite list). */
  const currentMeeting = meeting.current;
  const invitable = useMemo(() => {
    const inIt = new Set(currentMeeting?.participants.map((p) => p.peerId) ?? []);
    const byPeer = new Map<string, string>();
    for (const c of remoteCharacters) {
      if (!inIt.has(c.peerId) && !byPeer.has(c.peerId)) byPeer.set(c.peerId, c.peerName);
    }
    return [...byPeer].map(([peerId, name]) => ({ peerId, name }));
  }, [remoteCharacters, currentMeeting]);
  // Back in a room: sit at the desk remembered for it (once per join), when it is still free.
  const deskRestoredRef = useRef(false);
  const rememberedDesk = profile?.desk ?? null;
  useEffect(() => {
    if (!joined) {
      deskRestoredRef.current = false;
      return;
    }
    if (deskRestoredRef.current || !layoutReady || !rememberedDesk) return;
    const os = getOfficeState();
    if (os.avatarId === null) return;
    deskRestoredRef.current = true;
    if (os.getDesk() === null && os.isDeskAvailable(rememberedDesk)) os.setDesk(rememberedDesk);
  }, [joined, layoutReady, rememberedDesk]);
  useEffect(() => {
    if (!deskPromptPending || !joined || !layoutReady) return;
    setDeskPromptPending(false);
    const os = getOfficeState();
    if (os.getDesk() !== null) return;
    if (rememberedDesk && os.isDeskAvailable(rememberedDesk)) os.setDesk(rememberedDesk);
    else setIsDeskPicking(true);
  }, [deskPromptPending, joined, layoutReady, rememberedDesk]);
  useEffect(() => {
    if (deskLostTo) setIsDeskPicking(true);
  }, [deskLostTo]);
  useEffect(() => {
    if (!joined) setIsDeskPicking(false);
  }, [joined]);
  useEffect(() => {
    if (!avatarBusyHint) return;
    const t = setTimeout(() => setAvatarBusyHint(false), 2500);
    return () => clearTimeout(t);
  }, [avatarBusyHint]);
  // The room's layout arrived while editing: its owner is someone else now.
  useEffect(() => {
    if (!layoutEditable && editor.isEditMode) editor.handleToggleEditMode();
  }, [layoutEditable, editor]);
  // The editor edits chairs where the room built them, not where turned desks put them.
  useEffect(() => {
    getOfficeState().setTurnsPaused(editor.isEditMode);
  }, [editor.isEditMode]);
  // VS Code, office open in a browser page: that page is the person's. This
  // panel leaves its call (the call belongs where the camera works) and stops
  // walking the character (its position would contradict the page's).
  const leaveMeeting = meeting.leave;
  useEffect(() => {
    if (officeInBrowser && inCall) leaveMeeting();
  }, [officeInBrowser, inCall, leaveMeeting]);
  // The same for a match in the room: the browser page plays it.
  const leaveGame = games.leave;
  const inRoomMatch = games.playing?.mode === 'room';
  useEffect(() => {
    if (officeInBrowser && inRoomMatch) leaveGame();
  }, [officeInBrowser, inRoomMatch, leaveGame]);
  useAvatarKeyboard(
    getOfficeState,
    joined &&
      !officeInBrowser &&
      !editor.isEditMode &&
      !isDeskPicking &&
      !isAvatarEditorOpen &&
      !inGame &&
      !(inCall && meetingStageOpen),
    useCallback(() => setAvatarBusyHint(true), []),
  );
  // ── Multiplayer room: profile (look, status, decoration) ──────
  const [decorPlacing, setDecorPlacing] = useState<string | null>(null);
  const status: PersonStatus = profile?.status ?? 'available';
  const statusText = profile?.statusText ?? '';
  const decor = useMemo<DeskDecorItem[]>(() => profile?.decor ?? [], [profile]);

  const saveLook = useCallback((look: AvatarLook | null) => {
    getOfficeState().setLocalProfile({ look });
    transport.send({ type: 'updateProfile', look });
    setIsAvatarEditorOpen(false);
  }, []);
  const saveStatus = useCallback((next: PersonStatus, text: string) => {
    getOfficeState().setLocalProfile({ status: next, statusText: text });
    transport.send({ type: 'updateProfile', status: next, statusText: text });
  }, []);
  const saveDecor = useCallback((next: DeskDecorItem[]) => {
    getOfficeState().setLocalDecor(next);
    transport.send({ type: 'updateProfile', decor: next });
  }, []);
  /** Desk style and the items the room's layout put on the desk that were taken off. */
  const saveDressing = useCallback((patch: { deskStyle?: string | null; hidden?: string[] }) => {
    getOfficeState().setLocalDressing(patch);
    transport.send({ type: 'updateProfile', ...patch });
  }, []);
  // What is in hand to move: one of the person's items (put back where it was if
  // the move is abandoned), or an item that came with the desk (then it comes back).
  const movingDecorRef = useRef<
    { kind: 'decor'; item: DeskDecorItem } | { kind: 'layout'; uid: string } | null
  >(null);
  const selectDecor = useCallback(
    (type: string | null) => {
      const moving = movingDecorRef.current;
      movingDecorRef.current = null;
      if (moving?.kind === 'decor') saveDecor([...liveDecor(), moving.item]);
      if (moving?.kind === 'layout') {
        const hidden = getOfficeState().getLocalDressing().hidden;
        saveDressing({ hidden: hidden.filter((u) => u !== moving.uid) });
      }
      // Desk items come turned toward the person's chair.
      setDecorPlacing(type ? getOfficeState().decorVariantForDesk(type) : null);
    },
    [saveDecor, saveDressing],
  );
  const placeDecor = useCallback(
    (item: DeskDecorItem) => {
      if (liveDecor().length >= DECOR_MAX_ITEMS) return;
      const wasMove = movingDecorRef.current !== null;
      movingDecorRef.current = null;
      saveDecor([...liveDecor(), item]);
      // Keep the item in hand for another copy — unless it was a move, or the desk is full.
      if (wasMove || liveDecor().length >= DECOR_MAX_ITEMS) setDecorPlacing(null);
    },
    [saveDecor],
  );
  const pickUpDecor = useCallback(
    (index: number) => {
      const items = liveDecor();
      const item = items[index];
      if (!item) return;
      // In hand the way it is drawn (turned round on a desk turned to face the room).
      const drawnType = getOfficeState().drawnDecorType(item);
      saveDecor(items.filter((_, i) => i !== index));
      movingDecorRef.current = { kind: 'decor', item };
      setDecorPlacing(drawnType);
    },
    [saveDecor],
  );
  /** Take the room's item (its computer) off the desk: it disappears for everyone. */
  const hideLayoutItem = useCallback(
    (uid: string) => {
      const hidden = getOfficeState().getLocalDressing().hidden;
      if (!hidden.includes(uid)) saveDressing({ hidden: [...hidden, uid] });
    },
    [saveDressing],
  );
  /** Take it off and hold it, to put it somewhere else on the desk (as your own). */
  const takeOffLayoutItem = useCallback(
    (uid: string, type: string) => {
      if (liveDecor().length >= DECOR_MAX_ITEMS) {
        hideLayoutItem(uid);
        return;
      }
      hideLayoutItem(uid);
      movingDecorRef.current = { kind: 'layout', uid };
      setDecorPlacing(type);
    },
    [hideLayoutItem],
  );
  const putBackLayoutItem = useCallback(
    (uid: string) => {
      const hidden = getOfficeState().getLocalDressing().hidden;
      saveDressing({ hidden: hidden.filter((u) => u !== uid) });
    },
    [saveDressing],
  );
  const applyDeskPreset = useCallback((preset: DeskPreset) => {
    movingDecorRef.current = null;
    setDecorPlacing(null);
    const result = getOfficeState().applyDeskPreset(preset);
    if (!result) return;
    transport.send({ type: 'updateProfile', ...result });
  }, []);
  const cancelDecorPlacing = useCallback(() => selectDecor(null), [selectDecor]);
  // Closing the panel (or leaving the room) puts the item in hand away.
  useEffect(() => {
    if (sidePanel !== 'decor' || !joined) selectDecor(null);
  }, [sidePanel, joined, selectDecor]);
  // Decorating happens at the desk: look at the floor it is on.
  const { handleViewLevel } = editor;
  useEffect(() => {
    if (sidePanel !== 'decor' || !joined) return;
    const os = getOfficeState();
    const desk = os.getDesk();
    const seat = desk ? os.seats.get(desk) : undefined;
    const level = seat ? os.levelOf({ tileCol: seat.seatCol }) : null;
    if (level && level.id !== os.getViewLevel().id) handleViewLevel(level.id);
  }, [sidePanel, joined, handleViewLevel]);
  const rotateDecor = useCallback(
    () => setDecorPlacing((t) => (t ? (getRotatedType(t, 'cw') ?? t) : t)),
    [],
  );
  /** The look the editor opens with: the saved one, else today's character. */
  const editorLook = (): AvatarLook => {
    if (profile?.look) return profile.look;
    const os = getOfficeState();
    const ch = os.avatarId !== null ? os.characters.get(os.avatarId) : undefined;
    return { ...DEFAULT_LOOK, body: ch?.palette ?? 0 };
  };
  const joinMeeting = useCallback(
    (ev: CalendarEvent) => {
      if (ev.joinUrl) openUrl(ev.joinUrl);
      // In the room, the character heads for the meeting place too.
      if (!joined) return;
      const os = getOfficeState();
      const spot = os.meetingSpot();
      if (spot && os.walkAvatarTo(spot.col, spot.row)) os.cameraFollowId = os.avatarId;
    },
    [joined],
  );

  const handleJoin = useCallback((name: string, room: string, relayUrl?: string) => {
    transport.send({ type: 'joinRoom', name, room, ...(relayUrl ? { relayUrl } : {}) });
    setJoinDismissed(true);
    setDeskPromptPending(true);
  }, []);
  const handlePickDesk = useCallback(
    (seatId: string) => {
      if (getOfficeState().setDesk(seatId)) {
        setIsDeskPicking(false);
        clearDeskLost();
      }
    },
    [clearDeskLost],
  );
  const closeDeskPicker = useCallback(() => {
    setIsDeskPicking(false);
    clearDeskLost();
  }, [clearDeskLost]);

  const handleCloseAgent = useCallback((id: number) => {
    transport.send({ type: 'closeAgent', id });
  }, []);

  const handleClick = useCallback((agentId: number) => {
    // If clicked agent is a sub-agent, focus the parent's terminal instead
    const os = getOfficeState();
    // Another office's agent: its terminal is on someone else's machine.
    if (os.characters.get(agentId)?.isRemote) return;
    const meta = os.subagentMeta.get(agentId);
    const focusId = meta ? meta.parentAgentId : agentId;
    transport.send({ type: 'focusAgent', id: focusId });
  }, []);

  const officeState = getOfficeState();

  // Merged set of folders the Areas dropdown can map: real workspace folders plus
  // every distinct folder an agent has run in this session (deduped by name; name
  // is the areaMappings key / seat-bias identity, path is only the React list key).
  const areaFolders = useMemo(() => {
    const byName = new Map<string, { name: string; path: string }>();
    for (const f of workspaceFolders) byName.set(f.name, f);
    for (const name of agentFolderNames) {
      if (!byName.has(name)) byName.set(name, { name, path: name });
    }
    return [...byName.values()];
  }, [workspaceFolders, agentFolderNames]);

  // Areas authoring is available when the layout already defines areas, or when
  // there is at least one mappable folder. Decouples the Areas UI from VS Code
  // multi-root workspaces (fixes single-root VS Code AND standalone, where
  // workspaceFolders is always empty).
  const areasAvailable = (officeState.getLayout().areas?.length ?? 0) > 0 || areaFolders.length > 0;

  const handleExportLayout = useCallback(() => {
    exportLayoutToFile(getOfficeState().getLayout());
  }, []);

  const handleImportLayout = useCallback(
    (file: File) => {
      // Browser-native import (standalone): read + validate + apply directly,
      // bypassing the layoutLoaded message whose dirty guard would skip it.
      if (
        isEditDirty() &&
        !window.confirm('Replace the current layout? Unsaved edits will be lost.')
      ) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(String(reader.result)) as Record<string, unknown>;
          // Match the VS Code guard, plus the furniture-array check VS Code omits
          // (migrate + rebuild iterate furniture and would throw on a non-array).
          if (
            imported.version !== 1 ||
            !Array.isArray(imported.tiles) ||
            !Array.isArray(imported.furniture)
          ) {
            window.alert('Invalid layout file.');
            return;
          }
          const migrated = migrateLayoutColors(imported as unknown as OfficeLayout);
          getOfficeState().rebuildFromLayout(migrated);
          editor.setLastSavedLayout(migrated);
          // In a room, the import replaces the room's map (for everyone in it).
          if (!roomLayoutSync.localEdit(migrated)) {
            transport.send({
              type: 'saveLayout',
              layout: migrated as unknown as Record<string, unknown>,
            });
          }
          editor.markClean();
        } catch {
          window.alert('Failed to read or parse layout file.');
        }
      };
      reader.readAsText(file);
    },
    [isEditDirty, editor],
  );

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  if (!layoutReady) {
    return <div className="w-full h-full flex items-center justify-center ">Loading...</div>;
  }

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden">
      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
        showAreas={effectiveShowAreas}
        activeAreaLabel={activeAreaLabel}
      />

      {!isDebugMode ? (
        <>
          <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />

          <LevelSwitcher
            officeState={officeState}
            isEditMode={editor.isEditMode}
            onView={editor.handleViewLevel}
            onAdd={editor.handleAddLevel}
            onRemove={editor.handleRemoveLevel}
            onRename={editor.handleRenameLevel}
            onMove={editor.handleMoveLevel}
          />

          {editor.isEditMode &&
            editorState.selectedFurnitureUid &&
            (() => {
              const info = portalInfo(officeState.getLayout(), editorState.selectedFurnitureUid);
              return info ? (
                <PortalPanel
                  info={info}
                  levels={officeState.levels}
                  onSetStairsTarget={editor.handleSetStairsTarget}
                  onSetElevatorStop={editor.handleSetElevatorStop}
                />
              ) : null;
            })()}

          {joined && !editor.isEditMode && <ElevatorPicker officeState={officeState} />}

          {/* Vignette overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'var(--vignette)' }}
          />

          {editor.isEditMode && editor.isDirty && (
            <EditActionBar editor={editor} editorState={editorState} />
          )}

          {showRotateHint && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-11 bg-accent-bright text-white text-sm py-3 px-8 rounded-none border-2 border-accent shadow-pixel pointer-events-none whitespace-nowrap"
              style={{ top: editor.isDirty ? 64 : 8 }}
            >
              Rotate (R)
            </div>
          )}

          {editor.isEditMode &&
            (() => {
              const selUid = editorState.selectedFurnitureUid;
              const selColor = selUid
                ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
                : null;
              return (
                <EditorToolbar
                  activeTool={editorState.activeTool}
                  selectedTileType={editorState.selectedTileType}
                  selectedFurnitureType={editorState.selectedFurnitureType}
                  selectedFurnitureUid={selUid}
                  selectedFurnitureColor={selColor}
                  floorColor={editorState.floorColor}
                  wallColor={editorState.wallColor}
                  selectedWallSet={editorState.selectedWallSet}
                  onToolChange={editor.handleToolChange}
                  onTileTypeChange={editor.handleTileTypeChange}
                  onFloorColorChange={editor.handleFloorColorChange}
                  onWallColorChange={editor.handleWallColorChange}
                  onWallSetChange={editor.handleWallSetChange}
                  onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                  pickedFurnitureColor={editorState.pickedFurnitureColor}
                  onPickedFurnitureColorChange={editor.handlePickedFurnitureColorChange}
                  onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                  loadedAssets={loadedAssets}
                  activePetTypes={officeState.getActivePetTypes()}
                  petCount={getPetCount()}
                  onPetToggle={editor.handlePetToggle}
                  carpetVariant={editor.carpetVariant}
                  carpetColor={editor.carpetColor}
                  carpetAccentColor={editor.carpetAccentColor}
                  onCarpetVariantChange={editor.handleCarpetVariantChange}
                  onCarpetColorChange={editor.handleCarpetColorChange}
                  onCarpetAccentColorChange={editor.handleCarpetAccentColorChange}
                  areas={officeState.getLayout().areas ?? []}
                  selectedAreaLabel={editor.selectedAreaLabel}
                  workspaceFolders={areaFolders}
                  areasAvailable={areasAvailable}
                  areaMappings={areaMappings}
                  onSelectArea={editor.handleSelectArea}
                  onAddArea={editor.handleAddArea}
                  onRemoveArea={editor.handleRemoveArea}
                  onRenameArea={editor.handleRenameArea}
                  onAreaColorChange={editor.handleAreaColorChange}
                  onAreaMappingChange={handleAreaMappingChange}
                />
              );
            })()}

          <ToolOverlay
            officeState={officeState}
            agents={agents}
            agentTools={agentTools}
            subagentTools={subagentTools}
            subagentCharacters={subagentCharacters}
            remoteCharacters={remoteCharacters}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
            onCloseAgent={handleCloseAgent}
            alwaysShowOverlay={alwaysShowOverlay}
          />

          <ChatBubbles
            officeState={officeState}
            bubbles={chatBubbles}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
          />

          <EmoteOverlay
            officeState={officeState}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
          />

          {joined && (
            <NameTags
              officeState={officeState}
              selfName={multiplayer?.name ?? ''}
              badges={meetingBadges}
              containerRef={containerRef}
              zoom={editor.zoom}
              panRef={editor.panRef}
            />
          )}

          {joined && sidePanel === 'decor' && (
            <DecorPlacer
              officeState={officeState}
              type={decorPlacing}
              containerRef={containerRef}
              zoom={editor.zoom}
              panRef={editor.panRef}
              onPlace={placeDecor}
              onPickUp={pickUpDecor}
              onRemove={(i) => saveDecor(liveDecor().filter((_, n) => n !== i))}
              onTakeOff={takeOffLayoutItem}
              onHide={hideLayoutItem}
              onRotate={rotateDecor}
              onCancel={cancelDecorPlacing}
            />
          )}

          {joined && isDeskPicking && (
            <DeskPicker
              officeState={officeState}
              containerRef={containerRef}
              zoom={editor.zoom}
              panRef={editor.panRef}
              notice={deskLostTo ? `${deskLostTo} took your desk.` : null}
              onPick={handlePickDesk}
              onCancel={closeDeskPicker}
            />
          )}
        </>
      ) : (
        <DebugView
          agents={agents}
          selectedAgent={selectedAgent}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          subagentTools={subagentTools}
          officeState={officeState}
          onSelectAgent={handleSelectAgent}
        />
      )}

      {/* Hooks first-run tooltip. Gated on hooksInstalled (the hooksStatus
          message), NOT the hooksEnabled preference: hooksEnabled defaults true
          while first-run consent is still pending, and announcing "Instant
          Detection Active" before anything is installed would be a lie. */}
      {hooksEnabled && claudeHooksInstalled && !hooksInfoShown && !hooksTooltipDismissed && (
        <Tooltip
          title="Instant Detection Active"
          position="top-right"
          onDismiss={() => {
            setHooksTooltipDismissed(true);
            transport.send({ type: 'setHooksInfoShown' });
          }}
        >
          <span className="text-sm text-text leading-none">
            Your agents now respond in real-time.{' '}
            <span
              className="text-accent cursor-pointer underline"
              onClick={() => {
                setIsHooksInfoOpen(true);
                setHooksTooltipDismissed(true);
                transport.send({ type: 'setHooksInfoShown' });
              }}
            >
              View more
            </span>
          </span>
        </Tooltip>
      )}

      {/* Hooks info modal */}
      <Modal
        isOpen={isHooksInfoOpen}
        onClose={() => setIsHooksInfoOpen(false)}
        title="Instant Detection is ON"
        zIndex={52}
      >
        <div className="text-base text-text px-10" style={{ lineHeight: 1.4 }}>
          <p className="mb-8">Your Pixel Agents office now reacts in real-time:</p>
          <ul className="mb-8 pl-18 list-disc m-0">
            <li className="text-sm mb-2">Permission prompts appear instantly</li>
            <li className="text-sm mb-2">Turn completions detected the moment they happen</li>
            <li className="text-sm mb-2">Sound notifications play immediately</li>
          </ul>
          <p className="mb-12 text-text-muted">
            This works through Claude Code Hooks, small event listeners that notify Pixel Agents
            whenever something happens in your Claude sessions.
          </p>
          <div className="text-center">
            <button
              onClick={() => setIsHooksInfoOpen(false)}
              className="py-4 px-20 text-lg bg-accent text-white border-2 border-accent rounded-none cursor-pointer shadow-pixel"
            >
              Got it
            </button>
          </div>
          <p className="mt-8 text-xs text-text-muted text-center">
            To disable, go to Settings {'>'} Instant Detection
          </p>
        </div>
      </Modal>

      <BottomToolbar
        isEditMode={editor.isEditMode}
        onOpenClaude={editor.handleOpenClaude}
        onToggleEditMode={editor.handleToggleEditMode}
        isSettingsOpen={isSettingsOpen}
        onToggleSettings={() => setIsSettingsOpen((v) => !v)}
        workspaceFolders={workspaceFolders}
        chatEnabled={chatEnabled && joined}
        isChatOpen={isChatOpen}
        onToggleChat={() => toggleSidePanel('chat')}
        sidePanel={sidePanel}
        onToggleSidePanel={toggleSidePanel}
        onOpenAvatarEditor={() => setIsAvatarEditorOpen(true)}
        status={status}
        statusText={statusText}
        inMeeting={(calendar?.inMeeting === true && calendar.autoStatus) || inCall}
        onStatusChange={saveStatus}
        musicPlaying={spotify?.nowPlaying?.isPlaying === true}
        gameCount={games.matches.length}
        chatUnread={chatUnread}
        inCall={inCall}
        meetingCount={meeting.meetings.length}
        multiplayer={multiplayer}
        layoutEditable={layoutEditable}
        onOpenJoin={() => setJoinDismissed(false)}
        onLeaveRoom={() => transport.send({ type: 'leaveRoom' })}
        onCopyWebLink={isBrowserRuntime ? undefined : () => transport.send({ type: 'copyWebLink' })}
        onPickDesk={() => setIsDeskPicking((v) => !v)}
        onEmote={(kind) => {
          if (!getOfficeState().playEmote(kind)) setAvatarBusyHint(true);
        }}
      />

      {multiplayer && !joined && !joinDismissed && layoutReady && !intro && (
        <JoinScreen
          status={multiplayer}
          onJoin={handleJoin}
          onSolo={() => setJoinDismissed(true)}
        />
      )}

      {officeInBrowser && (
        <div
          className="absolute top-10 left-1/2 -translate-x-1/2 z-40 pixel-panel py-6 px-12 text-sm text-center"
          style={{ maxWidth: 'calc(100% - 32px)' }}
          data-testid="office-in-browser"
        >
          This office is open in your browser. Your character, walking and meetings are there.
          <br />
          <span className="text-text-muted">Close that tab to use this panel again.</span>
        </div>
      )}

      {avatarBusyHint && (
        <div
          className="absolute bottom-60 left-1/2 -translate-x-1/2 z-30 pixel-panel py-4 px-10 text-sm pointer-events-none"
          data-testid="avatar-busy-hint"
        >
          Claude is working at your desk. You can walk and dance again when it finishes.
        </div>
      )}

      {chatEnabled && joined && isChatOpen && (
        <ChatPanel
          messages={chatMessages}
          onSend={(text) => transport.send({ type: 'sendChat', text })}
          onClose={() => setSidePanel(null)}
        />
      )}

      {joined && sidePanel === 'meet' && (
        <MeetingsPanel
          m={meeting}
          selfName={multiplayer?.name ?? ''}
          onClose={() => setSidePanel(null)}
        />
      )}

      {joined && (
        <MeetingView m={meeting} roomPeople={invitable} onStageChange={setMeetingStageOpen} />
      )}

      {joined && <MeetingInviteToast m={meeting} />}

      {joined && sidePanel === 'people' && (
        <PeoplePanel
          officeState={officeState}
          selfName={multiplayer?.name ?? ''}
          remoteCharacters={remoteCharacters}
          onOpenUrl={openUrl}
          onClose={() => setSidePanel(null)}
        />
      )}

      {joined && sidePanel === 'decor' && (
        <DecorPanel
          decor={decor}
          hasDesk={officeState.getDesk() !== null}
          selected={decorPlacing}
          onSelect={selectDecor}
          onRemove={(i) => saveDecor(liveDecor().filter((_, n) => n !== i))}
          onClear={() => saveDecor([])}
          deskStyle={profile?.deskStyle ?? null}
          onDeskStyle={(deskStyle) => saveDressing({ deskStyle })}
          takenOff={(profile?.hidden ?? []).flatMap((uid) => {
            const type = officeState.layoutItemType(uid);
            return type ? [{ uid, type }] : [];
          })}
          onPutBack={putBackLayoutItem}
          onPreset={applyDeskPreset}
          onPickDesk={() => setIsDeskPicking(true)}
          onClose={() => setSidePanel(null)}
        />
      )}

      {sidePanel === 'games' && (
        <GamesPanel g={games} inRoom={joined} onClose={() => setSidePanel(null)} />
      )}

      {sidePanel === 'calendar' && (
        <CalendarPanel
          calendar={calendar}
          onConfigure={(change) => transport.send({ type: 'configureCalendar', ...change })}
          onJoin={joinMeeting}
          onClose={() => setSidePanel(null)}
        />
      )}

      {sidePanel === 'music' && (
        <MusicPanel
          spotify={spotify}
          shareMusic={joined && profile ? profile.shareMusic : null}
          onCommand={(action, clientId) =>
            transport.send({ type: 'spotifyCommand', action, ...(clientId ? { clientId } : {}) })
          }
          onShareChange={(shareMusic) => transport.send({ type: 'updateProfile', shareMusic })}
          onOpenUrl={openUrl}
          onClose={() => setSidePanel(null)}
        />
      )}

      {calendar && calendar.events.length > 0 && (
        <MeetingToast events={calendar.events} onJoin={joinMeeting} />
      )}

      {isAvatarEditorOpen && (
        <AvatarEditor
          initial={editorLook()}
          hasCustomLook={!!profile?.look}
          onSave={saveLook}
          onReset={() => saveLook(null)}
          onClose={() => setIsAvatarEditorOpen(false)}
        />
      )}

      {games.session && games.playing && (
        <FpsGame
          key={games.playing.matchId ?? 'solo'}
          session={games.session}
          title={games.playing.title}
          solo={games.playing.mode === 'solo'}
          onLeave={games.leave}
        />
      )}

      <VersionIndicator
        currentVersion={extensionVersion}
        lastSeenVersion={lastSeenVersion}
        onDismiss={handleWhatsNewDismiss}
        onOpenChangelog={handleOpenChangelog}
      />

      <ConnectionIndicator />

      <ChangelogModal
        isOpen={isChangelogOpen}
        onClose={() => setIsChangelogOpen(false)}
        currentVersion={extensionVersion}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        isDebugMode={isDebugMode}
        onToggleDebugMode={handleToggleDebugMode}
        alwaysShowOverlay={alwaysShowOverlay}
        onToggleAlwaysShowOverlay={handleToggleAlwaysShowOverlay}
        ghostHeadlessAgents={ghostHeadlessAgents}
        onToggleGhostHeadlessAgents={handleToggleGhostHeadlessAgents}
        externalAssetDirectories={externalAssetDirectories}
        watchAllSessions={watchAllSessions}
        onToggleWatchAllSessions={() => {
          const newVal = !watchAllSessions;
          setWatchAllSessions(newVal);
          transport.send({ type: 'setWatchAllSessions', enabled: newVal });
        }}
        hooksInstalled={claudeHooksInstalled}
        onToggleHooksEnabled={() => {
          // Toggle the DISPLAYED state (actual install), not the preference: when the two disagree — preference on,
          // nothing installed while consent is pending — toggling the preference would turn hooks OFF for a user
          // asking for ON. No optimistic local update either; both backends answer with the truthful hooksStatus this
          // checkbox renders, so it lands correct instead of flickering when an install fails. The providerId is
          // ECHOED from that row (never originated here), so nothing sends until the row has arrived.
          const [rowProviderId] =
            Object.entries(hooksInstalled).find(([id]) => id === 'claude') ?? [];
          if (rowProviderId !== undefined) {
            transport.send({
              type: 'setHooksEnabled',
              providerId: rowProviderId,
              enabled: !claudeHooksInstalled,
            });
          }
        }}
        showAreas={showAreas}
        onToggleShowAreas={onToggleShowAreas}
        showAreasAvailable={areasAvailable}
        onExportLayout={handleExportLayout}
        onImportLayout={handleImportLayout}
      />

      {showMigrationNotice && (
        <MigrationNotice onDismiss={() => setMigrationNoticeDismissed(true)} />
      )}

      {intro && (
        <IntroBubble
          officeState={officeState}
          headline={intro.headline}
          disclosure={intro.disclosure}
          containerRef={containerRef}
          zoom={editor.zoom}
          panRef={editor.panRef}
          installFailed={installFailed}
          installPending={installPending}
          onChoice={handleConsentChoice}
          onClose={handleIntroClose}
          escapeSuppressed={
            isSettingsOpen ||
            isChangelogOpen ||
            isHooksInfoOpen ||
            showMigrationNotice ||
            editor.isEditMode ||
            inGame
          }
        />
      )}
    </div>
  );
}

export default App;
