/**
 * Relay wire protocol for multiplayer offices.
 *
 * A peer is one Pixel Agents surface (a VS Code window or a standalone server).
 * Peers in the same room publish a SUMMARY of their agents to a relay, which
 * forwards it to every other peer in the room. The summary carries only what the
 * office needs to animate a character — never tool arguments, file names,
 * commands, prompts or folder names. Those stay on the machine that produced them.
 *
 * Three deliberate additions to that summary:
 * - chat: text the person typed on purpose, for the room to read;
 * - the person's profile: the look they picked for their character, a status
 *   ("busy", "in a meeting", their own words), the decoration on their desk
 *   and — only while they turned sharing on — the title and artist of the song
 *   they are listening to. Never the calendar event behind "in a meeting";
 * - the shared room: the office that CREATES a room with no map seeds it with
 *   its layout, every office in it renders that one map and anyone in it may
 *   edit it (revisions: an edit made on an older one is refused), so character
 *   positions (`pose`) and the desk each office claimed mean the same thing
 *   everywhere. A layout is tiles, furniture and colors — area labels and pets
 *   stay home.
 *
 * Meetings (video calls inside the room) add three things, none of them media:
 * a `meeting` presence on the state frame (who is in which call, mic/camera
 * flags, shared screens, raised hand, recording), `signal` frames that carry
 * WebRTC offers/answers/candidates to ONE peer, and `meet` frames (chat,
 * reactions, captions, notes) the relay fans out to that meeting's
 * participants only. Audio and video go browser to browser, never here.
 *
 * Games (a match played inside the room, see gameProtocol.ts) work like
 * meetings: a `game` presence on the state frame, and `play` frames the relay
 * sends to the other players of the sender's match only.
 *
 * Every frame is JSON with a `t` discriminator. Both ends sanitize everything
 * they receive: the relay does not trust peers, and peers do not trust the relay.
 * Unknown frames and fields are ignored on both ends, so these additions need no
 * protocol-version bump: an older peer or relay just never sees them.
 */

import { MEETING_REACTIONS } from '../../../core/src/constants.js';
import type {
  AvatarAccessory,
  AvatarLook,
  DeskDecorItem,
  GameFrameBody,
  GamePresence,
  IceServer,
  MeetingEventBody,
  MeetingEventKind,
  MeetingPresence,
  MeetingScreen,
  MeetingSdpType,
  MeetingSignalData,
  PeerProfile,
  PersonStatus,
  RemoteActivity,
  RemoteAgent,
  RemoteEmote,
  RemotePose,
  RemotePoseState,
  SharedTrack,
} from '../../../core/src/messages.js';
import {
  HUE_SHIFT_MAX_DEG,
  MEETING_MAX_CAPTION_LENGTH,
  MEETING_MAX_CHAT_LENGTH,
  MEETING_MAX_ICE_CANDIDATE_LENGTH,
  MEETING_MAX_ICE_SERVERS,
  MEETING_MAX_ID_LENGTH,
  MEETING_MAX_NOTES_LENGTH,
  MEETING_MAX_SCREEN_LABEL_LENGTH,
  MEETING_MAX_SCREENS,
  MEETING_MAX_SDP_LENGTH,
  MEETING_MAX_TITLE_LENGTH,
  MEETING_MAX_TRACK_ID_LENGTH,
  MULTIPLAYER_DECOR_MAX_OFFSET,
  MULTIPLAYER_MAX_AGENTS_PER_PEER,
  MULTIPLAYER_MAX_CHAT_LENGTH,
  MULTIPLAYER_MAX_DECOR_ITEMS,
  MULTIPLAYER_MAX_EDIT_ID_LENGTH,
  MULTIPLAYER_MAX_ID_LENGTH,
  MULTIPLAYER_MAX_LAYOUT_COLS,
  MULTIPLAYER_MAX_LAYOUT_DIM,
  MULTIPLAYER_MAX_LAYOUT_FURNITURE,
  MULTIPLAYER_MAX_LEVEL_NAME_LENGTH,
  MULTIPLAYER_MAX_LEVELS,
  MULTIPLAYER_MAX_NAME_LENGTH,
  MULTIPLAYER_MAX_RELAY_URL_LENGTH,
  MULTIPLAYER_MAX_REMEMBERED_DESKS,
  MULTIPLAYER_MAX_ROOM_LENGTH,
  MULTIPLAYER_MAX_STATUS_LENGTH,
  MULTIPLAYER_MAX_SWATCH_INDEX,
  MULTIPLAYER_MAX_TRACK_TEXT,
} from '../constants.js';
import { sanitizeGameFrame, sanitizeGameId, sanitizeGamePresence } from './gameProtocol.js';

/** One agent as published to the room — the same shape the webview receives in `remotePeers`
 *  (core/asyncapi.yaml `RemoteAgent`), so the relay frames and the UI contract cannot drift. */
export type RemoteAgentState = RemoteAgent;
export type {
  AvatarLook,
  DeskDecorItem,
  GameFrameBody,
  GamePresence,
  IceServer,
  MeetingEventBody,
  MeetingPresence,
  MeetingSignalData,
  PeerProfile,
  PersonStatus,
  RemoteActivity,
  RemotePose,
  SharedTrack,
};

/** A room layout after sanitizing: an OfficeLayout reduced to what renders the map. */
export type SharedLayout = Record<string, unknown>;

export interface PeerSnapshot {
  peerId: string;
  name: string;
  agents: RemoteAgentState[];
  /** Seat uid in the room layout this office claimed as its desk. */
  desk: string | null;
  /** Relay clock at join; the earlier office keeps a contested desk. */
  since: number;
  /** Look, status, desk decoration, shared song. Absent from older offices. */
  profile?: PeerProfile;
  /** The meeting this office's person is in, if any. */
  meeting?: MeetingPresence;
  /** The match (a game inside the room) this office's person plays, if any. */
  game?: GamePresence;
}

// ── Frames ───────────────────────────────────────────────────

export interface HelloFrame {
  t: 'hello';
  v: number;
  room: string;
  name: string;
}
export interface StateFrame {
  t: 'state';
  agents: RemoteAgentState[];
  desk: string | null;
  profile?: PeerProfile;
  meeting?: MeetingPresence;
  game?: GamePresence;
}
export interface ChatSendFrame {
  t: 'chat';
  text: string;
}
/** An edit of the room's map (or the first office seeding it). `base` = the
 *  revision the edit was made on; the relay refuses it once the map moved on.
 *  Without `base` (an older office) only the room's creator is heard, blindly. */
export interface LayoutSendFrame {
  t: 'layout';
  layout: SharedLayout;
  base?: number;
  /** The sender's id for this edit, echoed back so it knows which one landed. */
  id?: string;
}
/** WebRTC signaling (or an invite) for ONE other peer in the room. */
export interface SignalSendFrame {
  t: 'signal';
  to: string;
  data: MeetingSignalData;
}
/** Something said in the sender's current meeting. */
export interface MeetSendFrame {
  t: 'meet';
  ev: MeetingEventBody;
}
/** A frame for the other players of the sender's current match. */
export interface PlaySendFrame {
  t: 'play';
  ev: GameFrameBody;
}
export type ClientFrame =
  | HelloFrame
  | StateFrame
  | ChatSendFrame
  | LayoutSendFrame
  | SignalSendFrame
  | MeetSendFrame
  | PlaySendFrame;

export interface WelcomeFrame {
  t: 'welcome';
  peerId: string;
  since: number;
  peers: PeerSnapshot[];
  /** The room's current layout, when one has been published. */
  layout: SharedLayout | null;
  /** This peer created a room that has no map yet: publish yours, it seeds the room. */
  layoutOwner: boolean;
  /** The map's revision. Present = this relay lets everyone in the room edit
   *  the map (an older relay leaves it out: only the creator may). */
  rev?: number;
  /** STUN/TURN servers the relay's operator configured for meeting media. */
  iceServers?: IceServer[];
}
export interface PeerFrame {
  t: 'peer';
  peer: PeerSnapshot;
}
export interface LeaveFrame {
  t: 'leave';
  peerId: string;
}
export interface ErrorFrame {
  t: 'error';
  reason: string;
}
/** A chat message, fanned out to the WHOLE room — the sender included, so its
 *  own history only ever shows what the relay actually delivered. */
export interface ChatFrame {
  t: 'chat';
  peerId: string;
  name: string;
  text: string;
  /** Relay clock, ms since epoch. */
  ts: number;
}
/** The room layout changed — fanned out to the WHOLE room, the editor included
 *  (its echo, carrying its `id`, is the receipt). `rev` is absent from an older relay. */
export interface LayoutFrame {
  t: 'layout';
  layout: SharedLayout;
  rev?: number;
  id?: string;
}
/** Why the relay did not take an edit: made on an older revision, or too many too fast. */
export type LayoutRejectReason = 'stale' | 'busy';

/** An edit the relay did not take (sent to its editor only). */
export interface LayoutRejectFrame {
  t: 'layoutReject';
  id: string;
  /** The map's revision now. */
  rev: number;
  reason: LayoutRejectReason;
}
/** A signal from another peer, delivered to this peer only. */
export interface SignalFrame {
  t: 'signal';
  from: string;
  data: MeetingSignalData;
}
/** A meeting event, fanned out to the sender's meeting (the sender included). */
export interface MeetFrame {
  t: 'meet';
  from: string;
  name: string;
  meetingId: string;
  ev: MeetingEventBody;
  ts: number;
}
/** A match frame from another player, sent to the sender's match only (never back to it). */
export interface PlayFrame {
  t: 'play';
  from: string;
  gameId: string;
  ev: GameFrameBody;
}
export type RelayFrame =
  | PlayFrame
  | WelcomeFrame
  | PeerFrame
  | LeaveFrame
  | ErrorFrame
  | ChatFrame
  | LayoutFrame
  | LayoutRejectFrame
  | SignalFrame
  | MeetFrame;

// ── Sanitizers ───────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isIntIn = (v: unknown, min: number, max: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Keep printable characters only (no control or bidi-override characters), trim, cap length. */
export function sanitizeText(raw: unknown, maxLength: number): string {
  if (typeof raw !== 'string') return '';

  const cleaned = raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '');
  return Array.from(cleaned.trim()).slice(0, maxLength).join('');
}

export const sanitizeName = (raw: unknown): string =>
  sanitizeText(raw, MULTIPLAYER_MAX_NAME_LENGTH);

export const sanitizeRoom = (raw: unknown): string =>
  sanitizeText(raw, MULTIPLAYER_MAX_ROOM_LENGTH);

export const sanitizeChat = (raw: unknown): string =>
  sanitizeText(raw, MULTIPLAYER_MAX_CHAT_LENGTH);

/** Furniture uid / catalog type / seat uid: short printable string, or null. */
function sanitizeId(raw: unknown): string | null {
  const id = sanitizeText(raw, MULTIPLAYER_MAX_ID_LENGTH);
  return id === '' ? null : id;
}

/** Palette index as sent; the webview clamps it to the palettes it loaded. */
const MAX_PALETTE_INDEX = 255;

/** World-pixel bounds for a pose: the largest grid plus a tile of slack each side
 *  (a building's levels make the grid wide). */
const MAX_POSE_X_PX = (MULTIPLAYER_MAX_LAYOUT_COLS + 1) * 16;
const MAX_POSE_Y_PX = (MULTIPLAYER_MAX_LAYOUT_DIM + 1) * 16;
const POSE_STATES: ReadonlySet<string> = new Set<RemotePoseState>(['idle', 'walk', 'type', 'read']);
const EMOTES: ReadonlySet<string> = new Set<RemoteEmote>([
  'dance',
  'jump',
  'spin',
  'wave',
  'heart',
  'clap',
  'laugh',
  'party',
]);

export function sanitizePose(raw: unknown): RemotePose | undefined {
  if (!isObject(raw)) return undefined;
  const { x, y, dir, state } = raw;
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  if (Math.abs(x) > MAX_POSE_X_PX || Math.abs(y) > MAX_POSE_Y_PX) return undefined;
  const pose: RemotePose = {
    x,
    y,
    dir: isIntIn(dir, 0, 3) ? dir : 0,
    state:
      typeof state === 'string' && POSE_STATES.has(state) ? (state as RemotePoseState) : 'idle',
  };
  if (typeof raw.emote === 'string' && EMOTES.has(raw.emote)) {
    pose.emote = raw.emote as RemoteEmote;
    pose.emoteSeq = Number.isSafeInteger(raw.emoteSeq) ? (raw.emoteSeq as number) : 0;
  }
  return pose;
}

function sanitizeAgent(raw: unknown): RemoteAgentState | null {
  if (!isObject(raw)) return null;
  const { id, palette, hueShift, status, activity } = raw;
  if (!Number.isSafeInteger(id)) return null;
  const agent: RemoteAgentState = {
    id: id as number,
    palette: isIntIn(palette, 0, MAX_PALETTE_INDEX) ? palette : 0,
    hueShift: isIntIn(hueShift, 0, HUE_SHIFT_MAX_DEG) ? hueShift : 0,
    status: status === 'active' ? 'active' : 'waiting',
    activity: activity === 'typing' || activity === 'reading' ? activity : null,
    permission: raw.permission === true,
    awaitingInput: raw.awaitingInput === true,
  };
  if (raw.isAvatar === true) agent.isAvatar = true;
  const pose = sanitizePose(raw.pose);
  if (pose) agent.pose = pose;
  return agent;
}

/** Validate an agent list: drop malformed entries and duplicate ids, cap the count.
 *  At most one entry may be the person's avatar. */
export function sanitizeAgents(raw: unknown): RemoteAgentState[] {
  if (!Array.isArray(raw)) return [];
  const out: RemoteAgentState[] = [];
  const seen = new Set<number>();
  let sawAvatar = false;
  for (const entry of raw) {
    if (out.length >= MULTIPLAYER_MAX_AGENTS_PER_PEER) break;
    const agent = sanitizeAgent(entry);
    if (!agent || seen.has(agent.id)) continue;
    if (agent.isAvatar) {
      if (sawAvatar) delete agent.isAvatar;
      sawAvatar = true;
    }
    seen.add(agent.id);
    out.push(agent);
  }
  return out;
}

function sanitizeColor(raw: unknown): Record<string, unknown> | undefined {
  if (!isObject(raw)) return undefined;
  const num = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(-360, Math.min(360, v)) : 0;
  const color: Record<string, unknown> = {
    h: num(raw.h),
    s: num(raw.s),
    b: num(raw.b),
    c: num(raw.c),
  };
  if (raw.colorize === true) color.colorize = true;
  return color;
}

/**
 * Reduce an OfficeLayout to what renders the shared map, with bounded sizes.
 * Null when it is not a version-1 layout of sane dimensions. Area labels and
 * pets are dropped: areas map THIS machine's folder names, pets are decoration
 * that would need their own sync.
 */
export function sanitizeLayout(raw: unknown): SharedLayout | null {
  if (!isObject(raw) || raw.version !== 1) return null;
  const { cols, rows } = raw;
  if (
    !isIntIn(cols, 1, MULTIPLAYER_MAX_LAYOUT_COLS) ||
    !isIntIn(rows, 1, MULTIPLAYER_MAX_LAYOUT_DIM)
  ) {
    return null;
  }
  const cells = cols * rows;
  if (!Array.isArray(raw.tiles) || raw.tiles.length !== cells) return null;
  if (!raw.tiles.every((t) => isIntIn(t, 0, 255))) return null;
  if (!Array.isArray(raw.furniture)) return null;

  const furniture: Array<Record<string, unknown>> = [];
  for (const item of raw.furniture.slice(0, MULTIPLAYER_MAX_LAYOUT_FURNITURE)) {
    if (!isObject(item)) continue;
    const uid = sanitizeId(item.uid);
    const type = sanitizeId(item.type);
    const colBound = MULTIPLAYER_MAX_LAYOUT_COLS * 2;
    const rowBound = MULTIPLAYER_MAX_LAYOUT_DIM * 2;
    if (
      !uid ||
      !type ||
      !isIntIn(item.col, -colBound, colBound) ||
      !isIntIn(item.row, -rowBound, rowBound)
    ) {
      continue;
    }
    const placed: Record<string, unknown> = { uid, type, col: item.col, row: item.row };
    const color = sanitizeColor(item.color);
    if (color) placed.color = color;
    // Stairs / elevators: which others it connects to.
    const link = sanitizeId(item.link);
    if (link) placed.link = link;
    furniture.push(placed);
  }

  const layout: SharedLayout = {
    version: 1,
    cols,
    rows,
    tiles: [...raw.tiles],
    furniture,
  };
  if (Array.isArray(raw.tileColors)) {
    layout.tileColors = raw.tileColors.slice(0, cells).map((c) => sanitizeColor(c) ?? null);
  }
  const levels = sanitizeLevels(raw.levels, cols, rows);
  if (levels) layout.levels = levels;
  if (Array.isArray(raw.carpetTiles)) {
    layout.carpetTiles = raw.carpetTiles.slice(0, cells).map((c) => {
      if (!isObject(c) || !isIntIn(c.variant, 0, 255)) return null;
      const carpet: Record<string, unknown> = { variant: c.variant };
      const color = sanitizeColor(c.color);
      if (color) carpet.color = color;
      const accent = sanitizeColor(c.accentColor);
      if (accent) carpet.accentColor = accent;
      return carpet;
    });
  }
  return layout;
}

/** A building's levels: rectangles of the grid, each with an id, a name and a height order.
 *  Anything outside the grid, unnamed or duplicated is dropped. */
function sanitizeLevels(
  raw: unknown,
  cols: number,
  rows: number,
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(raw)) return null;
  const out: Array<Record<string, unknown>> = [];
  const ids = new Set<string>();
  for (const l of raw.slice(0, MULTIPLAYER_MAX_LEVELS)) {
    if (!isObject(l)) continue;
    const id = sanitizeId(l.id);
    const name = sanitizeText(l.name, MULTIPLAYER_MAX_LEVEL_NAME_LENGTH);
    if (!id || !name || ids.has(id)) continue;
    if (
      !isIntIn(l.elevation, -MULTIPLAYER_MAX_LEVELS, MULTIPLAYER_MAX_LEVELS) ||
      !isIntIn(l.col, 0, cols - 1) ||
      !isIntIn(l.row, 0, rows - 1) ||
      !isIntIn(l.cols, 1, cols - l.col) ||
      !isIntIn(l.rows, 1, rows - l.row)
    ) {
      continue;
    }
    ids.add(id);
    out.push({
      id,
      name,
      elevation: l.elevation,
      col: l.col,
      row: l.row,
      cols: l.cols,
      rows: l.rows,
    });
  }
  return out.length > 0 ? out : null;
}

const ACCESSORIES: ReadonlySet<string> = new Set<AvatarAccessory>([
  'none',
  'cap',
  'beanie',
  'tophat',
  'crown',
  'partyhat',
  'headphones',
  'glasses',
  'sunglasses',
  'flower',
  'bow',
  'halo',
]);
const STATUSES: ReadonlySet<string> = new Set<PersonStatus>([
  'available',
  'busy',
  'meeting',
  'away',
]);
/** The only link a shared song may carry: a public Spotify track page. */
const TRACK_URL = /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{1,64}$/;

export function sanitizeLook(raw: unknown): AvatarLook | undefined {
  if (!isObject(raw) || !isIntIn(raw.body, 0, MAX_PALETTE_INDEX)) return undefined;
  const swatch = (v: unknown) => (isIntIn(v, -1, MULTIPLAYER_MAX_SWATCH_INDEX) ? v : -1);
  return {
    body: raw.body,
    hair: swatch(raw.hair),
    top: swatch(raw.top),
    bottom: swatch(raw.bottom),
    accessory:
      typeof raw.accessory === 'string' && ACCESSORIES.has(raw.accessory)
        ? (raw.accessory as AvatarAccessory)
        : 'none',
  };
}

export function sanitizeStatus(raw: unknown): PersonStatus {
  return typeof raw === 'string' && STATUSES.has(raw) ? (raw as PersonStatus) : 'available';
}

export const sanitizeStatusText = (raw: unknown): string =>
  sanitizeText(raw, MULTIPLAYER_MAX_STATUS_LENGTH);

/** Desk decoration: known-shaped entries only, near the desk, capped. Items on the
 *  tabletop carry a pixel position (`px,py` within the tile) and may share a tile;
 *  the rest hold one tile each. */
export function sanitizeDecor(raw: unknown): DeskDecorItem[] {
  if (!Array.isArray(raw)) return [];
  const out: DeskDecorItem[] = [];
  const taken = new Set<string>();
  const near = (v: unknown): v is number =>
    isIntIn(v, -MULTIPLAYER_DECOR_MAX_OFFSET, MULTIPLAYER_DECOR_MAX_OFFSET);
  for (const entry of raw) {
    if (out.length >= MULTIPLAYER_MAX_DECOR_ITEMS) break;
    if (!isObject(entry)) continue;
    const type = sanitizeId(entry.type);
    if (!type || !near(entry.dc) || !near(entry.dr)) continue;
    const item: DeskDecorItem = { type, dc: entry.dc, dr: entry.dr };
    if (isIntIn(entry.px, 0, 15) && isIntIn(entry.py, 0, 15)) {
      item.px = entry.px;
      item.py = entry.py;
    }
    const key = `${item.dc},${item.dr},${item.px ?? ''},${item.py ?? ''}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(item);
  }
  return out;
}

/** room → seat uid, both short printable strings. */
export function sanitizeDesks(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [room, desk] of Object.entries(raw as Record<string, unknown>)) {
    const r = sanitizeRoom(room);
    const d = sanitizeText(desk, 128);
    if (r && d) out[r] = d;
    if (Object.keys(out).length >= MULTIPLAYER_MAX_REMEMBERED_DESKS) break;
  }
  return out;
}

/** A desk style id: the webview only draws the ones it knows. */
export function sanitizeDeskStyle(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Z0-9_]{1,40}$/.test(raw) ? raw : null;
}

/** Layout uids taken off a desk: short ids, no duplicates, capped. The webview
 *  honors only the ones standing on that person's own desk. */
export function sanitizeHidden(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (out.length >= MULTIPLAYER_MAX_DECOR_ITEMS) break;
    const id = sanitizeId(entry);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function sanitizeTrack(raw: unknown): SharedTrack | null {
  if (!isObject(raw)) return null;
  const title = sanitizeText(raw.title, MULTIPLAYER_MAX_TRACK_TEXT);
  const artist = sanitizeText(raw.artist, MULTIPLAYER_MAX_TRACK_TEXT);
  if (!title) return null;
  const track: SharedTrack = { title, artist };
  if (typeof raw.trackUrl === 'string' && TRACK_URL.test(raw.trackUrl)) {
    track.trackUrl = raw.trackUrl;
  }
  return track;
}

/** A peer's profile, field by field: anything malformed is dropped, not guessed. */
export function sanitizeProfile(raw: unknown): PeerProfile | undefined {
  if (!isObject(raw)) return undefined;
  const profile: PeerProfile = {};
  const look = sanitizeLook(raw.look);
  if (look) profile.look = look;
  if (raw.status !== undefined) profile.status = sanitizeStatus(raw.status);
  const statusText = sanitizeStatusText(raw.statusText);
  if (statusText) profile.statusText = statusText;
  const music = sanitizeTrack(raw.music);
  if (music) profile.music = music;
  const decor = sanitizeDecor(raw.decor);
  if (decor.length > 0) profile.decor = decor;
  const deskStyle = sanitizeDeskStyle(raw.deskStyle);
  if (deskStyle) profile.deskStyle = deskStyle;
  const hidden = sanitizeHidden(raw.hidden);
  if (hidden.length > 0) profile.hidden = hidden;
  return profile;
}

// ── Meetings ────────────────────────────────────────────────

const MEETING_ID = new RegExp(`^[A-Za-z0-9_-]{1,${MEETING_MAX_ID_LENGTH}}$`);
/** MediaStream ids: Chrome's are alphanumeric, Firefox wraps a UUID in braces. */
const STREAM_ID = /^[A-Za-z0-9{}_-]{1,64}$/;
const TRACK_ID = new RegExp(`^[a-z0-9-]{0,${MEETING_MAX_TRACK_ID_LENGTH}}$`);
const SDP_TYPES: ReadonlySet<string> = new Set<MeetingSdpType>([
  'offer',
  'answer',
  'pranswer',
  'rollback',
]);
const REACTIONS: ReadonlySet<string> = new Set(MEETING_REACTIONS);
const ICE_URL = /^(stun|stuns|turn|turns):[^\s]{1,256}$/i;

const isStamp = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

export function sanitizeMeetingId(raw: unknown): string | null {
  return typeof raw === 'string' && MEETING_ID.test(raw) ? raw : null;
}

export const sanitizeMeetingTitle = (raw: unknown): string =>
  sanitizeText(raw, MEETING_MAX_TITLE_LENGTH);

/** Like sanitizeText, but line breaks survive (meeting notes are markdown). */
export function sanitizeMultiline(raw: unknown, maxLength: number): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(
      /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
      '',
    );
  return Array.from(cleaned.trim()).slice(0, maxLength).join('');
}

/** A person's presence in a meeting, or undefined when it is not one. */
export function sanitizeMeetingPresence(raw: unknown): MeetingPresence | undefined {
  if (!isObject(raw)) return undefined;
  const id = sanitizeMeetingId(raw.id);
  if (!id || !isStamp(raw.since)) return undefined;
  const screens: MeetingScreen[] = [];
  if (Array.isArray(raw.screens)) {
    for (const s of raw.screens) {
      if (screens.length >= MEETING_MAX_SCREENS) break;
      if (!isObject(s) || typeof s.stream !== 'string' || !STREAM_ID.test(s.stream)) continue;
      if (screens.some((x) => x.stream === s.stream)) continue;
      const screen: MeetingScreen = { stream: s.stream };
      const label = sanitizeText(s.label, MEETING_MAX_SCREEN_LABEL_LENGTH);
      if (label) screen.label = label;
      if (s.audio === true) screen.audio = true;
      screens.push(screen);
    }
  }
  const presence: MeetingPresence = {
    id,
    title: sanitizeMeetingTitle(raw.title) || 'Meeting',
    since: raw.since,
    mic: raw.mic === true,
    cam: raw.cam === true,
    screens,
    hand: raw.hand === true,
    rec: raw.rec === true,
    captions: raw.captions === true,
  };
  if (typeof raw.stream === 'string' && STREAM_ID.test(raw.stream)) presence.stream = raw.stream;
  if (presence.hand && isStamp(raw.handAt)) presence.handAt = raw.handAt;
  if (isObject(raw.transcribe) && isStamp(raw.transcribe.at)) {
    presence.transcribe = { on: raw.transcribe.on === true, at: raw.transcribe.at };
  }
  if (
    isObject(raw.music) &&
    isStamp(raw.music.at) &&
    typeof raw.music.track === 'string' &&
    TRACK_ID.test(raw.music.track)
  ) {
    presence.music = { track: raw.music.track, at: raw.music.at };
  }
  return presence;
}

/** WebRTC signaling or an invite. SDP and candidates are opaque to us (the
 *  browser parses them); only their shape and size are checked. */
export function sanitizeSignal(raw: unknown): MeetingSignalData | null {
  if (!isObject(raw) || !isStamp(raw.sid) || !isStamp(raw.tsid)) return null;
  const base = { sid: raw.sid, tsid: raw.tsid };
  switch (raw.kind) {
    case 'sdp': {
      const d = raw.description;
      if (!isObject(d) || typeof d.type !== 'string' || !SDP_TYPES.has(d.type)) return null;
      if (typeof d.sdp !== 'string' || d.sdp.length > MEETING_MAX_SDP_LENGTH) return null;
      return { kind: 'sdp', ...base, description: { type: d.type as MeetingSdpType, sdp: d.sdp } };
    }
    case 'ice': {
      const c = raw.candidate;
      if (!isObject(c) || typeof c.candidate !== 'string') return null;
      if (c.candidate.length > MEETING_MAX_ICE_CANDIDATE_LENGTH) return null;
      const candidate: NonNullable<MeetingSignalData['candidate']> = { candidate: c.candidate };
      if (typeof c.sdpMid === 'string' && c.sdpMid.length <= 64) candidate.sdpMid = c.sdpMid;
      if (isIntIn(c.sdpMLineIndex, 0, 1024)) candidate.sdpMLineIndex = c.sdpMLineIndex;
      if (typeof c.usernameFragment === 'string' && c.usernameFragment.length <= 256) {
        candidate.usernameFragment = c.usernameFragment;
      }
      return { kind: 'ice', ...base, candidate };
    }
    case 'invite': {
      const meetingId = sanitizeMeetingId(raw.meetingId);
      if (!meetingId) return null;
      return {
        kind: 'invite',
        ...base,
        meetingId,
        title: sanitizeMeetingTitle(raw.title) || 'Meeting',
      };
    }
    default:
      return null;
  }
}

const EVENT_LIMITS: Record<MeetingEventKind, number> = {
  chat: MEETING_MAX_CHAT_LENGTH,
  reaction: 8,
  caption: MEETING_MAX_CAPTION_LENGTH,
  notes: MEETING_MAX_NOTES_LENGTH,
};

/** A meeting event: known kind, non-empty text within its cap; reactions from the fixed set. */
export function sanitizeMeetingEvent(raw: unknown): MeetingEventBody | null {
  if (!isObject(raw) || typeof raw.kind !== 'string' || !(raw.kind in EVENT_LIMITS)) return null;
  const kind = raw.kind as MeetingEventKind;
  const text =
    kind === 'notes'
      ? sanitizeMultiline(raw.text, EVENT_LIMITS.notes)
      : sanitizeText(raw.text, EVENT_LIMITS[kind]);
  if (!text) return null;
  if (kind === 'reaction' && !REACTIONS.has(text)) return null;
  return { kind, text };
}

/** STUN/TURN servers: stun:/turn:/turns: URLs, optional username + credential. */
export function sanitizeIceServers(raw: unknown): IceServer[] {
  if (!Array.isArray(raw)) return [];
  const out: IceServer[] = [];
  for (const entry of raw) {
    if (out.length >= MEETING_MAX_ICE_SERVERS) break;
    if (!isObject(entry)) continue;
    const list: unknown[] = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    const urls = list
      .filter((u): u is string => typeof u === 'string' && ICE_URL.test(u))
      .slice(0, 8);
    if (urls.length === 0) continue;
    const server: IceServer = { urls };
    if (typeof entry.username === 'string' && entry.username.length <= 256) {
      server.username = entry.username;
    }
    if (typeof entry.credential === 'string' && entry.credential.length <= 256) {
      server.credential = entry.credential;
    }
    out.push(server);
  }
  return out;
}

/** A relay's address as a person typed it: a ws:// or wss:// URL, or null. */
export function sanitizeRelayUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (url.length > MULTIPLAYER_MAX_RELAY_URL_LENGTH || !/^wss?:\/\/\S+$/i.test(url)) return null;
  try {
    return new URL(url).host ? url : null;
  } catch {
    return null;
  }
}

function sanitizePeer(raw: unknown): PeerSnapshot | null {
  if (!isObject(raw)) return null;
  const peerId = sanitizeText(raw.peerId, MULTIPLAYER_MAX_ROOM_LENGTH);
  if (!peerId) return null;
  const peer: PeerSnapshot = {
    peerId,
    name: sanitizeName(raw.name) || 'Guest',
    agents: sanitizeAgents(raw.agents),
    desk: sanitizeId(raw.desk),
    since: Number.isSafeInteger(raw.since) ? (raw.since as number) : 0,
  };
  const profile = sanitizeProfile(raw.profile);
  if (profile) peer.profile = profile;
  const meeting = sanitizeMeetingPresence(raw.meeting);
  if (meeting) peer.meeting = meeting;
  const game = sanitizeGamePresence(raw.game);
  if (game) peer.game = game;
  return peer;
}

/** Parse a frame a peer sent to the relay. Null = malformed, ignore it. */
export function parseClientFrame(data: string): ClientFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  switch (raw.t) {
    case 'hello':
      if (typeof raw.v !== 'number') return null;
      return { t: 'hello', v: raw.v, room: sanitizeRoom(raw.room), name: sanitizeName(raw.name) };
    case 'state': {
      const frame: StateFrame = {
        t: 'state',
        agents: sanitizeAgents(raw.agents),
        desk: sanitizeId(raw.desk),
      };
      const profile = sanitizeProfile(raw.profile);
      if (profile) frame.profile = profile;
      const meeting = sanitizeMeetingPresence(raw.meeting);
      if (meeting) frame.meeting = meeting;
      const game = sanitizeGamePresence(raw.game);
      if (game) frame.game = game;
      return frame;
    }
    case 'chat': {
      const text = sanitizeChat(raw.text);
      return text ? { t: 'chat', text } : null;
    }
    case 'play': {
      const ev = sanitizeGameFrame(raw.ev);
      return ev ? { t: 'play', ev } : null;
    }
    case 'signal': {
      const to = sanitizeText(raw.to, MULTIPLAYER_MAX_ROOM_LENGTH);
      const data = sanitizeSignal(raw.data);
      return to && data ? { t: 'signal', to, data } : null;
    }
    case 'meet': {
      const ev = sanitizeMeetingEvent(raw.ev);
      return ev ? { t: 'meet', ev } : null;
    }
    case 'layout': {
      const layout = sanitizeLayout(raw.layout);
      if (!layout) return null;
      const frame: LayoutSendFrame = { t: 'layout', layout };
      const base = sanitizeRev(raw.base);
      if (base !== null) frame.base = base;
      const id = sanitizeEditId(raw.id);
      if (id) frame.id = id;
      return frame;
    }
    default:
      return null;
  }
}

/** A room map's revision: a non-negative safe integer, or null. */
function sanitizeRev(raw: unknown): number | null {
  return Number.isSafeInteger(raw) && (raw as number) >= 0 ? (raw as number) : null;
}

const sanitizeEditId = (raw: unknown): string => sanitizeText(raw, MULTIPLAYER_MAX_EDIT_ID_LENGTH);

/** Parse a frame the relay sent to a peer. Null = malformed, ignore it. */
export function parseRelayFrame(data: string): RelayFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  switch (raw.t) {
    case 'welcome': {
      const peerId = sanitizeText(raw.peerId, MULTIPLAYER_MAX_ROOM_LENGTH);
      if (!peerId || !Array.isArray(raw.peers)) return null;
      const peers = raw.peers.map(sanitizePeer).filter((p): p is PeerSnapshot => p !== null);
      const welcome: WelcomeFrame = {
        t: 'welcome',
        peerId,
        since: Number.isSafeInteger(raw.since) ? (raw.since as number) : 0,
        peers,
        layout: raw.layout === null || raw.layout === undefined ? null : sanitizeLayout(raw.layout),
        layoutOwner: raw.layoutOwner === true,
        iceServers: sanitizeIceServers(raw.iceServers),
      };
      const rev = sanitizeRev(raw.rev);
      if (rev !== null) welcome.rev = rev;
      return welcome;
    }
    case 'peer': {
      const peer = sanitizePeer(raw.peer);
      return peer ? { t: 'peer', peer } : null;
    }
    case 'leave': {
      const peerId = sanitizeText(raw.peerId, MULTIPLAYER_MAX_ROOM_LENGTH);
      return peerId ? { t: 'leave', peerId } : null;
    }
    case 'error':
      return { t: 'error', reason: sanitizeText(raw.reason, 200) };
    case 'chat': {
      const peerId = sanitizeText(raw.peerId, MULTIPLAYER_MAX_ROOM_LENGTH);
      const text = sanitizeChat(raw.text);
      if (!peerId || !text) return null;
      return {
        t: 'chat',
        peerId,
        name: sanitizeName(raw.name) || 'Guest',
        text,
        ts: Number.isSafeInteger(raw.ts) ? (raw.ts as number) : Date.now(),
      };
    }
    case 'layout': {
      const layout = sanitizeLayout(raw.layout);
      if (!layout) return null;
      const frame: LayoutFrame = { t: 'layout', layout };
      const rev = sanitizeRev(raw.rev);
      if (rev !== null) frame.rev = rev;
      const id = sanitizeEditId(raw.id);
      if (id) frame.id = id;
      return frame;
    }
    case 'layoutReject': {
      const id = sanitizeEditId(raw.id);
      const rev = sanitizeRev(raw.rev);
      if (!id || rev === null) return null;
      return { t: 'layoutReject', id, rev, reason: raw.reason === 'busy' ? 'busy' : 'stale' };
    }
    case 'signal': {
      const from = sanitizeText(raw.from, MULTIPLAYER_MAX_ROOM_LENGTH);
      const data = sanitizeSignal(raw.data);
      return from && data ? { t: 'signal', from, data } : null;
    }
    case 'play': {
      const from = sanitizeText(raw.from, MULTIPLAYER_MAX_ROOM_LENGTH);
      const gameId = sanitizeGameId(raw.gameId);
      const ev = sanitizeGameFrame(raw.ev);
      return from && gameId && ev ? { t: 'play', from, gameId, ev } : null;
    }
    case 'meet': {
      const from = sanitizeText(raw.from, MULTIPLAYER_MAX_ROOM_LENGTH);
      const meetingId = sanitizeMeetingId(raw.meetingId);
      const ev = sanitizeMeetingEvent(raw.ev);
      if (!from || !meetingId || !ev) return null;
      return {
        t: 'meet',
        from,
        name: sanitizeName(raw.name) || 'Guest',
        meetingId,
        ev,
        ts: Number.isSafeInteger(raw.ts) ? (raw.ts as number) : Date.now(),
      };
    }
    default:
      return null;
  }
}
