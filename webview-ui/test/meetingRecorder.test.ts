/**
 * Unit tests for the pure half of the meeting recorder
 * (`meeting/recorder.ts`): where each tile lands on the recorded canvas, what
 * the downloaded file is called, and which codec MediaRecorder is asked for.
 * The MeetingRecorder class itself needs a browser (canvas, Web Audio).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import type { Rect } from '../src/meeting/recorder.js';
import { layoutTiles, pickMimeType, recordingFileName } from '../src/meeting/recorder.js';

const W = 1280;
const H = 720;

function assertInside(rects: Rect[], w = W, h = H): void {
  for (const r of rects) {
    assert.ok(r.w > 0 && r.h > 0, `empty rect ${JSON.stringify(r)}`);
    assert.ok(
      r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h,
      `out of bounds ${JSON.stringify(r)}`,
    );
  }
}

function assertNoOverlap(rects: Rect[]): void {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      assert.ok(apart, `rects ${i} and ${j} overlap: ${JSON.stringify(a)} ${JSON.stringify(b)}`);
    }
  }
}

const assert16by9 = (r: Rect) =>
  assert.ok(Math.abs(r.w / r.h - 16 / 9) < 0.02, `not 16:9: ${JSON.stringify(r)}`);

test('no participants lay out no tiles', () => {
  assert.deepEqual(layoutTiles(0, 0, W, H), []);
});

test('a single camera fills most of the canvas at 16:9, centered', () => {
  const [r] = layoutTiles(0, 1, W, H);
  assertInside([r]);
  assert16by9(r);
  assert.ok((r.w * r.h) / (W * H) > 0.9, `too small: ${JSON.stringify(r)}`);
  assert.ok(Math.abs(r.x + r.w / 2 - W / 2) <= 1 && Math.abs(r.y + r.h / 2 - H / 2) <= 1);
});

test('four cameras make a 2x2 grid inside the canvas, no overlaps', () => {
  const rects = layoutTiles(0, 4, W, H);
  assert.equal(rects.length, 4);
  assertInside(rects);
  assertNoOverlap(rects);
  rects.forEach(assert16by9);
  assert.equal(new Set(rects.map((r) => r.x)).size, 2, 'two columns');
  assert.equal(new Set(rects.map((r) => r.y)).size, 2, 'two rows');
  assert.ok(rects[0].y === rects[1].y && rects[0].x < rects[1].x, 'row-major order');
});

test('screens take the top area and cameras a smaller filmstrip below', () => {
  const rects = layoutTiles(2, 3, W, H);
  assert.equal(rects.length, 5);
  assertInside(rects);
  assertNoOverlap(rects);
  const screens = rects.slice(0, 2);
  const cameras = rects.slice(2);
  const lowestScreen = Math.max(...screens.map((r) => r.y + r.h));
  for (const c of cameras) assert.ok(c.y >= lowestScreen, 'cameras sit below every screen');
  assert.equal(new Set(cameras.map((r) => r.y)).size, 1, 'cameras share one row');
  const minScreen = Math.min(...screens.map((r) => r.w * r.h));
  const maxCamera = Math.max(...cameras.map((r) => r.w * r.h));
  assert.ok(minScreen > maxCamera, 'every screen is bigger than every camera');
  assert.ok(lowestScreen > H / 2, 'screens get the big area');
});

test('screens alone use the whole canvas; gap separates neighbours', () => {
  const [a, b] = layoutTiles(2, 0, W, H, 20);
  assertInside([a, b]);
  assertNoOverlap([a, b]);
  assert.ok(b.x - (a.x + a.w) >= 20 || b.y - (a.y + a.h) >= 20);
});

test('many participants still fit inside the canvas without overlapping', () => {
  for (const [s, c] of [
    [0, 7],
    [1, 1],
    [3, 9],
    [0, 12],
  ]) {
    const rects = layoutTiles(s, c, W, H);
    assert.equal(rects.length, s + c);
    assertInside(rects);
    assertNoOverlap(rects);
  }
});

test('recordingFileName slugs the title, strips accents and zero-pads local time', () => {
  const d = new Date(2026, 0, 5, 9, 7);
  assert.equal(
    recordingFileName('Reunião de Planejamento!', d),
    'meeting-reuniao-de-planejamento-2026-01-05-0907.webm',
  );
  assert.equal(
    recordingFileName('  Café & Código  ', d),
    'meeting-cafe-codigo-2026-01-05-0907.webm',
  );
});

test('recordingFileName falls back to "meeting" and caps the slug at 40 chars', () => {
  const d = new Date(2026, 11, 31, 23, 59);
  assert.equal(recordingFileName('', d), 'meeting-meeting-2026-12-31-2359.webm');
  assert.equal(recordingFileName('!!! ???', d), 'meeting-meeting-2026-12-31-2359.webm');
  const long = recordingFileName('a'.repeat(39) + ' bcdef', d);
  const slug = long.slice('meeting-'.length, -'-2026-12-31-2359.webm'.length);
  assert.ok(slug.length <= 40 && !slug.endsWith('-'), slug);
});

test('pickMimeType takes the first supported candidate, or nothing', () => {
  assert.equal(
    pickMimeType(() => true),
    'video/webm;codecs=vp9,opus',
  );
  assert.equal(
    pickMimeType((t) => !t.includes('vp9')),
    'video/webm;codecs=vp8,opus',
  );
  assert.equal(
    pickMimeType((t) => t === 'video/webm'),
    'video/webm',
  );
  assert.equal(
    pickMimeType(() => false),
    '',
  );
});
