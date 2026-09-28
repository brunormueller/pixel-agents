import { useEffect, useState } from 'react';

import {
  CHARACTER_SITTING_OFFSET_PX,
  CHAT_BUBBLE_MAX_WIDTH_PX,
  CHAT_BUBBLE_RISE_PX,
  CHAT_BUBBLE_Z_INDEX,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../../constants.js';
import { isSeatedPose } from '../engine/characters.js';
import type { ChatBubble } from '../engine/chat.js';
import { bubbleFrame } from '../engine/chat.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';

interface ChatBubblesProps {
  officeState: OfficeState;
  bubbles: ChatBubble[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/** Tail: three shrinking squares from the bubble down toward the speaker's head. */
const TAIL = [
  { dx: -4, dy: 0, size: 10 },
  { dx: -3, dy: 10, size: 7 },
  { dx: -2, dy: 18, size: 4 },
];

/**
 * Chat speech bubbles over the characters that spoke (multiplayer chat). Pops
 * in, types the text out, holds, fades. Follows the character as it walks, so
 * it re-projects every animation frame while any bubble is alive.
 */
export function ChatBubbles({
  officeState,
  bubbles,
  containerRef,
  zoom,
  panRef,
}: ChatBubblesProps) {
  const [now, setNow] = useState(() => Date.now());
  const alive = bubbles.some((b) => !bubbleFrame(b, now).expired);

  useEffect(() => {
    if (!alive) return;
    let rafId = 0;
    const tick = () => {
      setNow(Date.now());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [alive]);

  // A new bubble arrives while the loop is stopped: restart from the real clock.
  useEffect(() => {
    setNow(Date.now());
  }, [bubbles]);

  const el = containerRef.current;
  if (!el || !alive) return null;
  const project = overlayProjection(
    officeState.getView(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );

  return (
    <>
      {bubbles.map((bubble) => {
        const frame = bubbleFrame(bubble, now);
        if (frame.expired) return null;
        const ch = officeState.characters.get(bubble.charId);
        if (!ch || !officeState.isOnView(ch)) return null;
        const sittingOffset = isSeatedPose(ch) ? CHARACTER_SITTING_OFFSET_PX : 0;
        const x = project.toScreenX(ch.x);
        const y = project.toScreenY(ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET);
        const bottom = y - CHAT_BUBBLE_RISE_PX;

        return (
          <div
            key={bubble.key}
            className="absolute"
            style={{
              left: x,
              top: bottom,
              zIndex: CHAT_BUBBLE_Z_INDEX,
              pointerEvents: 'none',
              opacity: frame.opacity,
            }}
            data-testid="chat-bubble"
            data-agent-id={bubble.charId}
          >
            {TAIL.map(({ dx, dy, size }, i) => (
              <div
                key={i}
                aria-hidden
                className="absolute"
                style={{
                  left: dx,
                  top: dy,
                  width: size,
                  height: size,
                  background: 'var(--color-bg)',
                  border: '2px solid var(--color-border)',
                }}
              />
            ))}
            {/* Centering lives on this wrapper so the pop-in's scale transform doesn't override it. */}
            <div className="absolute bottom-0 left-0" style={{ transform: 'translateX(-50%)' }}>
              <div
                className="chat-bubble-pop pixel-panel py-4 px-8 text-sm leading-[1.3]"
                style={{
                  width: 'max-content',
                  maxWidth: CHAT_BUBBLE_MAX_WIDTH_PX,
                  overflowWrap: 'anywhere',
                }}
              >
                {frame.visibleText}
                {/* Invisible remainder reserves the final size, so the bubble doesn't grow as it types. */}
                <span style={{ visibility: 'hidden' }}>{frame.hiddenText}</span>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
