// webview-ui/src/meeting/model.ts
//
// Meetings as the room describes them: every office publishes its person's
// MeetingPresence, and a meeting is everyone publishing the same id. Pure
// (no DOM, no WebRTC), so the rules are testable in Node.

import { MEETING_REACTIONS } from '../../../core/src/constants.js';
import type {
  MeetingMusic,
  MeetingPresence,
  MeetingSwitch,
  RemotePeer,
} from '../../../core/src/messages.js';
import type { EmoteKind } from '../office/engine/emotes.js';

export type Reaction = (typeof MEETING_REACTIONS)[number];
export const REACTIONS: readonly Reaction[] = MEETING_REACTIONS;

/** Reactions the person's character acts out in the office too (everyone in the room sees those). */
export const REACTION_EMOTES: Partial<Record<Reaction, EmoteKind>> = {
  '❤️': 'heart',
  '😂': 'laugh',
  '👏': 'clap',
  '🎉': 'party',
  '👋': 'wave',
};

export interface Participant {
  peerId: string;
  name: string;
  self: boolean;
  presence: MeetingPresence;
}

export interface RoomMeeting {
  id: string;
  /** The title as its earliest participant published it. */
  title: string;
  /** Earliest join among those still in it (relay clock). */
  startedAt: number;
  /** Earliest joiner first. */
  participants: Participant[];
}

/** One line of the meeting's chat or transcript, as the panel shows it. */
export interface MeetingLine {
  peerId: string;
  name: string;
  text: string;
  ts: number;
  self: boolean;
}

/** Every meeting going on in the room (ours included), oldest first. */
export function roomMeetings(self: Participant | null, peers: RemotePeer[]): RoomMeeting[] {
  const byId = new Map<string, Participant[]>();
  const add = (p: Participant) => {
    const list = byId.get(p.presence.id);
    if (list) list.push(p);
    else byId.set(p.presence.id, [p]);
  };
  if (self) add(self);
  for (const peer of peers) {
    if (peer.meeting) {
      add({ peerId: peer.peerId, name: peer.name, self: false, presence: peer.meeting });
    }
  }
  const out: RoomMeeting[] = [];
  for (const [id, participants] of byId) {
    participants.sort(
      (a, b) => a.presence.since - b.presence.since || a.peerId.localeCompare(b.peerId),
    );
    out.push({
      id,
      title: participants[0].presence.title,
      startedAt: participants[0].presence.since,
      participants,
    });
  }
  return out.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}

/** The newest of a meeting-wide register every participant replicates; ties
 *  break the same way on every machine. */
export function latest<T extends MeetingSwitch | MeetingMusic>(
  values: ReadonlyArray<T | undefined>,
): T | undefined {
  let best: T | undefined;
  for (const v of values) {
    if (!v) continue;
    if (!best || v.at > best.at || (v.at === best.at && JSON.stringify(v) > JSON.stringify(best))) {
      best = v;
    }
  }
  return best;
}

/** Perfect negotiation needs exactly one polite side per pair. */
export const isPolite = (selfPeerId: string, otherPeerId: string): boolean =>
  selfPeerId > otherPeerId;

/** Raised hands in the order they went up. */
export function handQueue(participants: Participant[]): Participant[] {
  return participants
    .filter((p) => p.presence.hand)
    .sort((a, b) => (a.presence.handAt ?? 0) - (b.presence.handAt ?? 0));
}

/** A fresh meeting id: 12 random base-36 characters (the relay accepts [A-Za-z0-9_-]). */
export function newMeetingId(random: () => number = Math.random): string {
  let id = 'm';
  for (let i = 0; i < 12; i++) id += Math.floor(random() * 36).toString(36);
  return id;
}

export const defaultMeetingTitle = (name: string): string =>
  name ? `${name}'s meeting` : 'Meeting';

export const formatClock = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** mm:ss or h:mm:ss since `since`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** The transcript file the person downloads: notes (if any), transcript, chat. */
export function transcriptMarkdown(
  title: string,
  date: Date,
  transcript: MeetingLine[],
  chat: MeetingLine[],
  notes: string | null,
): string {
  const lines = (list: MeetingLine[]) =>
    list.map((l) => `[${formatClock(l.ts)}] ${l.name}: ${l.text}`).join('\n');
  return [
    `# ${title}`,
    '',
    `_${date.toLocaleString()}_`,
    '',
    ...(notes ? ['## Notes', '', notes, ''] : []),
    '## Transcript',
    '',
    lines(transcript) || '_No transcript._',
    '',
    '## Chat',
    '',
    lines(chat) || '_No chat._',
    '',
  ].join('\n');
}

/** "meeting-<slug>-YYYY-MM-DD-HHmm.<ext>" in local time. */
export function meetingFileName(title: string, date: Date, ext: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const slug =
    title
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'meeting';
  return `meeting-${slug}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.${ext}`;
}

/** What a tile shows. `key` is stable across renders; cameras are `${peerId}:cam`. */
export interface TileInfo {
  key: string;
  peerId: string;
  name: string;
  self: boolean;
  kind: 'camera' | 'screen';
  /** MediaStream id to look up among the peer's streams (null = nothing to show yet). */
  streamId: string | null;
  videoOn: boolean;
  micOn: boolean;
  hand: boolean;
  label: string;
}

/** Every tile of a meeting: all screens first (they matter most), then one camera per person. */
export function meetingTiles(participants: Participant[]): TileInfo[] {
  const screens: TileInfo[] = [];
  const cams: TileInfo[] = [];
  for (const p of participants) {
    const pr = p.presence;
    pr.screens.forEach((s, i) => {
      screens.push({
        key: `${p.peerId}:screen:${s.stream}`,
        peerId: p.peerId,
        name: p.name,
        self: p.self,
        kind: 'screen',
        streamId: s.stream,
        videoOn: true,
        micOn: pr.mic,
        hand: pr.hand,
        label:
          s.label || (pr.screens.length > 1 ? `${p.name} — screen ${i + 1}` : `${p.name} — screen`),
      });
    });
    cams.push({
      key: `${p.peerId}:cam`,
      peerId: p.peerId,
      name: p.name,
      self: p.self,
      kind: 'camera',
      streamId: pr.stream ?? null,
      videoOn: pr.cam,
      micOn: pr.mic,
      hand: pr.hand,
      label: p.self ? `${p.name} (you)` : p.name,
    });
  }
  return [...screens, ...cams];
}

/** Grid columns that make n tiles closest to square. */
export const gridColumns = (n: number): number => Math.max(1, Math.ceil(Math.sqrt(n)));
