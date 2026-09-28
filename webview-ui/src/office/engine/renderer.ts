import type { ColorValue } from '../../components/ui/types.js';
import {
  AREA_ACTIVE_ALPHA_MULTIPLIER,
  AREA_LABEL_ALPHA,
  AREA_LABEL_FALLBACK_COLOR,
  AREA_LABEL_FONT_SIZE_PX,
  AREA_LABEL_MIN_FONT_SIZE_PX,
  AREA_LABEL_SHADOW_ALPHA,
  AREA_LABEL_SHADOW_COLOR,
  AREA_OVERLAY_ALPHA,
  BUBBLE_FADE_DURATION_SEC,
  BUBBLE_SITTING_OFFSET_PX,
  BUBBLE_VERTICAL_OFFSET_PX,
  BUTTON_ICON_COLOR,
  BUTTON_ICON_SIZE_FACTOR,
  BUTTON_LINE_WIDTH_MIN,
  BUTTON_LINE_WIDTH_ZOOM_FACTOR,
  BUTTON_MIN_RADIUS,
  BUTTON_RADIUS_ZOOM_FACTOR,
  CARPET_DEFAULT_ACCENT_COLOR,
  CARPET_DEFAULT_COLOR,
  CHARACTER_SITTING_OFFSET_PX,
  CHARACTER_Z_SORT_OFFSET,
  DELETE_BUTTON_BG,
  FALLBACK_FLOOR_COLOR,
  GAME_CELEBRATE_HOP_PX,
  GAME_CELEBRATE_HOPS_PER_SEC,
  GHOST_BORDER_HOVER_FILL,
  GHOST_BORDER_HOVER_STROKE,
  GHOST_BORDER_STROKE,
  GHOST_INVALID_TINT,
  GHOST_PREVIEW_SPRITE_ALPHA,
  GHOST_PREVIEW_TINT_ALPHA,
  GHOST_VALID_TINT,
  GRID_LINE_COLOR,
  HEADLESS_CHARACTER_ALPHA,
  HOVERED_OUTLINE_ALPHA,
  OUTLINE_Z_SORT_OFFSET,
  ROTATE_BUTTON_BG,
  SCOREBOARD_COLOR,
  SCOREBOARD_FONT_SIZE_PX,
  SCOREBOARD_MIN_FONT_SIZE_PX,
  SCOREBOARD_SHADOW_COLOR,
  SEAT_AVAILABLE_COLOR,
  SEAT_BUSY_COLOR,
  SEAT_OWN_COLOR,
  SELECTED_OUTLINE_ALPHA,
  SELECTION_DASH_PATTERN,
  SELECTION_HIGHLIGHT_COLOR,
  TRANSIT_LABEL_DOWN_COLOR,
  TRANSIT_LABEL_FONT_SIZE_PX,
  TRANSIT_LABEL_MIN_FONT_SIZE_PX,
  TRANSIT_LABEL_SHADOW_COLOR,
  TRANSIT_LABEL_UP_COLOR,
  VOID_TILE_DASH_PATTERN,
  VOID_TILE_OUTLINE_COLOR,
} from '../../constants.js';
import { getColorizedFloorSprite, hasFloorSprites, WALL_COLOR } from '../floorTiles.js';
import type { GridRect } from '../layout/levels.js';
import { mapOffset } from '../projection.js';
import {
  getCarpetJunctionSprite,
  getCarpetPaletteKey,
  hasCarpetSprites,
} from '../sprites/carpetTiles.js';
import { getPetSprites } from '../sprites/petSpriteData.js';
import { getCachedSprite, getOutlineSprite } from '../sprites/spriteCache.js';
import {
  BUBBLE_HEART_SPRITE,
  BUBBLE_PERMISSION_SPRITE,
  BUBBLE_WAITING_SPRITE,
  getCharacterSprites,
} from '../sprites/spriteData.js';
import type {
  AreaDefinition,
  CarpetTile,
  Character,
  FurnitureInstance,
  GameBall,
  Pet,
  Scoreboard,
  Seat,
  SpriteData,
  TileType as TileTypeVal,
  TransitLabel,
} from '../types.js';
import { TILE_SIZE, TileType } from '../types.js';
import { getWallInstances, hasWallSprites, wallColorToHex } from '../wallTiles.js';
import { getCharacterSprite, isSeatedPose } from './characters.js';
import { emoteLook } from './emotes.js';
import { renderMatrixEffect } from './matrixEffect.js';
import { getPetSpriteData } from './petEntity.js';
import { transitLook } from './transit.js';

/** Loop bounds of `rect` clamped to a cols × rows grid (the whole grid without a rect). */
function spanOf(
  rect: GridRect | undefined,
  cols: number,
  rows: number,
): { c0: number; c1: number; r0: number; r1: number } {
  if (!rect) return { c0: 0, c1: cols, r0: 0, r1: rows };
  return {
    c0: Math.max(0, rect.col),
    c1: Math.min(cols, rect.col + rect.cols),
    r0: Math.max(0, rect.row),
    r1: Math.min(rows, rect.row + rect.rows),
  };
}

// ── Settings ────────────────────────────────────────────────────

/**
 * "Display headless as ghosts" — whether headless agents render translucent.
 * Module state rather than a render param: the rAF loop reads it every frame,
 * so a toggle takes effect on the next one without threading a 21st argument
 * through renderFrame. Same shape as setProviderCapabilities / setSoundEnabled.
 * Mirrors the server default (off) — the cue is opt-in, so an office looks the
 * same as it did before the setting existed until someone turns it on.
 */
let ghostHeadlessAgents = false;

export function setGhostHeadlessAgents(enabled: boolean): void {
  ghostHeadlessAgents = enabled;
}

export function isGhostHeadlessAgentsEnabled(): boolean {
  return ghostHeadlessAgents;
}

// ── Render functions ────────────────────────────────────────────

/**
 * Render the carpet layer. Called AFTER renderTileGrid and BEFORE seat
 * indicators / characters / furniture.
 *
 * Per junction (cols+1 × rows+1 grid of corners), we gather every
 * (variant, palette) pair from the up-to-4 adjacent tiles. Each pair becomes
 * one local "layer" drawn in ascending `order`, so the highest-order carpet
 * visually wins at overlaps. Sprite anchor: each 16×16 junction sprite is
 * centered on the corner — drawn at (offsetX + jx*s - halfS, offsetY + jy*s - halfS).
 *
 * @internal
 */
export function renderCarpetLayer(
  ctx: CanvasRenderingContext2D,
  carpetTiles: Array<CarpetTile | null>,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  rect?: GridRect,
): void {
  if (!hasCarpetSprites()) return;
  if (!carpetTiles || carpetTiles.length === 0) return;

  const s = TILE_SIZE * zoom;
  const halfS = s / 2;
  const { c0, c1, r0, r1 } = spanOf(rect, cols, rows);

  for (let jy = r0; jy <= r1; jy++) {
    for (let jx = c0; jx <= c1; jx++) {
      const localGroups = new Map<
        string,
        {
          variant: number;
          color: ColorValue;
          accentColor: ColorValue;
          paletteKey: string;
          order: number;
        }
      >();

      const adjacent = [
        { col: jx - 1, row: jy - 1 }, // NW
        { col: jx, row: jy - 1 }, // NE
        { col: jx, row: jy }, // SE
        { col: jx - 1, row: jy }, // SW
      ];

      for (const pos of adjacent) {
        if (pos.col < 0 || pos.row < 0 || pos.col >= cols || pos.row >= rows) continue;
        const tile = carpetTiles[pos.row * cols + pos.col];
        if (!tile) continue;
        const color = tile.color ?? CARPET_DEFAULT_COLOR;
        const accentColor = tile.accentColor ?? CARPET_DEFAULT_ACCENT_COLOR;
        const paletteKey = getCarpetPaletteKey(color, accentColor);
        const key = `${tile.variant}:${paletteKey}`;
        const order = tile.order ?? 0;
        const existing = localGroups.get(key);
        if (!existing || order > existing.order) {
          localGroups.set(key, { variant: tile.variant, color, accentColor, paletteKey, order });
        }
      }

      if (localGroups.size === 0) continue;

      // Ascending order → drawn lowest first; highest-order layer ends on top.
      const ordered = [...localGroups.values()].sort((a, b) => a.order - b.order);
      for (const { variant, color, accentColor, paletteKey } of ordered) {
        const sprite = getCarpetJunctionSprite(
          jx,
          jy,
          variant,
          carpetTiles,
          cols,
          rows,
          color,
          accentColor,
          paletteKey,
        );
        if (!sprite) continue;
        const cached = getCachedSprite(sprite, zoom);
        ctx.drawImage(cached, offsetX + jx * s - halfS, offsetY + jy * s - halfS);
      }
    }
  }
}

/**
 * Translucent per-tile color wash for Areas. Runs ABOVE carpets/floor and
 * BELOW seat indicators / characters / furniture. The active area (the one
 * the editor has currently selected) gets a multiplier-bumped alpha so users
 * can see which area they're editing without changing every other area's
 * visibility.
 *
 * @internal
 */
export function renderAreaOverlay(
  ctx: CanvasRenderingContext2D,
  areaTiles: Array<string | null> | undefined,
  areas: AreaDefinition[] | undefined,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  activeAreaLabel?: string | null,
  rect?: GridRect,
): void {
  if (!areaTiles || areaTiles.length === 0) return;
  if (!areas || areas.length === 0) return;

  const s = TILE_SIZE * zoom;
  const colorMap = new Map<string, string>();
  for (const a of areas) colorMap.set(a.label, a.color);
  const { c0, c1, r0, r1 } = spanOf(rect, cols, rows);

  ctx.save();
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const label = areaTiles[r * cols + c];
      if (!label) continue;
      const color = colorMap.get(label);
      if (!color) continue;
      ctx.globalAlpha =
        activeAreaLabel === label
          ? AREA_OVERLAY_ALPHA * AREA_ACTIVE_ALPHA_MULTIPLIER
          : AREA_OVERLAY_ALPHA;
      ctx.fillStyle = color;
      ctx.fillRect(offsetX + c * s, offsetY + r * s, s, s);
    }
  }
  ctx.restore();
}

/**
 * Render the centroid label for each Area, ABOVE characters/bubbles. Centroid
 * = arithmetic mean of all tile centers belonging to a given label. Pixel-art
 * drop shadow (no blur) for legibility on light backgrounds.
 *
 * @internal
 */
export function renderAreaLabels(
  ctx: CanvasRenderingContext2D,
  areaTiles: Array<string | null> | undefined,
  areas: AreaDefinition[] | undefined,
  cols: number,
  rows: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  rect?: GridRect,
): void {
  if (!areaTiles || areaTiles.length === 0) return;
  if (!areas || areas.length === 0) return;

  const s = TILE_SIZE * zoom;
  const colorMap = new Map<string, string>();
  for (const a of areas) colorMap.set(a.label, a.color);
  const { c0, c1, r0, r1 } = spanOf(rect, cols, rows);

  // Centroid accumulator: label → { sumX, sumY, count } (over the tiles on screen).
  const centroids = new Map<string, { sumX: number; sumY: number; count: number }>();
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const label = areaTiles[r * cols + c];
      if (!label) continue;
      const acc = centroids.get(label);
      if (acc) {
        acc.sumX += c;
        acc.sumY += r;
        acc.count += 1;
      } else {
        centroids.set(label, { sumX: c, sumY: r, count: 1 });
      }
    }
  }

  if (centroids.size === 0) return;

  const fontSize = Math.max(AREA_LABEL_FONT_SIZE_PX * zoom, AREA_LABEL_MIN_FONT_SIZE_PX);

  ctx.save();
  ctx.font = `bold ${fontSize}px 'FS Pixel Sans'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const [label, acc] of centroids) {
    const cx = offsetX + (acc.sumX / acc.count + 0.5) * s;
    const cy = offsetY + (acc.sumY / acc.count + 0.5) * s;

    // Pixel-art drop shadow (1px right + down, no blur).
    ctx.globalAlpha = AREA_LABEL_SHADOW_ALPHA;
    ctx.fillStyle = AREA_LABEL_SHADOW_COLOR;
    ctx.fillText(label, cx + 1, cy + 1);

    // Main label — area's own color, falling back to white if missing.
    ctx.globalAlpha = AREA_LABEL_ALPHA;
    ctx.fillStyle = colorMap.get(label) ?? AREA_LABEL_FALLBACK_COLOR;
    ctx.fillText(label, cx, cy);
  }
  ctx.restore();
}

/** Draw each ball as a 2×2 sprite-pixel dot (colour on top, shade below). */
export function renderBalls(
  ctx: CanvasRenderingContext2D,
  balls: GameBall[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  for (const b of balls) {
    const x = Math.round(offsetX + (b.x - 1) * zoom);
    const y = Math.round(offsetY + (b.y - 1) * zoom);
    ctx.fillStyle = b.color;
    ctx.fillRect(x, y, 2 * zoom, zoom);
    ctx.fillStyle = b.shade;
    ctx.fillRect(x, y + zoom, 2 * zoom, zoom);
  }
}

/** Draw "2 - 1" style scores above game tables in play. */
export function renderScoreboards(
  ctx: CanvasRenderingContext2D,
  boards: Scoreboard[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const fontSize = Math.max(SCOREBOARD_FONT_SIZE_PX * zoom, SCOREBOARD_MIN_FONT_SIZE_PX);
  ctx.save();
  ctx.font = `bold ${fontSize}px 'FS Pixel Sans'`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const b of boards) {
    const x = Math.round(offsetX + b.x * zoom);
    const y = Math.round(offsetY + b.y * zoom);
    ctx.fillStyle = SCOREBOARD_SHADOW_COLOR;
    ctx.fillText(b.text, x + 1, y + 1);
    ctx.fillStyle = SCOREBOARD_COLOR;
    ctx.fillText(b.text, x, y);
  }
  ctx.restore();
}

/** An arrow and the level a rider is going to, over their head: up green, down orange. */
export function renderTransitLabels(
  ctx: CanvasRenderingContext2D,
  labels: TransitLabel[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const fontSize = Math.max(TRANSIT_LABEL_FONT_SIZE_PX * zoom, TRANSIT_LABEL_MIN_FONT_SIZE_PX);
  const tri = Math.max(4, Math.round(fontSize * 0.7));
  const gap = Math.max(2, Math.round(fontSize * 0.3));
  ctx.save();
  ctx.font = `bold ${fontSize}px 'FS Pixel Sans'`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  const arrow = (x: number, y: number, up: boolean) => {
    const h = Math.round(tri * 0.8);
    const base = y - Math.round(fontSize * 0.25);
    ctx.beginPath();
    if (up) {
      ctx.moveTo(x, base);
      ctx.lineTo(x + tri, base);
      ctx.lineTo(x + tri / 2, base - h);
    } else {
      ctx.moveTo(x, base - h);
      ctx.lineTo(x + tri, base - h);
      ctx.lineTo(x + tri / 2, base);
    }
    ctx.closePath();
    ctx.fill();
  };
  for (const l of labels) {
    const w = tri + gap + ctx.measureText(l.text).width;
    const x = Math.round(offsetX + l.x * zoom - w / 2);
    const y = Math.round(offsetY + l.y * zoom);
    ctx.fillStyle = TRANSIT_LABEL_SHADOW_COLOR;
    arrow(x + 1, y + 1, l.up);
    ctx.fillText(l.text, x + tri + gap + 1, y + 1);
    ctx.fillStyle = l.up ? TRANSIT_LABEL_UP_COLOR : TRANSIT_LABEL_DOWN_COLOR;
    arrow(x, y, l.up);
    ctx.fillText(l.text, x + tri + gap, y);
  }
  ctx.restore();
}

/** @internal */
export function renderTileGrid(
  ctx: CanvasRenderingContext2D,
  tileMap: TileTypeVal[][],
  offsetX: number,
  offsetY: number,
  zoom: number,
  tileColors?: Array<ColorValue | null>,
  cols?: number,
  rect?: GridRect,
): void {
  const s = TILE_SIZE * zoom;
  const useSpriteFloors = hasFloorSprites();
  const tmRows = tileMap.length;
  const tmCols = tmRows > 0 ? tileMap[0].length : 0;
  const layoutCols = cols ?? tmCols;
  const { c0, c1, r0, r1 } = spanOf(rect, tmCols, tmRows);

  // Floor tiles + wall base color
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const tile = tileMap[r][c];

      // Skip VOID tiles entirely (transparent)
      if (tile === TileType.VOID) continue;

      if (tile === TileType.WALL || !useSpriteFloors) {
        // Wall tiles or fallback: solid color
        if (tile === TileType.WALL) {
          const colorIdx = r * layoutCols + c;
          const wallColor = tileColors?.[colorIdx];
          ctx.fillStyle = wallColor ? wallColorToHex(wallColor) : WALL_COLOR;
        } else {
          ctx.fillStyle = FALLBACK_FLOOR_COLOR;
        }
        ctx.fillRect(offsetX + c * s, offsetY + r * s, s, s);
        continue;
      }

      // Floor tile: get colorized sprite
      const colorIdx = r * layoutCols + c;
      const color = tileColors?.[colorIdx] ?? { h: 0, s: 0, b: 0, c: 0 };
      const sprite = getColorizedFloorSprite(tile, color);
      const cached = getCachedSprite(sprite, zoom);
      ctx.drawImage(cached, offsetX + c * s, offsetY + r * s);
    }
  }
}

interface ZDrawable {
  zY: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

/** @internal */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  furniture: FurnitureInstance[],
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  selectedAgentId: number | null,
  hoveredAgentId: number | null,
  pets: Pet[] = [],
): void {
  const drawables: ZDrawable[] = [];

  // Furniture
  for (const f of furniture) {
    const cached = getCachedSprite(f.sprite, zoom);
    const fx = offsetX + f.x * zoom;
    const fy = offsetY + f.y * zoom;
    if (f.mirrored) {
      drawables.push({
        zY: f.zY,
        draw: (c) => {
          c.save();
          c.translate(fx + cached.width, fy);
          c.scale(-1, 1);
          c.drawImage(cached, 0, 0);
          c.restore();
        },
      });
    } else {
      drawables.push({
        zY: f.zY,
        draw: (c) => {
          c.drawImage(cached, fx, fy);
        },
      });
    }
  }

  // Characters
  for (const ch of characters) {
    const sprites = getCharacterSprites(ch.palette, ch.hueShift, ch.look);
    const spriteData = getCharacterSprite(ch, sprites);
    const cached = getCachedSprite(spriteData, zoom);
    // Sitting offset: shift character down when seated so they visually sit in the chair
    const sittingOffset = isSeatedPose(ch) ? CHARACTER_SITTING_OFFSET_PX : 0;
    // Celebration hop: bounce on |sin| while the timer runs down
    const hop =
      (ch.celebrateTimer > 0
        ? -GAME_CELEBRATE_HOP_PX *
          Math.abs(Math.sin(ch.celebrateTimer * Math.PI * GAME_CELEBRATE_HOPS_PER_SEC))
        : 0) + emoteLook(ch.emote).hop;
    // Riding stairs / an elevator: climbing, sinking, stepping through a door.
    const ride = transitLook(ch);
    // Anchor at bottom-center of character — round to integer device pixels
    const drawX = Math.round(offsetX + ch.x * zoom - cached.width / 2);
    const drawY = Math.round(
      offsetY + (ch.y + sittingOffset + hop + (ride?.dy ?? 0)) * zoom - cached.height,
    );

    // Sort characters by bottom of their tile (not center) so they render
    // in front of same-row furniture (e.g. chairs) but behind furniture
    // at lower rows (e.g. desks, bookshelves that occlude from below).
    const charZY = ch.y + TILE_SIZE / 2 + CHARACTER_Z_SORT_OFFSET;

    // Headless agents (adopted, no terminal to focus) render translucent while
    // the "Display headless as ghosts" setting is on.
    const alpha =
      (ch.isHeadless && ghostHeadlessAgents ? HEADLESS_CHARACTER_ALPHA : 1) * (ride?.alpha ?? 1);
    if (ride) {
      if (alpha <= 0) continue;
      // Going down a stairwell: nothing below its front edge shows.
      const clipY = ride.clipDy !== null ? Math.round(offsetY + (ch.y + ride.clipDy) * zoom) : null;
      if (clipY !== null && clipY <= drawY) continue;
      drawables.push({
        zY: charZY,
        draw: (c) => {
          c.save();
          if (clipY !== null) {
            c.beginPath();
            c.rect(drawX - zoom, drawY - zoom, cached.width + 2 * zoom, clipY - drawY + zoom);
            c.clip();
          }
          c.globalAlpha = alpha;
          c.drawImage(cached, drawX, drawY);
          c.restore();
        },
      });
      continue;
    }

    // Matrix spawn/despawn effect — skip outline, use per-pixel rendering
    if (ch.matrixEffect) {
      const mDrawX = drawX;
      const mDrawY = drawY;
      const mSpriteData = spriteData;
      const mCh = ch;
      drawables.push({
        zY: charZY,
        draw: (c) => {
          c.save();
          c.globalAlpha = alpha;
          renderMatrixEffect(c, mCh, mSpriteData, mDrawX, mDrawY, zoom);
          c.restore();
        },
      });
      continue;
    }

    // White outline: full opacity for selected, 50% for hover
    const isSelected = selectedAgentId !== null && ch.id === selectedAgentId;
    const isHovered = hoveredAgentId !== null && ch.id === hoveredAgentId;
    if (isSelected || isHovered) {
      const outlineAlpha = isSelected ? SELECTED_OUTLINE_ALPHA : HOVERED_OUTLINE_ALPHA;
      const outlineData = getOutlineSprite(spriteData);
      const outlineCached = getCachedSprite(outlineData, zoom);
      const olDrawX = drawX - zoom; // 1 sprite-pixel offset, scaled
      const olDrawY = drawY - zoom; // outline follows sitting offset via drawY
      drawables.push({
        zY: charZY - OUTLINE_Z_SORT_OFFSET, // sort just before character
        draw: (c) => {
          c.save();
          c.globalAlpha = outlineAlpha;
          c.drawImage(outlineCached, olDrawX, olDrawY);
          c.restore();
        },
      });
    }

    drawables.push({
      zY: charZY,
      draw: (c) => {
        if (alpha === 1) {
          c.drawImage(cached, drawX, drawY);
          return;
        }
        c.save();
        c.globalAlpha = alpha;
        c.drawImage(cached, drawX, drawY);
        c.restore();
      },
    });
  }

  // ── Pets ──────────────────────────────────────────────
  for (const pet of pets) {
    const petSprites = getPetSprites(pet.petType);
    const spriteData = getPetSpriteData(pet, petSprites);
    if (!spriteData) continue;

    const cached = getCachedSprite(spriteData, zoom);
    // Anchor at bottom-center at (pet.x, pet.y) — round to integer device pixels
    const drawX = Math.round(offsetX + pet.x * zoom - cached.width / 2);
    const drawY = Math.round(offsetY + pet.y * zoom - cached.height);

    // Z-sort key: matches the chair/character "row boundary" formula.
    // pet.y is the pixel center, so + TILE_SIZE/2 lifts us to the row's bottom edge.
    const petZY = pet.y + TILE_SIZE / 2;

    drawables.push({
      zY: petZY,
      draw: (c) => {
        c.drawImage(cached, drawX, drawY);
      },
    });
  }

  // Sort by Y (lower = in front = drawn later)
  drawables.sort((a, b) => a.zY - b.zY);

  for (const d of drawables) {
    d.draw(ctx);
  }
}

// ── Seat indicators ─────────────────────────────────────────────

function renderSeatIndicators(
  ctx: CanvasRenderingContext2D,
  seats: Map<string, Seat>,
  characters: Map<number, Character>,
  selectedAgentId: number | null,
  hoveredTile: { col: number; row: number } | null,
  offsetX: number,
  offsetY: number,
  zoom: number,
  gameSlots?: SelectionRenderState['gameSlots'],
): void {
  if (selectedAgentId === null || !hoveredTile) return;
  const selectedChar = characters.get(selectedAgentId);
  if (!selectedChar) return;

  // Only show indicator for the hovered seat tile
  for (const [uid, seat] of seats) {
    if (seat.seatCol !== hoveredTile.col || seat.seatRow !== hoveredTile.row) continue;

    const s = TILE_SIZE * zoom;
    const x = offsetX + seat.seatCol * s;
    const y = offsetY + seat.seatRow * s;

    if (selectedChar.seatId === uid) {
      // Selected agent's own seat — blue
      ctx.fillStyle = SEAT_OWN_COLOR;
    } else if (!seat.assigned) {
      // Available seat — green
      ctx.fillStyle = SEAT_AVAILABLE_COLOR;
    } else {
      // Busy (assigned to another agent) — red
      ctx.fillStyle = SEAT_BUSY_COLOR;
    }
    ctx.fillRect(x, y, s, s);
    break;
  }

  // Hovering a game table: show where the selected agent would stand
  if (gameSlots) {
    const s = TILE_SIZE * zoom;
    for (const slot of gameSlots) {
      ctx.fillStyle = slot.free ? SEAT_AVAILABLE_COLOR : SEAT_BUSY_COLOR;
      ctx.fillRect(offsetX + slot.col * s, offsetY + slot.row * s, s, s);
    }
  }
}

// ── Edit mode overlays ──────────────────────────────────────────

/** @internal */
export function renderGridOverlay(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  cols: number,
  rows: number,
  tileMap?: TileTypeVal[][],
  rect?: GridRect,
): void {
  const s = TILE_SIZE * zoom;
  const { c0, c1, r0, r1 } = spanOf(rect, cols, rows);
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Vertical lines — offset by 0.5 for crisp 1px lines
  for (let c = c0; c <= c1; c++) {
    const x = offsetX + c * s + 0.5;
    ctx.moveTo(x, offsetY + r0 * s);
    ctx.lineTo(x, offsetY + r1 * s);
  }
  // Horizontal lines
  for (let r = r0; r <= r1; r++) {
    const y = offsetY + r * s + 0.5;
    ctx.moveTo(offsetX + c0 * s, y);
    ctx.lineTo(offsetX + c1 * s, y);
  }
  ctx.stroke();

  // Draw faint dashed outlines on VOID tiles
  if (tileMap) {
    ctx.save();
    ctx.strokeStyle = VOID_TILE_OUTLINE_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash(VOID_TILE_DASH_PATTERN);
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        if (tileMap[r]?.[c] === TileType.VOID) {
          ctx.strokeRect(offsetX + c * s + 0.5, offsetY + r * s + 0.5, s - 1, s - 1);
        }
      }
    }
    ctx.restore();
  }
}

/** Draw faint expansion placeholders 1 tile outside grid bounds (ghost border). */
function renderGhostBorder(
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  zoom: number,
  rect: GridRect,
  ghostHoverCol: number,
  ghostHoverRow: number,
): void {
  const s = TILE_SIZE * zoom;
  ctx.save();

  // Collect ghost border tiles: one ring around the grid (the level on screen)
  const { col: c0, row: r0, cols, rows } = rect;
  const ghostTiles: Array<{ c: number; r: number }> = [];
  // Top and bottom rows
  for (let c = c0 - 1; c <= c0 + cols; c++) {
    ghostTiles.push({ c, r: r0 - 1 });
    ghostTiles.push({ c, r: r0 + rows });
  }
  // Left and right columns (excluding corners already added)
  for (let r = r0; r < r0 + rows; r++) {
    ghostTiles.push({ c: c0 - 1, r });
    ghostTiles.push({ c: c0 + cols, r });
  }

  for (const { c, r } of ghostTiles) {
    const x = offsetX + c * s;
    const y = offsetY + r * s;
    const isHovered = c === ghostHoverCol && r === ghostHoverRow;
    if (isHovered) {
      ctx.fillStyle = GHOST_BORDER_HOVER_FILL;
      ctx.fillRect(x, y, s, s);
    }
    ctx.strokeStyle = isHovered ? GHOST_BORDER_HOVER_STROKE : GHOST_BORDER_STROKE;
    ctx.lineWidth = 1;
    ctx.setLineDash(VOID_TILE_DASH_PATTERN);
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
  }

  ctx.restore();
}

/** @internal */
export function renderGhostPreview(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteData,
  col: number,
  row: number,
  valid: boolean,
  offsetX: number,
  offsetY: number,
  zoom: number,
  mirrored: boolean = false,
): void {
  const cached = getCachedSprite(sprite, zoom);
  const x = offsetX + col * TILE_SIZE * zoom;
  const y = offsetY + row * TILE_SIZE * zoom;
  ctx.save();
  ctx.globalAlpha = GHOST_PREVIEW_SPRITE_ALPHA;
  if (mirrored) {
    ctx.translate(x + cached.width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(cached, 0, 0);
  } else {
    ctx.drawImage(cached, x, y);
  }
  // Tint overlay — reset transform for correct fill position
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = GHOST_PREVIEW_TINT_ALPHA;
  ctx.fillStyle = valid ? GHOST_VALID_TINT : GHOST_INVALID_TINT;
  ctx.fillRect(x, y, cached.width, cached.height);
  ctx.restore();
}

/** @internal */
export function renderSelectionHighlight(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  w: number,
  h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  const s = TILE_SIZE * zoom;
  const x = offsetX + col * s;
  const y = offsetY + row * s;
  ctx.save();
  ctx.strokeStyle = SELECTION_HIGHLIGHT_COLOR;
  ctx.lineWidth = 2;
  ctx.setLineDash(SELECTION_DASH_PATTERN);
  ctx.strokeRect(x + 1, y + 1, w * s - 2, h * s - 2);
  ctx.restore();
}

/** @internal */
export function renderDeleteButton(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  w: number,
  _h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): DeleteButtonBounds {
  const s = TILE_SIZE * zoom;
  // Position at top-right corner of selected furniture
  const cx = offsetX + (col + w) * s + 1;
  const cy = offsetY + row * s - 1;
  const radius = Math.max(BUTTON_MIN_RADIUS, zoom * BUTTON_RADIUS_ZOOM_FACTOR);

  // Circle background
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = DELETE_BUTTON_BG;
  ctx.fill();

  // X mark
  ctx.strokeStyle = BUTTON_ICON_COLOR;
  ctx.lineWidth = Math.max(BUTTON_LINE_WIDTH_MIN, zoom * BUTTON_LINE_WIDTH_ZOOM_FACTOR);
  ctx.lineCap = 'round';
  const xSize = radius * BUTTON_ICON_SIZE_FACTOR;
  ctx.beginPath();
  ctx.moveTo(cx - xSize, cy - xSize);
  ctx.lineTo(cx + xSize, cy + xSize);
  ctx.moveTo(cx + xSize, cy - xSize);
  ctx.lineTo(cx - xSize, cy + xSize);
  ctx.stroke();
  ctx.restore();

  return { cx, cy, radius };
}

function renderRotateButton(
  ctx: CanvasRenderingContext2D,
  col: number,
  row: number,
  _w: number,
  _h: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
): RotateButtonBounds {
  const s = TILE_SIZE * zoom;
  // Position to the left of the delete button (which is at top-right corner)
  const radius = Math.max(BUTTON_MIN_RADIUS, zoom * BUTTON_RADIUS_ZOOM_FACTOR);
  const cx = offsetX + col * s - 1;
  const cy = offsetY + row * s - 1;

  // Circle background
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = ROTATE_BUTTON_BG;
  ctx.fill();

  // Circular arrow icon
  ctx.strokeStyle = BUTTON_ICON_COLOR;
  ctx.lineWidth = Math.max(BUTTON_LINE_WIDTH_MIN, zoom * BUTTON_LINE_WIDTH_ZOOM_FACTOR);
  ctx.lineCap = 'round';
  const arcR = radius * BUTTON_ICON_SIZE_FACTOR;
  ctx.beginPath();
  // Draw a 270-degree arc
  ctx.arc(cx, cy, arcR, -Math.PI * 0.8, Math.PI * 0.7);
  ctx.stroke();
  // Draw arrowhead at the end of the arc
  const endAngle = Math.PI * 0.7;
  const endX = cx + arcR * Math.cos(endAngle);
  const endY = cy + arcR * Math.sin(endAngle);
  const arrowSize = radius * 0.35;
  ctx.beginPath();
  ctx.moveTo(endX + arrowSize * 0.6, endY - arrowSize * 0.3);
  ctx.lineTo(endX, endY);
  ctx.lineTo(endX + arrowSize * 0.7, endY + arrowSize * 0.5);
  ctx.stroke();
  ctx.restore();

  return { cx, cy, radius };
}

// ── Speech bubbles ──────────────────────────────────────────────

function renderBubbles(
  ctx: CanvasRenderingContext2D,
  characters: Character[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  for (const ch of characters) {
    if (!ch.bubbleType || ch.transit) continue;
    // The green checkmark bubble only represents "done" (turn finished). The
    // idle "Waiting for input" state communicates via its overlay label, not a
    // bubble, so skip the bubble for it.
    if (ch.bubbleType === 'waiting' && ch.waitingAwaitingInput) continue;

    const sprite =
      ch.bubbleType === 'permission' ? BUBBLE_PERMISSION_SPRITE : BUBBLE_WAITING_SPRITE;

    // Compute opacity: permission = full, waiting = fade in last 0.5s
    let alpha = 1.0;
    if (ch.bubbleType === 'waiting' && ch.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
      alpha = ch.bubbleTimer / BUBBLE_FADE_DURATION_SEC;
    }

    const cached = getCachedSprite(sprite, zoom);
    // Position: centered above the character's head
    // Character is anchored bottom-center at (ch.x, ch.y), sprite is 16x24
    // Place bubble above head with a small gap; follow sitting offset
    const sittingOff = isSeatedPose(ch) ? BUBBLE_SITTING_OFFSET_PX : 0;
    const bubbleX = Math.round(offsetX + ch.x * zoom - cached.width / 2);
    const bubbleY = Math.round(
      offsetY + (ch.y + sittingOff - BUBBLE_VERTICAL_OFFSET_PX) * zoom - cached.height - 1 * zoom,
    );

    ctx.save();
    if (alpha < 1.0) ctx.globalAlpha = alpha;
    ctx.drawImage(cached, bubbleX, bubbleY);
    ctx.restore();
  }
}

function renderPetBubbles(
  ctx: CanvasRenderingContext2D,
  pets: Pet[],
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  for (const pet of pets) {
    if (!pet.bubbleType) continue;

    const sprite = BUBBLE_HEART_SPRITE;

    // Fade in the last BUBBLE_FADE_DURATION_SEC of the lifetime
    let alpha = 1.0;
    if (pet.bubbleTimer < BUBBLE_FADE_DURATION_SEC) {
      alpha = Math.max(0, pet.bubbleTimer / BUBBLE_FADE_DURATION_SEC);
    }

    const cached = getCachedSprite(sprite, zoom);
    // Anchor: centered above the pet's head. Pet is anchored bottom-center at
    // (pet.x, pet.y); sprite is ~16 tall, so back up TILE_SIZE pixels and add
    // a 1-sprite-pixel gap (scaled by zoom).
    const bubbleX = Math.round(offsetX + pet.x * zoom - cached.width / 2);
    const bubbleY = Math.round(offsetY + (pet.y - TILE_SIZE) * zoom - cached.height - 1 * zoom);

    ctx.save();
    if (alpha < 1.0) ctx.globalAlpha = alpha;
    ctx.drawImage(cached, bubbleX, bubbleY);
    ctx.restore();
  }
}

export interface ButtonBounds {
  /** Center X in device pixels */
  cx: number;
  /** Center Y in device pixels */
  cy: number;
  /** Radius in device pixels */
  radius: number;
}

export type DeleteButtonBounds = ButtonBounds;
export type RotateButtonBounds = ButtonBounds;

export interface EditorRenderState {
  showGrid: boolean;
  ghostSprite: SpriteData | null;
  ghostMirrored: boolean;
  ghostCol: number;
  ghostRow: number;
  ghostValid: boolean;
  selectedCol: number;
  selectedRow: number;
  selectedW: number;
  selectedH: number;
  hasSelection: boolean;
  isRotatable: boolean;
  /** Updated each frame by renderDeleteButton */
  deleteButtonBounds: DeleteButtonBounds | null;
  /** Updated each frame by renderRotateButton */
  rotateButtonBounds: RotateButtonBounds | null;
  /** Whether to show ghost border (expansion tiles outside grid) */
  showGhostBorder: boolean;
  /** Hovered ghost border tile col (-1 to cols) */
  ghostBorderHoverCol: number;
  /** Hovered ghost border tile row (-1 to rows) */
  ghostBorderHoverRow: number;
}

export interface SelectionRenderState {
  selectedAgentId: number | null;
  hoveredAgentId: number | null;
  hoveredTile: { col: number; row: number } | null;
  seats: Map<string, Seat>;
  characters: Map<number, Character>;
  /** Standing ends of the hovered game table, if any (green = free, red = taken) */
  gameSlots?: Array<{ col: number; row: number; free: boolean }>;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  tileMap: TileTypeVal[][],
  furniture: FurnitureInstance[],
  characters: Character[],
  zoom: number,
  panX: number,
  panY: number,
  selection?: SelectionRenderState,
  editor?: EditorRenderState,
  tileColors?: Array<ColorValue | null>,
  layoutCols?: number,
  layoutRows?: number,
  carpetTiles?: Array<CarpetTile | null>,
  areas?: AreaDefinition[],
  areaTiles?: Array<string | null>,
  showAreas?: boolean,
  activeAreaLabel?: string | null,
  pets?: Pet[],
  scoreboards?: Scoreboard[],
  balls?: GameBall[],
  /** The part of the grid on screen (a building's level); the whole grid when absent. */
  view?: GridRect,
  transitLabels?: TransitLabel[],
): { offsetX: number; offsetY: number } {
  // Clear
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Use layout dimensions (fallback to tileMap size)
  const cols = layoutCols ?? (tileMap.length > 0 ? tileMap[0].length : 0);
  const rows = layoutRows ?? tileMap.length;
  const rect: GridRect = view ?? { col: 0, row: 0, cols, rows };

  // Center the view in the viewport + pan offset (integer device pixels). Shared
  // with the DOM overlays so a label lands exactly on the sprite it belongs to.
  const { offsetX, offsetY } = mapOffset(canvasWidth, canvasHeight, rect, zoom, panX, panY);

  // A building's other levels sit beside this one in the grid: draw only what
  // stands in this level's columns, clipped to them.
  const x0 = rect.col * TILE_SIZE;
  const x1 = (rect.col + rect.cols) * TILE_SIZE;
  const onScreen = (x: number) => x >= x0 && x < x1;
  const clipped = rect.col !== 0 || rect.cols !== cols;
  ctx.save();
  if (clipped) {
    const s = TILE_SIZE * zoom;
    ctx.beginPath();
    ctx.rect(offsetX + rect.col * s, 0, rect.cols * s, canvasHeight);
    ctx.clip();
    characters = characters.filter((ch) => onScreen(ch.x));
    pets = pets?.filter((p) => onScreen(p.x));
    balls = balls?.filter((b) => onScreen(b.x));
    scoreboards = scoreboards?.filter((b) => onScreen(b.x));
  }

  // Draw tiles (floor + wall base color)
  renderTileGrid(ctx, tileMap, offsetX, offsetY, zoom, tileColors, layoutCols, rect);

  // Carpet layer (above floor, below seat indicators / furniture / characters)
  if (carpetTiles && carpetTiles.length > 0) {
    renderCarpetLayer(ctx, carpetTiles, cols, rows, offsetX, offsetY, zoom, rect);
  }

  // Area overlay (translucent color wash) — above carpets, below seat indicators
  if (showAreas) {
    renderAreaOverlay(
      ctx,
      areaTiles,
      areas,
      cols,
      rows,
      offsetX,
      offsetY,
      zoom,
      activeAreaLabel,
      rect,
    );
  }

  // Seat indicators (below furniture/characters, on top of floor)
  if (selection) {
    renderSeatIndicators(
      ctx,
      selection.seats,
      selection.characters,
      selection.selectedAgentId,
      selection.hoveredTile,
      offsetX,
      offsetY,
      zoom,
      selection.gameSlots,
    );
  }

  // Build wall instances for z-sorting with furniture and characters
  const wallInstances = hasWallSprites() ? getWallInstances(tileMap, tileColors, layoutCols) : [];
  let allFurniture = wallInstances.length > 0 ? [...wallInstances, ...furniture] : furniture;
  if (clipped) {
    allFurniture = allFurniture.filter((f) => f.x < x1 && f.x + (f.sprite[0]?.length ?? 0) > x0);
  }

  // Draw walls + furniture + characters (z-sorted)
  const selectedId = selection?.selectedAgentId ?? null;
  const hoveredId = selection?.hoveredAgentId ?? null;
  renderScene(
    ctx,
    allFurniture,
    characters,
    offsetX,
    offsetY,
    zoom,
    selectedId,
    hoveredId,
    pets ?? [],
  );

  // Speech bubbles (always on top of characters)
  renderBubbles(ctx, characters, offsetX, offsetY, zoom);
  // Who is riding stairs / an elevator, and where to
  if (transitLabels && transitLabels.length > 0) {
    renderTransitLabels(ctx, transitLabels, offsetX, offsetY, zoom);
  }
  // Game balls in flight + scoreboards above tables in play
  if (balls && balls.length > 0) {
    renderBalls(ctx, balls, offsetX, offsetY, zoom);
  }
  if (scoreboards && scoreboards.length > 0) {
    renderScoreboards(ctx, scoreboards, offsetX, offsetY, zoom);
  }
  // Pet heart bubbles (same overlay pass)
  if (pets && pets.length > 0) {
    renderPetBubbles(ctx, pets, offsetX, offsetY, zoom);
  }

  // Area labels (above bubbles + characters, below editor overlays)
  if (showAreas) {
    renderAreaLabels(ctx, areaTiles, areas, cols, rows, offsetX, offsetY, zoom, rect);
  }
  ctx.restore();

  // Editor overlays
  if (editor) {
    if (editor.showGrid) {
      renderGridOverlay(ctx, offsetX, offsetY, zoom, cols, rows, tileMap, rect);
    }
    if (editor.showGhostBorder) {
      renderGhostBorder(
        ctx,
        offsetX,
        offsetY,
        zoom,
        rect,
        editor.ghostBorderHoverCol,
        editor.ghostBorderHoverRow,
      );
    }
    if (editor.ghostSprite && editor.ghostCol >= 0) {
      renderGhostPreview(
        ctx,
        editor.ghostSprite,
        editor.ghostCol,
        editor.ghostRow,
        editor.ghostValid,
        offsetX,
        offsetY,
        zoom,
        editor.ghostMirrored,
      );
    }
    if (editor.hasSelection) {
      renderSelectionHighlight(
        ctx,
        editor.selectedCol,
        editor.selectedRow,
        editor.selectedW,
        editor.selectedH,
        offsetX,
        offsetY,
        zoom,
      );
      editor.deleteButtonBounds = renderDeleteButton(
        ctx,
        editor.selectedCol,
        editor.selectedRow,
        editor.selectedW,
        editor.selectedH,
        offsetX,
        offsetY,
        zoom,
      );
      if (editor.isRotatable) {
        editor.rotateButtonBounds = renderRotateButton(
          ctx,
          editor.selectedCol,
          editor.selectedRow,
          editor.selectedW,
          editor.selectedH,
          offsetX,
          offsetY,
          zoom,
        );
      } else {
        editor.rotateButtonBounds = null;
      }
    } else {
      editor.deleteButtonBounds = null;
      editor.rotateButtonBounds = null;
    }
  }

  return { offsetX, offsetY };
}
