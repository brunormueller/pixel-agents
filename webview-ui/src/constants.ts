import type { ColorValue } from './components/ui/types.js';

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = 64;
export const MAX_ROWS = 64;

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
export const TYPE_FRAME_DURATION_SEC = 0.3;
export const WANDER_PAUSE_MIN_SEC = 2.0;
export const WANDER_PAUSE_MAX_SEC = 20.0;
export const WANDER_MOVES_BEFORE_REST_MIN = 3;
export const WANDER_MOVES_BEFORE_REST_MAX = 6;
export const SEAT_REST_MIN_SEC = 120.0;
export const SEAT_REST_MAX_SEC = 240.0;

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 0.3;
export const MATRIX_TRAIL_LENGTH = 6;
export const MATRIX_SPRITE_COLS = 16;
export const MATRIX_SPRITE_ROWS = 24;
export const MATRIX_FLICKER_FPS = 30;
export const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;
export const MATRIX_COLUMN_STAGGER_RANGE = 0.3;
export const MATRIX_HEAD_COLOR = '#ccffcc';
export const matrixGreenBright = (a: number): string => `rgba(0, 255, 65, ${a})`;
export const matrixGreenMid = (a: number): string => `rgba(0, 170, 40, ${a})`;
export const matrixGreenDim = (a: number): string => `rgba(0, 85, 20, ${a})`;
export const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;
export const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;
export const MATRIX_TRAIL_MID_THRESHOLD = 0.33;
export const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

// ── Rendering ────────────────────────────────────────────────
export const CHARACTER_SITTING_OFFSET_PX = 6;
export const CHARACTER_Z_SORT_OFFSET = 0.5;
export const OUTLINE_Z_SORT_OFFSET = 0.001;
export const SELECTED_OUTLINE_ALPHA = 1.0;
export const HOVERED_OUTLINE_ALPHA = 0.5;
/** Headless agents (adopted, no terminal to focus) render slightly translucent. */
export const HEADLESS_CHARACTER_ALPHA = 0.5;
export const GHOST_PREVIEW_SPRITE_ALPHA = 0.5;
export const GHOST_PREVIEW_TINT_ALPHA = 0.25;
export const SELECTION_DASH_PATTERN: [number, number] = [4, 3];
export const BUTTON_MIN_RADIUS = 6;
export const BUTTON_RADIUS_ZOOM_FACTOR = 3;
export const BUTTON_ICON_SIZE_FACTOR = 0.45;
export const BUTTON_LINE_WIDTH_MIN = 1.5;
export const BUTTON_LINE_WIDTH_ZOOM_FACTOR = 0.5;
export const BUBBLE_FADE_DURATION_SEC = 0.5;
export const BUBBLE_SITTING_OFFSET_PX = 10;
export const BUBBLE_VERTICAL_OFFSET_PX = 24;
export const FALLBACK_FLOOR_COLOR = '#808080';

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)';
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)';
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)';
export const GRID_LINE_COLOR = 'rgba(255,255,255,0.12)';
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255,255,255,0.08)';
export const VOID_TILE_DASH_PATTERN: [number, number] = [2, 2];
export const GHOST_BORDER_HOVER_FILL = 'rgba(60, 130, 220, 0.25)';
export const GHOST_BORDER_HOVER_STROKE = 'rgba(60, 130, 220, 0.5)';
export const GHOST_BORDER_STROKE = 'rgba(255, 255, 255, 0.06)';
export const GHOST_VALID_TINT = '#00ff00';
export const GHOST_INVALID_TINT = '#ff0000';
export const SELECTION_HIGHLIGHT_COLOR = '#007fd4';
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.85)';
export const ROTATE_BUTTON_BG = 'rgba(50, 120, 200, 0.85)';
export const BUTTON_ICON_COLOR = '#fff';
export const CANVAS_FALLBACK_TILE_COLOR = '#444';
export const CANVAS_ERROR_TILE_COLOR = '#FF00FF';
export const WALL_COLOR = '#3A3A5C';

// ── Camera ───────────────────────────────────────────────────
export const CAMERA_FOLLOW_LERP = 0.1;
export const CAMERA_FOLLOW_SNAP_THRESHOLD = 0.5;

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;
export const ZOOM_DEFAULT_DPR_FACTOR = 2;
export const ZOOM_LEVEL_FADE_DELAY_MS = 1500;
export const ZOOM_LEVEL_HIDE_DELAY_MS = 2000;
export const ZOOM_LEVEL_FADE_DURATION_SEC = 0.5;
export const ZOOM_SCROLL_THRESHOLD = 50;
export const PAN_MARGIN_FRACTION = 0.25;

// ── Editor ───────────────────────────────────────────────────
export const UNDO_STACK_MAX_SIZE = 50;
export const LAYOUT_SAVE_DEBOUNCE_MS = 500;
/** A room-map edit the room did not take (too fast, relay reconnecting) is retried after this. */
export const ROOM_LAYOUT_RETRY_MS = 1000;
/** Refusals in a row before an edit is dropped and the room's map put back on screen. */
export const ROOM_LAYOUT_MAX_RETRIES = 5;

// ── Layout Import/Export (browser-native, standalone) ────────
/** Suggested filename when exporting the office layout from the standalone browser. */
export const LAYOUT_EXPORT_FILENAME = 'pixel-agents-layout.json';
/** MIME type for the exported layout Blob. */
export const LAYOUT_EXPORT_MIME = 'application/json';
export const DEFAULT_FLOOR_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 };
export const DEFAULT_WALL_COLOR: ColorValue = { h: 240, s: 25, b: 0, c: 0 };
export const DEFAULT_NEUTRAL_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

// ── Carpets ──────────────────────────────────────────────────
/** Main (lowest-luminance) color applied to carpets when no per-tile override is set. */
export const CARPET_DEFAULT_COLOR: ColorValue = { h: 0, s: 71, b: -32, c: 0, colorize: true };
/** Accent (highest-luminance) color applied to carpets when no per-tile override is set. */
export const CARPET_DEFAULT_ACCENT_COLOR: ColorValue = {
  h: 34,
  s: 64,
  b: 21,
  c: 0,
  colorize: true,
};
/** Keyboard key that switches from CARPET_PAINT to CARPET_PICK while editing. */
export const KEY_CARPET_PICK = 'p';

// ── Areas (named, colored workspace-folder zones) ────────────
/** Color palette assigned to new Areas in rotation (cycles when more areas exist). */
export const AREA_DEFAULT_COLORS: readonly string[] = [
  '#ff6b6b',
  '#feca57',
  '#48dbfb',
  '#1dd1a1',
  '#5f27cd',
  '#ff9ff3',
  '#54a0ff',
  '#ffa502',
] as const;
/** Translucent overlay alpha for area tile fills. */
export const AREA_OVERLAY_ALPHA = 0.25;
/** Alpha multiplier applied to the actively-selected area's overlay. */
export const AREA_ACTIVE_ALPHA_MULTIPLIER = 1.6;
/** Base font size (pixel-pre-zoom) for area centroid labels. */
export const AREA_LABEL_FONT_SIZE_PX = 14;
/** Minimum on-screen label size to keep labels legible at low zoom. */
export const AREA_LABEL_MIN_FONT_SIZE_PX = 12;
/** Alpha of the area label text. */
export const AREA_LABEL_ALPHA = 1.0;
/** Fallback label color when an area has no color set (shouldn't happen in practice). */
export const AREA_LABEL_FALLBACK_COLOR = '#ffffff';
/** Drop-shadow color behind area labels for legibility on light backgrounds. */
export const AREA_LABEL_SHADOW_COLOR = '#000000';
/** Drop-shadow alpha behind area labels. */
export const AREA_LABEL_SHADOW_ALPHA = 0.6;

// ── VisualColorPicker (HSV wheel + brightness for carpets) ───
export const VISUAL_COLOR_PICKER_SV_SIZE_PX = 180;
export const VISUAL_COLOR_PICKER_HUE_WIDTH_PX = 20;
export const VISUAL_COLOR_PICKER_MARKER_RADIUS_PX = 6;
/**
 * The hue bar gradient is intrinsic to the color-picking interaction, not a
 * theme color — it must span the full hue circle. Centralized here so the
 * component body stays free of inline color literals. (The saturation/brightness
 * square is painted to a canvas from the carpet HSL model, not a CSS gradient.)
 */
export const VISUAL_COLOR_PICKER_HUE_GRADIENT =
  'linear-gradient(to bottom, ' +
  '#ff0000 0%, #ffff00 16.7%, #00ff00 33.3%, ' +
  '#00ffff 50%, #0000ff 66.7%, #ff00ff 83.3%, #ff0000 100%)';
export const VISUAL_COLOR_PICKER_MARKER_BORDER = '2px solid #fff';
export const VISUAL_COLOR_PICKER_MARKER_SHADOW = '0 0 0 1px rgba(0,0,0,0.6)';
/** Width of the collapsed swatch + hex trigger row (compact mode). */
export const VISUAL_COLOR_PICKER_COMPACT_WIDTH_PX = 160;
/** Swatch square size shown in the collapsed trigger. */
export const VISUAL_COLOR_PICKER_SWATCH_PX = 22;
/** Gap (px) between the collapsed trigger and the expanded popup panel. */
export const VISUAL_COLOR_PICKER_POPUP_GAP_PX = 6;

// ── Notification Sound (done: ascending chime) ─────────────
export const NOTIFICATION_NOTE_1_HZ = 659.25; // E5
export const NOTIFICATION_NOTE_2_HZ = 1318.51; // E6 (octave up)
export const NOTIFICATION_NOTE_1_START_SEC = 0;
export const NOTIFICATION_NOTE_2_START_SEC = 0.1;
export const NOTIFICATION_NOTE_DURATION_SEC = 0.18;
export const NOTIFICATION_VOLUME = 0.14;

// ── Permission Sound (attention: descending double tap) ────
export const PERMISSION_NOTE_1_HZ = 880; // A5
export const PERMISSION_NOTE_2_HZ = 659.25; // E5 (down a fourth)
export const PERMISSION_NOTE_1_START_SEC = 0;
export const PERMISSION_NOTE_2_START_SEC = 0.12;
export const PERMISSION_NOTE_DURATION_SEC = 0.15;
export const PERMISSION_VOLUME = 0.12;

// ── Furniture Animation ─────────────────────────────────────
export const FURNITURE_ANIM_INTERVAL_SEC = 0.2;

// ── Version Notice ──────────────────────────────────────────
export const WHATS_NEW_AUTO_CLOSE_MS = 20000;
export const WHATS_NEW_FADE_MS = 1000;

// ── Game Logic ───────────────────────────────────────────────
export const MAX_DELTA_TIME_SEC = 0.1;
export const WAITING_BUBBLE_DURATION_SEC = 2.0;
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3;
export const INACTIVE_SEAT_TIMER_MIN_SEC = 3.0;
export const INACTIVE_SEAT_TIMER_RANGE_SEC = 2.0;
/** Default/fallback palette count (bundled characters). Actual count comes from getLoadedCharacterCount(). */
export const PALETTE_COUNT = 6;
export const AUTO_ON_FACING_DEPTH = 3;
export const AUTO_ON_SIDE_DEPTH = 2;
export const CHARACTER_HIT_HALF_WIDTH = 8;
export const CHARACTER_HIT_HEIGHT = 24;
export const TOOL_OVERLAY_VERTICAL_OFFSET = 32;

// ── Greeter + Intro bubble ──────────────────────────────────
/** Reserved character id for the Intro's greeter. Far outside both real agent
 *  ids (positive) and sub-agent ids (small negatives from -1 down). */
export const GREETER_ID = -1_000_000_000;
/** Stacking order for the Intro's bubble. Deliberately BELOW the modal stack
 *  (ui/Modal defaults to 50, ChangelogModal 51, the migration notice z-100): the
 *  Intro is diegetic furniture over the office, not a modal, so a modal opened
 *  on top of it must cover it rather than slide underneath. */
export const INTRO_BUBBLE_Z_INDEX = 45;
/** The greeter stands this many tiles in from the office's bottom-left corner
 *  (target tile (margin, rows-1-margin); nearest walkable tile if blocked). */
export const GREETER_TILE_MARGIN = 3;
/** World px above the greeter's anchor (feet) where the bubble's bottom sits.
 *  Kept well above the head target (INTRO_TAIL_TARGET_RISE_WORLD) so the
 *  tail squares have a visible run between bubble and head. */
export const INTRO_BUBBLE_ANCHOR_RISE_WORLD = 44;
/** World px right of the greeter's center where the bubble's left edge starts —
 *  just clear of the sprite so the tail points down-left at the head. */
export const INTRO_BUBBLE_OFFSET_X_WORLD = 10;
/** Bubble width cap (CSS px) and the margin kept from the container edges.
 *  Wide on purpose: the disclosure reads as three short paragraphs instead of
 *  a tall column (still clamped to the container on narrow panels). */
export const INTRO_BUBBLE_MAX_WIDTH_PX = 560;
export const INTRO_BUBBLE_EDGE_MARGIN_PX = 4;
/** Where the Intro's Claude Code step sends people who don't have it yet. */
export const CLAUDE_CODE_URL = 'https://claude.com/claude-code';
export const CLAUDE_CODE_INSTALL_COMMAND = 'npm install -g @anthropic-ai/claude-code';
/** Speech-tail squares: placed at fraction `t` along the segment from the
 *  bubble's nearest edge point to the greeter's head, shrinking toward the
 *  speaker. Recomputed every frame so the tail stays connected no matter where
 *  edge-clamping or panning puts the bubble relative to the character. */
export const INTRO_TAIL_STEPS = [
  { t: 0.25, size: 12 },
  { t: 0.55, size: 9 },
  { t: 0.82, size: 6 },
] as const;
/** World px above the greeter's anchor (feet) the tail points at — the head. */
export const INTRO_TAIL_TARGET_RISE_WORLD = 26;
/** Camera-offset caps while centering character + bubble. The ideal composition
 *  assumes the bubble fits beside/above the character; when it can't (narrow or
 *  short viewports clamp the bubble to the screen), uncapped offsets shove the
 *  greeter to the viewport edge. Horizontal offset is capped to this fraction
 *  of the viewport; vertical offset always keeps this many world px of the
 *  character visible above the bottom edge. */
export const INTRO_CAMERA_MAX_X_OFFSET_VIEWPORT_FRACTION = 0.25;
export const INTRO_CAMERA_MIN_CHAR_VISIBLE_WORLD = 48;
/** Extra downward camera shift (CSS px) so the character+bubble composition
 *  sits a bit above the vertical center instead of dead-centered. */
export const INTRO_CAMERA_DOWN_SHIFT_PX = 50;

// ── Context Fuel Gauge ──────────────────────────────────────
/** Window assumed before the runtime reports one (it always does for agents
 *  that have taken a turn; this only covers characters created ahead of it). */
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;
export const CONTEXT_WARN_THRESHOLD = 0.6;
export const CONTEXT_DANGER_THRESHOLD = 0.8;
export const CONTEXT_CRITICAL_THRESHOLD = 0.95;
export const CONTEXT_GAUGE_WIDTH_PX = 40;
export const CONTEXT_GAUGE_HEIGHT_PX = 4;
export const CONTEXT_GAUGE_COLOR_OK = '#44cc44';
export const CONTEXT_GAUGE_COLOR_WARN = '#ffcc00';
export const CONTEXT_GAUGE_COLOR_DANGER = '#ff8800';
export const CONTEXT_GAUGE_COLOR_CRITICAL = '#ff2222';
export const CONTEXT_GAUGE_BG = '#222';

// ── Agent Teams ─────────────────────────────────────────────
export const TEAM_LEAD_COLOR = '#ffd700';
export const TEAM_ROLE_COLOR = '#66aaff';

// ── Pets ────────────────────────────────────────────────────────
/** Walking speed in world pixels per second (matches character walk speed visually but slower). */
export const PET_WALK_SPEED_PX_PER_SEC = 32;
/** Time per WALK animation cycle step (4 cycle steps × 0.15s = 0.6s per loop). */
export const PET_WALK_FRAME_DURATION_SEC = 0.15;
/** Time per IDLE animation cycle step (4 cycle steps × 0.3s = 1.2s per loop). */
export const PET_IDLE_FRAME_DURATION_SEC = 0.3;
/** Walk cycle: 4-step lookup into the 3-frame walkDown/walkUp/walkRight arrays. */
export const PET_WALK_SEQUENCE = [0, 1, 0, 2] as const;
/** Idle cycle: 4-step lookup into the 3-frame idleDown/idleUp arrays. */
export const PET_IDLE_SEQUENCE = [0, 1, 2, 1] as const;
/** Minimum seconds the pet stays in IDLE before making a new decision. */
export const PET_WANDER_PAUSE_MIN_SEC = 3.0;
/** Maximum seconds the pet stays in IDLE before making a new decision. */
export const PET_WANDER_PAUSE_MAX_SEC = 15.0;
/** Seconds between FOLLOW path re-computations. */
export const PET_FOLLOW_RECALC_INTERVAL_SEC = 1.0;
/** Probability that a pet enters FOLLOW (instead of WALK) when wanderTimer expires. */
export const PET_FOLLOW_CHANCE = 0.3;
/** Maximum Manhattan distance (tiles) at which a character can become a follow target. */
export const PET_FOLLOW_RADIUS_TILES = 3;
/** Minimum seconds a FOLLOW episode lasts before timing out. */
export const PET_FOLLOW_DURATION_MIN_SEC = 5.0;
/** Maximum seconds a FOLLOW episode lasts before timing out. */
export const PET_FOLLOW_DURATION_MAX_SEC = 15.0;
/** Hit-box half-width (world px) for pet click detection. */
export const PET_HIT_HALF_WIDTH = 8;
/** Hit-box height (world px) measured upward from the bottom-center anchor. */
export const PET_HIT_HEIGHT = 16;
/** Zoom factor used to draw pet thumbnails in the EditorToolbar Pets tab. */
export const PET_THUMB_ZOOM = 2;
/** Scale margin so the pet thumbnail fills the ItemSelect cell without touching the edges. */
export const PET_THUMB_SCALE_MARGIN = 0.85;
/** Fallback background fill for sprite-less thumbnail (used while pet sprites are loading). */
export const EMPTY_SPRITE_THUMBNAIL_BG = '#333';
/** Maximum string length for a PlacedPet.id (defends against pathologically-long layout entries). */
export const MAX_PET_ID_LENGTH = 128;

// ── Multiplayer (other offices' agents) ─────────────────────
/** First id handed to a remote character; later ones count down from here.
 *  Far below the sub-agent range (-1 down) and far above GREETER_ID. */
export const REMOTE_AGENT_ID_BASE = -1_000_000;
/** Tool name a remote character carries while typing. Only the character FSM
 *  reads it (anything outside the provider's readingTools animates as typing). */
export const REMOTE_TYPING_TOOL_NAME = 'remote:typing';

// ── Multiplayer room (join screen, avatar, shared map) ───────
/** Character id of the person's own character while no Claude agent drives it.
 *  Between the remote range (REMOTE_AGENT_ID_BASE down) and sub-agents (-1 down). */
export const AVATAR_LOCAL_ID = -900_000;
/** How often the webview reports its characters' poses to the server (only when changed). */
export const PRESENCE_SEND_INTERVAL_MS = 150;
/** A remote character further than this from where its office says it is jumps there. */
export const REMOTE_POSE_SNAP_PX = 48;
/** Remote characters catch up a little faster than they walk, so they never lag behind. */
export const REMOTE_POSE_SPEED_FACTOR = 1.4;
/** Below this distance a remote character counts as arrived. */
export const REMOTE_POSE_EPSILON_PX = 0.5;
/** Desk picker marker size, in CSS px, and the name tag's offset under the feet. */
export const DESK_MARKER_SIZE_PX = 18;
export const NAME_TAG_OFFSET_PX = 4;
/** Above the tool overlay and chat bubbles, below modals. */
export const DESK_PICKER_Z_INDEX = 44;

// ── Emotes (dance, reactions) ────────────────────────────────
/** One dance beat; jump hops and reaction hops are paced by it too. */
export const EMOTE_BEAT_SEC = 0.3;
export const EMOTE_DANCE_HOP_PX = 2;
export const EMOTE_JUMP_HOP_PX = 6;
export const EMOTE_JUMP_HOPS = 3;
export const EMOTE_REACTION_HOP_PX = 2;
/** Spin: seconds per quarter turn. */
export const EMOTE_SPIN_STEP_SEC = 0.1;
/** Floating emoji: how far it rises (CSS px) over its life, and its size. */
export const EMOTE_FLOAT_RISE_PX = 28;
export const EMOTE_EMOJI_SIZE_PX = 22;
/** Dance notes: a new one every this many seconds. */
export const EMOTE_NOTE_INTERVAL_SEC = 0.9;
export const NAME_TAG_Z_INDEX = 40;

// ── Multiplayer chat ─────────────────────────────────────────
/** Chat lines the panel keeps (the server replays at most this many too). */
export const CHAT_HISTORY_LIMIT = 100;
/** Longest message the input accepts; the relay caps at the same length. */
export const CHAT_MAX_LENGTH = 280;
/** How long a speech bubble stays: a base plus reading time per character, clamped. */
export const CHAT_BUBBLE_BASE_MS = 3000;
export const CHAT_BUBBLE_PER_CHAR_MS = 60;
export const CHAT_BUBBLE_MIN_MS = 4000;
export const CHAT_BUBBLE_MAX_MS = 10_000;
/** Typewriter reveal speed of the bubble text. */
export const CHAT_BUBBLE_TYPE_MS_PER_CHAR = 28;
/** Fade-out at the end of a bubble's life. */
export const CHAT_BUBBLE_FADE_MS = 500;
/** Bubble width cap, in CSS px. */
export const CHAT_BUBBLE_MAX_WIDTH_PX = 220;
/** Gap between the character's label anchor and the bubble's bottom edge, in CSS px. */
export const CHAT_BUBBLE_RISE_PX = 40;
/** Above the tool overlay (41/42), below the intro bubble (45). */
export const CHAT_BUBBLE_Z_INDEX = 43;
/** Side panel width, in CSS px. */
export const CHAT_PANEL_WIDTH_PX = 280;

// ── Avatar look (customization) ──────────────────────────────
/** Hair colors the avatar editor offers (AvatarLook.hair indexes this; -1 = the sprite's own). */
export const HAIR_SWATCHES: ReadonlyArray<{ label: string; color: string }> = [
  { label: 'Black', color: '#1E1A1A' },
  { label: 'Dark brown', color: '#4A2C1A' },
  { label: 'Brown', color: '#7A4A2A' },
  { label: 'Auburn', color: '#8E3B1F' },
  { label: 'Ginger', color: '#C8642A' },
  { label: 'Blonde', color: '#D8B25A' },
  { label: 'Platinum', color: '#E8E0C8' },
  { label: 'Gray', color: '#9A9A9A' },
  { label: 'Blue', color: '#3A6FD8' },
  { label: 'Pink', color: '#E06AA8' },
  { label: 'Purple', color: '#7A4AD0' },
  { label: 'Green', color: '#3AA060' },
];
/** Clothes colors (AvatarLook.top / .bottom index this; -1 = the sprite's own). */
export const OUTFIT_SWATCHES: ReadonlyArray<{ label: string; color: string }> = [
  { label: 'Red', color: '#C83A3A' },
  { label: 'Orange', color: '#E0782A' },
  { label: 'Yellow', color: '#E0C040' },
  { label: 'Green', color: '#3A9A4A' },
  { label: 'Teal', color: '#2A9A9A' },
  { label: 'Blue', color: '#2A5AC8' },
  { label: 'Navy', color: '#1E2A5A' },
  { label: 'Purple', color: '#7A3AC0' },
  { label: 'Pink', color: '#E070A8' },
  { label: 'White', color: '#E8E8E8' },
  { label: 'Gray', color: '#7A7A7A' },
  { label: 'Black', color: '#262626' },
];
/** Recolor: the source colors of a part keep at least this lightness spread, so a
 *  near-black hairdo recolored blonde still has its shading. */
export const LOOK_MIN_LIGHTNESS_SPREAD = 0.12;
/** Avatar editor preview: sprite scale and how often it turns to show another side. */
export const LOOK_PREVIEW_SCALE = 6;
export const LOOK_PREVIEW_TURN_MS = 1400;

// ── Status, people, following ────────────────────────────────
/** Status dot colors (name tags, people panel, status menu). */
export const STATUS_COLORS: Record<'available' | 'busy' | 'meeting' | 'away', string> = {
  available: '#4AC060',
  busy: '#E04848',
  meeting: '#B070F0',
  away: '#E0B040',
};
export const STATUS_TEXT_MAX_LENGTH = 60;
/** Status dot size on name tags, in CSS px. */
export const STATUS_DOT_PX = 6;
/** Following someone: how often the path is recomputed, and how close counts as "there" (tiles). */
export const FOLLOW_REPATH_SEC = 0.5;
export const FOLLOW_ARRIVE_TILES = 1;
/** Side panels (people, calendar, music, decorate) width, in CSS px. */
export const SIDE_PANEL_WIDTH_PX = 300;

// ── Desk decoration ──────────────────────────────────────────
/** How far from the desk's chair decoration may go, in tiles (the relay caps at 3). */
export const DECOR_MAX_OFFSET = 3;
/** Items per desk (the relay caps at 12). */
export const DECOR_MAX_ITEMS = 12;
/** Where a desk item saved without a pixel position stands within its tile (its base's middle). */
export const DECOR_DEFAULT_PX = 8;
export const DECOR_DEFAULT_PY = 12;
/** The decorate overlay (ghost, tabletop outline): over the map, under the toolbar and panels. */
export const DECOR_PLACER_Z_INDEX = 15;

// ── Calendar ─────────────────────────────────────────────────
/** A meeting starting within this long gets the "starting soon" toast (and the join button lights up). */
export const MEETING_SOON_MS = 5 * 60_000;
/** The toast offers to join until this long after the start. */
export const MEETING_TOAST_GRACE_MS = 10 * 60_000;

// ── Meetings (video calls inside the room) ───────────────────
/** While in a meeting the page re-sends its presence this often; the server
 *  drops a presence nobody refreshed (a closed tab) after a few misses. */
export const MEETING_PRESENCE_HEARTBEAT_MS = 5_000;
/** The relay caps these too (server/src/constants.ts). */
export const MEETING_TITLE_MAX_LENGTH = 60;
export const MEETING_CHAT_MAX_LENGTH = 500;
export const MEETING_NOTES_MAX_LENGTH = 8_000;
export const MEETING_CAPTION_MAX_LENGTH = 500;
/** Screens one person may share at once. */
export const MEETING_MAX_SCREENS = 4;
/** Used when neither the relay nor multiplayer.json names ICE servers. */
export const MEETING_DEFAULT_ICE_SERVERS: Array<{ urls: string[] }> = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];
/** getUserMedia video constraints (plain data: this file stays free of DOM types). */
export const MEETING_CAMERA_CONSTRAINTS = {
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24, max: 30 },
};
/** A reaction floats over the tile (and the character) this long. */
export const MEETING_REACTION_FLOAT_MS = 2_500;
/** Live captions stay on the stage this long after the line was said. */
export const MEETING_CAPTION_SHOW_MS = 8_000;
/** Speaking detection: RMS level above this counts as talking, held this long. */
export const MEETING_SPEAKING_THRESHOLD = 0.035;
export const MEETING_SPEAKING_HOLD_MS = 700;
export const MEETING_SPEAKING_POLL_MS = 120;
/** A peer connection that stays failed this long gets an ICE restart. */
export const MEETING_ICE_RESTART_DELAY_MS = 3_000;
/** A connection not through this long after it was set up restarts ICE (a lost signal, stuck gathering). */
export const MEETING_CONNECT_WATCHDOG_MS = 8_000;
/** The polite side of a new connection waits this long for the other side's first offer before offering itself. */
export const MEETING_POLITE_OFFER_WAIT_MS = 3_000;
/** Minimized call: the tiles along the top of the office. */
export const MEETING_STRIP_TILE_W = 176;
export const MEETING_STRIP_TILE_H = 99;
export const MEETING_STRIP_MAX_TILES = 6;
export const MEETING_SIDEBAR_WIDTH_PX = 320;
/** Over the office and its panels, under modals. */
export const MEETING_STAGE_Z_INDEX = 40;
export const MEETING_STRIP_Z_INDEX = 25;
/** Recording: the composed video's size and frame rate. */
export const MEETING_RECORD_WIDTH = 1280;
export const MEETING_RECORD_HEIGHT = 720;
export const MEETING_RECORD_FPS = 30;
/** Recording canvas colors (the tiles as the file shows them). */
export const MEETING_RECORD_BG = '#11111b';
export const MEETING_RECORD_TILE_BG = '#1e1e2e';
export const MEETING_RECORD_TILE_BORDER = '#4a4a6a';
export const MEETING_RECORD_SPEAKING = '#746fff';
export const MEETING_RECORD_LABEL_BG = 'rgba(10, 10, 20, 0.75)';
export const MEETING_RECORD_TEXT = '#e8e8f0';
export const MEETING_RECORD_AVATAR_BG = '#6030ff';
/** Meeting music: starting volume (0-1) of the built-in soundtrack. */
export const MEETING_MUSIC_DEFAULT_VOLUME = 0.25;
/** How far ahead the soundtrack schedules notes, and how often it tops the queue up. */
export const MEETING_MUSIC_LOOKAHEAD_SEC = 0.25;
export const MEETING_MUSIC_TICK_MS = 50;

// ── Game Tables (ping pong, air hockey, foosball) ─────────────
/** Catalog groupIds of two-player game tables (assets/furniture/<id>/). Idle agents
 *  stand at the left/right ends and play; the table shows its animated on-state
 *  while both ends are taken. */
export const GAME_TABLE_GROUP_IDS = [
  'PING_PONG_TABLE',
  'AIR_HOCKEY_TABLE',
  'FOOSBALL_TABLE',
] as const;
/** Chance an idle wander step heads to a free game slot instead of a random tile. */
export const GAME_JOIN_CHANCE = 0.5;
/** Idle agents beyond the two players wait in a row one tile below the table; at most
 *  this many default spots per table. Placed GAME_QUEUE_SPOT markers override the row. */
export const GAME_QUEUE_MAX = 5;
/** Catalog groupId of the floor marker that pins a spectator spot to a chosen tile */
export const GAME_QUEUE_SPOT_GROUP_ID = 'GAME_QUEUE_SPOT';
/** A marker belongs to the nearest game table within this many tiles of its footprint */
export const GAME_QUEUE_MARKER_RANGE = 4;
/** Rally simulation: one end-to-end ball flight, the miss fly-past, and the
 *  time the loser spends turning to pick the ball up before serving. */
export const GAME_RALLY_FLIGHT_SEC = 0.55;
export const GAME_MISS_SEC = 0.6;
export const GAME_PICKUP_SEC = 1.4;
/** Returns per point before someone misses (inclusive range) */
export const GAME_HITS_MIN = 2;
export const GAME_HITS_MAX = 7;
/** How long the swing frame is held after a hit */
export const GAME_SWING_SEC = 0.25;
/** Ball flight geometry in sprite px: inset from the table's ends, height on the
 *  table sprite, how far a missed ball flies past the end, and how far it drops. */
export const GAME_BALL_END_INSET_PX = 5;
export const GAME_BALL_SURFACE_Y_PX = 13;
export const GAME_MISS_DISTANCE_PX = 14;
export const GAME_MISS_DROP_PX = 12;
/** Per-game ball look: colour, shade pixel, arc height (0 = slides on the surface) */
export const GAME_BALL_STYLES: Record<string, { color: string; shade: string; arcPx: number }> = {
  PING_PONG_TABLE: { color: '#fff6c8', shade: '#e0c96a', arcPx: 5 },
  AIR_HOCKEY_TABLE: { color: '#ff3b3b', shade: '#b31f1f', arcPx: 0 },
  FOOSBALL_TABLE: { color: '#ffffff', shade: '#cfcfcf', arcPx: 0 },
};
/** First to this many points wins; both players then leave the table */
export const GAME_WIN_SCORE = 5;
export const GAME_CELEBRATE_POINT_SEC = 1.2;
export const GAME_CELEBRATE_WIN_SEC = 3.0;
/** Celebration hop: full bounces per second and height in sprite pixels */
export const GAME_CELEBRATE_HOPS_PER_SEC = 3;
export const GAME_CELEBRATE_HOP_PX = 4;
/** Scoreboard drawn above a table in play */
export const SCOREBOARD_FONT_SIZE_PX = 8;
export const SCOREBOARD_MIN_FONT_SIZE_PX = 10;
export const SCOREBOARD_COLOR = '#ffffff';
export const SCOREBOARD_SHADOW_COLOR = '#000000';
export const SCOREBOARD_OFFSET_PX = 6;

// ── Levels (floors of the building) + portals (stairs, elevators) ──
/** How many levels a building can have. */
export const MAX_LEVELS = 8;
/** VOID columns kept between two levels in the layout grid (never walkable, never painted). */
export const LEVEL_GAP_COLS = 1;
/** Id of the level a single-level layout implicitly is. */
export const MAIN_LEVEL_ID = 'main';
/** Default names: the ground floor, then numbered floors up and basements down. */
export const LEVEL_GROUND_NAME = 'Ground floor';
export const levelDefaultName = (elevation: number): string =>
  elevation === 0
    ? LEVEL_GROUND_NAME
    : elevation > 0
      ? `Floor ${elevation}`
      : elevation === -1
        ? 'Basement'
        : `Basement ${-elevation}`;
export const LEVEL_NAME_MAX_LENGTH = 24;
/** Floor color of a new level's tiles (warm beige, like the default office). */
export const LEVEL_NEW_FLOOR_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 };
/** Catalog groupIds of portal furniture (assets/furniture/<id>/). Stairs come in
 *  pairs; every elevator door sharing a link is one elevator's stops. */
export const STAIRS_GROUP_ID = 'STAIRS';
export const ELEVATOR_GROUP_ID = 'ELEVATOR';
/** Stairs are drawn by where their other end is: a flight going up, or a stairwell going down. */
export const STAIRS_UP_TYPE = 'STAIRS_UP';
export const STAIRS_DOWN_TYPE = 'STAIRS_DOWN';
/** Elevator doors, drawn open while someone gets in or out. */
export const ELEVATOR_CLOSED_TYPE = 'ELEVATOR_CLOSED';
export const ELEVATOR_OPEN_TYPE = 'ELEVATOR_OPEN';
/** Ride durations: stairs, and an elevator (base + per level travelled). */
export const TRANSIT_STAIRS_SEC = 1.1;
export const TRANSIT_ELEVATOR_BASE_SEC = 1.4;
export const TRANSIT_ELEVATOR_PER_LEVEL_SEC = 0.35;
/** Ride visuals, sprite px: how far a character climbs / sinks / steps into a door. */
export const TRANSIT_CLIMB_PX = 12;
export const TRANSIT_SINK_PX = 26;
export const TRANSIT_DOOR_PX = 5;
/** The label floating over a rider: arrow + the level it goes to. */
export const TRANSIT_LABEL_FONT_SIZE_PX = 6;
export const TRANSIT_LABEL_MIN_FONT_SIZE_PX = 10;
export const TRANSIT_LABEL_OFFSET_PX = 30;
export const TRANSIT_LABEL_UP_COLOR = '#7CFC9A';
export const TRANSIT_LABEL_DOWN_COLOR = '#FFB86B';
export const TRANSIT_LABEL_SHADOW_COLOR = '#000000';
/** Longest level name shown in a rider's label. */
export const TRANSIT_LABEL_MAX_CHARS = 14;
/** How often the floor switcher and the elevator question re-read who is where. */
export const LEVEL_SWITCHER_REFRESH_MS = 250;
export const ELEVATOR_PICKER_REFRESH_MS = 150;

// ── Doors ──────────────────────────────────────────────────────
/** Catalog groupId of doors (assets/furniture/DOOR/): they sit in a wall and open by themselves. */
export const DOOR_GROUP_ID = 'DOOR';
/** How fast a door swings (fraction of the way per second), opening and closing. */
export const DOOR_OPEN_SPEED = 7;
export const DOOR_CLOSE_SPEED = 4;
/** A door stays open this long after the last person went through. */
export const DOOR_HOLD_SEC = 0.6;
/** Someone this close to the doorway (px, along the way through / across it) opens the door. */
export const DOOR_REACH_PX = 14;
export const DOOR_REACH_ACROSS_PX = 7;

// ── Games: Pixel Frag (a first-person match, solo with bots or with the room) ──
/** Internal render resolution: pixels tall; the width follows the screen's shape. Scaled up pixel-sharp. */
export const FPS_RENDER_HEIGHT = 200;
export const FPS_RENDER_MIN_WIDTH = 240;
export const FPS_RENDER_MAX_WIDTH = 480;
/** Heights in wall units (a wall is 1 tall): the eye, and a character as drawn. */
export const FPS_EYE_HEIGHT = 0.5;
export const FPS_CHARACTER_HEIGHT = 0.85;
/** Furniture drawn in the map: world units per sprite pixel, and the tallest it may stand.
 *  Office sprites are drawn from above at an angle (their top shows), so they stand
 *  squashed to FPS_FURNITURE_HEIGHT_SQUASH of their drawn height. */
export const FPS_FURNITURE_UNITS_PER_PX = 1 / 26;
export const FPS_FURNITURE_HEIGHT_SQUASH = 0.72;
export const FPS_FURNITURE_MAX_HEIGHT = 1;
/** A desk (or crate) as a solid waist-high block, wall units. Must stay under the eye. */
export const FPS_BLOCK_HEIGHT = 0.4;
/** Collision radius of a player (cells) and the radius a shot hits within. */
export const FPS_PLAYER_RADIUS = 0.25;
export const FPS_HIT_RADIUS = 0.32;
/** Movement, cells per second; turning with the keys, radians per second. */
export const FPS_WALK_SPEED = 3.4;
export const FPS_RUN_SPEED = 5.2;
export const FPS_KEY_TURN_SPEED = 2.8;
/** Mouse look: radians per pixel of movement at sensitivity 1. */
export const FPS_MOUSE_RADIANS_PER_PX = 0.0022;
export const FPS_MAX_HP = 100;
export const FPS_RESPAWN_SEC = 3;
/** Just back in (or a round just began): nobody can hurt you this long, and bots leave you be. */
export const FPS_SPAWN_GUARD_SEC = 1.5;
/** Where the eye sinks to while dead (kept above the waist-high blocks). */
export const FPS_DEAD_EYE_HEIGHT = 0.47;
/** Things fade into the map's fog color over this many cells (at most FPS_FOG_MAX_FADE of the way). */
export const FPS_FOG_DISTANCE = 16;
export const FPS_FOG_MAX_FADE = 0.85;
/** Walls facing north/south are drawn this much darker (a cheap sense of light). */
export const FPS_SIDE_SHADE = 0.78;
/** Picking an item up: how close (cells), and how long until it is back. */
export const FPS_PICKUP_RADIUS = 0.55;
export const FPS_ITEM_RESPAWN_SEC = 20;
export const FPS_HEALTH_PICKUP = 25;
export const FPS_SHELLS_PICKUP = 8;
export const FPS_BULLETS_PICKUP = 40;
export const FPS_START_SHELLS = 8;
export const FPS_START_BULLETS = 50;
export const FPS_MAX_SHELLS = 40;
export const FPS_MAX_BULLETS = 200;
/** How often a player sends where it is, the host the bots, the host the score (ms). */
export const FPS_NET_POS_INTERVAL_MS = 66;
export const FPS_NET_BOTS_INTERVAL_MS = 100;
export const FPS_NET_SCORE_INTERVAL_MS = 2_000;
/** Remote players glide toward their last reported spot at this rate (per second). */
export const FPS_REMOTE_SMOOTHING = 14;
/** A remote player whose last report is older than this is not drawn (ms). */
export const FPS_REMOTE_STALE_MS = 3_000;
/** A round that ended shows the standings this long before the next one starts. */
export const FPS_ROUND_RESTART_MS = 8_000;
/** The relay caps these too (server/src/constants.ts FPS_*). */
export const FPS_MAX_BOTS = 8;
export const FPS_MAX_FRAG_LIMIT = 100;
export const FPS_MAX_TIME_LIMIT_MIN = 60;
/** While in a match the page re-sends its presence this often (the server drops a stale one). */
export const FPS_PRESENCE_HEARTBEAT_MS = 5_000;
/** Kill feed lines stay this long; at most this many at once. */
export const FPS_FEED_SHOW_MS = 5_000;
export const FPS_FEED_MAX_LINES = 5;
/** On-screen hints ("Picked up health") stay this long. */
export const FPS_MESSAGE_SHOW_MS = 2_000;
/** How long a hurt flash, a hit marker and a muzzle flash last (seconds). */
export const FPS_HURT_FLASH_SEC = 0.35;
export const FPS_HIT_MARKER_SEC = 0.18;
export const FPS_MUZZLE_FLASH_SEC = 0.07;
/** Bullet puffs on walls: how long they stay (seconds), at most how many. */
export const FPS_PUFF_SEC = 0.35;
export const FPS_MAX_PUFFS = 24;
/** Minimap: cells shown around the player, CSS px per cell. */
export const FPS_MINIMAP_RADIUS_CELLS = 10;
export const FPS_MINIMAP_CELL_PX = 6;
/** Personal settings (sensitivity, field of view, volume) remembered in this browser. */
export const FPS_SETTINGS_STORAGE_KEY = 'pixelAgents.fps.settings';
export const FPS_DEFAULT_FOV_DEG = 75;
export const FPS_MIN_FOV_DEG = 55;
export const FPS_MAX_FOV_DEG = 100;
export const FPS_DEFAULT_SENSITIVITY = 1;
export const FPS_DEFAULT_VOLUME = 0.5;
/** The game covers the whole office (over panels and toasts). */
export const FPS_OVERLAY_Z_INDEX = 70;
/** HUD colors (drawn on the game canvas). */
export const FPS_HUD_TEXT_COLOR = '#f0f0f5';
export const FPS_HUD_SHADOW_COLOR = '#000000';
export const FPS_HUD_MUTED_COLOR = '#a0a0b8';
export const FPS_HUD_ACCENT_COLOR = '#746fff';
export const FPS_HUD_HEALTH_COLOR = '#7cfc9a';
export const FPS_HUD_LOW_HEALTH_COLOR = '#ff5a5a';
export const FPS_HUD_AMMO_COLOR = '#ffd35a';
export const FPS_HUD_PANEL_COLOR = 'rgba(10, 10, 20, 0.62)';
export const FPS_HUD_CROSSHAIR_COLOR = 'rgba(255, 255, 255, 0.85)';
export const FPS_HUD_HIT_MARKER_COLOR = '#ff4040';
export const FPS_HUD_HURT_COLOR = 'rgba(220, 20, 20, 0.35)';
export const FPS_HUD_DEAD_COLOR = 'rgba(90, 0, 0, 0.45)';
export const FPS_HUD_SELF_COLOR = '#ffd35a';
export const FPS_MINIMAP_WALL_COLOR = 'rgba(200, 200, 220, 0.75)';
export const FPS_MINIMAP_BLOCK_COLOR = 'rgba(160, 120, 80, 0.75)';
export const FPS_MINIMAP_FLOOR_COLOR = 'rgba(20, 20, 30, 0.55)';
export const FPS_MINIMAP_ITEM_COLOR = '#7cfc9a';
