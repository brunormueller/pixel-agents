// webview-ui/src/meeting/media.ts
//
// The person's own devices (microphone, camera, screens), what this page may
// use of them, and who is speaking.

import {
  MEETING_CAMERA_CONSTRAINTS,
  MEETING_SPEAKING_HOLD_MS,
  MEETING_SPEAKING_POLL_MS,
  MEETING_SPEAKING_THRESHOLD,
} from '../constants.js';
import { isBrowserRuntime } from '../runtime.js';

export interface MediaSupport {
  /** Microphone and camera can be captured here. */
  capture: boolean;
  /** Screens can be shared from here. */
  screen: boolean;
  /** Why not, for the person. */
  reason: string | null;
}

/** VS Code webviews may not open the camera or microphone, and browsers only
 *  allow them on https or localhost. Watching and listening work anywhere. */
export function mediaSupport(): MediaSupport {
  if (!isBrowserRuntime) {
    return {
      capture: false,
      screen: false,
      reason:
        'VS Code does not let the office use your camera, microphone or screen. You can see, hear and chat here; to talk, open the office in the browser (npx pixel-agents).',
    };
  }
  const devices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!window.isSecureContext || !devices?.getUserMedia) {
    return {
      capture: false,
      screen: false,
      reason:
        'The browser only allows the camera and microphone on https or on this machine (http://127.0.0.1). Open the tokened URL the terminal printed.',
    };
  }
  return { capture: true, screen: typeof devices.getDisplayMedia === 'function', reason: null };
}

export interface DeviceChoice {
  mic: string | null;
  cam: string | null;
  speaker: string | null;
}

const DEVICE_KEY = 'pixelAgents.meetingDevices';

export function loadDeviceChoice(): DeviceChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? '{}') as Partial<DeviceChoice>;
    return {
      mic: typeof raw.mic === 'string' ? raw.mic : null,
      cam: typeof raw.cam === 'string' ? raw.cam : null,
      speaker: typeof raw.speaker === 'string' ? raw.speaker : null,
    };
  } catch {
    return { mic: null, cam: null, speaker: null };
  }
}

export function saveDeviceChoice(choice: DeviceChoice): void {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(choice));
  } catch {
    /* private window: the choice lasts this session */
  }
}

/** Open the microphone (echo cancellation on — the call plays through the same machine). */
export async function openMic(deviceId: string | null): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  return stream.getAudioTracks()[0];
}

export async function openCamera(deviceId: string | null): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      ...MEETING_CAMERA_CONSTRAINTS,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
  });
  return stream.getVideoTracks()[0];
}

/** Ask the browser for a screen, window or tab. With `audio`, Chrome offers to share its sound too. */
export async function openScreen(audio: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 15, max: 30 } },
    audio,
  });
}

/** A readable reason a device could not be opened. */
export function mediaErrorText(err: unknown, what: string): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return `The browser blocked the ${what}. Allow it in the address bar's site settings and try again.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return `No ${what} found. Plug one in, or pick another in Devices.`;
  }
  if (name === 'NotReadableError') return `The ${what} is busy in another app.`;
  if (name === 'AbortError') return '';
  return `Could not open the ${what}${err instanceof Error && err.message ? `: ${err.message}` : '.'}`;
}

export async function listDevices(): Promise<MediaDeviceInfo[]> {
  try {
    return await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [];
  }
}

/** Output device selection (Chrome and Edge; elsewhere the default speaker plays). */
export const canPickSpeaker = (): boolean =>
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/**
 * Who is talking: one analyser per audio stream, polled a few times a second.
 * Above the threshold counts as speaking, held a moment so a pause between
 * words does not flicker the outline.
 */
export class SpeakingMeter {
  private ctx: AudioContext | null = null;
  private readonly sources = new Map<
    string,
    { trackId: string; node: MediaStreamAudioSourceNode; analyser: AnalyserNode; lastLoud: number }
  >();
  private timer: ReturnType<typeof setInterval> | null = null;
  private speaking = new Set<string>();
  private readonly buffer = new Float32Array(512);
  private readonly onChange: (speaking: ReadonlySet<string>) => void;

  constructor(onChange: (speaking: ReadonlySet<string>) => void) {
    this.onChange = onChange;
  }

  /** Measure `track` under `key` (null stops measuring it). */
  watch(key: string, track: MediaStreamTrack | null): void {
    const current = this.sources.get(key);
    if (current && current.trackId === track?.id) return;
    if (current) this.unwatch(key);
    if (!track || track.readyState === 'ended') return;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      const node = this.ctx.createMediaStreamSource(new MediaStream([track]));
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      node.connect(analyser);
      this.sources.set(key, { trackId: track.id, node, analyser, lastLoud: 0 });
      this.timer ??= setInterval(() => this.poll(), MEETING_SPEAKING_POLL_MS);
    } catch {
      /* no audio context here: nobody lights up, nothing breaks */
    }
  }

  unwatch(key: string): void {
    const s = this.sources.get(key);
    if (!s) return;
    s.node.disconnect();
    this.sources.delete(key);
  }

  /** Stop measuring everything not in `keys`. */
  retain(keys: ReadonlySet<string>): void {
    for (const key of [...this.sources.keys()]) if (!keys.has(key)) this.unwatch(key);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const key of [...this.sources.keys()]) this.unwatch(key);
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private poll(): void {
    const now = Date.now();
    const next = new Set<string>();
    for (const [key, s] of this.sources) {
      s.analyser.getFloatTimeDomainData(this.buffer);
      let sum = 0;
      for (const v of this.buffer) sum += v * v;
      if (Math.sqrt(sum / this.buffer.length) > MEETING_SPEAKING_THRESHOLD) s.lastLoud = now;
      if (now - s.lastLoud < MEETING_SPEAKING_HOLD_MS) next.add(key);
    }
    if (next.size !== this.speaking.size || [...next].some((k) => !this.speaking.has(k))) {
      this.speaking = next;
      this.onChange(next);
    }
  }
}

/** Save a blob as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
