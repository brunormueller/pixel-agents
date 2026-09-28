// webview-ui/src/office/engine/decorCatalog.ts
//
// What a person can put on their desk: a curated list of furniture catalog ids
// (the same assets the layout editor places), grouped for the Decorate panel.
// Seasonal items are offered only around their date; once placed they stay.
// Pure (no DOM).

export type DecorGroup = 'setup' | 'plants' | 'office' | 'ornaments' | 'seasonal' | 'special';

/** A yearly window, inclusive: month 1-12, day 1-31. May wrap the new year. */
export interface SeasonWindow {
  from: [number, number];
  to: [number, number];
}

export interface DecorItem {
  /** Furniture catalog id (assets/furniture/<id>/). */
  id: string;
  label: string;
  group: DecorGroup;
  /** Seasonal items: when they can be picked, and what the season is called. */
  season?: { name: string; windows: SeasonWindow[] };
}

export const DECOR_GROUPS: ReadonlyArray<{ id: DecorGroup; label: string }> = [
  { id: 'setup', label: 'Desk setup' },
  { id: 'seasonal', label: 'Seasonal' },
  { id: 'special', label: 'Special' },
  { id: 'plants', label: 'Plants' },
  { id: 'office', label: 'Office' },
  { id: 'ornaments', label: 'Ornaments' },
];

const CHRISTMAS: SeasonWindow = { from: [12, 1], to: [1, 6] };

export const DECOR_ITEMS: readonly DecorItem[] = [
  // Desk setup: turn to face the chair (front / back / side), placed to the pixel
  { id: 'MONITOR_FRONT', label: 'Monitor', group: 'setup' },
  { id: 'MONITOR_CODE_FRONT', label: 'Code monitor', group: 'setup' },
  { id: 'LAPTOP_FRONT', label: 'Laptop', group: 'setup' },
  { id: 'KEYBOARD_FRONT', label: 'Keyboard', group: 'setup' },
  { id: 'MOUSE', label: 'Mouse', group: 'setup' },
  { id: 'ROBOT_ARM_FRONT', label: 'Robot arm', group: 'setup' },
  { id: 'PC_TOWER', label: 'PC tower', group: 'setup' },
  { id: 'DESK_LAMP', label: 'Desk lamp', group: 'setup' },
  // Plants
  { id: 'PLANT_STAND', label: 'Fig on a stand', group: 'plants' },
  { id: 'SUCCULENT', label: 'Succulent', group: 'plants' },
  { id: 'CACTUS', label: 'Cactus', group: 'plants' },
  { id: 'PLANT', label: 'Plant', group: 'plants' },
  { id: 'PLANT_2', label: 'Leafy plant', group: 'plants' },
  { id: 'POT', label: 'Pot', group: 'plants' },
  { id: 'HANGING_PLANT', label: 'Hanging plant', group: 'plants' },
  // Office
  { id: 'COFFEE', label: 'Coffee', group: 'office' },
  { id: 'PIE', label: 'Pie', group: 'office' },
  { id: 'PENCIL_CUP', label: 'Pencil cup', group: 'office' },
  { id: 'BOOK_STACK', label: 'Books', group: 'office' },
  { id: 'BIN', label: 'Bin', group: 'office' },
  { id: 'CLOCK', label: 'Clock', group: 'office' },
  // Ornaments
  { id: 'PHOTO_FRAME', label: 'Photo frame', group: 'ornaments' },
  { id: 'RUBBER_DUCK', label: 'Rubber duck', group: 'ornaments' },
  { id: 'SMALL_PAINTING', label: 'Painting', group: 'ornaments' },
  { id: 'SMALL_PAINTING_2', label: 'Painting (2)', group: 'ornaments' },
  // Special: always there, for the moments worth marking
  { id: 'TROPHY', label: 'Trophy', group: 'special' },
  { id: 'BIRTHDAY_CAKE', label: 'Birthday cake', group: 'special' },
  // Seasonal
  {
    id: 'CARNIVAL_MASK',
    label: 'Carnival mask',
    group: 'seasonal',
    season: { name: 'Carnival', windows: [{ from: [2, 1], to: [3, 10] }] },
  },
  {
    id: 'HEART_BALLOON',
    label: 'Heart balloon',
    group: 'seasonal',
    season: {
      name: "Valentine's",
      windows: [
        { from: [2, 1], to: [2, 14] },
        { from: [6, 1], to: [6, 12] },
      ],
    },
  },
  {
    id: 'EASTER_EGG',
    label: 'Easter egg',
    group: 'seasonal',
    season: { name: 'Easter', windows: [{ from: [3, 15], to: [4, 30] }] },
  },
  {
    id: 'JUNINA_LANTERN',
    label: 'Festa junina lantern',
    group: 'seasonal',
    season: { name: 'Festa junina', windows: [{ from: [6, 1], to: [7, 31] }] },
  },
  {
    id: 'SPRING_FLOWERS',
    label: 'Spring flowers',
    group: 'seasonal',
    season: { name: 'Spring', windows: [{ from: [9, 20], to: [10, 31] }] },
  },
  {
    id: 'PUMPKIN',
    label: 'Pumpkin',
    group: 'seasonal',
    season: { name: 'Halloween', windows: [{ from: [10, 1], to: [11, 2] }] },
  },
  {
    id: 'XMAS_TREE',
    label: 'Christmas tree',
    group: 'seasonal',
    season: { name: 'Christmas', windows: [CHRISTMAS] },
  },
  {
    id: 'GIFT_BOX',
    label: 'Gift',
    group: 'seasonal',
    season: { name: 'Christmas', windows: [CHRISTMAS] },
  },
  {
    id: 'SNOWMAN',
    label: 'Snowman',
    group: 'seasonal',
    season: { name: 'Winter holidays', windows: [{ from: [12, 1], to: [1, 31] }] },
  },
];

/** Styles a person can draw their own desk (and chair) in. Each has a variant per
 *  desk size (`<id>`, `<id>_3`, `<id>_2`: 4, 3 and 2 tiles wide). */
export const DESK_STYLES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'CURVED_DESK', label: 'Curved' },
  { id: 'OFFICE_DESK', label: 'Office' },
];

/** A whole desk in one click: a style, the desk cleared, items placed at fractions
 *  of the tabletop (for a chair in front of the desk: fx left→right, fy back→front;
 *  turned for other chairs) and floor pieces beside it. */
export interface DeskPreset {
  id: string;
  label: string;
  description: string;
  deskStyle: string;
  /** `minWidth`: only on tabletops at least this many pixels wide (a small desk skips it). */
  items: ReadonlyArray<{ type: string; fx: number; fy: number; minWidth?: number }>;
  floor: readonly string[];
}

export const DESK_PRESETS: readonly DeskPreset[] = [
  {
    id: 'studio',
    label: 'Studio desk',
    description:
      'Curved desk, robot arm, PC tower, two monitors, keyboard, mouse, a pie and a fig.',
    deskStyle: 'CURVED_DESK',
    items: [
      { type: 'ROBOT_ARM_FRONT', fx: 0.12, fy: 0.62 },
      { type: 'PC_TOWER', fx: 0.3, fy: 0.42, minWidth: 56 },
      { type: 'MONITOR_FRONT', fx: 0.48, fy: 0.46 },
      { type: 'MONITOR_CODE_FRONT', fx: 0.69, fy: 0.46 },
      { type: 'KEYBOARD_FRONT', fx: 0.49, fy: 0.82 },
      { type: 'MOUSE', fx: 0.64, fy: 0.82 },
      { type: 'PIE', fx: 0.87, fy: 0.9 },
    ],
    floor: ['PLANT_STAND'],
  },
];

const dayOfYear = (month: number, day: number): number => month * 100 + day;

function inWindow(w: SeasonWindow, date: Date): boolean {
  const today = dayOfYear(date.getMonth() + 1, date.getDate());
  const from = dayOfYear(...w.from);
  const to = dayOfYear(...w.to);
  return from <= to ? today >= from && today <= to : today >= from || today <= to;
}

/** Whether an item can be picked on `date` (non-seasonal items always can). */
export function isAvailable(item: DecorItem, date: Date): boolean {
  return !item.season || item.season.windows.some((w) => inWindow(w, date));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 1 – Nov 2" style label of a season's windows. */
export function seasonLabel(item: DecorItem): string {
  if (!item.season) return '';
  return item.season.windows
    .map((w) => `${MONTHS[w.from[0] - 1]} ${w.from[1]} – ${MONTHS[w.to[0] - 1]} ${w.to[1]}`)
    .join(', ');
}

export function decorItem(id: string): DecorItem | undefined {
  return DECOR_ITEMS.find((i) => i.id === id);
}
