/**
 * Meeting soundtrack composition (meeting/music.ts): the pure half that keeps every participant
 * on the same note — deterministic scores, sane note data, and the song-time math that turns
 * "seconds since the track started" into a position in the loop. Synthesis needs an
 * AudioContext and is not exercised here.
 *
 * Run with: npm test
 */

import { describe, expect, it } from 'vitest';

import {
  composeTrack,
  isMusicTrack,
  loopSeconds,
  MUSIC_TRACKS,
  musicTrack,
  positionAt,
  stepSeconds,
} from '../src/meeting/music.js';

const DRUMS = new Set(['kick', 'snare', 'hat', 'crackle']);

describe('track list', () => {
  it('has five tracks with valid, distinct ids', () => {
    expect(MUSIC_TRACKS).toHaveLength(5);
    const ids = MUSIC_TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(5);
    for (const t of MUSIC_TRACKS) {
      expect(t.id).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.bpm).toBeGreaterThan(0);
      expect(isMusicTrack(t.id)).toBe(true);
      expect(musicTrack(t.id)).toEqual(t);
    }
    expect(ids).toEqual(['lofi', 'bossa', 'arcade', 'synthwave', 'ambient']);
  });

  it('rejects unknown ids', () => {
    for (const id of ['', 'LOFI', 'jazz', 'lofi ', '__proto__', 'constructor']) {
      expect(isMusicTrack(id)).toBe(false);
      expect(musicTrack(id)).toBeUndefined();
      expect(() => composeTrack(id)).toThrow();
    }
  });
});

describe('composeTrack', () => {
  it('is deterministic: the same id composes the same score every time', () => {
    for (const { id } of MUSIC_TRACKS) expect(composeTrack(id)).toEqual(composeTrack(id));
  });

  it('gives each track its own score', () => {
    const scores = MUSIC_TRACKS.map((t) => JSON.stringify(composeTrack(t.id).notes));
    expect(new Set(scores).size).toBe(MUSIC_TRACKS.length);
  });

  it('keeps notes sorted, inside the loop, and well-formed', () => {
    for (const { id, bpm } of MUSIC_TRACKS) {
      const track = composeTrack(id);
      expect(track.id).toBe(id);
      expect(track.bpm).toBe(bpm);
      expect(track.stepsPerBeat).toBe(4);
      expect(track.loopSteps % 16).toBe(0);
      expect(track.notes.length).toBeGreaterThan(0);
      let prev = 0;
      for (const n of track.notes) {
        expect(n.step).toBeGreaterThanOrEqual(prev);
        expect(Number.isInteger(n.step)).toBe(true);
        expect(n.step).toBeGreaterThanOrEqual(0);
        expect(n.step).toBeLessThan(track.loopSteps);
        expect(n.lengthSteps).toBeGreaterThan(0);
        expect(n.velocity).toBeGreaterThan(0);
        expect(n.velocity).toBeLessThanOrEqual(1);
        if (DRUMS.has(n.voice)) expect(n.midi).toBe(0);
        else {
          expect(Number.isInteger(n.midi)).toBe(true);
          expect(n.midi).toBeGreaterThanOrEqual(24);
          expect(n.midi).toBeLessThanOrEqual(108);
        }
        prev = n.step;
      }
    }
  });

  it('keeps ambient drum-free and arcade on a short loop', () => {
    const ambient = composeTrack('ambient');
    for (const n of ambient.notes) expect(['kick', 'snare', 'hat']).not.toContain(n.voice);
    expect(ambient.notes.some((n) => n.voice === 'pad')).toBe(true);
    expect(composeTrack('arcade').loopSteps).toBe(128);
    expect(composeTrack('lofi').loopSteps).toBe(256);
  });

  it('gives each style its signature parts', () => {
    const voices = (id: string) => new Set(composeTrack(id).notes.map((n) => n.voice));
    expect(voices('lofi').has('crackle')).toBe(true);
    expect(voices('bossa').has('crackle')).toBe(false);
    expect(voices('synthwave').has('pad')).toBe(true);
    for (const id of ['lofi', 'bossa', 'arcade', 'synthwave'])
      expect(voices(id).has('kick') && voices(id).has('lead')).toBe(true);
    expect(composeTrack('lofi').swing).toBeGreaterThan(0);
    expect(composeTrack('bossa').swing).toBe(0);
  });

  it('keeps the melody background-sparse: lofi lead rests through most of the loop', () => {
    const track = composeTrack('lofi');
    const sounding = new Set<number>();
    for (const n of track.notes)
      if (n.voice === 'lead') for (let s = 0; s < n.lengthSteps; s++) sounding.add(n.step + s);
    expect(sounding.size).toBeGreaterThan(0);
    expect(sounding.size / track.loopSteps).toBeLessThan(0.6);
  });
});

describe('song time', () => {
  it('stepSeconds follows the tempo (16th-note steps)', () => {
    for (const { id, bpm } of MUSIC_TRACKS) {
      const track = composeTrack(id);
      expect(stepSeconds(track)).toBeCloseTo(60 / bpm / 4, 10);
      expect(loopSeconds(track)).toBeCloseTo(track.loopSteps * (60 / bpm / 4), 10);
    }
    expect(stepSeconds(composeTrack('ambient'))).toBeCloseTo(0.25, 10); // 60 bpm
  });

  it('positionAt starts at step 0 and walks the grid', () => {
    const track = composeTrack('lofi');
    const step = stepSeconds(track);
    expect(positionAt(track, 0)).toEqual({ step: 0, intoStep: 0 });
    const mid = positionAt(track, 5.5 * step);
    expect(mid.step).toBe(5);
    expect(mid.intoStep).toBeCloseTo(0.5 * step, 9);
  });

  it('positionAt wraps around the loop, however many loops have passed', () => {
    const track = composeTrack('arcade');
    const step = stepSeconds(track);
    const loop = loopSeconds(track);
    expect(positionAt(track, loop).step).toBe(0);
    const once = positionAt(track, loop + 3.25 * step);
    expect(once.step).toBe(3);
    expect(once.intoStep).toBeCloseTo(0.25 * step, 9);
    const later = positionAt(track, 40 * loop + 100.5 * step);
    expect(later.step).toBe(100);
    expect(later.intoStep).toBeCloseTo(0.5 * step, 6);
    const end = positionAt(track, loop - 1e-9);
    expect(end.step).toBe(track.loopSteps - 1);
    expect(end.intoStep).toBeGreaterThanOrEqual(0);
    expect(end.intoStep).toBeLessThan(step);
  });

  it('positionAt stays in range for odd offsets', () => {
    const track = composeTrack('bossa');
    for (const offset of [-1, -loopSeconds(track) * 2.5, Number.NaN, 1e7]) {
      const { step, intoStep } = positionAt(track, offset);
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThan(track.loopSteps);
      expect(intoStep).toBeGreaterThanOrEqual(0);
      expect(intoStep).toBeLessThan(stepSeconds(track) + 1e-9);
    }
  });
});
