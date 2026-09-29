// webview-ui/src/games/fps/audio.ts
//
// Pixel Frag's sounds, synthesized with the Web Audio API (no files): shots
// are filtered noise bursts over a thump, the rest short chiptune blips.

export type FpsSound =
  | 'pistol'
  | 'shotgun'
  | 'chaingun'
  | 'hurt'
  | 'die'
  | 'pickup'
  | 'empty'
  | 'hit'
  | 'frag'
  | 'respawn'
  | 'round';

export const WEAPON_SOUNDS: readonly FpsSound[] = ['pistol', 'shotgun', 'chaingun'];

interface Burst {
  /** Seconds. */
  len: number;
  filter: BiquadFilterType;
  freq: number;
  gain: number;
  /** A low sine thump under the noise (Hz), or 0. */
  thump: number;
}

const BURSTS: Partial<Record<FpsSound, Burst>> = {
  pistol: { len: 0.14, filter: 'bandpass', freq: 1700, gain: 0.55, thump: 160 },
  shotgun: { len: 0.38, filter: 'lowpass', freq: 1100, gain: 0.9, thump: 70 },
  chaingun: { len: 0.08, filter: 'bandpass', freq: 2300, gain: 0.45, thump: 120 },
};

interface Blip {
  type: OscillatorType;
  from: number;
  to: number;
  len: number;
  gain: number;
  /** Start offset, seconds. */
  at?: number;
}

const BLIPS: Partial<Record<FpsSound, Blip[]>> = {
  hurt: [{ type: 'square', from: 220, to: 110, len: 0.16, gain: 0.25 }],
  die: [{ type: 'sawtooth', from: 320, to: 50, len: 0.7, gain: 0.3 }],
  pickup: [
    { type: 'square', from: 660, to: 660, len: 0.07, gain: 0.18 },
    { type: 'square', from: 990, to: 990, len: 0.09, gain: 0.18, at: 0.07 },
  ],
  empty: [{ type: 'square', from: 1300, to: 900, len: 0.03, gain: 0.15 }],
  hit: [{ type: 'sine', from: 1500, to: 1200, len: 0.05, gain: 0.22 }],
  frag: [
    { type: 'square', from: 523, to: 523, len: 0.08, gain: 0.2 },
    { type: 'square', from: 659, to: 659, len: 0.08, gain: 0.2, at: 0.08 },
    { type: 'square', from: 784, to: 784, len: 0.14, gain: 0.2, at: 0.16 },
  ],
  respawn: [{ type: 'triangle', from: 220, to: 880, len: 0.3, gain: 0.2 }],
  round: [
    { type: 'square', from: 392, to: 392, len: 0.12, gain: 0.2 },
    { type: 'square', from: 523, to: 523, len: 0.12, gain: 0.2, at: 0.13 },
    { type: 'square', from: 784, to: 784, len: 0.3, gain: 0.2, at: 0.26 },
  ],
};

export class FpsAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.5;

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master) this.master.gain.value = this.volume;
  }

  /** Start (or resume) audio: call from a click or key press — pages start muted until then. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /** Play a sound; `gain` scales it (quieter far away). */
  play(sound: FpsSound, gain = 1): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || gain <= 0.01 || this.volume <= 0) return;
    const now = ctx.currentTime;
    const burst = BURSTS[sound];
    if (burst && this.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = burst.filter;
      filter.frequency.value = burst.freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(burst.gain * gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + burst.len);
      src.connect(filter).connect(g).connect(master);
      src.start(now, Math.random() * 0.3);
      src.stop(now + burst.len);
      if (burst.thump > 0) {
        this.tone(
          {
            type: 'sine',
            from: burst.thump,
            to: burst.thump / 2,
            len: burst.len * 0.7,
            gain: burst.gain * 0.8,
          },
          gain,
        );
      }
    }
    for (const blip of BLIPS[sound] ?? []) this.tone(blip, gain);
  }

  private tone(b: Blip, gain: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const start = ctx.currentTime + (b.at ?? 0);
    const osc = ctx.createOscillator();
    osc.type = b.type;
    osc.frequency.setValueAtTime(b.from, start);
    if (b.to !== b.from)
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, b.to), start + b.len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(b.gain * gain, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + b.len);
    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(start + b.len + 0.02);
  }

  dispose(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) void ctx.close().catch(() => {});
  }
}
