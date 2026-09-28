/**
 * Local meeting recording: every participant's video (cameras + screen shares)
 * composed onto one offscreen canvas, every audio track mixed through one
 * AudioContext, and the pair recorded by MediaRecorder into a .webm the person
 * downloads. Nothing leaves the machine — the file is theirs.
 *
 * The layout, file name and codec pick are pure (unit-tested in Node); the
 * MeetingRecorder class is the DOM/Web Audio glue around them.
 */

import {
  MEETING_RECORD_AVATAR_BG,
  MEETING_RECORD_BG,
  MEETING_RECORD_FPS,
  MEETING_RECORD_HEIGHT,
  MEETING_RECORD_LABEL_BG,
  MEETING_RECORD_SPEAKING,
  MEETING_RECORD_TEXT,
  MEETING_RECORD_TILE_BG,
  MEETING_RECORD_TILE_BORDER,
  MEETING_RECORD_WIDTH,
} from '../constants.js';

export interface RecordingSource {
  key: string; // stable id (e.g. `${peerId}:cam`, `${peerId}:screen:${streamId}`)
  name: string; // label drawn on the tile ("Ana", "Ana — screen")
  stream: MediaStream | null; // video source; null => draw the placeholder (initial letter)
  kind: 'camera' | 'screen';
  videoOn: boolean; // false => placeholder even if a stream exists (camera off)
  speaking: boolean; // draw a highlighted border
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_GAP = 8;
/** Share of the height screen shares take when cameras sit in a filmstrip below. */
const SCREEN_AREA_SHARE = 0.75;
const ASPECT = 16 / 9;
const VIDEO_BITS_PER_SECOND = 2_500_000;
const TIMESLICE_MS = 1000;
const AUDIO_SYNC_MS = 1000;
const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

const font = (px: number, bold = false) =>
  `${bold ? 'bold ' : ''}${px}px "FS Pixel Sans", sans-serif`;

/** The largest 16:9 box inside the cell, centered; integer edges that never leave the cell. */
function fit(x: number, y: number, w: number, h: number): Rect {
  const fw = Math.max(0, Math.min(w, h * ASPECT));
  const fh = fw / ASPECT;
  const x1 = Math.ceil(x + (w - fw) / 2);
  const y1 = Math.ceil(y + (h - fh) / 2);
  return {
    x: x1,
    y: y1,
    w: Math.floor(x + (w + fw) / 2) - x1,
    h: Math.floor(y + (h + fh) / 2) - y1,
  };
}

/** `n` tiles in `area`; `rows` forces the row count, otherwise the grid that gives the biggest tile wins. */
function grid(n: number, area: Rect, gap: number, rows?: number): Rect[] {
  if (n <= 0) return [];
  let cols = rows ? Math.ceil(n / rows) : 1;
  if (!rows) {
    let best = -1;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const t = fit(0, 0, (area.w - gap * (c - 1)) / c, (area.h - gap * (r - 1)) / r);
      if (t.w * t.h > best) [best, cols] = [t.w * t.h, c]; // strict: ties keep fewer columns
    }
  }
  const r = Math.ceil(n / cols);
  const cw = (area.w - gap * (cols - 1)) / cols;
  const ch = (area.h - gap * (r - 1)) / r;
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    // A short last row is centered rather than hugging the left edge.
    const inRow = row === r - 1 ? n - row * cols : cols;
    const shift = ((cols - inRow) * (cw + gap)) / 2;
    out.push(fit(area.x + shift + (i % cols) * (cw + gap), area.y + row * (ch + gap), cw, ch));
  }
  return out;
}

/** Pure. Screens get the big area (grid of screens across the top ~75% when any exist), cameras a filmstrip row
 *  along the bottom; with no screens, cameras fill a near-square grid. Tiles keep 16:9 inside their cell
 *  (letterboxed, centered), with `gap` px between cells. Returns rects in the same order as the inputs:
 *  first all screens, then all cameras. */
export function layoutTiles(
  screens: number,
  cameras: number,
  width: number,
  height: number,
  gap: number = DEFAULT_GAP,
): Rect[] {
  const s = Math.max(0, Math.floor(screens));
  const c = Math.max(0, Math.floor(cameras));
  const content: Rect = { x: gap, y: gap, w: width - gap * 2, h: height - gap * 2 };
  if (s === 0) return grid(c, content, gap);
  if (c === 0) return grid(s, content, gap);
  const screenH = Math.round((content.h - gap) * SCREEN_AREA_SHARE);
  const top: Rect = { ...content, h: screenH };
  const strip: Rect = { ...content, y: content.y + screenH + gap, h: content.h - gap - screenH };
  return [...grid(s, top, gap), ...grid(c, strip, gap, 1)];
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Pure: "meeting-<slug-of-title>-YYYY-MM-DD-HHmm.webm" in local time; slug = lowercase ascii letters/digits and
 *  dashes (accents stripped via NFD), max 40 chars, "meeting" when empty. */
export function recordingFileName(title: string, date: Date): string {
  const slug =
    title
      .normalize('NFD')
      .replace(/\p{M}/gu, '') // NFD split "ã" into "a" + a combining mark; drop the mark
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'meeting';
  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `meeting-${slug}-${day}-${pad2(date.getHours())}${pad2(date.getMinutes())}.webm`;
}

/** Pure: the first MIME type the predicate accepts from vp9+opus, vp8+opus, webm; '' when none. */
export function pickMimeType(isSupported: (type: string) => boolean): string {
  return MIME_CANDIDATES.find((t) => isSupported(t)) ?? '';
}

export class MeetingRecorder {
  static isSupported(): boolean {
    return (
      typeof document !== 'undefined' &&
      typeof MediaRecorder !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function'
    );
  }

  private readonly getSources: () => RecordingSource[];
  private readonly getAudioStreams: () => MediaStream[];
  private ctx2d: CanvasRenderingContext2D | null = null;
  private canvasStream: MediaStream | null = null;
  private readonly videos = new Map<string, { el: HTMLVideoElement; stream: MediaStream }>();
  private audioCtx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  /** Keyed by track id, so a track shared by several streams is mixed once. */
  private readonly audioNodes = new Map<string, { track: MediaStreamTrack; node: AudioNode }>();
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';
  private timers: ReturnType<typeof setInterval>[] = [];
  private _startedAt = 0;

  constructor(opts: { getSources: () => RecordingSource[]; getAudioStreams: () => MediaStream[] }) {
    this.getSources = opts.getSources;
    this.getAudioStreams = opts.getAudioStreams;
  }

  get recording(): boolean {
    return this.recorder !== null && this.recorder.state !== 'inactive';
  }

  get startedAt(): number {
    return this._startedAt;
  }

  start(): void {
    if (this.recorder) throw new Error('A recording is already running.');
    if (!MeetingRecorder.isSupported()) throw new Error('This browser cannot record meetings.');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = MEETING_RECORD_WIDTH;
      canvas.height = MEETING_RECORD_HEIGHT;
      this.ctx2d = canvas.getContext('2d');
      if (!this.ctx2d) throw new Error('no 2D canvas context');
      this._startedAt = Date.now();
      this.drawFrame(); // the first captured frame is already the meeting, not a blank canvas
      this.canvasStream = canvas.captureStream(MEETING_RECORD_FPS);

      this.audioCtx = new AudioContext();
      this.audioCtx.resume().catch(() => {}); // started outside a gesture it may begin suspended
      this.dest = this.audioCtx.createMediaStreamDestination();
      this.syncAudio();

      this.mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
      const mixed = new MediaStream([
        ...this.canvasStream.getVideoTracks(),
        ...this.dest.stream.getAudioTracks(),
      ]);
      const recorder = new MediaRecorder(mixed, {
        ...(this.mimeType ? { mimeType: this.mimeType } : {}),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      };
      // setInterval, not rAF: rAF stops in a background tab and the file would freeze on one frame.
      this.timers.push(setInterval(() => this.drawFrame(), 1000 / MEETING_RECORD_FPS));
      this.timers.push(setInterval(() => this.syncAudio(), AUDIO_SYNC_MS));
      recorder.start(TIMESLICE_MS); // timeslice: chunks accumulate as we go, not one blob at the end
      this.recorder = recorder;
    } catch (err) {
      this.release();
      const why = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not start the recording: ${why}`, { cause: err });
    }
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) return Promise.reject(new Error('Not recording.'));
    const finish = () => {
      const blob = new Blob(this.chunks, { type: this.mimeType || 'video/webm' });
      this.release();
      return blob;
    };
    // A recorder that died on its own (encoder error) already flushed: hand over what it made.
    if (recorder.state === 'inactive') return Promise.resolve(finish());
    return new Promise<Blob>((resolve, reject) => {
      // 'stop' fires after the final 'dataavailable', so every chunk is in by then.
      recorder.addEventListener('stop', () => resolve(finish()), { once: true });
      try {
        recorder.stop();
      } catch (err) {
        this.release();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Releases everything start() acquired; safe to call on a half-started recorder. */
  private release(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.canvasStream?.getTracks().forEach((t) => t.stop());
    this.dest?.stream.getTracks().forEach((t) => t.stop());
    for (const { node } of this.audioNodes.values()) node.disconnect();
    this.audioNodes.clear();
    this.audioCtx?.close().catch(() => {});
    for (const key of [...this.videos.keys()]) this.dropVideo(key);
    this.canvasStream = null;
    this.dest = null;
    this.audioCtx = null;
    this.ctx2d = null;
    this.recorder = null;
    this.chunks = [];
  }

  private dropVideo(key: string): void {
    const v = this.videos.get(key);
    if (!v) return;
    v.el.pause();
    v.el.srcObject = null;
    v.el.remove();
    this.videos.delete(key);
  }

  /** One hidden muted <video> per source: drawImage needs an element, not a stream. */
  private syncVideos(sources: RecordingSource[]): void {
    const wanted = new Map<string, MediaStream>();
    for (const s of sources) if (s.stream) wanted.set(s.key, s.stream);
    for (const [key, v] of this.videos) if (wanted.get(key) !== v.stream) this.dropVideo(key);
    for (const [key, stream] of wanted) {
      if (this.videos.has(key)) continue;
      const el = document.createElement('video');
      el.muted = true; // audio comes through the mixer; a muted element may also autoplay
      el.playsInline = true;
      el.srcObject = stream;
      el.play().catch(() => {});
      this.videos.set(key, { el, stream });
    }
  }

  private syncAudio(): void {
    const ctx = this.audioCtx;
    const dest = this.dest;
    if (!ctx || !dest) return;
    const live = new Map<string, MediaStreamTrack>();
    try {
      for (const s of this.getAudioStreams())
        for (const t of s.getAudioTracks()) if (t.readyState === 'live') live.set(t.id, t);
    } catch {
      return; // keep the current mix; try again next tick
    }
    for (const [id, { track, node }] of this.audioNodes) {
      if (live.get(id) === track) continue;
      node.disconnect();
      this.audioNodes.delete(id);
    }
    for (const [id, track] of live) {
      if (this.audioNodes.has(id)) continue;
      try {
        const node = ctx.createMediaStreamSource(new MediaStream([track]));
        node.connect(dest);
        this.audioNodes.set(id, { track, node });
      } catch {
        /* retried on the next sync */
      }
    }
  }

  private drawFrame(): void {
    const ctx = this.ctx2d;
    if (!ctx) return;
    const W = MEETING_RECORD_WIDTH;
    const H = MEETING_RECORD_HEIGHT;
    try {
      ctx.fillStyle = MEETING_RECORD_BG;
      ctx.fillRect(0, 0, W, H);
      const sources = this.getSources();
      this.syncVideos(sources);
      const screens = sources.filter((s) => s.kind === 'screen');
      const cameras = sources.filter((s) => s.kind !== 'screen');
      const ordered = [...screens, ...cameras]; // layoutTiles' order: screens first
      if (ordered.length === 0) {
        ctx.fillStyle = MEETING_RECORD_TEXT;
        ctx.font = font(24);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Waiting for participants', W / 2, H / 2);
      }
      const rects = layoutTiles(screens.length, cameras.length, W, H);
      ordered.forEach((s, i) => {
        try {
          this.drawTile(ctx, s, rects[i]);
        } catch {
          /* one broken tile must not blank the whole frame */
        }
      });
      this.drawRecBadge(ctx, W);
    } catch {
      /* never throw from the timer: the next frame tries again */
    }
  }

  private drawTile(ctx: CanvasRenderingContext2D, s: RecordingSource, r: Rect): void {
    if (!r || r.w <= 0 || r.h <= 0) return;
    ctx.fillStyle = MEETING_RECORD_TILE_BG;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const el = this.videos.get(s.key)?.el;
    if (s.videoOn && el && el.readyState >= 2 && el.videoWidth > 0) {
      const vw = el.videoWidth;
      const vh = el.videoHeight || 1;
      // Cameras COVER (a face crops fine); screens CONTAIN (cropping hides the content).
      const scale =
        s.kind === 'screen' ? Math.min(r.w / vw, r.h / vh) : Math.max(r.w / vw, r.h / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.drawImage(el, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      const radius = Math.min(r.w, r.h) * 0.22;
      ctx.fillStyle = MEETING_RECORD_AVATAR_BG;
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + r.h / 2, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = MEETING_RECORD_TEXT;
      ctx.font = font(Math.max(8, Math.round(radius)), true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const letter = Array.from(s.name.trim())[0]?.toUpperCase() ?? '?';
      ctx.fillText(letter, r.x + r.w / 2, r.y + r.h / 2);
    }
    const lw = s.speaking ? 3 : 1;
    ctx.lineWidth = lw;
    ctx.strokeStyle = s.speaking ? MEETING_RECORD_SPEAKING : MEETING_RECORD_TILE_BORDER;
    ctx.strokeRect(r.x + lw / 2, r.y + lw / 2, r.w - lw, r.h - lw);

    const px = Math.max(10, Math.min(18, Math.round(r.h / 12)));
    ctx.font = font(px);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const maxW = r.w - px * 2;
    let label = s.name;
    while (label.length > 1 && ctx.measureText(label).width > maxW) label = label.slice(0, -1);
    if (label !== s.name) label = `${label.slice(0, -1)}…`;
    const lh = px + 8;
    ctx.fillStyle = MEETING_RECORD_LABEL_BG;
    ctx.fillRect(r.x + 4, r.y + r.h - lh - 4, ctx.measureText(label).width + 12, lh);
    ctx.fillStyle = MEETING_RECORD_TEXT;
    ctx.fillText(label, r.x + 10, r.y + r.h - 4 - lh / 2);
  }

  private drawRecBadge(ctx: CanvasRenderingContext2D, W: number): void {
    const secs = Math.max(0, Math.floor((Date.now() - this._startedAt) / 1000));
    const text = `● REC ${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`;
    ctx.font = font(14, true);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = MEETING_RECORD_LABEL_BG;
    ctx.fillRect(W - tw - 24, 8, tw + 16, 24);
    ctx.fillStyle = MEETING_RECORD_TEXT;
    ctx.fillText(text, W - tw - 16, 20);
  }
}
