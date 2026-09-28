import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { MULTIPLAYER_MAX_SAVED_ROOMS, MULTIPLAYER_ROOM_SAVE_DEBOUNCE_MS } from '../constants.js';
import type { SharedLayout } from './protocol.js';
import { sanitizeLayout } from './protocol.js';

export interface SavedRoomLayout {
  rev: number;
  layout: SharedLayout;
}

const SAVED_ROOM_FILE = /^[0-9a-f]{64}\.json$/;

/**
 * The relay's memory of room maps, so a map outlives the room emptying and the
 * relay restarting: one JSON file per room, named by a hash of the room name (a
 * directory listing gives no room away). Writes are debounced per room and
 * atomic (tmp + rename, mode 0600); past `maxRooms` files the least recently
 * edited maps are deleted. Only maps are kept — never who was in a room, what
 * they said or what their agents did.
 */
export class RoomLayoutStore {
  private readonly pending = new Map<
    string,
    { value: SavedRoomLayout; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly dir: string,
    private readonly maxRooms = MULTIPLAYER_MAX_SAVED_ROOMS,
    private readonly debounceMs = MULTIPLAYER_ROOM_SAVE_DEBOUNCE_MS,
  ) {}

  /** The map saved for a room, or null (never saved, unreadable, or not a map). */
  load(room: string): SavedRoomLayout | null {
    const pending = this.pending.get(room);
    if (pending) return pending.value;
    try {
      const raw = JSON.parse(fs.readFileSync(this.fileFor(room), 'utf-8')) as Record<
        string,
        unknown
      >;
      const layout = sanitizeLayout(raw.layout);
      const rev = raw.rev;
      if (!layout || !Number.isSafeInteger(rev) || (rev as number) < 0) return null;
      return { rev: rev as number, layout };
    } catch {
      return null;
    }
  }

  /** Remember a room's map; written once the edits pause. */
  save(room: string, value: SavedRoomLayout): void {
    const pending = this.pending.get(room);
    if (pending) {
      pending.value = value;
      return;
    }
    const timer = setTimeout(() => this.write(room), this.debounceMs);
    timer.unref?.();
    this.pending.set(room, { value, timer });
  }

  /** Write every map still waiting for its debounce (the relay is shutting down). */
  flush(): void {
    for (const [room, { timer }] of [...this.pending]) {
      clearTimeout(timer);
      this.write(room);
    }
  }

  private fileFor(room: string): string {
    const hash = crypto.createHash('sha256').update(room).digest('hex');
    return path.join(this.dir, `${hash}.json`);
  }

  private write(room: string): void {
    const pending = this.pending.get(room);
    if (!pending) return;
    this.pending.delete(room);
    const file = this.fileFor(room);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const { rev, layout } = pending.value;
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, rev, savedAt: Date.now(), layout }), {
        mode: 0o600,
      });
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error(`[Pixel Agents Relay] Could not save a room map: ${err}`);
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* never written */
      }
      return;
    }
    this.prune();
  }

  /** Keep at most `maxRooms` maps: the ones edited longest ago go first. */
  private prune(): void {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir).filter((n) => SAVED_ROOM_FILE.test(n));
    } catch {
      return;
    }
    if (names.length <= this.maxRooms) return;
    const files: Array<{ file: string; mtime: number }> = [];
    for (const name of names) {
      const file = path.join(this.dir, name);
      try {
        files.push({ file, mtime: fs.statSync(file).mtimeMs });
      } catch {
        /* removed meanwhile */
      }
    }
    files.sort((a, b) => a.mtime - b.mtime);
    for (const { file } of files.slice(0, files.length - this.maxRooms)) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* already gone */
      }
    }
  }
}
