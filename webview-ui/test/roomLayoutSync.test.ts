/**
 * Unit tests for the room map everyone edits: the three-way layout merge and
 * the page-side sync (`RoomLayoutSync`) against a fake relay that keeps a
 * revision and refuses edits made on an older one — the relay's real rule.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import { mergeLayouts, sameLayoutValue } from '../src/office/layout/layoutMerge.js';
import type { RoomLayoutRebase } from '../src/office/layout/roomLayoutSync.js';
import { RoomLayoutSync } from '../src/office/layout/roomLayoutSync.js';
import type { OfficeLayout, PlacedFurniture } from '../src/office/types.js';

function layout(furniture: PlacedFurniture[] = [], cols = 4, rows = 2): OfficeLayout {
  return { version: 1, cols, rows, tiles: new Array(cols * rows).fill(1), furniture };
}

const item = (uid: string, col = 0, row = 0): PlacedFurniture => ({
  uid,
  type: 'DESK',
  col,
  row,
});

const withTile = (l: OfficeLayout, index: number, tile: number): OfficeLayout => {
  const tiles = [...l.tiles];
  tiles[index] = tile as OfficeLayout['tiles'][number];
  return { ...l, tiles };
};

const uids = (l: OfficeLayout) => l.furniture.map((f) => `${f.uid}@${f.col},${f.row}`).sort();

// ── mergeLayouts ─────────────────────────────────────────────

test('merge keeps furniture both sides added, moved or removed', () => {
  const base = layout([item('a'), item('b'), item('c')]);
  const mine = layout([item('a', 2, 0), item('b'), item('c'), item('mine')]); // moved a, added mine
  const theirs = layout([item('a'), item('b', 3, 1), item('theirs')]); // moved b, removed c, added theirs
  assert.deepEqual(uids(mergeLayouts(base, mine, theirs)), [
    'a@2,0',
    'b@3,1',
    'mine@0,0',
    'theirs@0,0',
  ]);
});

test('merge: our change wins a conflict, and our removal stands over their move', () => {
  const base = layout([item('a'), item('b')]);
  const mine = layout([item('a', 1, 0)]); // moved a, removed b
  const theirs = layout([item('a', 3, 0), item('b', 2, 1)]); // moved both
  assert.deepEqual(uids(mergeLayouts(base, mine, theirs)), ['a@1,0']);
});

test('merge paints tiles per cell; the same cell painted twice keeps ours', () => {
  const base = layout();
  const mine = withTile(withTile(base, 0, 7), 5, 7);
  const theirs = withTile(withTile(base, 1, 9), 5, 9);
  const merged = mergeLayouts(base, mine, theirs);
  assert.deepEqual(merged.tiles, [7, 9, 1, 1, 1, 7, 1, 1]);
});

test('merge: a side that reshaped the grid takes the grid, furniture still merges', () => {
  const base = layout([item('a')]);
  const mine = { ...withTile(base, 0, 7), furniture: [item('a'), item('mine')] };
  const grown = layout([item('a')], 5, 2); // they grew the grid a column
  const merged = mergeLayouts(base, mine, grown);
  assert.equal(merged.cols, 5);
  assert.deepEqual(merged.tiles, grown.tiles); // our tile edit could not be placed
  assert.deepEqual(uids(merged), ['a@0,0', 'mine@0,0']);
});

test('merge: renaming a level and painting a tile both survive', () => {
  const level = { id: 'main', name: 'Ground', elevation: 0, col: 0, row: 0, cols: 4, rows: 2 };
  const base = { ...layout(), levels: [level] };
  const mine = { ...base, levels: [{ ...level, name: 'Lobby' }] };
  const theirs = withTile(base, 3, 9);
  const merged = mergeLayouts(base, mine, theirs);
  assert.equal(merged.levels?.[0].name, 'Lobby');
  assert.equal(merged.tiles[3], 9);
});

test('values compare regardless of key order (a relay re-serializes them)', () => {
  assert.equal(
    sameLayoutValue({ uid: 'a', type: 'DESK', col: 1 }, { col: 1, type: 'DESK', uid: 'a' }),
    true,
  );
  const base = layout([item('a')]);
  const reordered = layout([{ row: 0, col: 0, type: 'DESK', uid: 'a' }]);
  const theirs = layout([item('a', 3, 1)]);
  assert.deepEqual(uids(mergeLayouts(base, reordered, theirs)), ['a@3,1']);
});

// ── RoomLayoutSync against a fake relay ──────────────────────

interface Sent {
  from: Page;
  layout: OfficeLayout;
  base: number;
  id: string;
}

type Inbound =
  | { kind: 'layout'; layout: OfficeLayout; rev: number; id?: string }
  | { kind: 'reject'; id: string };

class Page {
  readonly sync: RoomLayoutSync;
  screen: OfficeLayout | null = null;
  readonly shows: Array<{ layout: OfficeLayout; rebase: RoomLayoutRebase | null }> = [];
  readonly inbox: Inbound[] = [];
  sends = 0;

  constructor(relay: FakeRelay, retryMs = 5) {
    this.sync = new RoomLayoutSync(retryMs, 2);
    this.sync.setHost({
      send: (l, base, id) => {
        this.sends++;
        relay.queue.push({ from: this, layout: l, base, id });
      },
      show: (l, rebase) => {
        this.screen = l;
        this.shows.push({ layout: l, rebase });
      },
    });
  }

  /** The person edits what is on screen. */
  edit(change: (l: OfficeLayout) => OfficeLayout): void {
    const next = change(this.screen!);
    this.screen = next;
    assert.equal(this.sync.localEdit(next), true);
  }

  deliver(): void {
    for (const msg of this.inbox.splice(0)) {
      if (msg.kind === 'layout') this.sync.receive(msg.layout, msg.rev, msg.id);
      else this.sync.rejected(msg.id, 'stale');
    }
  }
}

class FakeRelay {
  rev = 0;
  layout: OfficeLayout | null = null;
  readonly queue: Sent[] = [];
  readonly pages: Page[] = [];
  /** What the relay keeps of a layout (the real one strips pets and areas). */
  private readonly trim: (l: OfficeLayout) => OfficeLayout;

  constructor(trim: (l: OfficeLayout) => OfficeLayout = (l) => l) {
    this.trim = trim;
  }

  join(page: Page): void {
    this.pages.push(page);
    if (this.layout) page.inbox.push({ kind: 'layout', layout: this.layout, rev: this.rev });
  }

  seed(l: OfficeLayout): void {
    this.rev = 1;
    this.layout = l;
    for (const p of this.pages) p.inbox.push({ kind: 'layout', layout: l, rev: 1 });
  }

  /** Handle the oldest queued edit, like the relay does: current base or refuse. */
  step(): void {
    const frame = this.queue.shift();
    if (!frame) return;
    if (frame.base !== this.rev) {
      frame.from.inbox.push({ kind: 'reject', id: frame.id });
      return;
    }
    this.rev++;
    this.layout = this.trim(frame.layout);
    for (const p of this.pages) {
      p.inbox.push({ kind: 'layout', layout: this.layout, rev: this.rev, id: frame.id });
    }
  }

  /** Run until nothing is left in flight anywhere. */
  settle(): void {
    for (let guard = 0; guard < 100; guard++) {
      if (this.queue.length === 0 && this.pages.every((p) => p.inbox.length === 0)) return;
      this.step();
      for (const p of this.pages) p.deliver();
    }
    throw new Error('relay never settled (edit loop?)');
  }
}

test('no room map on screen: edits are not the room’s', () => {
  const sync = new RoomLayoutSync();
  assert.equal(sync.active, false);
  assert.equal(sync.localEdit(layout()), false);
});

test('an edit reaches everyone in the room, and a late joiner gets the latest map', () => {
  const relay = new FakeRelay();
  const ana = new Page(relay);
  const bob = new Page(relay);
  relay.join(ana);
  relay.join(bob);
  relay.seed(layout([item('desk')]));
  relay.settle();
  assert.equal(bob.shows[0].rebase, null); // a fresh map: history starts over

  ana.edit((l) => ({ ...l, furniture: [...l.furniture, item('plant', 2, 1)] }));
  relay.settle();
  assert.deepEqual(uids(bob.screen!), ['desk@0,0', 'plant@2,1']);

  const cai = new Page(relay);
  relay.join(cai);
  relay.settle();
  assert.deepEqual(uids(cai.screen!), ['desk@0,0', 'plant@2,1']);
});

test('two people editing at once: nobody’s edit is lost', () => {
  const relay = new FakeRelay();
  const ana = new Page(relay);
  const bob = new Page(relay);
  relay.join(ana);
  relay.join(bob);
  relay.seed(layout([item('desk')]));
  relay.settle();

  // Both edit revision 1 before either hears of the other.
  ana.edit((l) => ({ ...l, furniture: [...l.furniture, item('plant', 1, 0)] }));
  bob.edit((l) => withTile({ ...l, furniture: [...l.furniture, item('lamp', 3, 1)] }, 0, 9));
  relay.step(); // Ana's lands as revision 2
  relay.step(); // Bob's was made on revision 1: refused
  ana.deliver();
  bob.deliver(); // Bob merges revision 2 in and sends again
  relay.settle();

  const expected = ['desk@0,0', 'lamp@3,1', 'plant@1,0'];
  assert.deepEqual(uids(relay.layout!), expected);
  assert.deepEqual(uids(ana.screen!), expected);
  assert.deepEqual(uids(bob.screen!), expected);
  assert.equal(relay.layout!.tiles[0], 9);
  assert.equal(ana.sync.pending || bob.sync.pending, false);
});

test('a change from someone else is carried onto the undo history', () => {
  const relay = new FakeRelay();
  const ana = new Page(relay);
  const bob = new Page(relay);
  relay.join(ana);
  relay.join(bob);
  const start = layout([item('desk')]);
  relay.seed(start);
  relay.settle();

  const beforeMyEdit = ana.screen!; // what Undo would restore
  ana.edit((l) => ({ ...l, furniture: [...l.furniture, item('mine', 1, 1)] }));
  relay.settle();
  bob.edit((l) => ({ ...l, furniture: [...l.furniture, item('theirs', 3, 0)] }));
  relay.settle();

  const rebase = ana.shows[ana.shows.length - 1].rebase!;
  // Undoing my edit now takes away mine only, not Bob's.
  assert.deepEqual(uids(rebase(beforeMyEdit)), ['desk@0,0', 'theirs@3,0']);
});

test('what the relay trims off an edit comes back without an edit loop', () => {
  const trim = (l: OfficeLayout): OfficeLayout => {
    const copy = { ...l };
    delete copy.pets;
    return copy;
  };
  const relay = new FakeRelay(trim);
  const ana = new Page(relay);
  const bob = new Page(relay);
  relay.join(ana);
  relay.join(bob);
  relay.seed(layout([item('desk')]));
  relay.settle();

  ana.edit((l) => ({ ...l, pets: [], furniture: [...l.furniture, item('plant')] }));
  bob.edit((l) => ({ ...l, pets: [], furniture: [...l.furniture, item('lamp', 2, 0)] }));
  relay.settle();
  assert.equal(ana.screen!.pets, undefined);
  assert.equal(ana.sends + bob.sends <= 4, true);
  assert.deepEqual(uids(ana.screen!), uids(bob.screen!));
});

test('refused for being too fast: tried again; refused as invalid: the room’s map comes back', async () => {
  const relay = new FakeRelay();
  const ana = new Page(relay);
  relay.join(ana);
  relay.seed(layout([item('desk')]));
  relay.settle();

  ana.edit((l) => ({ ...l, furniture: [...l.furniture, item('plant')] }));
  const first = relay.queue.shift()!;
  ana.sync.rejected(first.id, 'busy');
  assert.equal(relay.queue.length, 0);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(relay.queue.length, 1); // retried
  relay.settle();
  assert.deepEqual(uids(relay.layout!), ['desk@0,0', 'plant@0,0']);

  ana.edit((l) => ({ ...l, furniture: [] }));
  const bad = relay.queue.shift()!;
  ana.sync.rejected(bad.id, 'invalid');
  assert.deepEqual(uids(ana.screen!), ['desk@0,0', 'plant@0,0']);
  assert.equal(ana.sync.pending, false);
});

test('leaving the room: edits go back to this office’s own layout', () => {
  const relay = new FakeRelay();
  const ana = new Page(relay);
  relay.join(ana);
  relay.seed(layout());
  relay.settle();
  assert.equal(ana.sync.active, true);
  ana.sync.reset();
  assert.equal(ana.sync.active, false);
  assert.equal(ana.sync.localEdit(layout()), false);
});
