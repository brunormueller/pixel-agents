import { useEffect, useState } from 'react';

import {
  CHARACTER_SITTING_OFFSET_PX,
  EMOTE_EMOJI_SIZE_PX,
  EMOTE_FLOAT_RISE_PX,
  EMOTE_NOTE_INTERVAL_SEC,
  NAME_TAG_Z_INDEX,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../../constants.js';
import { isSeatedPose } from '../engine/characters.js';
import { EMOTES } from '../engine/emotes.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';

interface EmoteOverlayProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/** Fraction of a float's life after which it starts fading. */
const FADE_FROM = 0.6;
/** Dance notes drift sideways, alternating, by this many CSS px. */
const NOTE_DRIFT_PX = 10;

/**
 * The emoji of every emote in play, floating up from the character's head —
 * a reaction's emoji once, a dance's notes over and over. Characters move, so
 * it re-projects every frame (the renderer draws the motion itself).
 */
export function EmoteOverlay({ officeState, containerRef, zoom, panRef }: EmoteOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const project = overlayProjection(
    officeState.getView(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );

  const floats: Array<{ key: string; x: number; y: number; emoji: string; life: number }> = [];
  for (const ch of officeState.characters.values()) {
    const emote = ch.emote;
    if (!emote || ch.matrixEffect !== null || !officeState.isOnView(ch)) continue;
    const def = EMOTES[emote.kind];
    if (!def.emoji) continue;
    const sitting = isSeatedPose(ch) ? CHARACTER_SITTING_OFFSET_PX : 0;
    const x = project.toScreenX(ch.x);
    const y = project.toScreenY(ch.y + sitting - TOOL_OVERLAY_VERTICAL_OFFSET);
    if (def.duration === Infinity) {
      // Looping (dance): one note per interval, each floating for one interval.
      const n = Math.floor(emote.t / EMOTE_NOTE_INTERVAL_SEC);
      const life = (emote.t % EMOTE_NOTE_INTERVAL_SEC) / EMOTE_NOTE_INTERVAL_SEC;
      const side = n % 2 === 0 ? -1 : 1;
      floats.push({
        key: `${ch.id}:${emote.seq}:${n}`,
        x: x + side * NOTE_DRIFT_PX * life,
        y,
        emoji: n % 3 === 2 ? '🎵' : def.emoji,
        life,
      });
    } else {
      floats.push({
        key: `${ch.id}:${emote.seq}`,
        x,
        y,
        emoji: def.emoji,
        life: Math.min(1, emote.t / def.duration),
      });
    }
  }
  if (floats.length === 0) return null;

  return (
    <>
      {floats.map((f) => (
        <div
          key={f.key}
          aria-hidden
          className="absolute -translate-x-1/2 -translate-y-full leading-none select-none"
          style={{
            left: f.x,
            top: f.y - EMOTE_FLOAT_RISE_PX * f.life,
            fontSize: EMOTE_EMOJI_SIZE_PX,
            opacity: f.life < FADE_FROM ? 1 : (1 - f.life) / (1 - FADE_FROM),
            zIndex: NAME_TAG_Z_INDEX + 1,
            pointerEvents: 'none',
          }}
          data-testid="emote-float"
        >
          {f.emoji}
        </div>
      ))}
    </>
  );
}
