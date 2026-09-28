import { useEffect, useState } from 'react';

import { DESK_MARKER_SIZE_PX, DESK_PICKER_Z_INDEX } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';
import { TILE_SIZE } from '../types.js';

interface DeskPickerProps {
  officeState: OfficeState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  /** Shown above the hint, e.g. "Ana took your desk." */
  notice: string | null;
  onPick: (seatId: string) => void;
  onCancel: () => void;
}

/**
 * "Choose your desk": a marker on every chair of the (shared) office. Free ones
 * are clickable; taken ones are dimmed; yours is highlighted. Follows pan and
 * zoom, so it re-projects every animation frame while open.
 */
export function DeskPicker({
  officeState,
  containerRef,
  zoom,
  panRef,
  notice,
  onPick,
  onCancel,
}: DeskPickerProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  const el = containerRef.current;
  if (!el) return null;
  const project = overlayProjection(
    officeState.getView(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    window.devicePixelRatio || 1,
  );
  const mine = officeState.getDesk();

  return (
    <>
      <div
        className="absolute top-10 left-1/2 -translate-x-1/2 pixel-panel py-6 px-12 flex items-center gap-10 text-sm"
        style={{ zIndex: DESK_PICKER_Z_INDEX + 1 }}
        data-testid="desk-picker"
      >
        <span>
          {notice && <span className="text-warning">{notice} </span>}
          Choose your desk: click a green chair.
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="bg-btn-bg border-2 border-border text-text text-sm cursor-pointer px-8 py-1"
        >
          {mine ? 'Done' : 'Later'}
        </button>
      </div>
      {[...officeState.seats.entries()].map(([uid, seat]) => {
        // Chairs on the level on screen (switch levels to pick one elsewhere).
        if (!officeState.isOnView({ tileCol: seat.seatCol })) return null;
        const isMine = uid === mine;
        const free = isMine || officeState.isDeskAvailable(uid);
        const x = project.toScreenX(seat.seatCol * TILE_SIZE + TILE_SIZE / 2);
        const y = project.toScreenY(seat.seatRow * TILE_SIZE + TILE_SIZE / 2);
        return (
          <button
            key={uid}
            type="button"
            disabled={!free}
            title={isMine ? 'Your desk' : free ? 'Take this desk' : 'Taken'}
            aria-label={isMine ? 'Your desk' : free ? 'Free desk' : 'Taken desk'}
            data-testid="desk-marker"
            data-seat-id={uid}
            data-free={free}
            onClick={() => onPick(uid)}
            className="absolute -translate-x-1/2 -translate-y-1/2 p-0 rounded-none"
            style={{
              left: x,
              top: y,
              width: DESK_MARKER_SIZE_PX,
              height: DESK_MARKER_SIZE_PX,
              zIndex: DESK_PICKER_Z_INDEX,
              cursor: free ? 'pointer' : 'not-allowed',
              opacity: free ? 0.9 : 0.35,
              border: '2px solid var(--color-border)',
              background: isMine
                ? 'var(--color-accent)'
                : free
                  ? 'var(--color-status-success)'
                  : 'var(--color-danger)',
            }}
          />
        );
      })}
    </>
  );
}
