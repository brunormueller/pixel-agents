import { useEffect, useState } from 'react';

import { StatusDot } from '../../components/StatusMenu.js';
import {
  CHARACTER_SITTING_OFFSET_PX,
  NAME_TAG_OFFSET_PX,
  NAME_TAG_Z_INDEX,
  STATUS_DOT_PX,
} from '../../constants.js';
import { isSeatedPose } from '../engine/characters.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';

interface NameTagsProps {
  officeState: OfficeState;
  /** This office's person's name. */
  selfName: string;
  /** Meeting badges ("📞", "✋📞") per person: 'self' or the office's peerId. */
  badges?: Record<string, string>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

/** A name under every person in the room — yours and the other offices' —
 *  with their status and, when they share it, the song they listen to. */
export function NameTags({
  officeState,
  selfName,
  badges = {},
  containerRef,
  zoom,
  panRef,
}: NameTagsProps) {
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

  return (
    <>
      {[...officeState.characters.values()].map((ch) => {
        if (!ch.isAvatar || ch.matrixEffect !== null || !officeState.isOnView(ch)) return null;
        const name = ch.isRemote ? ch.remotePeerName : selfName;
        if (!name) return null;
        const sitting = isSeatedPose(ch) ? CHARACTER_SITTING_OFFSET_PX : 0;
        const status = ch.personStatus;
        const badge = badges[ch.isRemote ? (ch.remotePeerId ?? '') : 'self'];
        return (
          <div
            key={ch.id}
            className="absolute -translate-x-1/2 flex flex-col items-center gap-1"
            style={{
              left: project.toScreenX(ch.x),
              top: project.toScreenY(ch.y + sitting) + NAME_TAG_OFFSET_PX,
              zIndex: NAME_TAG_Z_INDEX,
              pointerEvents: 'none',
            }}
            data-testid="name-tag"
          >
            <div
              className="flex items-center gap-4 whitespace-nowrap text-2xs leading-none px-4 py-1 bg-bg-dark border-2 border-border"
              style={{ color: ch.isRemote ? 'var(--color-text)' : 'var(--color-accent-bright)' }}
              title={ch.statusText || undefined}
            >
              {status && <StatusDot status={status} size={STATUS_DOT_PX} />}
              {name}
              {badge && (
                <span title="In a call" data-testid="call-badge">
                  {badge}
                </span>
              )}
            </div>
            {ch.statusText && (
              <div
                className="whitespace-nowrap text-2xs leading-none px-4 py-1 bg-bg-dark text-text-muted"
                style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}
                data-testid="status-tag"
              >
                {ch.statusText}
              </div>
            )}
            {ch.music && (
              <div
                className="whitespace-nowrap text-2xs leading-none px-4 py-1 bg-bg-dark text-text"
                style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}
                data-testid="music-tag"
              >
                ♪ {ch.music.artist ? `${ch.music.artist} – ` : ''}
                {ch.music.title}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
