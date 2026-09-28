/**
 * Unit tests for the multiplayer chat logic (`office/engine/chat.ts`): who
 * speaks a message, and how its speech bubble animates. Pure, no React.
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  CHAT_BUBBLE_FADE_MS,
  CHAT_BUBBLE_MAX_MS,
  CHAT_BUBBLE_MIN_MS,
  CHAT_BUBBLE_TYPE_MS_PER_CHAR,
} from '../src/constants.js';
import type { ChatBubble } from '../src/office/engine/chat.js';
import {
  bubbleDurationMs,
  bubbleFrame,
  pickLocalSpeaker,
  pushBubble,
} from '../src/office/engine/chat.js';

const bubble = (overrides: Partial<ChatBubble> = {}): ChatBubble => ({
  key: 0,
  charId: 1,
  text: 'hello',
  startedAt: 1000,
  durationMs: 5000,
  ...overrides,
});

test('bubble duration grows with the text, within bounds', () => {
  assert.equal(bubbleDurationMs('oi'), CHAT_BUBBLE_MIN_MS);
  assert.equal(bubbleDurationMs('x'.repeat(1000)), CHAT_BUBBLE_MAX_MS);
  assert.ok(bubbleDurationMs('x'.repeat(60)) > bubbleDurationMs('x'.repeat(30)));
});

test('the selected local agent speaks; otherwise the oldest local agent', () => {
  // Sub-agents, remote characters and the greeter have non-positive ids.
  const ids = [-1, 5, -1_000_000, 3, 9];
  assert.equal(pickLocalSpeaker(ids, 9), 9);
  assert.equal(pickLocalSpeaker(ids, null), 3);
  // A selected sub-agent or remote character never speaks for this office.
  assert.equal(pickLocalSpeaker(ids, -1_000_000), 3);
  assert.equal(pickLocalSpeaker([-1, -1_000_000], null), null);
});

test('a new message replaces the speaker’s bubble and prunes expired ones', () => {
  const old = bubble({ key: 1, charId: 1 });
  const other = bubble({ key: 2, charId: 2 });
  const expired = bubble({ key: 3, charId: 3, startedAt: 0, durationMs: 100 });
  const next = bubble({ key: 4, charId: 1, text: 'again', startedAt: 2000 });
  assert.deepEqual(
    pushBubble([old, other, expired], next, 2000).map((b) => b.key),
    [2, 4],
  );
});

test('a bubble types out, holds, fades, then expires', () => {
  const b = bubble({ text: 'hello', startedAt: 0, durationMs: 5000 });
  assert.deepEqual(bubbleFrame(b, 0), {
    visibleText: 'h',
    hiddenText: 'ello',
    opacity: 1,
    expired: false,
  });
  assert.equal(bubbleFrame(b, CHAT_BUBBLE_TYPE_MS_PER_CHAR * 2).visibleText, 'hel');
  assert.deepEqual(bubbleFrame(b, 2000), {
    visibleText: 'hello',
    hiddenText: '',
    opacity: 1,
    expired: false,
  });
  const fading = bubbleFrame(b, 5000 - CHAT_BUBBLE_FADE_MS / 2);
  assert.ok(fading.opacity > 0 && fading.opacity < 1);
  assert.equal(bubbleFrame(b, 5000).expired, true);
});

test('typing never splits a character made of two UTF-16 units', () => {
  const b = bubble({ text: '👋🏓', startedAt: 0 });
  assert.deepEqual(bubbleFrame(b, 0), {
    visibleText: '👋',
    hiddenText: '🏓',
    opacity: 1,
    expired: false,
  });
});
