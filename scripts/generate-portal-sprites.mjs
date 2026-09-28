#!/usr/bin/env node
// Generates the portal furniture — what connects the floors of a building:
//
//   STAIRS    (misc, 2×2): STAIRS_UP, a flight going up to the floor above, and
//             STAIRS_DOWN, a stairwell going down to the floor below. One item in
//             the editor; the office draws whichever matches where its other end is.
//   ELEVATOR  (wall, 1×2): ELEVATOR_CLOSED, and ELEVATOR_OPEN while someone gets
//             in or out.
//
//   node scripts/generate-portal-sprites.mjs
//
// Writes webview-ui/public/assets/furniture/<ID>/ (PNGs + manifest.json). The
// office recognises them by these ids (STAIRS_GROUP_ID / ELEVATOR_GROUP_ID and
// the *_TYPE constants in webview-ui/src/constants.ts). Original art.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

import { Art } from './decor-office-art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FURNITURE_DIR = path.join(ROOT, 'webview-ui', 'public', 'assets', 'furniture');

const P = {
  ink: '#2A2230',
  stone: '#8C8398',
  stoneDark: '#6A6276',
  stoneHi: '#B3ABC0',
  tread: '#D8C8A8',
  treadHi: '#EADDC0',
  riser: '#A08A6C',
  riserDark: '#7C6850',
  rail: '#5A4A3A',
  railHi: '#8A7058',
  arrowUp: '#7CC78A',
  arrowDown: '#E8A05A',
  pit0: '#B7A68A',
  pit1: '#8E7E66',
  pit2: '#665A48',
  pit3: '#443B30',
  pit4: '#2A241E',
  metal: '#AEB6C6',
  metalHi: '#D5DBE6',
  metalDark: '#7C859A',
  frame: '#4E5468',
  frameHi: '#6A7188',
  seam: '#3A3F50',
  display: '#1C1E2A',
  lamp: '#FFB347',
  car: '#F0E4C0',
  carDark: '#C9B98E',
  carFloor: '#8A7A5E',
};

/** Art → PNG buffer. */
function png(art) {
  const out = new PNG({ width: art.w, height: art.h });
  out.data.fill(0);
  art.px.forEach((row, y) =>
    row.forEach((c, x) => {
      if (!c) return;
      const n = parseInt(c.slice(1, 7), 16);
      const i = (y * art.w + x) * 4;
      out.data[i] = (n >> 16) & 255;
      out.data[i + 1] = (n >> 8) & 255;
      out.data[i + 2] = n & 255;
      out.data[i + 3] = c.length > 7 ? parseInt(c.slice(7, 9), 16) : 255;
    }),
  );
  return PNG.sync.write(out);
}

/** A small chevron pointing up or down, centered on (cx, cy). */
function chevron(a, cx, cy, up, c) {
  for (let i = 0; i < 3; i++) {
    const y = up ? cy - 1 + i : cy + 1 - i;
    a.hline(cx - i, cx + i + 1, y, c);
  }
}

/** A flight going up, away from the viewer: stone side walls with a rail, treads
 *  getting lighter toward the top, the next floor's landing dark beyond it. */
function stairsUp() {
  const a = new Art(32, 32);
  // Side walls (stringers) with a wooden handrail on top.
  a.rect(0, 0, 3, 31, P.stone).rect(28, 0, 31, 31, P.stone);
  a.vline(3, 0, 31, P.stoneDark).vline(28, 0, 31, P.stoneDark);
  a.vline(0, 0, 31, P.stoneHi).vline(31, 0, 31, P.stoneHi);
  a.rect(1, 0, 2, 31, P.rail).rect(29, 0, 30, 31, P.rail);
  a.vline(1, 0, 31, P.railHi).vline(29, 0, 31, P.railHi);
  // Landing of the floor above, in shadow.
  a.rect(4, 0, 27, 3, P.pit3);
  a.hline(4, 27, 3, P.pit2);
  // Seven steps: tread + riser, nearest at the bottom.
  const steps = 7;
  for (let i = 0; i < steps; i++) {
    const y0 = 4 + i * 4;
    const far = i < 3; // farther steps sit a little darker
    a.rect(4, y0, 27, y0 + 2, far ? P.tread : P.treadHi);
    a.hline(4, 27, y0, far ? P.treadHi : P.treadHi);
    a.hline(4, 27, y0 + 3, i === steps - 1 ? P.riserDark : P.riser);
  }
  chevron(a, 15, 20, true, P.arrowUp);
  chevron(a, 15, 12, true, P.arrowUp);
  a.outline(P.ink);
  return a;
}

/** A stairwell going down, into the floor: a railing on three sides, steps
 *  sinking into the dark, the open side facing the viewer. */
function stairsDown() {
  const a = new Art(32, 32);
  // The floor opening, darker the deeper.
  const bands = [P.pit4, P.pit4, P.pit3, P.pit3, P.pit2, P.pit2, P.pit1, P.pit0];
  for (let i = 0; i < bands.length; i++) {
    const y0 = 3 + i * 3 + Math.floor(i / 2);
    a.rect(4, y0, 27, Math.min(31, y0 + 3), bands[i]);
    if (i >= 2) a.hline(4, 27, y0, i >= 5 ? P.pit0 : P.pit1);
  }
  a.rect(4, 28, 27, 31, P.pit0);
  a.hline(4, 27, 28, P.tread);
  // Railing: back and sides, posts at the corners and midway.
  a.rect(0, 0, 31, 2, P.rail);
  a.hline(0, 31, 0, P.railHi);
  a.rect(0, 0, 3, 31, P.stone).rect(28, 0, 31, 31, P.stone);
  a.vline(3, 3, 31, P.stoneDark).vline(28, 3, 31, P.stoneDark);
  a.rect(1, 0, 2, 31, P.rail).rect(29, 0, 30, 31, P.rail);
  a.vline(1, 0, 31, P.railHi).vline(29, 0, 31, P.railHi);
  for (const x of [1, 15, 29]) a.rect(x, 0, x + 1, 2, P.rail);
  chevron(a, 15, 22, false, P.arrowDown);
  chevron(a, 15, 14, false, P.arrowDown);
  a.outline(P.ink);
  return a;
}

/** An elevator door on the wall: steel frame, a floor display above, sliding doors. */
function elevator(open) {
  const a = new Art(16, 32);
  // Frame
  a.rect(0, 5, 15, 31, P.frame);
  a.vline(0, 5, 31, P.frameHi).hline(0, 15, 5, P.frameHi);
  // Floor display with its lamp
  a.rect(4, 6, 11, 9, P.display);
  a.rect(7, 7, 8, 8, P.lamp);
  if (open) {
    // The car: lit back wall, floor, doors slid into the frame.
    a.rect(2, 11, 13, 31, P.car);
    a.rect(2, 11, 13, 13, P.carDark);
    a.rect(2, 27, 13, 31, P.carFloor);
    a.rect(2, 11, 3, 31, P.metalDark).rect(12, 11, 13, 31, P.metalDark);
  } else {
    a.rect(2, 11, 13, 31, P.metal);
    a.vline(7, 11, 31, P.seam).vline(8, 11, 31, P.seam);
    a.vline(2, 11, 31, P.metalHi).vline(9, 11, 31, P.metalHi);
    a.hline(2, 13, 11, P.metalDark);
  }
  a.outline(P.ink);
  return a;
}

function writeGroup(id, name, category, canPlaceOnWalls, members) {
  const dir = path.join(FURNITURE_DIR, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const manifestMembers = members.map(({ id: assetId, art, state }) => {
    fs.writeFileSync(path.join(dir, `${assetId}.png`), png(art));
    return {
      type: 'asset',
      id: assetId,
      file: `${assetId}.png`,
      width: art.w,
      height: art.h,
      footprintW: Math.round(art.w / 16),
      footprintH: Math.round(art.h / 16),
      state,
    };
  });
  const manifest = {
    id,
    name,
    category,
    type: 'group',
    groupType: 'state',
    canPlaceOnWalls,
    canPlaceOnSurfaces: false,
    backgroundTiles: 0,
    members: manifestMembers,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${id} (${members.map((m) => m.id).join(', ')})`);
}

writeGroup('STAIRS', 'Stairs', 'misc', false, [
  { id: 'STAIRS_UP', art: stairsUp(), state: 'off' },
  { id: 'STAIRS_DOWN', art: stairsDown(), state: 'on' },
]);
writeGroup('ELEVATOR', 'Elevator', 'wall', true, [
  { id: 'ELEVATOR_CLOSED', art: elevator(false), state: 'off' },
  { id: 'ELEVATOR_OPEN', art: elevator(true), state: 'on' },
]);
