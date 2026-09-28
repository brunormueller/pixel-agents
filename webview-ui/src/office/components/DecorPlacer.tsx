import { useEffect, useRef, useState } from 'react';

import type { DeskDecorItem } from '../../../../core/src/messages.js';
import { SpriteThumb } from '../../components/ui/SpriteThumb.js';
import { DECOR_PLACER_Z_INDEX } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { overlayProjection } from '../projection.js';

interface DecorPlacerProps {
  officeState: OfficeState;
  /** The catalog variant being placed (its ghost follows the mouse), or null. */
  type: string | null;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onPlace: (item: DeskDecorItem) => void;
  /** Click on one of your items with nothing in hand: pick it up to move it. */
  onPickUp: (index: number) => void;
  /** Right-click on one of your items. */
  onRemove: (index: number) => void;
  /** Click on an item that came with the desk (the room's computer): take it off and hold it. */
  onTakeOff: (uid: string, type: string) => void;
  /** Right-click on an item that came with the desk: just take it off. */
  onHide: (uid: string) => void;
  /** R: the next orientation of the item in hand. */
  onRotate: () => void;
  onCancel: () => void;
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

const onOfficeCanvas = (e: Event): boolean =>
  !!(e.target as Element | null)?.closest?.('[data-office-canvas]');

/**
 * Decorating the desk, on the map itself: the item in hand follows the mouse
 * as a ghost — green where it stands on your desk's tabletop (or its floor
 * or wall spot), red where it doesn't — and a click puts it down, to the
 * pixel. With nothing in hand, a click picks up one of your items to move it
 * and a right-click removes it. Clicks on the map go here, not to the office,
 * while it is open; the middle button still pans.
 */
export function DecorPlacer({
  officeState,
  type,
  containerRef,
  zoom,
  panRef,
  onPlace,
  onPickUp,
  onRemove,
  onTakeOff,
  onHide,
  onRotate,
  onCancel,
}: DecorPlacerProps) {
  const [, setTick] = useState(0);
  const mouse = useRef<{ x: number; y: number } | null>(null);
  // Latest props for the window listeners, which are registered once.
  const latest = useRef({
    type,
    zoom,
    onPlace,
    onPickUp,
    onRemove,
    onTakeOff,
    onHide,
    onRotate,
    onCancel,
  });
  latest.current = {
    type,
    zoom,
    onPlace,
    onPickUp,
    onRemove,
    onTakeOff,
    onHide,
    onRotate,
    onCancel,
  };

  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const toWorld = (clientX: number, clientY: number) => {
      const el = containerRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const p = overlayProjection(
        officeState.getView(),
        rect,
        latest.current.zoom,
        panRef.current,
        window.devicePixelRatio || 1,
      );
      return {
        x: p.toWorldLength(clientX - rect.left - p.toScreenX(0)),
        y: p.toWorldLength(clientY - rect.top - p.toScreenY(0)),
      };
    };
    const onMove = (e: MouseEvent) => {
      mouse.current = onOfficeCanvas(e) ? toWorld(e.clientX, e.clientY) : null;
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0 || !onOfficeCanvas(e)) return;
      const w = toWorld(e.clientX, e.clientY);
      if (!w) return;
      e.stopPropagation();
      e.preventDefault();
      const held = latest.current.type;
      if (held) {
        const placement = officeState.decorPlacementAt(held, w.x, w.y);
        if (placement?.valid) latest.current.onPlace(placement.item);
      } else {
        const index = officeState.decorAt(w.x, w.y);
        if (index !== null) {
          latest.current.onPickUp(index);
          return;
        }
        const layoutItem = officeState.deskLayoutItemAt(w.x, w.y);
        if (layoutItem) latest.current.onTakeOff(layoutItem.uid, layoutItem.type);
      }
    };
    const swallow = (e: MouseEvent) => {
      if (e.button === 0 && onOfficeCanvas(e)) e.stopPropagation();
    };
    const onContext = (e: MouseEvent) => {
      if (!onOfficeCanvas(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const w = toWorld(e.clientX, e.clientY);
      const index = w ? officeState.decorAt(w.x, w.y) : null;
      const layoutItem = w && index === null ? officeState.deskLayoutItemAt(w.x, w.y) : null;
      if (index !== null) latest.current.onRemove(index);
      else if (layoutItem) latest.current.onHide(layoutItem.uid);
      else if (latest.current.type) latest.current.onCancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape') latest.current.onCancel();
      else if (e.key.toLowerCase() === 'r' && latest.current.type && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        latest.current.onRotate();
      }
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mouseup', swallow, true);
    window.addEventListener('click', swallow, true);
    window.addEventListener('contextmenu', onContext, true);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mouseup', swallow, true);
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [officeState, containerRef, panRef]);

  const el = containerRef.current;
  if (!el) return null;
  const dpr = window.devicePixelRatio || 1;
  const project = overlayProjection(
    officeState.getView(),
    el.getBoundingClientRect(),
    zoom,
    panRef.current,
    dpr,
  );
  const scale = zoom / dpr;
  const at = mouse.current;
  const placement = type && at ? officeState.decorPlacementAt(type, at.x, at.y) : null;
  const hovered =
    !type && at
      ? officeState
          .decorPieces()
          .find((p) => p.owner === 'self' && p.index === officeState.decorAt(at.x, at.y))
      : undefined;
  // Something that came with the desk (the room's computer, a mug): it can be taken off.
  const hoveredLayout = !type && at && !hovered ? officeState.deskLayoutItemAt(at.x, at.y) : null;
  const rectStyle = (r: { x0: number; y0: number; x1: number; y1: number }) => ({
    left: project.toScreenX(r.x0),
    top: project.toScreenY(r.y0),
    width: (r.x1 - r.x0 + 1) * scale,
    height: (r.y1 - r.y0 + 1) * scale,
  });

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: DECOR_PLACER_Z_INDEX }}
      data-testid="decor-placer"
    >
      {type &&
        officeState
          .decorSurfaces()
          .map((r, i) => (
            <div
              key={i}
              className="absolute border border-dashed border-accent-bright opacity-60"
              style={rectStyle(r)}
            />
          ))}
      {placement && (
        <div
          className="absolute"
          data-testid="decor-ghost"
          data-valid={placement.valid}
          style={{
            left: project.toScreenX(placement.instance.x),
            top: project.toScreenY(placement.instance.y),
            opacity: placement.valid ? 0.85 : 0.5,
            filter: `drop-shadow(0 0 1px var(${placement.valid ? '--color-status-success' : '--color-danger'}))`,
            transform: placement.instance.mirrored ? 'scaleX(-1)' : undefined,
          }}
        >
          <SpriteThumb
            sprite={placement.instance.sprite}
            width={(placement.instance.sprite[0]?.length ?? 0) * scale}
            height={placement.instance.sprite.length * scale}
          />
        </div>
      )}
      {hovered && (
        <div className="absolute border-2 border-accent-bright" style={rectStyle(hovered.box)} />
      )}
      {hoveredLayout && (
        <div
          className="absolute border-2 border-dashed border-warning"
          style={rectStyle(hoveredLayout.box)}
          data-testid="decor-layout-hover"
        />
      )}
    </div>
  );
}
