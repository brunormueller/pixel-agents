#!/usr/bin/env node
// Generates the DOOR furniture: a door that sits in a wall (the wall tile it is
// placed on becomes its doorway) and opens by itself when someone walks through.
//
//   DOOR_FRONT[_HALF|_OPEN]  in a wall running left-right (walk through up/down)
//   DOOR_SIDE[_HALF|_OPEN]   in a wall running up-down (walk through left/right)
//
//   node scripts/generate-door-sprites.mjs
//
// 16×32 like a wall piece: the top 8 px are the lintel (level with the wall's
// top), the bottom 16 px the doorway tile. Mid-tone wood so the editor's color
// controls (adjust or colorize) tint it well. The office picks the frame
// (closed / half / open) from who is near; the placed type is the closed one.
// Original art.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

import { Art } from './decor-office-art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'webview-ui', 'public', 'assets', 'furniture', 'DOOR');

const P = {
  ink: '#2A2230',
  frame: '#6B4428',
  frameHi: '#8A5A36',
  panel: '#A8743F',
  panelHi: '#C48E56',
  panelDark: '#855A30',
  edge: '#6E4A28',
  knob: '#F2C94C',
  shadow: '#1E1824',
};

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

/** The lintel across the top, level with the wall's top face. */
function lintel(a) {
  a.rect(0, 0, 15, 7, P.frame);
  a.hline(0, 15, 0, P.ink).hline(0, 15, 7, P.ink);
  a.hline(1, 14, 1, P.frameHi);
}

/** A door panel between x0..x1, rows 9..30, with two insets and a knob. */
function panel(a, x0, x1, knobX) {
  a.rect(x0, 9, x1, 30, P.panel);
  a.vline(x0, 9, 30, P.panelHi);
  if (x1 - x0 >= 6) {
    a.rect(x0 + 2, 11, x1 - 2, 18, P.panelDark).rect(x0 + 3, 12, x1 - 3, 17, P.panel);
    a.rect(x0 + 2, 21, x1 - 2, 28, P.panelDark).rect(x0 + 3, 22, x1 - 3, 27, P.panel);
  }
  if (knobX !== null) a.rect(knobX, 19, knobX, 20, P.knob);
  a.hline(x0, x1, 30, P.panelDark);
}

function front(frame) {
  const a = new Art(16, 32);
  lintel(a);
  // Posts
  a.rect(0, 8, 1, 31, P.frame).rect(14, 8, 15, 31, P.frame);
  a.vline(0, 8, 31, P.ink).vline(15, 8, 31, P.ink);
  if (frame === 'closed') {
    panel(a, 2, 13, 11);
  } else if (frame === 'half') {
    // Swinging in: narrower, darker as it turns away.
    a.rect(2, 9, 8, 30, P.panelDark);
    a.vline(2, 9, 30, P.panelHi).vline(8, 9, 30, P.edge);
    a.rect(4, 12, 6, 17, P.panel).rect(4, 22, 6, 27, P.panel);
  } else {
    // Open against the left post, seen edge-on.
    a.rect(2, 9, 4, 30, P.panelDark);
    a.vline(2, 9, 30, P.panelHi);
  }
  return a;
}

function side(frame) {
  const a = new Art(16, 32);
  lintel(a);
  if (frame === 'closed') {
    // Seen edge-on, along the wall line.
    a.rect(6, 8, 9, 31, P.panel);
    a.vline(6, 8, 31, P.ink).vline(9, 8, 31, P.ink);
    a.vline(7, 8, 30, P.panelHi);
    a.rect(8, 19, 8, 20, P.knob);
  } else if (frame === 'half') {
    a.rect(6, 8, 11, 31, P.panelDark);
    a.vline(6, 8, 31, P.ink).vline(11, 8, 31, P.ink);
    a.rect(8, 12, 9, 27, P.panel);
  } else {
    // Swung open: its face toward the viewer, against the wall.
    a.rect(8, 8, 15, 31, P.panel);
    a.vline(8, 8, 31, P.ink).vline(15, 8, 31, P.ink).hline(8, 15, 31, P.ink);
    a.rect(10, 11, 13, 18, P.panelDark).rect(11, 12, 12, 17, P.panel);
    a.rect(10, 21, 13, 28, P.panelDark).rect(11, 22, 12, 27, P.panel);
  }
  return a;
}

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const asset = (id, art, state) => {
  fs.writeFileSync(path.join(DIR, `${id}.png`), png(art));
  return {
    type: 'asset',
    id,
    file: `${id}.png`,
    width: 16,
    height: 32,
    footprintW: 1,
    footprintH: 2,
    state,
  };
};

const orientation = (name, draw) => ({
  type: 'group',
  groupType: 'state',
  orientation: name,
  members: [
    asset(`DOOR_${name.toUpperCase()}`, draw('closed'), 'off'),
    asset(`DOOR_${name.toUpperCase()}_HALF`, draw('half'), 'on'),
    asset(`DOOR_${name.toUpperCase()}_OPEN`, draw('open'), 'on'),
  ],
});

const manifest = {
  id: 'DOOR',
  name: 'Door',
  category: 'wall',
  type: 'group',
  groupType: 'rotation',
  rotationScheme: '2-way',
  canPlaceOnWalls: false,
  canPlaceOnSurfaces: false,
  backgroundTiles: 1,
  members: [orientation('front', front), orientation('side', side)],
};
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote DOOR (front, side × closed, half, open)');
