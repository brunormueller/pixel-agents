import { ROOM_LAYOUT_MAX_RETRIES, ROOM_LAYOUT_RETRY_MS } from '../../constants.js';
import type { OfficeLayout } from '../types.js';
import { mergeLayouts, sameLayoutValue } from './layoutMerge.js';

/** Carries one change of the room's map onto another snapshot of it. */
export type RoomLayoutRebase = (snapshot: OfficeLayout) => OfficeLayout;

/** Why an edit did not land (core/asyncapi.yaml `RoomLayoutRejectReason`). */
export type RoomLayoutRejectReason =
  'stale' | 'busy' | 'replaced' | 'offline' | 'invalid' | 'forbidden';

export interface RoomLayoutSyncHost {
  /** Send one edit of the room's map, made on revision `base`. */
  send(layout: OfficeLayout, base: number, editId: string): void;
  /**
   * Put the room's map on screen. `rebase` carries the same change onto the
   * editor's other snapshots (undo/redo, the Reset point); null = a map just
   * arrived from nowhere (joined a room): those snapshots start over.
   */
  show(layout: OfficeLayout, rebase: RoomLayoutRebase | null): void;
}

/**
 * This page's side of a room map everyone in the room edits. The relay keeps
 * the map's revision and takes an edit only while it was made on the current
 * one, so two people editing at once never silently overwrite each other: when
 * someone else's revision lands first, our unconfirmed edits are merged onto it
 * (three-way, `mergeLayouts`) and sent again.
 *
 * One edit is in flight at a time. Edits made meanwhile pile into `work` (the
 * map on screen) and go out, as one, once the room took or refused the last.
 * Pure: no transport, no React — the page supplies a host.
 */
export class RoomLayoutSync {
  private host: RoomLayoutSyncHost | null = null;
  /** The room's map as the relay last confirmed it. */
  private confirmed: { layout: OfficeLayout; rev: number } | null = null;
  /** The map on screen while it holds edits of ours the room has not taken yet. */
  private work: OfficeLayout | null = null;
  private inflight: { id: string; sent: OfficeLayout } | null = null;
  private seq = 0;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idPrefix = Math.random().toString(36).slice(2, 10);
  private readonly retryMs: number;
  private readonly maxRetries: number;

  constructor(retryMs = ROOM_LAYOUT_RETRY_MS, maxRetries = ROOM_LAYOUT_MAX_RETRIES) {
    this.retryMs = retryMs;
    this.maxRetries = maxRetries;
  }

  setHost(host: RoomLayoutSyncHost | null): void {
    this.host = host;
  }

  /** A room map everyone edits is on screen: edits go to the room, not layout.json. */
  get active(): boolean {
    return this.confirmed !== null;
  }

  /** Edits of ours the room has not taken yet. */
  get pending(): boolean {
    return this.work !== null;
  }

  /** The room's map left the screen (left the room, relay gone). */
  reset(): void {
    this.confirmed = null;
    this.work = null;
    this.inflight = null;
    this.failures = 0;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** A revision of the room's map arrived; `editId` = the edit that made it. */
  receive(layout: OfficeLayout, rev: number, editId?: string): void {
    const confirmed = this.confirmed;
    if (!confirmed) {
      this.confirmed = { layout, rev };
      this.host?.show(layout, null);
      return;
    }
    if (rev <= confirmed.rev) return; // already have it
    this.confirmed = { layout, rev };

    const inflight = this.inflight;
    if (inflight && editId === inflight.id) {
      // Ours landed. The room keeps only what renders the map, so what it
      // stored can differ from what we sent: carry that trim onto the screen.
      this.inflight = null;
      this.failures = 0;
      const sent = inflight.sent;
      const rebase = sameLayoutValue(layout, sent)
        ? null
        : (s: OfficeLayout) => mergeLayouts(sent, s, layout);
      if (this.work === sent) {
        this.work = null;
        if (rebase) this.host?.show(layout, rebase);
      } else if (this.work) {
        if (rebase) {
          this.work = rebase(this.work);
          this.host?.show(this.work, rebase);
        }
        this.flush();
      }
      return;
    }

    // Someone else's revision (or another page of this office's).
    const before = confirmed.layout;
    const rebase = (s: OfficeLayout) => mergeLayouts(before, s, layout);
    if (this.work) {
      this.work = rebase(this.work);
      // Our edit in flight was made on the older revision: the room refuses it.
      this.inflight = null;
      this.host?.show(this.work, rebase);
      this.flush();
    } else {
      this.host?.show(layout, rebase);
    }
  }

  /** The person edited the room's map. False = no room map on screen (save it locally). */
  localEdit(layout: OfficeLayout): boolean {
    if (!this.confirmed) return false;
    this.work = layout;
    this.flush();
    return true;
  }

  /** The room did not take one of our edits. */
  rejected(editId: string, reason: RoomLayoutRejectReason): void {
    if (this.inflight?.id !== editId) return; // one we already replaced
    this.inflight = null;
    if (reason === 'invalid' || reason === 'forbidden' || ++this.failures > this.maxRetries) {
      this.giveUp(reason);
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flush();
    }, this.retryMs);
  }

  private flush(): void {
    const { work, confirmed, host } = this;
    if (this.inflight || this.retryTimer || !work || !confirmed || !host) return;
    const id = `${this.idPrefix}-${++this.seq}`;
    this.inflight = { id, sent: work };
    host.send(work, confirmed.rev, id);
  }

  /** Drop edits the room will not take and show its map as it is. */
  private giveUp(reason: RoomLayoutRejectReason): void {
    console.warn(`[Webview] Room map edit dropped (${reason}); showing the room's map.`);
    this.work = null;
    this.failures = 0;
    const confirmed = this.confirmed;
    if (confirmed) this.host?.show(confirmed.layout, (s) => s);
  }
}
