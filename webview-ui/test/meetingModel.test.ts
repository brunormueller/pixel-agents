import { describe, expect, it } from 'vitest';

import type { MeetingPresence, RemotePeer } from '../../core/src/messages.js';
import {
  gridColumns,
  handQueue,
  isPolite,
  latest,
  meetingFileName,
  meetingTiles,
  newMeetingId,
  REACTION_EMOTES,
  REACTIONS,
  roomMeetings,
  transcriptMarkdown,
} from '../src/meeting/model.js';

const presence = (
  id: string,
  since: number,
  extra: Partial<MeetingPresence> = {},
): MeetingPresence => ({
  id,
  title: `title-${id}`,
  since,
  mic: true,
  cam: false,
  screens: [],
  hand: false,
  rec: false,
  captions: false,
  ...extra,
});

const peer = (peerId: string, meeting?: MeetingPresence): RemotePeer => ({
  peerId,
  name: peerId.toUpperCase(),
  agents: [],
  ...(meeting ? { meeting } : {}),
});

describe('roomMeetings', () => {
  it('groups everyone publishing the same id, earliest joiner first, titled by them', () => {
    const self = {
      peerId: 'me',
      name: 'Me',
      self: true,
      presence: presence('a', 30, { title: 'late title' }),
    };
    const meetings = roomMeetings(self, [
      peer('p1', presence('a', 10, { title: 'Standup' })),
      peer('p2', presence('b', 5)),
      peer('p3'),
    ]);
    expect(meetings.map((m) => m.id)).toEqual(['b', 'a']);
    const a = meetings[1];
    expect(a.title).toBe('Standup');
    expect(a.startedAt).toBe(10);
    expect(a.participants.map((p) => p.peerId)).toEqual(['p1', 'me']);
  });

  it('is empty when nobody is in a call', () => {
    expect(roomMeetings(null, [peer('p1'), peer('p2')])).toEqual([]);
  });
});

describe('meeting-wide switches', () => {
  it('the newest wins, and ties break the same way everywhere', () => {
    expect(latest([{ on: true, at: 5 }, undefined, { on: false, at: 9 }])).toEqual({
      on: false,
      at: 9,
    });
    const tieA = latest([
      { track: 'lofi', at: 7 },
      { track: 'bossa', at: 7 },
    ]);
    const tieB = latest([
      { track: 'bossa', at: 7 },
      { track: 'lofi', at: 7 },
    ]);
    expect(tieA).toEqual(tieB);
    expect(latest([undefined])).toBeUndefined();
  });

  it('exactly one side of a pair is polite', () => {
    expect(isPolite('a', 'b')).not.toBe(isPolite('b', 'a'));
  });
});

describe('tiles and hands', () => {
  it('lists every shared screen before the cameras, one camera per person', () => {
    const tiles = meetingTiles([
      {
        peerId: 'p1',
        name: 'Ana',
        self: false,
        presence: presence('m', 1, {
          cam: true,
          stream: 'c1',
          screens: [{ stream: 's1' }, { stream: 's2' }],
        }),
      },
      {
        peerId: 'me',
        name: 'Bia',
        self: true,
        presence: presence('m', 2, { stream: 'c2', screens: [{ stream: 's3' }] }),
      },
    ]);
    expect(tiles.map((t) => t.key)).toEqual([
      'p1:screen:s1',
      'p1:screen:s2',
      'me:screen:s3',
      'p1:cam',
      'me:cam',
    ]);
    expect(tiles[0].label).toBe('Ana — screen 1');
    expect(tiles[2].label).toBe('Bia — screen');
    expect(tiles[3]).toMatchObject({ streamId: 'c1', videoOn: true });
    expect(tiles[4]).toMatchObject({ label: 'Bia (you)', videoOn: false });
  });

  it('orders raised hands by when they went up', () => {
    const q = handQueue([
      {
        peerId: 'a',
        name: 'A',
        self: false,
        presence: presence('m', 1, { hand: true, handAt: 50 }),
      },
      { peerId: 'b', name: 'B', self: false, presence: presence('m', 1) },
      {
        peerId: 'c',
        name: 'C',
        self: false,
        presence: presence('m', 1, { hand: true, handAt: 20 }),
      },
    ]);
    expect(q.map((p) => p.peerId)).toEqual(['c', 'a']);
  });

  it('grids stay near square', () => {
    expect([1, 2, 4, 5, 9, 10].map(gridColumns)).toEqual([1, 2, 2, 3, 3, 4]);
  });
});

describe('ids, reactions and files', () => {
  it('meeting ids fit what the relay accepts', () => {
    for (let i = 0; i < 50; i++) expect(newMeetingId()).toMatch(/^[A-Za-z0-9_-]{2,64}$/);
  });

  it('every emote-mapped reaction is a real reaction', () => {
    for (const emoji of Object.keys(REACTION_EMOTES)) {
      expect(REACTIONS as readonly string[]).toContain(emoji);
    }
  });

  it('names downloads by title and time, and writes the transcript file', () => {
    expect(meetingFileName('Reunião: Q3!', new Date(2026, 0, 2, 3, 4), 'webm')).toBe(
      'meeting-reuniao-q3-2026-01-02-0304.webm',
    );
    const md = transcriptMarkdown(
      'Sync',
      new Date(0),
      [{ peerId: 'p', name: 'Ana', text: 'oi', ts: 0, self: false }],
      [],
      '## Summary\n- ok',
    );
    expect(md).toContain('# Sync');
    expect(md).toContain('## Notes');
    expect(md).toContain('Ana: oi');
    expect(md).toContain('_No chat._');
  });
});
