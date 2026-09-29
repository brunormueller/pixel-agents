// webview-ui/src/office/sprites/fpsArt.ts
//
// The art of Pixel Frag (the first-person game): wall, floor and ceiling
// textures (16×16, generated), the pickups and props that stand in a map, a
// muzzle flash, bullet puffs and the three weapons as seen in the player's
// hands. Pixels are ImageData words (little-endian ABGR, alpha 0 = see-through),
// ready for the raycaster to copy. Pure (no DOM).

/** A texture or sprite as the raycaster reads it: `px[y * w + x]`. */
export interface FpsTexture {
  w: number;
  h: number;
  px: Uint32Array;
}

/** 0xRRGGBB (+ alpha) as an ImageData word. */
export function rgbToPixel(rgb: number, alpha = 255): number {
  return ((alpha << 24) | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)) >>> 0;
}

/** Scale a 0xRRGGBB color's channels (f > 1 lightens), clamped. */
export function shadeRgb(rgb: number, f: number): number {
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (ch((rgb >> 16) & 0xff) << 16) | (ch((rgb >> 8) & 0xff) << 8) | ch(rgb & 0xff);
}

/** Mix two 0xRRGGBB colors: t = 0 → a, 1 → b. */
export function mixRgb(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t) & 0xff;
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Multiply a texel's color by a tint (both 0xRRGGBB), as paint over a light surface. */
function multiplyRgb(rgb: number, tint: number): number {
  const ch = (s: number) => Math.round((((rgb >> s) & 0xff) * ((tint >> s) & 0xff)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Deterministic per-texel noise in [0, 1). */
function noise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const T = 16;

function makeTexture(color: (x: number, y: number) => number): FpsTexture {
  const px = new Uint32Array(T * T);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) px[y * T + x] = rgbToPixel(color(x, y));
  }
  return { w: T, h: T, px };
}

const grain = (rgb: number, x: number, y: number, seed: number, amount: number) =>
  shadeRgb(rgb, 1 - amount / 2 + noise(x, y, seed) * amount);

// ── Walls ────────────────────────────────────────────────────

const WALL_GENERATORS: Record<string, (tint: number | undefined) => FpsTexture> = {
  brick: () =>
    makeTexture((x, y) => {
      const course = Math.floor(y / 4);
      const offset = (course % 2) * 4;
      if (y % 4 === 3 || (x + offset) % 8 === 7) return grain(0x6b5f55, x, y, 3, 0.2);
      const brick = Math.floor((x + offset) / 8) + course * 3;
      const base = shadeRgb(0x8c3b2e, 0.85 + noise(brick, course, 9) * 0.3);
      return grain(base, x, y, 5, 0.18);
    }),
  stone: () =>
    makeTexture((x, y) => {
      const bx = Math.floor(x / 8);
      const by = Math.floor(y / 8);
      const edge = x % 8 === 0 || y % 8 === 0;
      const base = shadeRgb(0x6d6d78, 0.85 + noise(bx, by, 4) * 0.3);
      return edge ? shadeRgb(base, 0.6) : grain(base, x, y, 7, 0.22);
    }),
  metal: () =>
    makeTexture((x, y) => {
      if (x === 0 || y === 0) return 0x8a94a4;
      if (x === T - 1 || y === T - 1) return 0x323842;
      if ((x === 2 || x === T - 3) && (y === 2 || y === T - 3)) return 0xb0b8c8;
      return grain(0x5a6470, x, y, 11, 0.12);
    }),
  wood: () =>
    makeTexture((x, y) => {
      if (x % 4 === 0) return 0x4a3018;
      const plank = Math.floor(x / 4);
      const base = shadeRgb(0x7a5230, 0.85 + noise(plank, 0, 13) * 0.3);
      return grain(base, x, Math.floor(y / 3), 17, 0.25);
    }),
  office: (tint) =>
    makeTexture((x, y) => {
      let rgb = grain(0xd8d4cc, x, y, 19, 0.08);
      if (y >= T - 2)
        rgb = 0x6a5e52; // baseboard
      else if (y === 0) rgb = 0xb0aca4; // trim
      return tint === undefined ? rgb : multiplyRgb(rgb, tint);
    }),
  tech: () =>
    makeTexture((x, y) => {
      if (y === 7 || y === 8) return x % 4 === 0 ? 0x6ff0ff : 0x2fb0c0;
      if (x === 0 || y === 0) return 0x303a4c;
      if (x === T - 1 || y === T - 1) return 0x121620;
      if (y > 10 && y < 14 && x > 3 && x < 12) return (x + y) % 2 ? 0x2a3446 : 0x222a3a;
      return grain(0x1c2433, x, y, 23, 0.15);
    }),
  void: () =>
    makeTexture((x, y) => (noise(x, y, 29) > 0.96 ? 0x3a3f60 : grain(0x0d0f1a, x, y, 31, 0.3))),
};

/** A wall texture by id (unknown ids get stone), tinted when the map says so. */
export function wallTexture(id: string | undefined, tint?: number): FpsTexture {
  return (WALL_GENERATORS[id ?? ''] ?? WALL_GENERATORS.stone)(tint);
}

// ── Floors and ceilings ─────────────────────────────────────

const FLOOR_GENERATORS: Record<string, (tint: number | undefined) => FpsTexture> = {
  tile: () =>
    makeTexture((x, y) => {
      if (x % 8 === 0 || y % 8 === 0) return 0x5c5c66;
      const even = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      return grain(even ? 0x9a9aa4 : 0x84848e, x, y, 37, 0.08);
    }),
  concrete: () => makeTexture((x, y) => grain(0x6e6a66, x, y, 41, 0.3)),
  grid: () =>
    makeTexture((x, y) =>
      x % 8 === 0 || y % 8 === 0 ? 0x3a4458 : grain(0x20242e, x, y, 43, 0.15),
    ),
  carpet: (tint) =>
    makeTexture((x, y) => {
      const rgb = grain(0xb0b0b0, x, y, 47, 0.35);
      return multiplyRgb(rgb, tint ?? 0x44506a);
    }),
  planks: () =>
    makeTexture((x, y) => {
      if (y % 4 === 0) return 0x4a3018;
      const plank = Math.floor(y / 4);
      const shifted = (x + plank * 5) % T;
      const base = shadeRgb(0x8a6038, 0.85 + noise(plank, 1, 53) * 0.3);
      return shifted === 0 ? 0x5a3a20 : grain(base, Math.floor(x / 3), y, 59, 0.22);
    }),
  plate: () =>
    makeTexture((x, y) => {
      if ((x + y) % 4 === 0 && x % 8 < 6) return 0x7a808a;
      return grain(0x50555e, x, y, 61, 0.12);
    }),
};

export function floorTexture(id: string | undefined, tint?: number): FpsTexture {
  return (FLOOR_GENERATORS[id ?? ''] ?? FLOOR_GENERATORS.concrete)(tint);
}

/** Ceiling tiles (a drop ceiling), tinted with the map's ceiling color. */
export function ceilingTexture(tint: number): FpsTexture {
  return makeTexture((x, y) => {
    const line = x % 8 === 0 || y % 8 === 0;
    const rgb = line ? 0x9a9a94 : grain(0xf0f0ea, x, y, 67, 0.06);
    return multiplyRgb(rgb, tint);
  });
}

/** The sides of a waist-high block: a panel in the block's color with a darker frame. */
export function blockSideTexture(rgb: number): FpsTexture {
  return makeTexture((x, y) => {
    if (y === 0) return shadeRgb(rgb, 1.25);
    if (x === 0 || x === T - 1 || y === T - 1) return shadeRgb(rgb, 0.55);
    if (y === 1 || x === 1 || x === T - 2) return shadeRgb(rgb, 0.8);
    return grain(rgb, x, y, 71, 0.12);
  });
}

// ── Sprites from pixel art ───────────────────────────────────

function fromArt(rows: string[], palette: Record<string, number>): FpsTexture {
  const h = rows.length;
  const w = rows[0].length;
  const px = new Uint32Array(w * h);
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const rgb = palette[row[x]];
      px[y * w + x] = rgb === undefined ? 0 : rgbToPixel(rgb);
    }
  });
  return { w, h, px };
}

/** Pickups, standing on the floor. */
export const FPS_ITEM_ART: Record<'health' | 'shells' | 'bullets', FpsTexture> = {
  health: fromArt(
    [
      '................',
      '....kkkkkkkk....',
      '...kwwwwwwwwk...',
      '..kwwwwrrwwwwk..',
      '..kwwwwrrwwwwk..',
      '..kwwrrrrrrwwk..',
      '..kwwrrrrrrwwk..',
      '..kwwwwrrwwwwk..',
      '..kwwwwrrwwwwk..',
      '..kggggggggggk..',
      '...kkkkkkkkkk...',
    ],
    { k: 0x202028, w: 0xf0f0f0, r: 0xd02828, g: 0xb0b0b8 },
  ),
  shells: fromArt(
    [
      '...k.k.k.k.k....',
      '..kykykykykyk...',
      '..krkrkrkrkrk...',
      '..krkrkrkrkrk...',
      '..krkrkrkrkrk...',
      '..kkkkkkkkkkkk..',
      '..kbbbbbbbbbbk..',
      '..kbbbbbbbbbbk..',
      '..kBBBBBBBBBBk..',
      '..kkkkkkkkkkkk..',
    ],
    { k: 0x201810, y: 0xd8b040, r: 0xc03020, b: 0x6a5030, B: 0x4a3820 },
  ),
  bullets: fromArt(
    [
      '....k.k.k.k.....',
      '...kykykykyk....',
      '...kykykykyk....',
      '..kkkkkkkkkkkk..',
      '..kGGGGGGGGGGk..',
      '..kGGyyyyyyGGk..',
      '..kGGGGGGGGGGk..',
      '..kggggggggggk..',
      '..kkkkkkkkkkkk..',
    ],
    { k: 0x182018, y: 0xe0c050, G: 0x4a6a3a, g: 0x34502a },
  ),
};

/** Props of the built-in maps (office maps use the office's own furniture). */
export const FPS_PROP_ART: Record<string, FpsTexture> = {
  barrel: fromArt(
    [
      '..kkkkkkkk..',
      '.kGGGGGGGGk.',
      '.kgGGGGGGgk.',
      '.kkkkkkkkkk.',
      '.kgGGGGGGgk.',
      '.kgGGGGGGgk.',
      '.kgGLLGGGgk.',
      '.kgGLLGGGgk.',
      '.kkkkkkkkkk.',
      '.kgGGGGGGgk.',
      '.kgGGGGGGgk.',
      '.kgGGGGGGgk.',
      '.kkkkkkkkkk.',
      '.kgGGGGGGgk.',
      '..kkkkkkkk..',
    ],
    { k: 0x141814, G: 0x3a8a3a, g: 0x286028, L: 0x9adf6a },
  ),
  plant: fromArt(
    [
      '.....g..g.....',
      '...g.gg.g..g..',
      '..ggGgGggGg...',
      '.gGGgGGgGGgg..',
      '..gGGGgGGGg.g.',
      '.ggGgGGGgGGg..',
      '..gGGgGgGGgg..',
      '...ggGGGGgg...',
      '....gggggg....',
      '......gg......',
      '...kkkkkkkk...',
      '...kppppppk...',
      '....kppppk....',
      '....kPPPPk....',
      '.....kkkk.....',
    ],
    { g: 0x2f7a3a, G: 0x4fb04f, k: 0x3a2418, p: 0xa0583a, P: 0x804428 },
  ),
  /** Anything a map names that this office does not have. */
  box: fromArt(
    [
      'kkkkkkkkkkkk',
      'kbbbbbbbbbbk',
      'kbBbbbbbbBbk',
      'kbbBbbbbBbbk',
      'kbbbBbbBbbbk',
      'kbbbbBBbbbbk',
      'kbbbbBBbbbbk',
      'kbbbBbbBbbbk',
      'kbbBbbbbBbbk',
      'kbBbbbbbbBbk',
      'kbbbbbbbbbbk',
      'kkkkkkkkkkkk',
    ],
    { k: 0x3a2814, b: 0x9a7040, B: 0x6a4a28 },
  ),
};

export const FPS_MUZZLE_FLASH_ART: FpsTexture = fromArt(
  [
    '.....y.....',
    '..y..y..y..',
    '...yYWYy...',
    '.y.YWWWY.y.',
    'yyYWWWWWYyy',
    '.y.YWWWY.y.',
    '...yYWYy...',
    '..y..y..y..',
    '.....y.....',
  ],
  { y: 0xff9a20, Y: 0xffd040, W: 0xfff8d0 },
);

const PUFF_ROWS = ['.ggg.', 'gGGGg', 'gGWGg', 'gGGGg', '.ggg.'];
/** A bullet hitting a wall, and one hitting someone. */
export const FPS_PUFF_ART: FpsTexture = fromArt(PUFF_ROWS, {
  g: 0x807870,
  G: 0xb0a898,
  W: 0xe0d8c8,
});
export const FPS_BLOOD_ART: FpsTexture = fromArt(PUFF_ROWS, {
  g: 0x901818,
  G: 0xd03030,
  W: 0xff7070,
});

// ── Weapons in hand ──────────────────────────────────────────

/** One rectangle of a weapon's view: x, y, width, height on a 64×48 canvas, 0xRRGGBB. */
export type ArtRect = [number, number, number, number, number];

export interface WeaponArt {
  /** Drawn bottom-centred, scaled to the screen. */
  w: number;
  h: number;
  rects: ArtRect[];
  /** Drawn instead of the first `alt.length` rects on every other shot (a spinning chaingun). */
  alt?: ArtRect[];
  /** Where the muzzle flash appears. */
  muzzle: { x: number; y: number };
}

const SKIN = 0xe8b088;
const SKIN_DARK = 0xc08860;
const SLEEVE = 0x2f4f8f;
const SLEEVE_DARK = 0x223a6a;
const STEEL_DARK = 0x2a2d35;
const STEEL = 0x4a4f5c;
const STEEL_LIGHT = 0x7a8294;
const WOOD = 0x7a4a28;
const WOOD_DARK = 0x5a3418;
const HOLE = 0x0a0a0c;

const chaingunBarrels = (shift: number): ArtRect[] =>
  [0, 1, 2, 3, 4].flatMap((i): ArtRect[] => [
    [23 + i * 4, 4, 3, 26, STEEL],
    [23 + i * 4 + ((i + shift) % 2), 4, 1, 26, STEEL_LIGHT],
    [23 + i * 4, 3, 3, 2, HOLE],
  ]);

export const FPS_WEAPON_ART: WeaponArt[] = [
  // Pistol
  {
    w: 64,
    h: 48,
    muzzle: { x: 32, y: 6 },
    rects: [
      [26, 10, 12, 21, STEEL_DARK],
      [27, 10, 10, 20, STEEL],
      [28, 10, 2, 20, STEEL_LIGHT],
      [31, 7, 2, 3, STEEL_DARK],
      [30, 9, 4, 2, HOLE],
      [27, 26, 10, 2, STEEL_DARK],
      [24, 28, 16, 12, SKIN],
      [24, 30, 16, 1, SKIN_DARK],
      [24, 33, 16, 1, SKIN_DARK],
      [24, 36, 16, 4, SKIN_DARK],
      [22, 38, 20, 10, SLEEVE],
      [22, 44, 20, 4, SLEEVE_DARK],
    ],
  },
  // Shotgun
  {
    w: 64,
    h: 48,
    muzzle: { x: 32, y: 1 },
    rects: [
      [26, 2, 5, 30, STEEL],
      [33, 2, 5, 30, STEEL],
      [27, 2, 1, 30, STEEL_LIGHT],
      [34, 2, 1, 30, STEEL_LIGHT],
      [31, 2, 2, 30, STEEL_DARK],
      [27, 1, 3, 2, HOLE],
      [34, 1, 3, 2, HOLE],
      [24, 18, 16, 10, WOOD],
      [24, 26, 16, 2, WOOD_DARK],
      [25, 30, 14, 8, STEEL_DARK],
      [20, 20, 8, 9, SKIN],
      [20, 27, 8, 2, SKIN_DARK],
      [14, 26, 10, 22, SLEEVE],
      [14, 26, 3, 22, SLEEVE_DARK],
      [26, 36, 14, 10, SKIN],
      [26, 36, 14, 2, SKIN_DARK],
      [28, 42, 16, 6, SLEEVE],
    ],
  },
  // Chaingun
  {
    w: 64,
    h: 48,
    muzzle: { x: 32, y: 2 },
    rects: [
      ...chaingunBarrels(0),
      [22, 6, 21, 3, STEEL_DARK],
      [22, 18, 21, 3, STEEL_DARK],
      [21, 28, 23, 12, STEEL_DARK],
      [23, 30, 19, 2, STEEL],
      [14, 30, 10, 10, SKIN],
      [14, 37, 10, 3, SKIN_DARK],
      [41, 32, 10, 10, SKIN],
      [41, 39, 10, 3, SKIN_DARK],
      [10, 38, 12, 10, SLEEVE],
      [42, 40, 12, 8, SLEEVE],
      [42, 40, 12, 2, SLEEVE_DARK],
    ],
    alt: chaingunBarrels(1),
  },
];
