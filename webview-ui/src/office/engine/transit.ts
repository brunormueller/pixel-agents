/**
 * Riding a portal (stairs, elevator) from one level to another.
 *
 * A path step that carries `portal` is not walked: the character stops on the
 * access tile and RIDES. The first half of the ride happens where it is
 * (climbing the stairs, sinking down them, stepping into the elevator), then it
 * is moved to the other end and the second half plays there (coming up out of
 * the stairwell, down the steps, out of the elevator). Up or down is the hop's
 * `rise` — the elevation difference of the two levels.
 *
 * Pure: the FSM advances it, the renderer asks transitLook how to draw it.
 */

import {
  TRANSIT_CLIMB_PX,
  TRANSIT_DOOR_PX,
  TRANSIT_ELEVATOR_BASE_SEC,
  TRANSIT_ELEVATOR_PER_LEVEL_SEC,
  TRANSIT_SINK_PX,
  TRANSIT_STAIRS_SEC,
  WALK_FRAME_DURATION_SEC,
} from '../../constants.js';
import type { Character, PathStep, PortalHop } from '../types.js';
import { Direction, TILE_SIZE } from '../types.js';

export function transitDuration(hop: PortalHop): number {
  if (hop.kind === 'stairs') return TRANSIT_STAIRS_SEC;
  return TRANSIT_ELEVATOR_BASE_SEC + TRANSIT_ELEVATOR_PER_LEVEL_SEC * Math.abs(hop.rise);
}

/** Start riding the portal `step` leads through, from where the character stands. */
export function startTransit(ch: Character, step: PathStep): void {
  if (!step.portal) return;
  ch.transit = {
    hop: step.portal,
    t: 0,
    from: { col: ch.tileCol, row: ch.tileRow },
    to: { col: step.col, row: step.row },
    arrived: false,
  };
  ch.x = ch.tileCol * TILE_SIZE + TILE_SIZE / 2;
  ch.y = ch.tileRow * TILE_SIZE + TILE_SIZE / 2;
  ch.moveProgress = 0;
  // Portals are entered from below: face into the stairs / the door.
  ch.dir = Direction.UP;
}

/**
 * Advance a ride. Halfway, the character moves to the other end; a path that
 * was replaced while riding (a new desk, a new target) is dropped there, so
 * whoever drives the character plans again from where it came out.
 */
export function advanceTransit(ch: Character, dt: number): void {
  const tr = ch.transit;
  if (!tr) return;
  tr.t += dt / transitDuration(tr.hop);
  // Legs keep moving on the stairs; still in the elevator.
  if (tr.hop.kind === 'stairs') {
    ch.frameTimer += dt;
    if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
      ch.frameTimer -= WALK_FRAME_DURATION_SEC;
      ch.frame = (ch.frame + 1) % 4;
    }
  } else {
    ch.frame = 0;
  }
  if (!tr.arrived && tr.t >= 0.5) {
    tr.arrived = true;
    ch.tileCol = tr.to.col;
    ch.tileRow = tr.to.row;
    ch.x = tr.to.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = tr.to.row * TILE_SIZE + TILE_SIZE / 2;
    const next = ch.path[0];
    if (next && next.portal && next.col === tr.to.col && next.row === tr.to.row) ch.path.shift();
    else ch.path = [];
    ch.dir = Direction.DOWN;
  }
  if (tr.t >= 1) {
    ch.transit = null;
    ch.frame = 0;
    ch.frameTimer = 0;
  }
}

/** How a riding character is drawn this frame. */
export interface TransitLook {
  /** Sprite px offset (negative = up the screen). */
  dy: number;
  alpha: number;
  /** Stairwell edge, sprite px from the character's feet (as if not riding):
   *  nothing below it is drawn. Null = not clipped. */
  clipDy: number | null;
}

export function transitLook(ch: Character): TransitLook | null {
  const tr = ch.transit;
  if (!tr) return null;
  const leaving = tr.t < 0.5;
  // 0 on the access tile, 1 inside the portal.
  const depth = leaving ? Math.min(1, tr.t / 0.5) : Math.max(0, 1 - (tr.t - 0.5) / 0.5);
  if (tr.hop.kind === 'elevator') {
    return { dy: -TRANSIT_DOOR_PX * depth, alpha: 1 - depth, clipDy: null };
  }
  const up = tr.hop.rise > 0;
  // Leaving upstairs = climbing the flight; leaving downstairs = going down into
  // the stairwell. Arriving is the other end of the same flight: stepping down
  // it downstairs, coming up out of the stairwell upstairs.
  const climbing = leaving ? up : !up;
  if (climbing) {
    return { dy: -TRANSIT_CLIMB_PX * depth, alpha: 1 - depth, clipDy: null };
  }
  // Walk up to the stairwell's front edge (half a tile ahead), then sink below it.
  const edge = TILE_SIZE / 2;
  const forward = Math.min(1, depth * 2) * edge;
  const sink = Math.max(0, depth * 2 - 1) * TRANSIT_SINK_PX;
  return { dy: -forward + sink, alpha: 1, clipDy: -edge };
}
