// webview-ui/src/games/fps/hud.ts
//
// Pixel Frag's heads-up display, drawn over the 3D view at screen resolution
// in the pixel font: crosshair, health, ammo, clock and frags, the kill feed,
// a minimap, the scoreboard and the "you were fragged" screen.

import {
  FPS_HUD_ACCENT_COLOR,
  FPS_HUD_AMMO_COLOR,
  FPS_HUD_CROSSHAIR_COLOR,
  FPS_HUD_DEAD_COLOR,
  FPS_HUD_HEALTH_COLOR,
  FPS_HUD_HIT_MARKER_COLOR,
  FPS_HUD_HURT_COLOR,
  FPS_HUD_LOW_HEALTH_COLOR,
  FPS_HUD_MUTED_COLOR,
  FPS_HUD_PANEL_COLOR,
  FPS_HUD_SELF_COLOR,
  FPS_HUD_SHADOW_COLOR,
  FPS_HUD_TEXT_COLOR,
  FPS_HURT_FLASH_SEC,
  FPS_MINIMAP_BLOCK_COLOR,
  FPS_MINIMAP_CELL_PX,
  FPS_MINIMAP_FLOOR_COLOR,
  FPS_MINIMAP_ITEM_COLOR,
  FPS_MINIMAP_RADIUS_CELLS,
  FPS_MINIMAP_WALL_COLOR,
} from '../../constants.js';
import type { FpsSession } from './session.js';
import { Cell, WEAPONS } from './types.js';

export interface HudOptions {
  /** Canvas size in device pixels, and device pixels per CSS pixel. */
  w: number;
  h: number;
  scale: number;
  showScores: boolean;
  minimap: boolean;
}

const FONT = '"FS Pixel Sans", monospace';

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign,
  scale: number,
): void {
  ctx.font = `${Math.round(size * scale)}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const off = Math.max(1, Math.round(2 * scale));
  ctx.fillStyle = FPS_HUD_SHADOW_COLOR;
  ctx.fillText(s, x + off, y + off);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

const clock = (ms: number) => {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export function drawHud(ctx: CanvasRenderingContext2D, s: FpsSession, o: HudOptions): void {
  const { w, h, scale } = o;
  const k = scale;
  const pad = 14 * k;
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  if (s.waiting) {
    ctx.fillStyle = FPS_HUD_PANEL_COLOR;
    ctx.fillRect(0, 0, w, h);
    text(ctx, 'Waiting for the host’s map…', w / 2, h / 2, 22, FPS_HUD_TEXT_COLOR, 'center', k);
    ctx.restore();
    return;
  }

  const me = s.me;
  // Hurt, dead.
  if (s.hurt > 0 && me.alive) {
    ctx.globalAlpha = Math.min(1, s.hurt / FPS_HURT_FLASH_SEC);
    ctx.fillStyle = FPS_HUD_HURT_COLOR;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
  if (!me.alive && !s.over) {
    ctx.fillStyle = FPS_HUD_DEAD_COLOR;
    ctx.fillRect(0, 0, w, h);
    const by =
      s.killedBy && s.killedBy !== me.id ? `Fragged by ${s.nameOf(s.killedBy)}` : 'Fragged';
    text(ctx, by, w / 2, h / 2 - 10 * k, 28, FPS_HUD_TEXT_COLOR, 'center', k);
    text(
      ctx,
      `Back in ${Math.max(1, Math.ceil(me.respawnIn))}…`,
      w / 2,
      h / 2 + 22 * k,
      18,
      FPS_HUD_MUTED_COLOR,
      'center',
      k,
    );
  }

  // Crosshair and the name under it.
  if (me.alive && !s.over) {
    const cx = Math.round(w / 2);
    const cy = Math.round(h / 2);
    const len = 6 * k;
    const gap = 4 * k;
    const t = Math.max(1, Math.round(2 * k));
    ctx.fillStyle = FPS_HUD_CROSSHAIR_COLOR;
    ctx.fillRect(cx - gap - len, cy - t / 2, len, t);
    ctx.fillRect(cx + gap, cy - t / 2, len, t);
    ctx.fillRect(cx - t / 2, cy - gap - len, t, len);
    ctx.fillRect(cx - t / 2, cy + gap, t, len);
    if (s.hitMarker > 0) {
      ctx.strokeStyle = FPS_HUD_HIT_MARKER_COLOR;
      ctx.lineWidth = t;
      ctx.beginPath();
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        ctx.moveTo(cx + dx * gap, cy + dy * gap);
        ctx.lineTo(cx + dx * (gap + len), cy + dy * (gap + len));
      }
      ctx.stroke();
    }
    const aimed = s.aimedAt();
    if (aimed) text(ctx, aimed, cx, cy + 34 * k, 16, FPS_HUD_TEXT_COLOR, 'center', k);
  }

  // Health, bottom left.
  const low = me.hp <= 30;
  text(ctx, 'HEALTH', pad, h - pad - 34 * k, 14, FPS_HUD_MUTED_COLOR, 'left', k);
  text(
    ctx,
    `${Math.max(0, Math.round(me.hp))}`,
    pad,
    h - pad,
    36,
    low ? FPS_HUD_LOW_HEALTH_COLOR : FPS_HUD_HEALTH_COLOR,
    'left',
    k,
  );

  // Weapon and ammo, bottom right.
  const def = WEAPONS[me.weapon];
  const ammo = def.ammo === null ? '∞' : `${me[def.ammo]}`;
  text(ctx, def.name.toUpperCase(), w - pad, h - pad - 34 * k, 14, FPS_HUD_MUTED_COLOR, 'right', k);
  text(ctx, ammo, w - pad, h - pad, 36, FPS_HUD_AMMO_COLOR, 'right', k);
  WEAPONS.forEach((wpn, i) => {
    const has = wpn.ammo === null || me[wpn.ammo] > 0;
    const color =
      i === me.weapon ? FPS_HUD_ACCENT_COLOR : has ? FPS_HUD_TEXT_COLOR : FPS_HUD_MUTED_COLOR;
    text(
      ctx,
      `${i + 1}`,
      w - pad - (WEAPONS.length - 1 - i) * 18 * k,
      h - pad - 58 * k,
      16,
      color,
      'right',
      k,
    );
  });

  // Clock and frags, top centre.
  const mine = s.scoreboard().find((r) => r.self);
  const left = s.timeLeftMs();
  const head = [
    left !== null ? clock(left) : '',
    `Frags ${mine?.frags ?? 0}${s.cfg.fragLimit > 0 ? ` / ${s.cfg.fragLimit}` : ''}`,
  ].filter(Boolean);
  text(ctx, head.join('   '), w / 2, pad + 20 * k, 20, FPS_HUD_TEXT_COLOR, 'center', k);

  // Kill feed, top left.
  s.feed.forEach((line, i) => {
    const wpn = WEAPONS[line.weapon]?.name ?? '';
    const what = line.killer ? `${line.killer} [${wpn}] ${line.victim}` : `${line.victim} fell`;
    text(
      ctx,
      what,
      pad,
      pad + 18 * k + i * 22 * k,
      15,
      line.mine ? FPS_HUD_SELF_COLOR : FPS_HUD_TEXT_COLOR,
      'left',
      k,
    );
  });

  // A message (pickups, the round), under the crosshair.
  if (s.message && me.alive) {
    text(ctx, s.message.text, w / 2, h / 2 + 70 * k, 18, FPS_HUD_AMMO_COLOR, 'center', k);
  }

  if (o.minimap) drawMinimap(ctx, s, w, pad, k);
  if (o.showScores || s.over) drawScores(ctx, s, w, h, k);
  ctx.restore();
}

function drawMinimap(
  ctx: CanvasRenderingContext2D,
  s: FpsSession,
  w: number,
  pad: number,
  k: number,
): void {
  const world = s.world;
  if (!world) return;
  const cell = FPS_MINIMAP_CELL_PX * k;
  const r = FPS_MINIMAP_RADIUS_CELLS;
  const size = (r * 2 + 1) * cell;
  const x0 = w - pad - size;
  const y0 = pad;
  const me = s.me;
  const mcx = Math.floor(me.x);
  const mcy = Math.floor(me.y);
  ctx.fillStyle = FPS_MINIMAP_FLOOR_COLOR;
  ctx.fillRect(x0, y0, size, size);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const cx = mcx + dx;
      const cy = mcy + dy;
      if (cx < 0 || cy < 0 || cx >= world.cols || cy >= world.rows) continue;
      const i = cy * world.cols + cx;
      const kind = world.kind[i];
      if (kind === Cell.FLOOR && !world.solid[i]) continue;
      ctx.fillStyle = kind === Cell.WALL ? FPS_MINIMAP_WALL_COLOR : FPS_MINIMAP_BLOCK_COLOR;
      ctx.fillRect(x0 + (dx + r) * cell, y0 + (dy + r) * cell, cell, cell);
    }
  }
  ctx.fillStyle = FPS_MINIMAP_ITEM_COLOR;
  s.itemStates().forEach((it) => {
    if (!it.available) return;
    const dx = it.x - me.x;
    const dy = it.y - me.y;
    if (Math.abs(dx) > r || Math.abs(dy) > r) return;
    ctx.fillRect(
      x0 + (dx + r + 0.5) * cell - cell / 4,
      y0 + (dy + r + 0.5) * cell - cell / 4,
      cell / 2,
      cell / 2,
    );
  });
  // You: an arrow in the middle, pointing where you look.
  const mx = x0 + (me.x - mcx + r) * cell;
  const my = y0 + (me.y - mcy + r) * cell;
  const len = cell * 1.3;
  ctx.fillStyle = FPS_HUD_SELF_COLOR;
  ctx.beginPath();
  ctx.moveTo(mx + Math.cos(me.a) * len, my + Math.sin(me.a) * len);
  ctx.lineTo(mx + Math.cos(me.a + 2.4) * len * 0.7, my + Math.sin(me.a + 2.4) * len * 0.7);
  ctx.lineTo(mx + Math.cos(me.a - 2.4) * len * 0.7, my + Math.sin(me.a - 2.4) * len * 0.7);
  ctx.closePath();
  ctx.fill();
}

function drawScores(
  ctx: CanvasRenderingContext2D,
  s: FpsSession,
  w: number,
  h: number,
  k: number,
): void {
  const rows = s.scoreboard();
  const rowH = 26 * k;
  const pw = Math.min(w - 40 * k, 460 * k);
  const ph = (rows.length + (s.over ? 4.5 : 3)) * rowH + 30 * k;
  const px = (w - pw) / 2;
  const py = Math.max(10 * k, (h - ph) / 2);
  ctx.fillStyle = FPS_HUD_PANEL_COLOR;
  ctx.fillRect(px, py, pw, ph);
  const title = s.over ? `Round over — ${rows[0]?.name ?? 'nobody'} wins` : `Round ${s.round}`;
  text(ctx, title, w / 2, py + 30 * k, 22, FPS_HUD_ACCENT_COLOR, 'center', k);
  const colName = px + 20 * k;
  const colFrags = px + pw - 110 * k;
  const colDeaths = px + pw - 24 * k;
  let y = py + 30 * k + rowH * 1.3;
  text(ctx, 'Player', colName, y, 14, FPS_HUD_MUTED_COLOR, 'left', k);
  text(ctx, 'Frags', colFrags, y, 14, FPS_HUD_MUTED_COLOR, 'right', k);
  text(ctx, 'Deaths', colDeaths, y, 14, FPS_HUD_MUTED_COLOR, 'right', k);
  for (const r of rows) {
    y += rowH;
    const color = r.self ? FPS_HUD_SELF_COLOR : r.bot ? FPS_HUD_MUTED_COLOR : FPS_HUD_TEXT_COLOR;
    text(ctx, r.name, colName, y, 17, color, 'left', k);
    text(ctx, `${r.frags}`, colFrags, y, 17, color, 'right', k);
    text(ctx, `${r.deaths}`, colDeaths, y, 17, color, 'right', k);
  }
  if (s.over) {
    y += rowH * 1.4;
    text(
      ctx,
      `Next round in ${Math.ceil(s.restartInMs() / 1000)}…`,
      w / 2,
      y,
      16,
      FPS_HUD_MUTED_COLOR,
      'center',
      k,
    );
  }
}
