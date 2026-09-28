#!/usr/bin/env node
// Generates the desk-decoration furniture assets (plants, office bits, seasonal
// and special items) from the pixel art below: one folder per item under
// webview-ui/public/assets/furniture/<ID>/ with <ID>.png and manifest.json.
//
//   node scripts/generate-decor-sprites.mjs
//
// Art rows are 16 characters; '.' is transparent, every other character is a
// key of the item's palette. Desk items (surface) are drawn from the top of
// their tile, like COFFEE; floor items (16x32) stand on the bottom of theirs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PNG } from 'pngjs';

import {
  curvedDesk,
  keyboardFront,
  keyboardSide,
  monitorBack,
  monitorFront,
  monitorSide,
  mouse,
  officeChair,
  officeDesk,
  pcTower,
  pie,
  plantStand,
  robotArm,
  tallMonitorBack,
  tallMonitorFront,
  tallMonitorSide,
} from './decor-office-art.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FURNITURE_DIR = path.join(ROOT, 'webview-ui', 'public', 'assets', 'furniture');

/** @type {Array<{id: string, name: string, kind: 'surface' | 'floor', palette: Record<string,string>, art: string[]}>} */
const ITEMS = [
  {
    id: 'SUCCULENT',
    name: 'Succulent',
    kind: 'surface',
    palette: { o: '#230D0F', P: '#D98A52', p: '#B0643A', g: '#4F7147', G: '#89A057', L: '#B7C067' },
    art: [
      '.......gg.......',
      '....g.gGGg.g....',
      '...gGgGLLGgGg...',
      '....gGGLLGGg....',
      '.....oooooo.....',
      '.....oPPPpo.....',
      '.....opPPpo.....',
      '......oppo......',
      '......oooo......',
    ],
  },
  {
    id: 'PHOTO_FRAME',
    name: 'Photo frame',
    kind: 'surface',
    palette: { o: '#230D0F', F: '#B07A3A', s: '#7AB0E0', h: '#5A9A4A', w: '#F0D060' },
    art: [
      '....oooooooo....',
      '....oFFFFFFo....',
      '....oFsswsFo....',
      '....oFshssFo....',
      '....oFhhhhFo....',
      '....oFFFFFFo....',
      '....oooooooo....',
      '.......oo.......',
    ],
  },
  {
    id: 'RUBBER_DUCK',
    name: 'Rubber duck',
    kind: 'surface',
    palette: { o: '#3A2A10', y: '#F2D03A', Y: '#FFF080', b: '#E87A20', e: '#1A1A1A' },
    art: [
      '......oooo......',
      '.....oyyyyo.....',
      '.....oyyeyobb...',
      '.oo..oyyyyo.....',
      '.oyooyyyyyyo....',
      '.oyyyyyYYyyyo...',
      '.oyyyyyyyyyyo...',
      '..oyyyyyyyyo....',
      '...oooooooo.....',
    ],
  },
  {
    id: 'BOOK_STACK',
    name: 'Books',
    kind: 'surface',
    palette: {
      o: '#230D0F',
      R: '#E86060',
      r: '#C83A3A',
      B: '#6A9AF0',
      b: '#3A6AD8',
      G: '#6ACA7A',
      g: '#3A9A4A',
      p: '#F0E8D0',
    },
    art: [
      '....oooooooo....',
      '....oRrrrrpo....',
      '...ooooooooooo..',
      '...oBbbbbbbbpo..',
      '..oooooooooooo..',
      '..oGgggggggggpo.',
      '..ooooooooooooo.',
    ],
  },
  {
    id: 'PENCIL_CUP',
    name: 'Pencil cup',
    kind: 'surface',
    palette: {
      o: '#230D0F',
      C: '#8A9ABA',
      c: '#5A6A8A',
      t: '#3A2A10',
      w: '#E8C890',
      y: '#F2C230',
      r: '#D63A3A',
      b: '#3A6AD8',
    },
    art: [
      '......t.t.t.....',
      '......w.w.w.....',
      '......y.r.b.....',
      '......y.r.b.....',
      '.....ooooooo....',
      '.....oCcccco....',
      '.....oCcccco....',
      '.....oCcccco....',
      '.....ooooooo....',
    ],
  },
  {
    id: 'DESK_LAMP',
    name: 'Desk lamp',
    kind: 'surface',
    palette: { o: '#230D0F', G: '#6ACA7A', g: '#3A9A4A', l: '#FFF27A', k: '#3A3A46' },
    art: [
      '.........oooo...',
      '........oGGGGo..',
      '.......oggggggo.',
      '......k..llll...',
      '.....k..........',
      '....k...........',
      '....k...........',
      '...ooooo........',
      '...okkko........',
    ],
  },
  {
    id: 'SPRING_FLOWERS',
    name: 'Spring flowers',
    kind: 'surface',
    palette: {
      o: '#230D0F',
      V: '#A8D0F0',
      v: '#7AB0E0',
      p: '#F072A8',
      y: '#F2C230',
      r: '#E04848',
      g: '#4AA050',
    },
    art: [
      '...pp..yy..rr...',
      '...pp..yy..rr...',
      '....g..g...g....',
      '.....g.g..g.....',
      '......gggg......',
      '.....oooooo.....',
      '.....oVvvvo.....',
      '......ovvo......',
      '......ovvo......',
      '.....oooooo.....',
    ],
  },
  {
    id: 'PUMPKIN',
    name: 'Pumpkin',
    kind: 'surface',
    palette: { o: '#3A1A08', O: '#E8781A', L: '#F8A040', s: '#4A7A30', y: '#F2D03A' },
    art: [
      '.......s........',
      '.......ss.......',
      '....oooooooo....',
      '...oOLOOOOLOo...',
      '..oOLyOOOOyLOo..',
      '..oOLOOyyOOLOo..',
      '..oOLyyyyyyLOo..',
      '...oOLOOOOLOo...',
      '....oooooooo....',
    ],
  },
  {
    id: 'XMAS_TREE',
    name: 'Christmas tree',
    kind: 'floor',
    palette: {
      o: '#0E2A14',
      G: '#4AAA5A',
      g: '#2A7A3A',
      Y: '#F2D03A',
      r: '#E04848',
      b: '#3A8AD8',
      t: '#6A4020',
      T: '#B03030',
    },
    art: [
      '.......YY.......',
      '......YYYY......',
      '.......YY.......',
      '.......oo.......',
      '......oGGo......',
      '.....oGggGo.....',
      '.....oggrgo.....',
      '....oGgggggo....',
      '...oGggbgggGo...',
      '....ooGgggoo....',
      '....oGgggrgo....',
      '...oGgYgggggo...',
      '..oGggggggbgGo..',
      '...oooGggGooo...',
      '...oGgggrgggo...',
      '..oGggbgggggGo..',
      '.oGgggggYgggggo.',
      'oGggrgggggbgggGo',
      '.oooooooooooooo.',
      '......otto......',
      '......otto......',
      '.....oTTTTo.....',
      '.....oTTTTo.....',
      '......oooo......',
    ],
  },
  {
    id: 'GIFT_BOX',
    name: 'Gift',
    kind: 'surface',
    palette: { o: '#1A2A1A', G: '#3AA050', g: '#2A7A3A', R: '#E83A3A', r: '#B02424' },
    art: [
      '.....rr..rr.....',
      '.......rr.......',
      '....oooRRooo....',
      '....oGGRRGGo....',
      '....oRRRRRRo....',
      '....oGGRRGGo....',
      '....ogGRRGgo....',
      '....oooooooo....',
    ],
  },
  {
    id: 'SNOWMAN',
    name: 'Snowman',
    kind: 'floor',
    palette: {
      o: '#3A3A4A',
      w: '#F2F2F2',
      W: '#D0D8E8',
      k: '#1C1C24',
      c: '#F07A20',
      r: '#D63A3A',
    },
    art: [
      '......kkkk......',
      '......kkkk......',
      '.....kkkkkk.....',
      '.....owwwwo.....',
      '....owkwwkwo....',
      '....owwwccwo....',
      '.....owwwwo.....',
      '....orrrrrro....',
      '.....owrrwo.....',
      '....owwwwwwo....',
      '...owwwkwwwwo...',
      '...oWwwwwwwWo...',
      '...owwwkwwwwo...',
      '...oWwwwwwwWo...',
      '....oWWWWWWo....',
      '.....oooooo.....',
    ],
  },
  {
    id: 'HEART_BALLOON',
    name: 'Heart balloon',
    kind: 'floor',
    palette: { o: '#5A0A1A', R: '#E83A5A', W: '#FF9AAA', s: '#D0D0D0', g: '#6A6A7A' },
    art: [
      '....ooo..ooo....',
      '...oRRRooRRRo...',
      '..oRWRRRRRRRRo..',
      '..oRRRRRRRRRRo..',
      '...oRRRRRRRRo...',
      '....oRRRRRRo....',
      '.....oRRRRo.....',
      '......oRRo......',
      '.......oo.......',
      '.......s........',
      '........s.......',
      '.......s........',
      '........s.......',
      '.......s........',
      '........s.......',
      '.......s........',
      '......oooo......',
      '......oggo......',
      '......oooo......',
    ],
  },
  {
    id: 'CARNIVAL_MASK',
    name: 'Carnival mask',
    kind: 'surface',
    palette: {
      o: '#2A0A2A',
      M: '#A040E0',
      k: '#1A0A1A',
      Y: '#F2C230',
      g: '#3AC070',
      p: '#F072A8',
    },
    art: [
      '...........g....',
      '..........gp....',
      '.........gpY....',
      '..oooooooooooo..',
      '.oMMMMMMMMMMMMo.',
      '.oMkkkMMMMkkkMo.',
      '..oMMMYooYMMMo..',
      '...oooo..oooo...',
      '...........Y....',
      '............Y...',
    ],
  },
  {
    id: 'EASTER_EGG',
    name: 'Easter egg',
    kind: 'surface',
    palette: { o: '#4A2A3A', P: '#F0A0C8', y: '#F2E060', b: '#6AB0F0' },
    art: [
      '......oooo......',
      '.....oPPPPo.....',
      '....oPyyyyPo....',
      '....oPPPPPPo....',
      '....obbbbbbo....',
      '....oPPPPPPo....',
      '.....oyyyyo.....',
      '......oooo......',
    ],
  },
  {
    id: 'JUNINA_LANTERN',
    name: 'Festa junina lantern',
    kind: 'surface',
    palette: {
      o: '#3A1A08',
      R: '#E83A3A',
      Y: '#F2C230',
      B: '#3A8AD8',
      G: '#3AA050',
      y: '#FF9A30',
    },
    art: [
      '.......oo.......',
      '......oRRo......',
      '.....oRYYRo.....',
      '....oRYYYYRo....',
      '....oBBBBBBo....',
      '....oGGGGGGo....',
      '....oYYYYYYo....',
      '.....oRRRRo.....',
      '......oyyo......',
      '.......oo.......',
    ],
  },
  {
    id: 'TROPHY',
    name: 'Trophy',
    kind: 'surface',
    palette: { o: '#5A3A08', Y: '#F2C230', W: '#FFF8C0', y: '#B0861A' },
    art: [
      '....oooooooo....',
      '..ooYYYYYYYYoo..',
      '..oYoYWYYYYoYo..',
      '..oYoYYYYYYoYo..',
      '...ooYYYYYYoo...',
      '.....oYYYYo.....',
      '......oYYo......',
      '.......YY.......',
      '.....oyyyyo.....',
      '....oyyyyyyo....',
      '....oooooooo....',
    ],
  },
  {
    id: 'BIRTHDAY_CAKE',
    name: 'Birthday cake',
    kind: 'surface',
    palette: {
      f: '#FFB030',
      c: '#6AB0F0',
      o: '#4A2A1A',
      W: '#FFF2F2',
      P: '#F072A8',
      B: '#D8A060',
    },
    art: [
      '....f..f..f.....',
      '....c..c..c.....',
      '....c..c..c.....',
      '...oooooooooo...',
      '...oWWPWWPWWo...',
      '...oPPPPPPPPo...',
      '...oBBBBBBBBo...',
      '...oBBBBBBBBo...',
      '..oooooooooooo..',
    ],
  },
];

// ── Desk setup: items with a front, back and side (screen toward the chair) ──
//
// Rotation groups like the PC: `front` faces a person sitting below the desk,
// `back` one sitting above it, `side` one sitting to its left (mirrored for the
// right). Desk decoration picks the variant that faces the person's chair.

const TECH = {
  k: '#1A1A22',
  K: '#3A3A48',
  g: '#8A8E9A',
  G: '#B8BCC6',
  w: '#E8EAF0',
  S: '#1E2A5A',
  M: '#E050C0',
  C: '#40D0E8',
  Y: '#F0D040',
  L: '#7AE080',
};

/** @type {Array<{id: string, name: string, scheme: string, palette: Record<string,string>, members: Array<{orientation: string, art: string[], mirrorSide?: boolean}>}>} */
const GROUPS = [
  {
    id: 'LAPTOP',
    name: 'Laptop',
    scheme: '3-way-mirror',
    palette: TECH,
    members: [
      {
        orientation: 'front',
        art: [
          '................',
          '...kkkkkkkkkk...',
          '...kSSSSSSSSk...',
          '...kSLLSYYSSk...',
          '...kSSCCCSSSk...',
          '...kSMMSLLLSk...',
          '...kSSSSSSSSk...',
          '...kkkkkkkkkk...',
          '..kGGGGGGGGGGk..',
          '..kGwGwGwGwGGk..',
          '.kkkkkkkkkkkkkk.',
        ],
      },
      {
        orientation: 'back',
        art: [
          '................',
          '...kkkkkkkkkk...',
          '...kGGGGGGGGk...',
          '...kGGGGGGGGk...',
          '...kGGGwwGGGk...',
          '...kGGGGGGGGk...',
          '...kGGGGGGGGk...',
          '...kggggggggk...',
          '..kkkkkkkkkkkk..',
        ],
      },
      {
        orientation: 'side',
        mirrorSide: true,
        art: [
          '................',
          '................',
          '..........kk....',
          '.........kCk....',
          '.........kCk....',
          '........kCk.....',
          '........kCk.....',
          '.......kCk......',
          '..kkkkkkkkkk....',
          '..kGwGwGwGGk....',
          '..kkkkkkkkkk....',
        ],
      },
    ],
  },
];

function hexToRgba(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

function render(item) {
  const height = item.kind === 'floor' || item.art.length > 16 ? 32 : 16;
  const png = new PNG({ width: 16, height });
  png.data.fill(0);
  // Desk items start at the top of the tile; floor items end two rows above its bottom (like the plants).
  const top = item.kind === 'floor' ? height - 1 - item.art.length : 0;
  if (top < 0) throw new Error(`${item.id}: art is taller than ${height} rows`);
  item.art.forEach((row, i) => {
    if (row.length !== 16)
      throw new Error(`${item.id} row ${i}: ${row.length} columns, expected 16`);
    [...row].forEach((key, x) => {
      if (key === '.') return;
      const color = item.palette[key];
      if (!color) throw new Error(`${item.id} row ${i}: no color for '${key}'`);
      const [r, g, b, a] = hexToRgba(color);
      const idx = ((top + i) * 16 + x) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    });
  });
  return PNG.sync.write(png);
}

/** Size fields of a rendered item: desk items taller than a tile take two (the top one a background row). */
function sizeOf(item) {
  const tall = item.kind === 'floor' || item.art.length > 16;
  return {
    width: 16,
    height: tall ? 32 : 16,
    footprintW: 1,
    footprintH: tall ? 2 : 1,
    backgroundTiles: tall ? 1 : 0,
  };
}

for (const item of ITEMS) {
  const dir = path.join(FURNITURE_DIR, item.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${item.id}.png`), render(item));
  const floor = item.kind === 'floor';
  const { backgroundTiles, ...size } = sizeOf(item);
  const manifest = {
    id: item.id,
    name: item.name,
    category: 'decor',
    type: 'asset',
    canPlaceOnWalls: false,
    canPlaceOnSurfaces: !floor,
    backgroundTiles,
    ...size,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${item.id}`);
}

const mirrorArt = (art) => art.map((row) => [...row].reverse().join(''));

for (const group of GROUPS) {
  const dir = path.join(FURNITURE_DIR, group.id);
  fs.mkdirSync(dir, { recursive: true });
  const front = group.members.find((m) => m.orientation === 'front');
  const members = group.members.map((m) => {
    const art = m.art === 'MIRROR_FRONT' ? mirrorArt(front.art) : m.art;
    const id = `${group.id}_${m.orientation.toUpperCase()}`;
    const item = { id, kind: 'surface', palette: group.palette, art };
    fs.writeFileSync(path.join(dir, `${id}.png`), render(item));
    const { backgroundTiles: _bg, ...size } = sizeOf(item);
    return {
      type: 'asset',
      id,
      file: `${id}.png`,
      ...size,
      orientation: m.orientation,
      ...(m.mirrorSide ? { mirrorSide: true } : {}),
    };
  });
  const tall = members.some((m) => m.footprintH > 1);
  const manifest = {
    id: group.id,
    name: group.name,
    category: 'decor',
    type: 'group',
    groupType: 'rotation',
    rotationScheme: group.scheme,
    canPlaceOnWalls: false,
    canPlaceOnSurfaces: true,
    backgroundTiles: tall ? 1 : 0,
    members,
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${group.id} (${members.map((m) => m.orientation).join(', ')})`);
}

// ── Modern office set (procedural art, see decor-office-art.mjs) ─────────

/** Art → PNG. */
function artPng(art) {
  const png = new PNG({ width: art.w, height: art.h });
  png.data.fill(0);
  art.px.forEach((row, y) =>
    row.forEach((c, x) => {
      if (!c) return;
      const n = parseInt(c.slice(1, 7), 16);
      const i = (y * art.w + x) * 4;
      png.data[i] = (n >> 16) & 255;
      png.data[i + 1] = (n >> 8) & 255;
      png.data[i + 2] = n & 255;
      png.data[i + 3] = c.length > 7 ? parseInt(c.slice(7, 9), 16) : 255;
    }),
  );
  return PNG.sync.write(png);
}

function artSize(art, category) {
  const footprintW = Math.max(1, Math.round(art.w / 16));
  const footprintH = Math.max(1, Math.round(art.h / 16));
  return {
    width: art.w,
    height: art.h,
    footprintW,
    footprintH,
    // Tall things let characters pass behind their top row (desks, chairs, plants).
    backgroundTiles: footprintH > 1 && category !== 'wall' ? 1 : 0,
  };
}

/**
 * @type {Array<{id: string, name: string, category: string, surface?: boolean,
 *   art?: import('./decor-office-art.mjs').Art,
 *   scheme?: string, members?: Array<[string, import('./decor-office-art.mjs').Art, boolean?]>}>}
 */
const OFFICE = [
  { id: 'OFFICE_DESK', name: 'Office desk', category: 'desks', art: officeDesk(64) },
  { id: 'OFFICE_DESK_3', name: 'Office desk (small)', category: 'desks', art: officeDesk(48) },
  { id: 'CURVED_DESK', name: 'Curved desk', category: 'desks', art: curvedDesk(64) },
  { id: 'CURVED_DESK_3', name: 'Curved desk (small)', category: 'desks', art: curvedDesk(48) },
  { id: 'OFFICE_DESK_2', name: 'Office desk (2 tiles)', category: 'desks', art: officeDesk(32) },
  { id: 'CURVED_DESK_2', name: 'Curved desk (2 tiles)', category: 'desks', art: curvedDesk(32) },
  {
    id: 'OFFICE_CHAIR',
    name: 'Office chair',
    category: 'chairs',
    scheme: '3-way-mirror',
    members: [
      ['front', officeChair('front', true)],
      ['back', officeChair('back', true)],
      ['side', officeChair('side', true), true],
    ],
  },
  {
    id: 'OFFICE_CHAIR_SMALL',
    name: 'Office chair (1 tile)',
    category: 'chairs',
    scheme: '3-way-mirror',
    members: [
      ['front', officeChair('front', false)],
      ['back', officeChair('back', false)],
      ['side', officeChair('side', false), true],
    ],
  },
  {
    id: 'MONITOR',
    name: 'Monitor',
    category: 'decor',
    surface: true,
    scheme: '3-way-mirror',
    members: [
      ['front', monitorFront()],
      ['back', monitorBack()],
      ['side', monitorSide(), true],
    ],
  },
  {
    id: 'MONITOR_CODE',
    name: 'Portrait monitor',
    category: 'decor',
    surface: true,
    scheme: '3-way-mirror',
    members: [
      ['front', tallMonitorFront()],
      ['back', tallMonitorBack()],
      ['side', tallMonitorSide(), true],
    ],
  },
  {
    id: 'KEYBOARD',
    name: 'Keyboard',
    category: 'decor',
    surface: true,
    scheme: '3-way-mirror',
    members: [
      ['front', keyboardFront()],
      ['back', keyboardFront()],
      ['side', keyboardSide(), true],
    ],
  },
  {
    id: 'ROBOT_ARM',
    name: 'Robot arm',
    category: 'decor',
    surface: true,
    scheme: '2-way',
    members: [
      ['front', robotArm()],
      ['side', robotArm().mirrored()],
    ],
  },
  { id: 'MOUSE', name: 'Mouse', category: 'decor', surface: true, art: mouse() },
  { id: 'PIE', name: 'Pie', category: 'decor', surface: true, art: pie() },
  { id: 'PC_TOWER', name: 'PC tower', category: 'decor', surface: true, art: pcTower() },
  { id: 'PLANT_STAND', name: 'Plant on a stand', category: 'decor', art: plantStand() },
];

for (const item of OFFICE) {
  const dir = path.join(FURNITURE_DIR, item.id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const common = {
    id: item.id,
    name: item.name,
    category: item.category,
    canPlaceOnWalls: false,
    canPlaceOnSurfaces: !!item.surface,
  };
  let manifest;
  if (item.art) {
    fs.writeFileSync(path.join(dir, `${item.id}.png`), artPng(item.art));
    manifest = { ...common, type: 'asset', ...artSize(item.art, item.category) };
  } else {
    const members = item.members.map(([orientation, art, mirrorSide]) => {
      const id = `${item.id}_${orientation.toUpperCase()}`;
      fs.writeFileSync(path.join(dir, `${id}.png`), artPng(art));
      const { backgroundTiles: _bg, ...size } = artSize(art, item.category);
      return {
        type: 'asset',
        id,
        file: `${id}.png`,
        ...size,
        orientation,
        ...(mirrorSide ? { mirrorSide: true } : {}),
      };
    });
    manifest = {
      ...common,
      type: 'group',
      groupType: 'rotation',
      rotationScheme: item.scheme,
      backgroundTiles: artSize(item.members[0][1], item.category).backgroundTiles,
      members,
    };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${item.id}`);
}

// Superseded by OFFICE_DESK / CURVED_DESK.
fs.rmSync(path.join(FURNITURE_DIR, 'WHITE_DESK'), { recursive: true, force: true });
