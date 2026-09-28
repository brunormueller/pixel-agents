// webview-ui/src/office/engine/chat.ts
//
// Multiplayer chat: which character speaks a message, and how its speech bubble
// animates over time. Pure (no DOM, no React) so it is Node-testable; the
// ChatBubbles overlay only projects and paints what these functions decide.

import {
  CHAT_BUBBLE_BASE_MS,
  CHAT_BUBBLE_FADE_MS,
  CHAT_BUBBLE_MAX_MS,
  CHAT_BUBBLE_MIN_MS,
  CHAT_BUBBLE_PER_CHAR_MS,
  CHAT_BUBBLE_TYPE_MS_PER_CHAR,
} from '../../constants.js';

/** A speech bubble over one character. At most one per character: a new message replaces it. */
export interface ChatBubble {
  /** Unique per message, so React restarts the pop-in animation on replacement. */
  key: number;
  charId: number;
  text: string;
  startedAt: number;
  durationMs: number;
}

/** Reading time: long messages stay up longer, within bounds. */
export function bubbleDurationMs(text: string): number {
  const len = Array.from(text).length;
  return Math.min(
    CHAT_BUBBLE_MAX_MS,
    Math.max(CHAT_BUBBLE_MIN_MS, CHAT_BUBBLE_BASE_MS + len * CHAT_BUBBLE_PER_CHAR_MS),
  );
}

/**
 * The local character that speaks this office's messages: the selected agent
 * when it is one of ours, otherwise the oldest local agent. Local agents have
 * positive ids; sub-agents, remote characters and the greeter are negative.
 * Null when the office shows no agent — the message then lives only in the panel.
 */
export function pickLocalSpeaker(
  characterIds: Iterable<number>,
  selectedId: number | null,
): number | null {
  let oldest: number | null = null;
  for (const id of characterIds) {
    if (id <= 0) continue;
    if (id === selectedId) return id;
    if (oldest === null || id < oldest) oldest = id;
  }
  return oldest;
}

/** Replace any bubble the speaker already has, and drop expired ones. */
export function pushBubble(bubbles: ChatBubble[], next: ChatBubble, now: number): ChatBubble[] {
  return [
    ...bubbles.filter((b) => b.charId !== next.charId && now - b.startedAt < b.durationMs),
    next,
  ];
}

export interface BubbleFrame {
  /** Typewriter-revealed prefix of the text. */
  visibleText: string;
  /** The rest, still to be typed (rendered invisible to reserve the bubble's final size). */
  hiddenText: string;
  opacity: number;
  expired: boolean;
}

/** What a bubble looks like `now`: typewriter reveal, then hold, then fade. */
export function bubbleFrame(bubble: ChatBubble, now: number): BubbleFrame {
  const elapsed = now - bubble.startedAt;
  if (elapsed >= bubble.durationMs) {
    return { visibleText: '', hiddenText: '', opacity: 0, expired: true };
  }
  const chars = Array.from(bubble.text);
  const shown = Math.max(
    0,
    Math.min(chars.length, Math.floor(elapsed / CHAT_BUBBLE_TYPE_MS_PER_CHAR) + 1),
  );
  const remaining = bubble.durationMs - elapsed;
  return {
    visibleText: chars.slice(0, shown).join(''),
    hiddenText: chars.slice(shown).join(''),
    opacity: remaining < CHAT_BUBBLE_FADE_MS ? remaining / CHAT_BUBBLE_FADE_MS : 1,
    expired: false,
  };
}
