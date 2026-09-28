import type { RawData } from 'ws';
import { WebSocket } from 'ws';

import type { PresenceCharacter } from '../../../core/src/messages.js';
import type { AgentStateStore } from '../agentStateStore.js';
import {
  MEETING_PRESENCE_TTL_MS,
  MULTIPLAYER_CHAT_HISTORY_LIMIT,
  MULTIPLAYER_LAYOUT_MIN_INTERVAL_MS,
  MULTIPLAYER_LEGACY_LAYOUT_INTERVAL_MS,
  MULTIPLAYER_MAX_AGENTS_PER_PEER,
  MULTIPLAYER_MAX_EDIT_ID_LENGTH,
  MULTIPLAYER_MAX_LAYOUT_BYTES,
  MULTIPLAYER_MAX_REMEMBERED_DESKS,
  MULTIPLAYER_PROTOCOL_VERSION,
  MULTIPLAYER_PUBLISH_DEBOUNCE_MS,
  MULTIPLAYER_RECONNECT_MAX_MS,
  MULTIPLAYER_RECONNECT_MIN_MS,
} from '../constants.js';
import type {
  AvatarLook,
  DeskDecorItem,
  IceServer,
  LayoutRejectReason,
  MeetingPresence,
  PeerProfile,
  PeerSnapshot,
  PersonStatus,
  RemoteActivity,
  RemoteAgentState,
  RemotePose,
  SharedLayout,
  SharedTrack,
} from './protocol.js';
import {
  parseRelayFrame,
  sanitizeChat,
  sanitizeDecor,
  sanitizeDesks,
  sanitizeDeskStyle,
  sanitizeHidden,
  sanitizeIceServers,
  sanitizeLayout,
  sanitizeLook,
  sanitizeMeetingEvent,
  sanitizeMeetingPresence,
  sanitizeName,
  sanitizePose,
  sanitizeRelayUrl,
  sanitizeRoom,
  sanitizeSignal,
  sanitizeStatus,
  sanitizeStatusText,
  sanitizeText,
  sanitizeTrack,
} from './protocol.js';

export interface MultiplayerSettings {
  /** ws:// or wss:// URL of a `pixel-agents relay`; '' = none known yet (the join screen asks). */
  relayUrl: string;
  /** Peers sharing a room see each other's agents. Treat it like a password.
   *  Absent = the office waits for the join screen instead of joining at start. */
  room?: string;
  /** Shown above this office's characters in everyone else's office. */
  displayName?: string;
  /** STUN/TURN servers for meeting media, after the relay's own (multiplayer.json `iceServers`). */
  iceServers?: IceServer[];
}

/** What the person shows the room about themselves, as this office keeps it. */
export interface LocalProfile {
  /** Null = no look chosen: the office's own character pick stands. */
  look: AvatarLook | null;
  status: PersonStatus;
  statusText: string;
  decor: DeskDecorItem[];
  /** Publish the song playing (title + artist) while one is. */
  shareMusic: boolean;
  /** The desk last claimed in each room (room → seat uid), taken again on return. */
  desks: Record<string, string>;
  /** Style the person's desk and chair are drawn in; null = as the room built them. */
  deskStyle: string | null;
  /** Room-layout items taken off the person's desk. */
  hidden: string[];
}

export interface MultiplayerClientOptions {
  /** This office's own layout, published when it creates (and so owns) a room. */
  getLocalLayout?: () => Record<string, unknown> | null;
  /** Save a change to the join screen's answer or the profile (merged into what is saved). */
  rememberProfile?: (
    patch: Partial<LocalProfile> & { room?: string; displayName?: string; relayUrl?: string },
  ) => void;
  /** The profile saved last time. */
  initialProfile?: Partial<LocalProfile>;
}

/** A song as the music integration reports it. */
export interface PlayingTrack {
  title: string;
  artist: string;
  trackUrl?: string;
  isPlaying?: boolean;
}

interface LocalAgentActivity {
  status: 'active' | 'waiting';
  awaitingInput: boolean;
  permission: boolean;
  /** Foreground tools in flight, in start order: toolId → toolName. */
  tools: Map<string, string>;
}

/** One chat line as the webview receives it (core/asyncapi.yaml `ChatEntry`). */
export interface ChatEntry {
  peerId: string;
  name: string;
  text: string;
  ts: number;
  /** Sent by THIS office — the webview puts the bubble over a local character. */
  self: boolean;
}

interface LocalPresence {
  isAvatar: boolean;
  palette: number;
  hueShift: number;
  pose: RemotePose;
}

/** Id the person's character is published under while no agent drives it. */
const AVATAR_ONLY_ID = 0;

/** Edit id of the map an office publishes into a room that had none. No page waits on it. */
const SEED_EDIT_ID = 'seed';

/** Why an edit of the room's map did not land (core/asyncapi.yaml `RoomLayoutRejected`). */
type RoomEditRejectReason = LayoutRejectReason | 'invalid' | 'offline' | 'replaced';

interface RoomLayoutEdit {
  layout: SharedLayout;
  base: number;
  id: string;
}

type WsSend = (message: Record<string, unknown>) => void;

/**
 * Publishes this office's agents to a multiplayer relay and turns the other
 * peers' agents into a `remotePeers` broadcast for the webview.
 *
 * It reads the same StoreEvents the transports read, so both surfaces get it by
 * constructing one against their store — no change to the runtime. What leaves
 * the machine is `RemoteAgentState`: palette, active/waiting, typing vs reading,
 * permission-pending. Tool arguments, status text and folder names never do.
 *
 * The room is a shared place with one map: the office that creates a room with
 * no map seeds it with its layout, and every office in the room shows that map
 * instead of its own (`roomLayout`, never written to any layout.json). Anyone
 * in the room edits it (`editRoomLayout`, revision-checked by the relay; the
 * page merges a concurrent edit in and retries). An older relay knows no
 * revisions: there the creator keeps its own layout and is the only editor. On
 * the shared map the webview reports where its characters stand
 * (`setPresence`), so positions and the claimed desk travel too. The person's
 * own character is published even with no agent running.
 *
 * It also carries the room's chat: `sendChat` forwards what the person typed,
 * and every message the relay fans out (ours included) lands in an in-memory
 * history that a reloaded webview gets back. Nothing is written to disk.
 */
export class MultiplayerClient {
  private readonly local = new Map<number, LocalAgentActivity>();
  private readonly remote = new Map<string, PeerSnapshot>();
  private readonly chat: ChatEntry[] = [];
  private presence = new Map<number, LocalPresence>();
  private desk: string | null = null;
  private profile: LocalProfile;
  /** The song playing right now (from the music integration), shared only with shareMusic. */
  private nowPlaying: SharedTrack | null = null;
  /** A calendar event is in progress and the calendar may say so. */
  private inMeeting = false;
  /** The person's place in a meeting (a call inside the room), as the webview last reported it. */
  private meeting: MeetingPresence | null = null;
  private meetingExpiry: ReturnType<typeof setTimeout> | null = null;
  /** STUN/TURN servers the relay handed out at welcome. */
  private relayIceServers: IceServer[] = [];
  /** Relay clock minus ours, estimated at welcome (ms). */
  private clockOffset = 0;
  private socket: WebSocket | null = null;
  private selfPeerId: string | null = null;
  private selfSince = 0;
  private joined = false;
  /** This office created a room with no map: its layout seeds it. */
  private layoutOwner = false;
  /** The relay lets everyone in the room edit its map (it sends revisions). */
  private sharedMap = false;
  /** The room's map on screen; null while none arrived (or, on an older relay, while we own it). */
  private roomLayout: SharedLayout | null = null;
  /** Revision of `roomLayout` on a shared-map relay. */
  private roomRev = 0;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private layoutTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingLayout: Record<string, unknown> | null = null;
  /** The page's newest edit of the room's map, held back while the last one is too recent. */
  private pendingEdit: RoomLayoutEdit | null = null;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEditSentAt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = MULTIPLAYER_RECONNECT_MIN_MS;
  private disposed = false;
  private lastPublished = '';
  private readonly unsubscribe: () => void;

  constructor(
    private readonly store: AgentStateStore,
    private readonly settings: MultiplayerSettings,
    private readonly readingTools: ReadonlySet<string>,
    private readonly options: MultiplayerClientOptions = {},
  ) {
    const saved = options.initialProfile ?? {};
    this.profile = {
      look: sanitizeLook(saved.look) ?? null,
      status: sanitizeStatus(saved.status),
      statusText: sanitizeStatusText(saved.statusText),
      decor: sanitizeDecor(saved.decor),
      shareMusic: saved.shareMusic === true,
      desks: sanitizeDesks(saved.desks),
      deskStyle: sanitizeDeskStyle(saved.deskStyle),
      hidden: sanitizeHidden(saved.hidden),
    };
    for (const id of store.keys()) this.trackAgent(id);

    const onAdded = (id: number) => {
      this.trackAgent(id);
      this.schedulePublish();
    };
    const onRemoved = (id: number) => {
      this.local.delete(id);
      this.presence.delete(id);
      this.schedulePublish();
    };
    const onBroadcast = (message: Record<string, unknown>) => {
      if (this.applyLocalBroadcast(message)) this.schedulePublish();
    };
    store.on('agentAdded', onAdded);
    store.on('agentRemoved', onRemoved);
    store.on('broadcast', onBroadcast);
    this.unsubscribe = () => {
      store.off('agentAdded', onAdded);
      store.off('agentRemoved', onRemoved);
      store.off('broadcast', onBroadcast);
    };
  }

  /** Join at start when the room is already known (CLI --room, tests). Otherwise
   *  the office waits for the join screen. */
  start(): void {
    if (this.settings.relayUrl && this.settings.room && sanitizeRoom(this.settings.room)) {
      this.joined = true;
      this.connect();
      this.emitStatus();
    }
  }

  /** The join screen's answer: name, room and — when the person gave one — the
   *  relay. Switching rooms leaves the current one first. */
  join(rawRoom: unknown, rawName: unknown, rawRelayUrl?: unknown): boolean {
    const room = sanitizeRoom(rawRoom);
    const displayName = sanitizeName(rawName);
    const relayUrl =
      rawRelayUrl === undefined || rawRelayUrl === ''
        ? this.settings.relayUrl
        : sanitizeRelayUrl(rawRelayUrl);
    if (!room || !displayName || !relayUrl || this.disposed) return false;
    if (this.joined) this.leave();
    const newRelay = relayUrl !== this.settings.relayUrl;
    this.settings.relayUrl = relayUrl;
    this.settings.room = room;
    this.settings.displayName = displayName;
    this.options.rememberProfile?.(
      rawRelayUrl === undefined ? { room, displayName } : { room, displayName, relayUrl },
    );
    if (newRelay) console.log(`[Pixel Agents] Multiplayer: relay ${relayUrl}`);
    this.joined = true;
    this.reconnectDelay = MULTIPLAYER_RECONNECT_MIN_MS;
    this.connect();
    this.emitStatus();
    // The desk remembered for this room.
    this.store.broadcast(this.profileMessage());
    return true;
  }

  /** Leave the room: back to this office's own layout, nobody else's characters. */
  leave(): void {
    if (!this.joined) return;
    this.joined = false;
    this.clearMeeting();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null; // its close handler must not reconnect
    socket?.close();
    this.resetConnection();
    this.emitStatus();
  }

  /** Whether writing the webview's layout to THIS office's layout.json would
   *  overwrite it with the room's map. */
  showsRoomLayout(): boolean {
    return this.joined && this.roomLayout !== null;
  }

  /** This office's layout was saved. On an older relay the room's creator republishes it. */
  onLocalLayoutSaved(layout: Record<string, unknown>): void {
    if (!this.joined || !this.layoutOwner || this.sharedMap) return;
    this.pendingLayout = layout;
    if (this.layoutTimer) return;
    // The relay drops layouts closer together than its interval: send the newest
    // one once the interval has passed rather than lose the last edit.
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = null;
      const next = this.pendingLayout;
      this.pendingLayout = null;
      if (next) this.sendLayout(next);
    }, MULTIPLAYER_LEGACY_LAYOUT_INTERVAL_MS);
  }

  /**
   * An edit of the room's map made on this office's page: `base` = the
   * revision it was made on, `editId` = the page's id for it. It lands as a
   * `roomLayout` carrying that id (the whole room gets the same revision), or
   * comes back as `roomLayoutRejected` and the page merges and retries.
   */
  editRoomLayout(raw: unknown, rawBase: unknown, rawEditId: unknown): void {
    const id = sanitizeText(rawEditId, MULTIPLAYER_MAX_EDIT_ID_LENGTH);
    if (!id || this.disposed) return;
    const layout = sanitizeLayout(raw);
    if (!layout) return this.rejectEdit(id, 'invalid');
    if (!this.sharedMap || !this.roomLayout) return this.rejectEdit(id, 'offline');
    const base = Number.isSafeInteger(rawBase) ? (rawBase as number) : -1;
    // Only the newest edit matters: one still held back is superseded.
    const superseded = this.pendingEdit;
    if (superseded && superseded.id !== id) this.rejectEdit(superseded.id, 'replaced');
    this.pendingEdit = { layout, base, id };
    this.flushEdit();
  }

  /** Where the webview's characters stand on the shared map, and the claimed desk. */
  setPresence(characters: unknown, desk: unknown): void {
    const next = new Map<number, LocalPresence>();
    if (Array.isArray(characters)) {
      for (const raw of characters.slice(0, MULTIPLAYER_MAX_AGENTS_PER_PEER)) {
        const c = raw as Partial<PresenceCharacter> | null;
        if (!c || !Number.isSafeInteger(c.id)) continue;
        const pose = sanitizePose(c.pose);
        if (!pose) continue;
        next.set(c.id as number, {
          isAvatar: c.isAvatar === true,
          palette: Number.isInteger(c.palette) ? (c.palette as number) : 0,
          hueShift: Number.isInteger(c.hueShift) ? (c.hueShift as number) : 0,
          pose,
        });
      }
    }
    this.presence = next;
    this.desk = typeof desk === 'string' ? sanitizeText(desk, 128) || null : null;
    // Remember the desk for this room, so a reload (or tomorrow) sits down at it again.
    const room = this.settings.room;
    if (this.joined && room && this.desk && this.profile.desks[room] !== this.desk) {
      const desks = { ...this.profile.desks, [room]: this.desk };
      const rooms = Object.keys(desks);
      if (rooms.length > MULTIPLAYER_MAX_REMEMBERED_DESKS) delete desks[rooms[0]];
      this.profile = { ...this.profile, desks };
      this.options.rememberProfile?.({ desks });
    }
    this.schedulePublish();
  }

  /**
   * Change what the person shows the room: any subset of look / status /
   * statusText / decor / shareMusic, each sanitized like the relay would.
   * Saved (so the next start has it), echoed to the webview, published.
   */
  updateProfile(raw: Record<string, unknown>): void {
    const patch: Partial<LocalProfile> = {};
    if ('look' in raw) patch.look = raw.look === null ? null : (sanitizeLook(raw.look) ?? null);
    if ('status' in raw) patch.status = sanitizeStatus(raw.status);
    if ('statusText' in raw) patch.statusText = sanitizeStatusText(raw.statusText);
    if ('decor' in raw) patch.decor = sanitizeDecor(raw.decor);
    if (typeof raw.shareMusic === 'boolean') patch.shareMusic = raw.shareMusic;
    if ('deskStyle' in raw) patch.deskStyle = sanitizeDeskStyle(raw.deskStyle);
    if ('hidden' in raw) patch.hidden = sanitizeHidden(raw.hidden);
    if (Object.keys(patch).length === 0 || this.disposed) return;
    this.profile = { ...this.profile, ...patch };
    this.options.rememberProfile?.(patch);
    this.store.broadcast(this.profileMessage());
    this.schedulePublish();
  }

  /** The song playing now, or null (paused, stopped, not connected). Only
   *  published while the person shares music. */
  setMusic(track: PlayingTrack | null): void {
    const next = track && track.isPlaying !== false ? sanitizeTrack(track) : null;
    if (JSON.stringify(next) === JSON.stringify(this.nowPlaying)) return;
    this.nowPlaying = next;
    if (this.profile.shareMusic) this.schedulePublish();
  }

  /** A calendar event started or ended (only called while the calendar may set the status). */
  setInMeeting(inMeeting: boolean): void {
    if (inMeeting === this.inMeeting) return;
    this.inMeeting = inMeeting;
    this.schedulePublish();
  }

  /**
   * Join, update or leave (null) a meeting. The webview re-sends it every few
   * seconds while in a call; a presence nobody refreshes expires, so a closed
   * tab does not leave a ghost in everyone's call.
   */
  setMeeting(raw: unknown): void {
    if (this.disposed) return;
    const next = raw === null ? null : (sanitizeMeetingPresence(raw) ?? null);
    if (this.meetingExpiry) clearTimeout(this.meetingExpiry);
    this.meetingExpiry = null;
    if (next) {
      this.meetingExpiry = setTimeout(() => {
        this.meetingExpiry = null;
        console.log('[Pixel Agents] Multiplayer: meeting presence expired (page closed?)');
        this.meeting = null;
        this.schedulePublish();
      }, MEETING_PRESENCE_TTL_MS);
    }
    if (JSON.stringify(next) === JSON.stringify(this.meeting)) return;
    this.meeting = next;
    this.schedulePublish();
  }

  /** The meeting this office is in, as published. Exposed for tests. */
  currentMeeting(): MeetingPresence | null {
    return this.meeting;
  }

  /** WebRTC signaling (or an invite) for one peer in the room. False when it could not be sent. */
  sendMeetingSignal(rawTo: unknown, rawData: unknown): boolean {
    const to = sanitizeText(rawTo, 64);
    const data = sanitizeSignal(rawData);
    const socket = this.socket;
    if (!to || !data || !socket || socket.readyState !== WebSocket.OPEN || !this.selfPeerId) {
      return false;
    }
    // The receiver must already know we are in the call when our offer lands,
    // so a presence change still waiting in the debounce goes out first.
    this.flushPublish();
    socket.send(JSON.stringify({ t: 'signal', to, data }));
    return true;
  }

  /** Chat, a reaction, a caption or notes for the current meeting. False when it could not be sent. */
  sendMeetingEvent(raw: unknown): boolean {
    const ev = sanitizeMeetingEvent(raw);
    const socket = this.socket;
    if (!ev || !this.meeting || !socket || socket.readyState !== WebSocket.OPEN) return false;
    if (!this.selfPeerId) return false;
    this.flushPublish(); // the relay routes by the meeting in our last state frame
    socket.send(JSON.stringify({ t: 'meet', ev }));
    return true;
  }

  /** The profile as the room sees it. Exposed for tests. */
  publishedProfile(): PeerProfile {
    const p = this.profile;
    const out: PeerProfile = {
      // A calendar event in progress, or a call in the room, reads as "in a meeting"
      // unless the person said something stronger.
      status: (this.inMeeting || this.meeting) && p.status === 'available' ? 'meeting' : p.status,
    };
    if (p.look) out.look = p.look;
    if (p.statusText) out.statusText = p.statusText;
    if (p.shareMusic && this.nowPlaying) out.music = this.nowPlaying;
    if (p.decor.length > 0) out.decor = p.decor;
    if (p.deskStyle) out.deskStyle = p.deskStyle;
    if (p.hidden.length > 0) out.hidden = p.hidden;
    return out;
  }

  /** Everything a webview that just (re)connected needs. */
  resend(send: WsSend): void {
    send(this.statusMessage());
    send(this.profileMessage());
    send(this.roomLayoutMessage());
    send(this.remotePeersMessage());
    send({ type: 'chatHistory', messages: [...this.chat] });
  }

  /**
   * Send a chat message to the room. Returns false when it could not be sent
   * (empty after sanitizing, or no live relay connection). A sent message shows
   * up in the history only when the relay echoes it back.
   */
  sendChat(raw: unknown): boolean {
    const text = sanitizeChat(raw);
    const socket = this.socket;
    if (!text || !socket || socket.readyState !== WebSocket.OPEN || !this.selfPeerId) return false;
    socket.send(JSON.stringify({ t: 'chat', text }));
    return true;
  }

  /** Snapshot of what this peer publishes. Exposed for tests. */
  localSnapshot(): RemoteAgentState[] {
    // Positions only mean something on a map everyone shares.
    const shared = this.layoutOwner || this.roomLayout !== null;
    const out: RemoteAgentState[] = [];
    // The person's chosen look is their character's sprite — sent as its palette
    // too, so an office too old to read the profile still draws the right body.
    const look = this.profile.look;
    for (const [id, a] of this.local) {
      const agent = this.store.get(id);
      if (!agent) continue;
      const lastTool = [...a.tools.values()].pop();
      const activity: RemoteActivity | null =
        lastTool === undefined ? null : this.readingTools.has(lastTool) ? 'reading' : 'typing';
      const avatarLook = this.presence.get(id)?.isAvatar ? look : null;
      const entry: RemoteAgentState = {
        id,
        palette: avatarLook ? avatarLook.body : (agent.palette ?? 0),
        hueShift: avatarLook ? 0 : (agent.hueShift ?? 0),
        status: a.status,
        activity: a.status === 'active' ? activity : null,
        permission: a.permission,
        awaitingInput: a.status === 'waiting' && a.awaitingInput,
      };
      const p = this.presence.get(id);
      if (p?.isAvatar) entry.isAvatar = true;
      if (p && shared) entry.pose = p.pose;
      out.push(entry);
    }
    // The person's character with no agent driving it yet.
    const avatar = this.presence.get(AVATAR_ONLY_ID);
    if (avatar?.isAvatar && !this.local.has(AVATAR_ONLY_ID)) {
      const entry: RemoteAgentState = {
        id: AVATAR_ONLY_ID,
        palette: look ? look.body : avatar.palette,
        hueShift: look ? 0 : avatar.hueShift,
        status: 'waiting',
        activity: null,
        permission: false,
        awaitingInput: false,
        isAvatar: true,
      };
      if (shared) entry.pose = avatar.pose;
      out.push(entry);
    }
    return out.sort((x, y) => x.id - y.id);
  }

  dispose(): void {
    this.disposed = true;
    this.joined = false;
    this.unsubscribe();
    this.clearMeeting();
    if (this.publishTimer) clearTimeout(this.publishTimer);
    if (this.layoutTimer) clearTimeout(this.layoutTimer);
    if (this.editTimer) clearTimeout(this.editTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.resetConnection();
  }

  // ── Local side ──────────────────────────────────────────────

  private trackAgent(id: number): void {
    if (this.local.has(id)) return;
    // Seed from what the store already knows, so an agent restored or adopted
    // before this client existed doesn't read as idle until its next event.
    const agent = this.store.get(id);
    const tools = new Map<string, string>();
    for (const [toolId, toolName] of agent?.activeToolNames ?? []) {
      if (!agent?.backgroundAgentToolIds.has(toolId)) tools.set(toolId, toolName);
    }
    this.local.set(id, {
      status: agent && !agent.isWaiting && tools.size > 0 ? 'active' : 'waiting',
      awaitingInput: false,
      permission: agent?.permissionSent === true,
      tools,
    });
  }

  /** Fold one outgoing broadcast into the local summary. True if it changed anything we publish. */
  private applyLocalBroadcast(msg: Record<string, unknown>): boolean {
    const a = typeof msg.id === 'number' ? this.local.get(msg.id) : undefined;
    if (!a) return false;
    switch (msg.type) {
      case 'agentStatus':
        a.status = msg.status === 'active' ? 'active' : 'waiting';
        a.awaitingInput = msg.awaitingInput === true;
        if (a.status === 'active') a.permission = false;
        return true;
      case 'agentToolStart': {
        // Background spawns outlive the turn and don't describe what the agent
        // itself is doing right now.
        if (msg.runInBackground === true || typeof msg.toolId !== 'string') return false;
        a.tools.delete(msg.toolId);
        a.tools.set(msg.toolId, typeof msg.toolName === 'string' ? msg.toolName : '');
        a.status = 'active';
        if (msg.permissionActive === true) a.permission = true;
        return true;
      }
      case 'agentToolDone':
        return typeof msg.toolId === 'string' && a.tools.delete(msg.toolId);
      case 'agentToolsClear':
        a.tools.clear();
        a.permission = false;
        return true;
      case 'agentToolPermission':
        a.permission = true;
        return true;
      case 'agentToolPermissionClear':
        a.permission = false;
        return true;
      default:
        return false;
    }
  }

  private schedulePublish(): void {
    if (this.publishTimer || this.disposed) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.publish();
    }, MULTIPLAYER_PUBLISH_DEBOUNCE_MS);
  }

  /** Publish now what a pending debounce would have published a moment later. */
  private flushPublish(): void {
    if (!this.publishTimer) return;
    clearTimeout(this.publishTimer);
    this.publishTimer = null;
    this.publish();
  }

  private clearMeeting(): void {
    if (this.meetingExpiry) clearTimeout(this.meetingExpiry);
    this.meetingExpiry = null;
    this.meeting = null;
  }

  private publish(force = false): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.selfPeerId) return;
    const frame = JSON.stringify({
      t: 'state',
      agents: this.localSnapshot(),
      desk: this.desk,
      profile: this.publishedProfile(),
      ...(this.meeting ? { meeting: this.meeting } : {}),
    });
    if (!force && frame === this.lastPublished) return;
    this.lastPublished = frame;
    socket.send(frame);
  }

  /** Publish a layout blindly: an older relay, which knows no revisions. */
  private sendLayout(raw: Record<string, unknown> | null): void {
    const socket = this.socket;
    const layout = sanitizeLayout(raw);
    if (!layout || !socket || socket.readyState !== WebSocket.OPEN || !this.selfPeerId) return;
    socket.send(JSON.stringify({ t: 'layout', layout }));
  }

  /** Send the page's newest edit once the last one is far enough behind. */
  private flushEdit(): void {
    const edit = this.pendingEdit;
    if (!edit || this.editTimer) return;
    const wait = this.lastEditSentAt + MULTIPLAYER_LAYOUT_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) {
      this.editTimer = setTimeout(() => {
        this.editTimer = null;
        this.flushEdit();
      }, wait);
      return;
    }
    this.pendingEdit = null;
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.selfPeerId || !this.sharedMap) {
      return this.rejectEdit(edit.id, 'offline');
    }
    this.lastEditSentAt = Date.now();
    socket.send(JSON.stringify({ t: 'layout', layout: edit.layout, base: edit.base, id: edit.id }));
  }

  private rejectEdit(editId: string, reason: RoomEditRejectReason): void {
    if (editId === SEED_EDIT_ID) return; // no page waits on the seed
    this.store.broadcast({ type: 'roomLayoutRejected', editId, rev: this.roomRev, reason });
  }

  // ── Relay connection ────────────────────────────────────────

  private connect(): void {
    if (this.disposed || !this.joined || !this.settings.relayUrl) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.settings.relayUrl, {
        maxPayload: MULTIPLAYER_MAX_LAYOUT_BYTES * 2,
      });
    } catch (err) {
      console.error(`[Pixel Agents] Multiplayer: invalid relay URL: ${err}`);
      return; // a malformed URL will not get better by retrying
    }
    this.socket = socket;

    socket.on('open', () => {
      this.reconnectDelay = MULTIPLAYER_RECONNECT_MIN_MS;
      socket.send(
        JSON.stringify({
          t: 'hello',
          v: MULTIPLAYER_PROTOCOL_VERSION,
          room: sanitizeRoom(this.settings.room),
          name: sanitizeName(this.settings.displayName),
        }),
      );
    });

    socket.on('message', (data: RawData) => {
      if (this.socket !== socket) return;
      const frame = parseRelayFrame(data.toString());
      if (!frame) return;
      switch (frame.t) {
        case 'welcome':
          this.selfPeerId = frame.peerId;
          this.selfSince = frame.since;
          // Good to a round trip; meeting timestamps only need to agree to a fraction of a second.
          this.clockOffset = frame.since > 0 ? frame.since - Date.now() : 0;
          this.relayIceServers = frame.iceServers ?? [];
          this.layoutOwner = frame.layoutOwner;
          this.sharedMap = frame.rev !== undefined;
          this.roomRev = frame.rev ?? 0;
          // An older relay: the creator keeps showing its own layout.
          this.roomLayout = frame.layoutOwner && !this.sharedMap ? null : frame.layout;
          this.remote.clear();
          for (const peer of frame.peers) this.remote.set(peer.peerId, peer);
          console.log(
            `[Pixel Agents] Multiplayer: joined room with ${frame.peers.length} other peer(s)${frame.layoutOwner ? ' (a new room: it starts with your layout)' : ''}`,
          );
          if (frame.layoutOwner && this.sharedMap) {
            // Seed the room with our layout; its echo puts the room's map on screen.
            const seed = sanitizeLayout(this.options.getLocalLayout?.() ?? null);
            if (seed) {
              this.pendingEdit = { layout: seed, base: this.roomRev, id: SEED_EDIT_ID };
              this.flushEdit();
            }
          } else if (frame.layoutOwner) {
            this.sendLayout(this.options.getLocalLayout?.() ?? null);
          }
          this.emitStatus();
          this.emitRoomLayout();
          this.emitRemote();
          this.publish(true);
          break;
        case 'peer':
          if (frame.peer.peerId === this.selfPeerId) break;
          this.remote.set(frame.peer.peerId, frame.peer);
          this.emitRemote();
          break;
        case 'leave':
          if (this.remote.delete(frame.peerId)) this.emitRemote();
          break;
        case 'layout': {
          if (!this.sharedMap || frame.rev === undefined) {
            // An older relay: the creator's publishes, shown to everyone else.
            if (this.layoutOwner) break;
            this.roomLayout = frame.layout;
            this.emitRoomLayout();
            this.publish(true); // poses mean something now
            break;
          }
          const hadMap = this.roomLayout !== null;
          this.roomLayout = frame.layout;
          this.roomRev = frame.rev;
          this.store.broadcast(this.roomLayoutMessage(frame.id));
          if (!hadMap) this.publish(true);
          break;
        }
        case 'layoutReject':
          this.rejectEdit(frame.id, frame.reason);
          break;
        case 'error':
          console.warn(`[Pixel Agents] Multiplayer: relay refused: ${frame.reason}`);
          break;
        case 'chat': {
          const entry: ChatEntry = {
            peerId: frame.peerId,
            name: frame.name,
            text: frame.text,
            ts: frame.ts,
            self: frame.peerId === this.selfPeerId,
          };
          this.chat.push(entry);
          if (this.chat.length > MULTIPLAYER_CHAT_HISTORY_LIMIT) this.chat.shift();
          this.store.broadcast({ type: 'chatMessage', message: entry });
          break;
        }
        case 'signal':
          // Only the page in the call acts on it; the others ignore it.
          if (this.meeting || frame.data.kind === 'invite') {
            this.store.broadcast({ type: 'meetingSignal', from: frame.from, data: frame.data });
          }
          break;
        case 'meet':
          if (frame.meetingId !== this.meeting?.id) break; // a call we already left
          this.store.broadcast({
            type: 'meetingEvent',
            from: frame.from,
            name: frame.name,
            meetingId: frame.meetingId,
            ts: frame.ts,
            self: frame.from === this.selfPeerId,
            event: frame.ev,
          });
          break;
      }
    });

    socket.on('error', (err) => {
      console.warn(`[Pixel Agents] Multiplayer: relay connection error: ${err.message}`);
    });

    socket.on('close', () => {
      if (this.socket !== socket) return; // left the room, or replaced by a newer socket
      this.socket = null;
      this.resetConnection();
      this.emitStatus();
      this.scheduleReconnect();
    });
  }

  /** Forget everything that belonged to the relay connection. */
  private resetConnection(): void {
    this.selfPeerId = null;
    this.lastPublished = '';
    const hadRoomLayout = this.roomLayout !== null || this.layoutOwner;
    this.layoutOwner = false;
    this.sharedMap = false;
    this.roomLayout = null;
    this.roomRev = 0;
    if (this.editTimer) clearTimeout(this.editTimer);
    this.editTimer = null;
    const held = this.pendingEdit;
    this.pendingEdit = null;
    if (held) this.rejectEdit(held.id, 'offline');
    // Remote characters would otherwise freeze mid-animation while we're cut off.
    if (this.remote.size > 0) {
      this.remote.clear();
      this.emitRemote();
    }
    if (hadRoomLayout) this.emitRoomLayout();
  }

  private scheduleReconnect(): void {
    if (this.disposed || !this.joined || this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MULTIPLAYER_RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ── Webview side ────────────────────────────────────────────

  private statusMessage(): Record<string, unknown> {
    return {
      type: 'multiplayerStatus',
      available: true,
      joined: this.joined,
      connected: this.selfPeerId !== null,
      room: this.settings.room ?? '',
      name: this.settings.displayName ?? '',
      relayUrl: this.settings.relayUrl,
      layoutOwner: this.layoutOwner,
      since: this.selfSince,
      peerId: this.selfPeerId ?? '',
      clockOffset: this.clockOffset,
      iceServers: [...this.relayIceServers, ...sanitizeIceServers(this.settings.iceServers)],
    };
  }

  private profileMessage(): Record<string, unknown> {
    const { desks, ...profile } = this.profile;
    const room = this.settings.room;
    return { type: 'profileLoaded', ...profile, desk: (room && desks[room]) || null };
  }

  /** `editId` = the edit that made this revision, when it just landed. */
  private roomLayoutMessage(editId?: string): Record<string, unknown> {
    const shown = this.showsRoomLayout();
    return {
      type: 'roomLayout',
      layout: shown ? this.roomLayout : null,
      // On an older relay only the room's creator edits, and it shows its own layout.
      editable: this.sharedMap || !shown,
      ...(shown && this.sharedMap ? { rev: this.roomRev } : {}),
      ...(editId && editId !== SEED_EDIT_ID ? { editId } : {}),
    };
  }

  private remotePeersMessage(): Record<string, unknown> {
    return {
      type: 'remotePeers',
      peers: [...this.remote.values()].map((p) => ({
        peerId: p.peerId,
        name: p.name,
        agents: p.agents,
        desk: p.desk,
        since: p.since,
        ...(p.profile ? { profile: p.profile } : {}),
        ...(p.meeting ? { meeting: p.meeting } : {}),
      })),
    };
  }

  private emitStatus(): void {
    if (!this.disposed) this.store.broadcast(this.statusMessage());
  }

  private emitRoomLayout(): void {
    this.store.broadcast(this.roomLayoutMessage());
  }

  private emitRemote(): void {
    this.store.broadcast(this.remotePeersMessage());
  }
}
