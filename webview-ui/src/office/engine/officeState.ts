import type {
  AvatarLook,
  DeskDecorItem,
  PeerProfile,
  PersonStatus,
  RemotePose,
  SharedTrack,
} from '../../../../core/src/messages.js';
import { pickDiversePalette } from '../../../../core/src/paletteUtils.js';
import {
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  AVATAR_LOCAL_ID,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  CHARACTER_SITTING_OFFSET_PX,
  DECOR_DEFAULT_PX,
  DECOR_DEFAULT_PY,
  DECOR_MAX_OFFSET,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  DOOR_CLOSE_SPEED,
  DOOR_HOLD_SEC,
  DOOR_OPEN_SPEED,
  DOOR_REACH_ACROSS_PX,
  DOOR_REACH_PX,
  ELEVATOR_CLOSED_TYPE,
  ELEVATOR_OPEN_TYPE,
  FOLLOW_ARRIVE_TILES,
  FOLLOW_REPATH_SEC,
  FURNITURE_ANIM_INTERVAL_SEC,
  GAME_BALL_END_INSET_PX,
  GAME_BALL_STYLES,
  GAME_BALL_SURFACE_Y_PX,
  GAME_CELEBRATE_POINT_SEC,
  GAME_CELEBRATE_WIN_SEC,
  GAME_HITS_MAX,
  GAME_HITS_MIN,
  GAME_MISS_DISTANCE_PX,
  GAME_MISS_DROP_PX,
  GAME_MISS_SEC,
  GAME_PICKUP_SEC,
  GAME_RALLY_FLIGHT_SEC,
  GAME_SWING_SEC,
  GAME_WIN_SCORE,
  GREETER_ID,
  GREETER_TILE_MARGIN,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  MAX_PET_ID_LENGTH,
  PET_HIT_HALF_WIDTH,
  PET_HIT_HEIGHT,
  REMOTE_POSE_EPSILON_PX,
  REMOTE_POSE_SNAP_PX,
  REMOTE_POSE_SPEED_FACTOR,
  SCOREBOARD_OFFSET_PX,
  STAIRS_DOWN_TYPE,
  STAIRS_UP_TYPE,
  TRANSIT_LABEL_MAX_CHARS,
  TRANSIT_LABEL_OFFSET_PX,
  TYPE_FRAME_DURATION_SEC,
  WAITING_BUBBLE_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WANDER_PAUSE_MIN_SEC,
} from '../../constants.js';
import type { PixelRect } from '../layout/deskSurface.js';
import {
  baseSpan,
  deskSurface,
  isTabletopPixel,
  mirrorRect,
  opaqueBox,
} from '../layout/deskSurface.js';
import type { DoorFrame } from '../layout/doors.js';
import { doorFrameAt, doorFrameType, doorTile, isDoorType, isSideDoor } from '../layout/doors.js';
import type { CatalogEntryWithCategory } from '../layout/furnitureCatalog.js';
import {
  getAnimationFrames,
  getCatalogEntry,
  getFrontVariant,
  getOnStateType,
  getOrientationInGroup,
  getVariantForOrientation,
} from '../layout/furnitureCatalog.js';
import {
  createDefaultLayout,
  getBlockedTiles,
  isGameTable,
  layoutToFurnitureInstances,
  layoutToGameSlots,
  layoutToSeats,
  layoutToTileMap,
  layoutToWaitSpots,
} from '../layout/layoutSerializer.js';
import type { GridRect, TileRemap } from '../layout/levels.js';
import {
  defaultLevel,
  getLevels,
  inRect,
  levelById,
  levelOfColumn,
  levelsTopDown,
} from '../layout/levels.js';
import type { Portal } from '../layout/portals.js';
import {
  layoutPortals,
  portalAt,
  portalDestinations,
  portalLinks,
  stairsGoDown,
} from '../layout/portals.js';
import {
  findPath,
  getPortalEdges,
  getWalkableTiles,
  isWalkable,
  setPortalEdges,
} from '../layout/tileMap.js';
import { getPetCount, getPetName } from '../sprites/petSpriteData.js';
import { getLoadedCharacterCount } from '../sprites/spriteData.js';
import type {
  Character,
  FurnitureInstance,
  GameBall,
  GameMatch,
  GameSlot,
  OfficeLayout,
  OfficeLevel,
  Pet,
  PlacedFurniture,
  PlacedPet,
  Scoreboard,
  Seat,
  TileType as TileTypeVal,
  TransitLabel,
  WaitSpot,
} from '../types.js';
import { CharacterState, Direction, PetState, TILE_SIZE, TileType } from '../types.js';
import { createCharacter, isSeatedPose, updateCharacter } from './characters.js';
import type { DeskPreset } from './decorCatalog.js';
import { DESK_STYLES } from './decorCatalog.js';
import type { EmoteKind } from './emotes.js';
import { advanceEmote, EMOTES, isEmoteKind } from './emotes.js';
import { advanceMatrixEffect, startMatrixEffect } from './matrixEffectState.js';
import { createPet, updatePet } from './petEntity.js';
import { anchorTile, closestFreeSeat } from './seatPlacement.js';
import { advanceTransit, startTransit } from './transit.js';

/** Internal helper: facing-tile coords for a seat. Returns null for invalid direction. */
function seatFacingOffset(direction: Direction): { dCol: number; dRow: number } {
  if (direction === Direction.RIGHT) return { dCol: 1, dRow: 0 };
  if (direction === Direction.LEFT) return { dCol: -1, dRow: 0 };
  if (direction === Direction.DOWN) return { dCol: 0, dRow: 1 };
  return { dCol: 0, dRow: -1 };
}

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  furniture: FurnitureInstance[];
  walkableTiles: Array<{ col: number; row: number }>;
  /** Standing spots beside game tables (derived from layout) */
  gameSlots: GameSlot[] = [];
  /** Spectator spots where queued agents wait for an end (derived from layout) */
  waitSpots: WaitSpot[] = [];
  /** Games in progress, keyed by table uid. Exists only while both ends are taken. */
  matches: Map<string, GameMatch> = new Map();
  characters: Map<number, Character> = new Map();
  pets: Pet[] = [];
  /** Accumulated time for furniture animation frame cycling */
  furnitureAnimTimer = 0;
  selectedAgentId: number | null = null;
  cameraFollowId: number | null = null;
  hoveredAgentId: number | null = null;
  hoveredTile: { col: number; row: number } | null = null;
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map();
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map();
  private nextSubagentId = -1;

  /**
   * folderName → list of Area labels that workspace folder belongs to.
   * Populated by useExtensionMessages on `areaMappingsLoaded`. Consulted by
   * `findFreeSeat()` to bias new agents toward seats inside their folder's Area.
   */
  areaMappings: Record<string, string[]> = {};

  /**
   * The first-run consent greeter, deliberately NOT in `characters`.
   *
   * `characters` means "agents": everything that iterates it — seat
   * assignment, palette diversity, the wander FSM, hit-testing, the seat
   * payload the webview persists — is asking an agent question the greeter has
   * no answer to. Holding it here instead of tagging it with a flag makes
   * every one of those loops correct by default, rather than correct as long
   * as each remembers an `isGreeter` guard. It is drawn because
   * `getCharacters()` appends it, and that is the only place it joins the
   * others.
   */
  greeter: Character | null = null;

  /** World-space point the camera drifts to while the greeter is up
   *  (the bubble overlay recomputes it every frame: the combined center of the
   *  character and its speech bubble). An explicit cameraFollowId outranks it. */
  greeterCameraTarget: { x: number; y: number } | null = null;
  /** Latched by a manual pan during the ask: the user took the camera, so the
   *  overlay's per-frame updates stop re-centering. Reset on spawn/despawn. */
  private greeterCameraCancelled = false;

  // -- Multiplayer room --------------------------------------------------------
  /** The person's own character (joined a room): AVATAR_LOCAL_ID while no
   *  Claude agent drives it, else that agent's id. The first agent IS the
   *  person, re-keyed in place, so the character never despawns in between.
   *  Its seat is the person's chosen desk. Null when not in a room. */
  avatarId: number | null = null;
  /** Direction a movement key is held in; update() steps the avatar with it. */
  avatarHeldDir: Direction | null = null;
  /** Seats other offices hold on the shared map (their desks, and seats their
   *  characters sit in). Marked `assigned` so local seating skips them. */
  private externalSeatClaims = new Set<string>();
  private emoteSeq = 0;
  /** What the person picked for their character; applied to it whenever it exists. */
  private localProfile: LocalCharacterProfile = {
    look: null,
    status: 'available',
    statusText: '',
    music: null,
  };
  /** Someone the person's character walks after (People panel). */
  avatarFollowId: number | null = null;
  /** "Go to": stop following once there. */
  private avatarFollowOnce = false;
  private followTimer = 0;
  private followTargetTile: string | null = null;
  /** The person's desk decoration, relative to their desk's chair. */
  private localDecor: DeskDecorItem[] = [];
  /** Other offices' desk decoration: the desk (seat uid) each claimed and its items. */
  private remoteDecor: Array<{ desk: string; items: DeskDecorItem[] }> = [];
  private decorKey = '';
  private deskTopCache: { layout: OfficeLayout; skinKey: string; tops: DeskTop[] } | null = null;
  /** The person's desk dressing: a style their desk (and chair) is drawn in, and
   *  layout items taken off their desk (the computer it came with). */
  private localDressing: DeskDressing = { deskStyle: null, hidden: [] };
  private remoteDressing: Array<DeskDressing & { desk: string }> = [];
  /** Derived from every dressing: layout uid → the type it is drawn as, and uids not drawn. */
  private skins = new Map<string, string>();
  private hiddenUids = new Set<string>();
  private skinKey = '';
  /** Styled desks turned to face the room: seat uid → where its chair was and went. */
  private turns = new Map<string, DeskTurn>();
  /** The layout editor shows chairs where the room built them. */
  private turnsPaused = false;

  // -- Levels (floors of the building) ---------------------------------------
  /** The building's levels: the layout's, or one covering the whole grid. */
  levels: OfficeLevel[] = [];
  /** Stairs and elevators. */
  portals: Portal[] = [];
  /** The level on screen. */
  private viewLevelId = '';
  /** Walkable tiles per level: idle characters wander on the level they are on. */
  private walkableByLevel = new Map<string, Array<{ col: number; row: number }>>();
  /** The level each character was last on — to follow the person up and down. */
  private seenLevel = new Map<number, string>();
  /** Elevator doors someone is getting in or out of right now (drawn open). */
  private openDoors = new Set<string>();
  /** The person stepped into an elevator with several stops: where to? */
  elevatorPrompt: ElevatorPrompt | null = null;
  /** Where the person just came out of a portal: no riding back from there
   *  until the movement key is let go (or they step off). */
  private portalRearm: string | null = null;

  // -- Doors --------------------------------------------------------------------
  /** Doors in the walls: their doorway tile and which way they are walked through. */
  private doors: Array<{ uid: string; type: string; col: number; row: number; side: boolean }> = [];
  /** How open each door is (0..1), and how long it stays open after the last passer-by. */
  private doorOpen = new Map<string, { open: number; hold: number }>();
  /** The frame each door is drawn with (to rebuild the furniture only when one changes). */
  private doorFrames = new Map<string, DoorFrame>();

  setAreaMappings(mappings: Record<string, string[]>): void {
    this.areaMappings = mappings;
  }

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    this.walkableTiles = [];
    this.rebuildLevels();
    this.refreshWalkable();
    this.gameSlots = layoutToGameSlots(this.layout.furniture, this.tileMap, this.blockedTiles);
    this.waitSpots = layoutToWaitSpots(this.layout.furniture, this.tileMap, this.blockedTiles);
    // Pets are built last because they need walkableTiles populated for spawn.
    this.rebuildPetsFromLayout(this.layout);
  }

  /** Rebuild all derived state from a new layout. Reassigns existing characters.
   *  @param shift How the grid moved under everyone: a whole-grid shift (the
   *  grid grew left/up), or a remap (a level grew or went; null = that tile is gone). */
  rebuildFromLayout(layout: OfficeLayout, shift?: { col: number; row: number } | TileRemap): void {
    // A ride in progress ends where it was going: the portals may be about to move.
    for (const ch of this.characters.values()) {
      const tr = ch.transit;
      if (!tr) continue;
      ch.transit = null;
      ch.tileCol = tr.to.col;
      ch.tileRow = tr.to.row;
      ch.x = tr.to.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = tr.to.row * TILE_SIZE + TILE_SIZE / 2;
      ch.path = [];
      ch.moveProgress = 0;
    }
    this.elevatorPrompt = null;
    this.openDoors.clear();

    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout.furniture);
    this.blockedTiles = getBlockedTiles(layout.furniture);
    this.rebuildLevels();
    // Fresh seats: turn the styled desks again before anyone is seated.
    this.turns.clear();
    this.computeDressing();
    this.rebuildFurnitureInstances();
    this.refreshWalkable();
    this.gameSlots = layoutToGameSlots(layout.furniture, this.tileMap, this.blockedTiles);
    this.waitSpots = layoutToWaitSpots(layout.furniture, this.tileMap, this.blockedTiles);

    // Move characters with the tiles they stand on (the grid grew or lost a level).
    const remap: TileRemap | null =
      typeof shift === 'function'
        ? shift
        : shift && (shift.col !== 0 || shift.row !== 0)
          ? (c, r) => ({ col: c + shift.col, row: r + shift.row })
          : null;
    const lost = new Set<Character>();
    if (remap) {
      const moved = <T extends { col: number; row: number }>(spot: T): T | null => {
        const to = remap(spot.col, spot.row);
        return to ? { ...spot, col: to.col, row: to.row } : null;
      };
      for (const ch of this.characters.values()) {
        const to = remap(ch.tileCol, ch.tileRow);
        if (!to) {
          lost.add(ch);
        } else {
          ch.x += (to.col - ch.tileCol) * TILE_SIZE;
          ch.y += (to.row - ch.tileRow) * TILE_SIZE;
          ch.tileCol = to.col;
          ch.tileRow = to.row;
        }
        // Game slot claims move with the table they belong to
        if (ch.playSlot) ch.playSlot = moved(ch.playSlot);
        if (ch.waitSpot) ch.waitSpot = moved(ch.waitSpot);
        // Clear path since tile coords changed
        ch.path = [];
        ch.moveProgress = 0;
      }
      for (const pet of this.pets) {
        const to = remap(pet.tileCol, pet.tileRow) ?? { col: -1, row: -1 };
        pet.x += (to.col - pet.tileCol) * TILE_SIZE;
        pet.y += (to.row - pet.tileRow) * TILE_SIZE;
        pet.tileCol = to.col;
        pet.tileRow = to.row;
        pet.path = [];
        pet.moveProgress = 0;
      }
    }

    // Release claims on slots that no longer exist (table moved/removed) — the
    // PLAY state sees playSlot === null and walks off. Runs after the shift so a
    // grid expansion keeps a game going.
    for (const ch of this.characters.values()) {
      const s = ch.playSlot;
      if (s && !this.gameSlots.some((p) => p.uid === s.uid && p.col === s.col && p.row === s.row)) {
        ch.playSlot = null;
      }
      const w = ch.waitSpot;
      if (w && !this.waitSpots.some((p) => p.uid === w.uid && p.col === w.col && p.row === w.row)) {
        ch.waitSpot = null;
      }
    }

    // Reassign characters to new seats, preserving existing assignments when possible
    for (const seat of this.seats.values()) {
      seat.assigned = false;
    }

    // First pass: try to keep characters at their existing seats
    for (const ch of this.characters.values()) {
      if (ch.remoteTarget) continue; // placed by its own office, not seated here
      if (ch.seatId && this.seats.has(ch.seatId)) {
        const seat = this.seats.get(ch.seatId)!;
        if (!seat.assigned) {
          seat.assigned = true;
          // Playing or queued at a game table: keep the seat but stay at the table
          if (ch.playSlot || ch.waitSpot) continue;
          // Snap character to seat position
          ch.tileCol = seat.seatCol;
          ch.tileRow = seat.seatRow;
          const cx = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
          const cy = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
          ch.x = cx;
          ch.y = cy;
          ch.dir = seat.facingDir;
          continue;
        }
      }
      ch.seatId = null; // will be reassigned below
    }

    // Seats other offices hold stay theirs across a rebuild.
    this.applyExternalSeatClaims(this.externalSeatClaims);

    // Second pass: assign remaining characters to free seats
    for (const ch of this.characters.values()) {
      if (ch.seatId || ch.remoteTarget) continue;
      // The person's character without a desk stays where it is (keyboard-driven).
      if (ch.isAvatar && !ch.isRemote) continue;
      const seatId = this.findFreeSeat(ch.folderName);
      if (seatId) {
        this.seats.get(seatId)!.assigned = true;
        ch.seatId = seatId;
        const seat = this.seats.get(seatId)!;
        ch.tileCol = seat.seatCol;
        ch.tileRow = seat.seatRow;
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
        ch.dir = seat.facingDir;
      }
    }

    // Relocate any characters that ended up outside bounds or on non-walkable tiles
    for (const ch of this.characters.values()) {
      if (ch.seatId || ch.remoteTarget) continue; // seated, or placed by their own office
      if (
        lost.has(ch) ||
        (ch.isAvatar && !isWalkable(ch.tileCol, ch.tileRow, this.tileMap, this.blockedTiles))
      ) {
        this.relocateCharacterToWalkable(ch);
        continue;
      }
      if (
        ch.tileCol < 0 ||
        ch.tileCol >= layout.cols ||
        ch.tileRow < 0 ||
        ch.tileRow >= layout.rows ||
        levelOfColumn(this.levels, ch.tileCol) === null
      ) {
        this.relocateCharacterToWalkable(ch);
      }
    }

    // Relocate any pets that ended up outside bounds or on non-walkable tiles
    for (const pet of this.pets) {
      if (
        pet.tileCol < 0 ||
        pet.tileCol >= layout.cols ||
        pet.tileRow < 0 ||
        pet.tileRow >= layout.rows ||
        !isWalkable(pet.tileCol, pet.tileRow, this.tileMap, this.blockedTiles)
      ) {
        const tiles = this.walkableOnView();
        if (tiles.length > 0) {
          const spawn = tiles[Math.floor(Math.random() * tiles.length)];
          pet.tileCol = spawn.col;
          pet.tileRow = spawn.row;
          pet.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
          pet.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
          pet.path = [];
          pet.moveProgress = 0;
          pet.state = PetState.IDLE;
          pet.frame = 0;
          pet.frameTimer = 0;
          pet.followTargetId = null;
        }
      }
    }

    // Reconcile pets against the layout roster (handles editor add/remove)
    this.rebuildPetsFromLayout(layout);

    // Desk styles, items taken off desks and decoration hang off this layout's desks.
    this.decorKey = '';
    this.refreshDecor();
  }

  /** Move a character to a random walkable tile (on the level on screen) */
  private relocateCharacterToWalkable(ch: Character): void {
    const tiles = this.walkableOnView();
    if (tiles.length === 0) return;
    const spawn = tiles[Math.floor(Math.random() * tiles.length)];
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.path = [];
    ch.moveProgress = 0;
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }

  // ── Levels ────────────────────────────────────────────────────
  // Every level lives in the one grid (see layout/levels.ts); this is where the
  // office keeps track of which one is on screen, and who is where.

  /** Re-derive levels and portals from the layout; hand the portals to pathfinding. */
  private rebuildLevels(): void {
    this.levels = getLevels(this.layout);
    this.portals = layoutPortals(this.layout);
    setPortalEdges(this.tileMap, portalLinks(this.portals));
    // Doors (not portals, but drawn by who is near, like elevator doors).
    this.doors = this.layout.furniture
      .filter((f) => isDoorType(f.type))
      .map((f) => ({ uid: f.uid, type: f.type, ...doorTile(f), side: isSideDoor(f.type) }));
    const uids = new Set(this.doors.map((d) => d.uid));
    for (const uid of [...this.doorOpen.keys()]) if (!uids.has(uid)) this.doorOpen.delete(uid);
    for (const uid of [...this.doorFrames.keys()]) if (!uids.has(uid)) this.doorFrames.delete(uid);
    if (!levelById(this.levels, this.viewLevelId)) this.viewLevelId = defaultLevel(this.levels).id;
  }

  /** Walkable tiles, and the same split per level. */
  private refreshWalkable(): void {
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
    const byLevel = new Map<string, Array<{ col: number; row: number }>>();
    for (const t of this.walkableTiles) {
      const level = levelOfColumn(this.levels, t.col);
      if (!level) continue;
      const list = byLevel.get(level.id);
      if (list) list.push(t);
      else byLevel.set(level.id, [t]);
    }
    this.walkableByLevel = byLevel;
  }

  /** Whether the building has more than one level. */
  isMultiLevel(): boolean {
    return this.levels.length > 1;
  }

  /** The level on screen. */
  getViewLevel(): OfficeLevel {
    return levelById(this.levels, this.viewLevelId) ?? defaultLevel(this.levels);
  }

  /** The part of the grid on screen: the level being looked at. */
  getView(): GridRect {
    const l = this.getViewLevel();
    return { col: l.col, row: l.row, cols: l.cols, rows: l.rows };
  }

  /** Look at another level. Following someone who is not there stops. */
  setViewLevel(levelId: string): void {
    if (!levelById(this.levels, levelId) || levelId === this.viewLevelId) return;
    this.viewLevelId = levelId;
    const followed =
      this.cameraFollowId !== null ? this.characters.get(this.cameraFollowId) : undefined;
    if (followed && this.levelOf(followed)?.id !== levelId) this.cameraFollowId = null;
    this.hoveredTile = null;
    this.hoveredAgentId = null;
  }

  /** The level a character stands on (by column: levels stand side by side). */
  levelOf(ch: { tileCol: number }): OfficeLevel | null {
    return levelOfColumn(this.levels, ch.tileCol);
  }

  /** Whether a character is on the level on screen (so it is drawn and clickable). */
  isOnView(ch: { tileCol: number }): boolean {
    if (this.levels.length <= 1) return true;
    return this.levelOf(ch)?.id === this.viewLevelId;
  }

  /** Whether a world x (px) is on the level on screen. */
  isPointOnView(worldX: number): boolean {
    return this.isOnView({ tileCol: Math.floor(worldX / TILE_SIZE) });
  }

  /** How many characters stand on each level (sub-agents aside), for the level switcher. */
  levelHeadcount(): Map<string, number> {
    const out = new Map<string, number>();
    for (const ch of this.characters.values()) {
      if (ch.isSubagent || ch.matrixEffect === 'despawn') continue;
      const level = this.levelOf(ch);
      if (level) out.set(level.id, (out.get(level.id) ?? 0) + 1);
    }
    return out;
  }

  /** The level the person's character is on, or null (not in a room). */
  avatarLevelId(): string | null {
    const me = this.avatarId !== null ? this.characters.get(this.avatarId) : undefined;
    return me ? (this.levelOf(me)?.id ?? null) : null;
  }

  /** Tiles an idle character wanders to: the ones on its own level. */
  private walkableFor(ch: { tileCol: number }): Array<{ col: number; row: number }> {
    if (this.levels.length <= 1) return this.walkableTiles;
    const level = levelOfColumn(this.levels, ch.tileCol);
    return (level && this.walkableByLevel.get(level.id)) || this.walkableTiles;
  }

  /** Walkable tiles on the level on screen (where new characters appear). */
  private walkableOnView(): Array<{ col: number; row: number }> {
    if (this.levels.length <= 1) return this.walkableTiles;
    const list = this.walkableByLevel.get(this.viewLevelId);
    return list && list.length > 0 ? list : this.walkableTiles;
  }

  /** The seats among `uids` on the level on screen. */
  private seatsOnView(uids: string[]): string[] {
    if (this.levels.length <= 1) return uids;
    const view = this.getViewLevel();
    return uids.filter((uid) => {
      const seat = this.seats.get(uid);
      return !!seat && inRect(view, seat.seatCol, seat.seatRow);
    });
  }

  /** Stairs drawn going up or down (by where their other end is); elevator doors
   *  open while someone gets in or out. */
  private portalDressed(furniture: PlacedFurniture[]): PlacedFurniture[] {
    if (this.portals.length === 0 && this.doors.length === 0) return furniture;
    const types = new Map<string, string>();
    // Doors swing open as people come through.
    for (const d of this.doors) {
      const want = doorFrameType(d.type, this.doorFrames.get(d.uid) ?? 0);
      if (want !== d.type && getCatalogEntry(want)) types.set(d.uid, want);
    }
    for (const p of this.portals) {
      const want =
        p.kind === 'stairs'
          ? stairsGoDown(this.portals, p)
            ? STAIRS_DOWN_TYPE
            : STAIRS_UP_TYPE
          : this.openDoors.has(p.uid)
            ? ELEVATOR_OPEN_TYPE
            : ELEVATOR_CLOSED_TYPE;
      if (want !== p.type && getCatalogEntry(want)) types.set(p.uid, want);
    }
    if (types.size === 0) return furniture;
    return furniture.map((f) => {
      const type = types.get(f.uid);
      return type ? { ...f, type } : f;
    });
  }

  /** Open the doors someone is walking through (or about to), close the others. */
  private updateDoors(dt: number): void {
    if (this.doors.length === 0) return;
    let changed = false;
    for (const d of this.doors) {
      const cx = d.col * TILE_SIZE + TILE_SIZE / 2;
      const cy = d.row * TILE_SIZE + TILE_SIZE / 2;
      const near = (e: { x: number; y: number; path: Array<{ col: number; row: number }> }) => {
        const along = d.side ? Math.abs(e.x - cx) : Math.abs(e.y - cy);
        const across = d.side ? Math.abs(e.y - cy) : Math.abs(e.x - cx);
        if (along <= DOOR_REACH_PX && across <= DOOR_REACH_ACROSS_PX) return true;
        // About to step into the doorway.
        const next = e.path[0];
        return !!next && next.col === d.col && next.row === d.row;
      };
      let someone = false;
      for (const ch of this.characters.values()) {
        if (ch.matrixEffect !== 'despawn' && near(ch)) {
          someone = true;
          break;
        }
      }
      if (!someone) someone = this.pets.some(near);
      const st = this.doorOpen.get(d.uid) ?? { open: 0, hold: 0 };
      st.hold = someone ? DOOR_HOLD_SEC : Math.max(0, st.hold - dt);
      st.open =
        st.hold > 0
          ? Math.min(1, st.open + dt * DOOR_OPEN_SPEED)
          : Math.max(0, st.open - dt * DOOR_CLOSE_SPEED);
      this.doorOpen.set(d.uid, st);
      const frame = doorFrameAt(st.open);
      if (frame !== (this.doorFrames.get(d.uid) ?? 0)) {
        this.doorFrames.set(d.uid, frame);
        changed = true;
      }
    }
    if (changed) this.rebuildFurnitureInstances();
  }

  /** How open a door is (0 closed … 1 open), for tests and the e2e hooks. */
  doorOpenness(uid: string): number {
    return this.doorOpen.get(uid)?.open ?? 0;
  }

  /** After everyone moved: follow the person (or whoever the camera follows) onto
   *  another level, open the elevator doors in use, drop a stale elevator prompt. */
  private trackLevels(): void {
    if (this.levels.length <= 1) return;
    const doors = new Set<string>();
    for (const ch of this.characters.values()) {
      const tr = ch.transit;
      if (tr?.hop.kind === 'elevator') doors.add(tr.arrived ? tr.hop.toUid : tr.hop.fromUid);
      const level = this.levelOf(ch);
      if (!level) continue;
      const before = this.seenLevel.get(ch.id);
      if (before === level.id) continue;
      this.seenLevel.set(ch.id, level.id);
      if (before === undefined) continue;
      if (ch.id === this.avatarId) this.portalRearm = `${ch.tileCol},${ch.tileRow}`;
      // The view goes with the person (and with whoever the camera follows).
      const followed = ch.id === this.avatarId || ch.id === this.cameraFollowId;
      if (followed && before === this.viewLevelId) this.viewLevelId = level.id;
    }
    // Locating someone on another level (People panel) takes the view there.
    const cam = this.cameraFollowId !== null ? this.characters.get(this.cameraFollowId) : undefined;
    const camLevel = cam && !cam.transit ? this.levelOf(cam) : null;
    if (camLevel && camLevel.id !== this.viewLevelId) this.viewLevelId = camLevel.id;
    if (doors.size !== this.openDoors.size || [...doors].some((d) => !this.openDoors.has(d))) {
      this.openDoors = doors;
      this.rebuildFurnitureInstances();
    }
    // The elevator question is over once the person walks off (or rides).
    const prompt = this.elevatorPrompt;
    if (prompt) {
      const me = this.avatarId !== null ? this.characters.get(this.avatarId) : undefined;
      if (!me || me.transit || me.tileCol !== prompt.col || me.tileRow !== prompt.row) {
        this.elevatorPrompt = null;
      }
    }
  }

  /** The person pushes into stairs or an elevator door from in front of it: ride
   *  it. An elevator with several other stops asks where to first. True when the
   *  push was taken (a ride, or the question). */
  private enterPortal(ch: Character, col: number, row: number): boolean {
    const portal = portalAt(this.portals, col, row);
    if (!portal || !portal.access.some((a) => a.col === ch.tileCol && a.row === ch.tileRow)) {
      return false;
    }
    // Just came out here with the key still held: let go of it first.
    if (this.portalRearm === `${ch.tileCol},${ch.tileRow}`) return true;
    const dests = portalDestinations(this.portals, portal);
    if (dests.length === 0) return false;
    if (dests.length === 1 || portal.kind === 'stairs') return this.ride(ch, dests[0].uid);
    const here = portal.level;
    const stops = levelsTopDown(
      [...dests.map((d) => d.level!), ...(here ? [here] : [])].filter(
        (l, i, all) => all.findIndex((x) => x.id === l.id) === i,
      ),
    ).map((l) => ({
      levelId: l.id,
      name: l.name,
      uid: dests.find((d) => d.level!.id === l.id)?.uid ?? null,
      rise: l.elevation - (here?.elevation ?? 0),
    }));
    this.elevatorPrompt = { col: ch.tileCol, row: ch.tileRow, fromUid: portal.uid, stops };
    return true;
  }

  /** Walk into the portal link from where `ch` stands to portal `toUid`. */
  private ride(ch: Character, toUid: string): boolean {
    const edge = getPortalEdges(this.tileMap)
      ?.get(`${ch.tileCol},${ch.tileRow}`)
      ?.find((e) => e.hop.toUid === toUid);
    if (!edge || !isWalkable(edge.col, edge.row, this.tileMap, this.blockedTiles)) return false;
    ch.playSlot = null;
    ch.waitSpot = null;
    ch.path = [{ col: edge.col, row: edge.row, portal: edge.hop }];
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  /** The person picked a floor in the elevator. */
  rideElevator(toUid: string): boolean {
    const prompt = this.elevatorPrompt;
    const me = this.avatarId !== null ? this.characters.get(this.avatarId) : undefined;
    this.elevatorPrompt = null;
    if (!prompt || !me || me.tileCol !== prompt.col || me.tileRow !== prompt.row) return false;
    return this.ride(me, toUid);
  }

  closeElevatorPrompt(): void {
    this.elevatorPrompt = null;
  }

  /** Labels over characters riding stairs or an elevator on screen: which way, to which level. */
  getTransitLabels(): TransitLabel[] {
    const out: TransitLabel[] = [];
    for (const ch of this.characters.values()) {
      const tr = ch.transit;
      if (!tr || !this.isOnView(ch)) continue;
      const to = levelById(this.levels, tr.hop.toLevelId);
      out.push({
        x: ch.x,
        y: ch.y - TRANSIT_LABEL_OFFSET_PX,
        text: (to?.name ?? '').slice(0, TRANSIT_LABEL_MAX_CHARS),
        up: tr.hop.rise > 0,
      });
    }
    return out;
  }

  /** Get the blocked-tile key for a character's own seat, or null */
  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return null;
    return `${seat.seatCol},${seat.seatRow}`;
  }

  /** Temporarily unblock a character's own seat, run fn, then re-block */
  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch);
    // A couch wait spot we claimed is a seat tile too — open it for our own path
    const couch = ch.waitSpot?.seatId ? `${ch.waitSpot.col},${ch.waitSpot.row}` : null;
    const couchWasBlocked = couch !== null && this.blockedTiles.has(couch);
    if (key) this.blockedTiles.delete(key);
    if (couchWasBlocked) this.blockedTiles.delete(couch!);
    const result = fn();
    if (key) this.blockedTiles.add(key);
    if (couchWasBlocked) this.blockedTiles.add(couch!);
    return result;
  }

  /** Collect every tile occupied by electronics furniture (PCs, monitors, etc.). */
  private buildElectronicsTileSet(): Set<string> {
    const out = new Set<string>();
    for (const item of this.layout.furniture) {
      const entry = getCatalogEntry(item.type);
      if (!entry || entry.category !== 'electronics') continue;
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          out.add(`${item.col + dc},${item.row + dr}`);
        }
      }
    }
    return out;
  }

  /** Find the area label assigned to a seat's tile, or null. Public for e2e
   *  observability (getAgentSeats hook reads a seated agent's area). */
  seatZone(uid: string): string | null {
    const seat = this.seats.get(uid);
    if (!seat) return null;
    const tiles = this.layout.areaTiles;
    if (!tiles || tiles.length === 0) return null;
    const idx = seat.seatRow * this.layout.cols + seat.seatCol;
    if (idx < 0 || idx >= tiles.length) return null;
    return tiles[idx] ?? null;
  }

  /**
   * Does this seat face an electronics tile (PC, monitor)? Mirrors the
   * forward-and-flanking scan used by furniture auto-state.
   */
  private isSeatFacingElectronics(seat: Seat, electronicsTiles: Set<string>): boolean {
    const { dCol, dRow } = seatFacingOffset(seat.facingDir);
    for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
      const tileCol = seat.seatCol + dCol * d;
      const tileRow = seat.seatRow + dRow * d;
      if (electronicsTiles.has(`${tileCol},${tileRow}`)) return true;
      if (dCol !== 0) {
        if (
          electronicsTiles.has(`${tileCol},${tileRow - 1}`) ||
          electronicsTiles.has(`${tileCol},${tileRow + 1}`)
        ) {
          return true;
        }
      } else if (
        electronicsTiles.has(`${tileCol - 1},${tileRow}`) ||
        electronicsTiles.has(`${tileCol + 1},${tileRow}`)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Random-pick a seat from a candidate list, biased toward seats that face an
   * electronics tile. Returns null when the candidate list is empty.
   */
  private pickFromSeats(seatUids: string[], electronicsTiles: Set<string>): string | null {
    if (seatUids.length === 0) return null;
    const pcSeats: string[] = [];
    const otherSeats: string[] = [];
    for (const uid of seatUids) {
      const seat = this.seats.get(uid);
      if (!seat) continue;
      if (this.isSeatFacingElectronics(seat, electronicsTiles)) {
        pcSeats.push(uid);
      } else {
        otherSeats.push(uid);
      }
    }
    if (pcSeats.length > 0) return pcSeats[Math.floor(Math.random() * pcSeats.length)];
    if (otherSeats.length > 0) return otherSeats[Math.floor(Math.random() * otherSeats.length)];
    return null;
  }

  /**
   * 3-stage seat picker for top-level agents.
   *
   *   Stage 1: If `folderName` is given and `areaMappings[folderName]` lists
   *            Area labels, prefer free seats whose tile is labeled with one
   *            of those areas.
   *   Stage 2: Prefer free seats whose tile has NO area label (unzoned).
   *   Stage 3: Any free seat.
   *
   * Each stage routes through `pickFromSeats` for the PC-bias rule. Returns
   * null only when every seat is already occupied. Passing `undefined`
   * preserves pre-Areas single-stage behavior (skips Stage 1; Stage 2 picks
   * unzoned seats from a layout without `areaTiles`, which is every seat).
   */
  private findFreeSeat(folderName?: string): string | null {
    const electronicsTiles = this.buildElectronicsTileSet();
    const freeSeats: string[] = [];
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned) freeSeats.push(uid);
    }
    if (freeSeats.length === 0) return null;

    const areaLabels = folderName ? this.areaMappings[folderName] : undefined;

    // Stage 1 — in-area seats for the folder's mapped Area labels.
    if (areaLabels && areaLabels.length > 0) {
      const wanted = new Set(areaLabels);
      const inArea = freeSeats.filter((uid) => {
        const label = this.seatZone(uid);
        return label !== null && wanted.has(label);
      });
      const pick = this.pickFromSeats(inArea, electronicsTiles);
      if (pick) return pick;
    }

    // Stage 2 — unzoned seats (no area label, or layout has no areas at all),
    // on the level on screen first: a new agent shows up where you are looking.
    const unzoned = freeSeats.filter((uid) => this.seatZone(uid) === null);
    const pick2 =
      this.pickFromSeats(this.seatsOnView(unzoned), electronicsTiles) ??
      this.pickFromSeats(unzoned, electronicsTiles);
    if (pick2) return pick2;

    // Stage 3 — any free seat.
    return (
      this.pickFromSeats(this.seatsOnView(freeSeats), electronicsTiles) ??
      this.pickFromSeats(freeSeats, electronicsTiles)
    );
  }

  /** Closest walkable tile to (col,row) not occupied by another character, or null. */
  private closestFreeWalkableTile(col: number, row: number): { col: number; row: number } | null {
    const occupied = new Set<string>();
    for (const ch of this.characters.values()) {
      occupied.add(`${ch.tileCol},${ch.tileRow}`);
    }
    let best: { col: number; row: number } | null = null;
    let bestDist = Infinity;
    // On the same level as (col,row): the next level is only a gap away on the grid.
    for (const tile of this.walkableFor({ tileCol: col })) {
      if (occupied.has(`${tile.col},${tile.row}`)) continue;
      const d = Math.abs(tile.col - col) + Math.abs(tile.row - row);
      if (d < bestDist) {
        best = tile;
        bestDist = d;
      }
    }
    return best;
  }

  /**
   * Pick a diverse palette for a new agent based on currently active agents.
   * First 6 agents each get a unique skin (random order). Beyond 6, skins
   * repeat in balanced rounds with a random hue shift (≥45°).
   */
  private pickDiversePalette(): { palette: number; hueShift: number } {
    // Count how many non-sub-agents use each base palette (0-5)
    const paletteCount = getLoadedCharacterCount();
    const counts = new Array(paletteCount).fill(0) as number[];
    for (const ch of this.characters.values()) {
      if (ch.isSubagent || ch.isRemote) continue;
      if (ch.palette < paletteCount) counts[ch.palette]++;
    }
    return pickDiversePalette(paletteCount, counts);
  }

  addAgent(
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    folderName?: string,
    nearAgentId?: number,
  ): void {
    if (this.characters.has(id)) return;

    // The person's character becomes this office's first Claude agent.
    if (id > 0 && this.avatarId === AVATAR_LOCAL_ID && this.bindAvatarToAgent(id)) return;
    // Further agents sit around the person's desk, like a team.
    if (id > 0 && nearAgentId === undefined && this.avatarId !== null) nearAgentId = this.avatarId;

    let palette: number;
    let hueShift: number;
    if (preferredPalette !== undefined) {
      palette = preferredPalette;
      hueShift = preferredHueShift ?? 0;
    } else {
      const pick = this.pickDiversePalette();
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    // Try preferred seat first, then (for teammates) the seat closest to the
    // anchor agent, then any free seat. anchorTile resolves to the anchor's SEAT
    // (stable from creation) rather than its live tile, so a teammate placed while
    // the lead is still walking to its seat still clusters around the final seat.
    const anchor = nearAgentId !== undefined ? this.characters.get(nearAgentId) : undefined;
    const anchorAt = anchorTile(anchor, this.seats);
    let seatId: string | null = null;
    if (preferredSeatId && this.seats.has(preferredSeatId)) {
      const seat = this.seats.get(preferredSeatId)!;
      if (!seat.assigned) {
        seatId = preferredSeatId;
      }
    }
    if (!seatId && anchorAt) {
      seatId = closestFreeSeat(this.seats, anchorAt.col, anchorAt.row);
    }
    if (!seatId) {
      seatId = this.findFreeSeat(folderName);
    }

    let ch: Character;
    if (seatId) {
      const seat = this.seats.get(seatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, seatId, seat, hueShift);
    } else {
      // No seats — teammates spawn beside their anchor, others at a random walkable tile
      let spawn = anchorAt ? this.closestFreeWalkableTile(anchorAt.col, anchorAt.row) : null;
      if (!spawn) {
        const tiles = this.walkableOnView();
        spawn =
          tiles.length > 0 ? tiles[Math.floor(Math.random() * tiles.length)] : { col: 1, row: 1 };
      }
      ch = createCharacter(id, palette, null, null, hueShift);
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
    }

    if (folderName) {
      ch.folderName = folderName;
    }
    if (!skipSpawnEffect) {
      startMatrixEffect(ch, 'spawn');
    }
    this.characters.set(id, ch);
  }

  // ── Greeter ───────────────────────────────────────────────────
  // The Intro is diegetic: a char_0 character stands near the office's
  // bottom-left corner and "speaks" the tour through a DOM bubble
  // (IntroBubble). It is not an agent — see the `greeter` field.

  /** Spawn the greeter near the office's bottom-left corner: target tile
   *  GREETER_TILE_MARGIN in from the left and bottom edges, falling
   *  back to the closest walkable tile when the target is a seat, furniture,
   *  a wall, or VOID (seat tiles are in blockedTiles, so closestFreeWalkableTile
   *  covers every one of those). Idempotent; a remount mid-despawn (StrictMode)
   *  revives it. */
  spawnGreeter(): void {
    this.greeterCameraCancelled = false;
    if (this.greeter) {
      if (this.greeter.matrixEffect === 'despawn') startMatrixEffect(this.greeter, 'spawn');
      return;
    }
    const view = this.getView();
    const spawn = this.closestFreeWalkableTile(
      view.col + GREETER_TILE_MARGIN,
      view.row + view.rows - 1 - GREETER_TILE_MARGIN,
    );
    if (!spawn) return; // no walkable tile — IntroBubble falls back to a fixed panel
    const ch = createCharacter(GREETER_ID, 0, null, null, 0);
    ch.isGreeter = true;
    ch.state = CharacterState.IDLE;
    ch.isActive = false;
    ch.dir = Direction.DOWN;
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    startMatrixEffect(ch, 'spawn');
    this.greeter = ch;
  }

  /** Start the greeter's despawn effect and release the greeter camera. The
   *  character is dropped once the effect finishes (see update()).
   *  Idempotent — every close path (answer, Escape, hooksStatus) funnels here. */
  despawnGreeter(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = false;
    if (!this.greeter || this.greeter.matrixEffect === 'despawn') return;
    startMatrixEffect(this.greeter, 'despawn');
  }

  /** Per-frame update from the bubble overlay; ignored once the user panned. */
  setGreeterCameraTarget(p: { x: number; y: number }): void {
    if (!this.greeterCameraCancelled) this.greeterCameraTarget = p;
  }

  /** Manual pan during the ask: stop re-centering until the next spawn. */
  cancelGreeterCamera(): void {
    this.greeterCameraTarget = null;
    this.greeterCameraCancelled = true;
  }

  removeAgent(id: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (ch.matrixEffect === 'despawn') return; // already despawning
    // The agent driving the person's character closed: the person stays.
    if (id === this.avatarId && id !== AVATAR_LOCAL_ID) {
      this.unbindAvatar();
      return;
    }
    // Free seat and clear selection immediately
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId);
      if (seat) seat.assigned = false;
    }
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
    // Start despawn animation instead of immediate delete
    startMatrixEffect(ch, 'despawn');
    ch.bubbleType = null;
  }

  /** Find seat uid at a given tile position, or null */
  getSeatAtTile(col: number, row: number): string | null {
    for (const [uid, seat] of this.seats) {
      if (seat.seatCol === col && seat.seatRow === row) return uid;
    }
    return null;
  }

  /** Reassign an agent from their current seat to a new seat */
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId);
    if (!ch) return;
    // Unassign old seat
    if (ch.seatId) {
      const old = this.seats.get(ch.seatId);
      if (old) old.assigned = false;
    }
    // Assign new seat
    const seat = this.seats.get(seatId);
    if (!seat || seat.assigned) return;
    seat.assigned = true;
    ch.seatId = seatId;
    // Pathfind to new seat (unblock own seat tile for this query)
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat or no path — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /**
   * Move a just-linked teammate to the free seat closest to its lead, so teams
   * cluster. Only moves when that seat is strictly closer than the teammate's
   * current one — a teammate created as a plain external agent (seated by an
   * arbitrary findFreeSeat) and tagged as a teammate only after tag discovery
   * would otherwise keep its arbitrary seat, unlike an inline teammate seated
   * next to the lead at creation.
   */
  private reseatNextToLead(teammateId: number, leadId: number): void {
    const teammate = this.characters.get(teammateId);
    const lead = this.characters.get(leadId);
    if (!teammate || !lead) return;
    const anchorAt = anchorTile(lead, this.seats);
    if (!anchorAt) return;
    const target = closestFreeSeat(this.seats, anchorAt.col, anchorAt.row);
    if (!target || target === teammate.seatId) return;
    const targetSeat = this.seats.get(target)!;
    const targetDist =
      Math.abs(targetSeat.seatCol - anchorAt.col) + Math.abs(targetSeat.seatRow - anchorAt.row);
    const currentSeat = teammate.seatId ? this.seats.get(teammate.seatId) : undefined;
    const currentDist = currentSeat
      ? Math.abs(currentSeat.seatCol - anchorAt.col) + Math.abs(currentSeat.seatRow - anchorAt.row)
      : Infinity;
    if (targetDist < currentDist) {
      this.reassignSeat(teammateId, target);
    }
  }

  /** Send an agent back to their currently assigned seat */
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId);
    if (!ch || !ch.seatId) return;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return;
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /** Uid of the game table whose footprint or standing slot covers a tile, or null. */
  getGameTableAtTile(col: number, row: number): string | null {
    for (const s of this.gameSlots) {
      if (s.col === col && s.row === row) return s.uid;
    }
    for (const item of this.layout.furniture) {
      if (!isGameTable(item.type)) continue;
      const entry = getCatalogEntry(item.type);
      if (!entry) continue;
      if (
        col >= item.col &&
        col < item.col + entry.footprintW &&
        row >= item.row &&
        row < item.row + entry.footprintH
      ) {
        return item.uid;
      }
    }
    return null;
  }

  /** Standing slots of a table with whether each is still free (for hover indicators). */
  getGameSlotStatus(uid: string): Array<{ col: number; row: number; free: boolean }> {
    const free = new Set(this.freeGameSlots().map((s) => `${s.col},${s.row}`));
    return this.gameSlots
      .filter((s) => s.uid === uid)
      .map((s) => ({ col: s.col, row: s.row, free: free.has(`${s.col},${s.row}`) }));
  }

  /** Send an idle agent to play at a table (click-to-play). Picks the nearest free end.
   *  Returns false when the agent is busy, a sub-agent, or no end is free/reachable. */
  sendToGame(agentId: number, uid: string): boolean {
    const ch = this.characters.get(agentId);
    if (!ch || ch.isSubagent || ch.isActive) return false;
    // Already heading to / playing at / queued for this table — nothing to do
    if (ch.playSlot?.uid === uid || ch.waitSpot?.uid === uid) return true;
    const byDistance = <T extends { col: number; row: number }>(spots: T[]): T[] =>
      spots.sort(
        (a, b) =>
          Math.abs(a.col - ch.tileCol) +
          Math.abs(a.row - ch.tileRow) -
          (Math.abs(b.col - ch.tileCol) + Math.abs(b.row - ch.tileRow)),
      );
    const go = (target: GameSlot | WaitSpot): boolean => {
      const blocked = new Set(this.blockedTiles);
      if ('seatId' in target && target.seatId) blocked.delete(`${target.col},${target.row}`);
      const path = this.withOwnSeatUnblocked(ch, () =>
        findPath(ch.tileCol, ch.tileRow, target.col, target.row, this.tileMap, blocked),
      );
      const alreadyThere = ch.tileCol === target.col && ch.tileRow === target.row;
      if (path.length === 0 && !alreadyThere) return false;
      ch.playSlot = null;
      ch.waitSpot = null;
      if ('side' in target) ch.playSlot = target;
      else {
        ch.waitSpot = target;
        ch.queuedAt = ++this.queueTicket;
      }
      ch.seatTimer = 0;
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK; // arrival flips to PLAY / QUEUE
      ch.frame = 0;
      ch.frameTimer = 0;
      return true;
    };
    // A free end nobody is waiting for → play. Otherwise → get in line.
    for (const end of byDistance(this.freeGameSlotsFor(ch).filter((s) => s.uid === uid))) {
      if (go(end)) return true;
    }
    for (const spot of byDistance(this.freeWaitSpots().filter((s) => s.uid === uid))) {
      if (go(spot)) return true;
    }
    return false;
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    const ch = this.characters.get(agentId);
    if (!ch || ch.isSubagent) return false;
    if (!isWalkable(col, row, this.tileMap, this.blockedTiles)) {
      // Also allow walking to own seat tile (blocked for others but not self)
      const key = this.ownSeatKey(ch);
      if (!key || key !== `${col},${row}`) return false;
    }
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, col, row, this.tileMap, this.blockedTiles),
    );
    if (path.length === 0) return false;
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  /** Create a sub-agent character with the parent's palette. Returns the sub-agent ID. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    const key = `${parentAgentId}:${parentToolId}`;
    if (this.subagentIdMap.has(key)) return this.subagentIdMap.get(key)!;

    const id = this.nextSubagentId--;
    const parentCh = this.characters.get(parentAgentId);
    const palette = parentCh ? parentCh.palette : 0;
    const hueShift = parentCh ? parentCh.hueShift : 0;

    // Find the closest walkable tile to the parent, avoiding tiles occupied by other characters
    const parentCol = parentCh ? parentCh.tileCol : 0;
    const parentRow = parentCh ? parentCh.tileRow : 0;
    let spawn = { col: parentCol, row: parentRow };
    if (this.walkableTiles.length > 0) {
      spawn = this.closestFreeWalkableTile(parentCol, parentRow) ?? this.walkableTiles[0];
    }

    const ch = createCharacter(id, palette, null, null, hueShift);
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    // Face the same direction as the parent agent
    if (parentCh) ch.dir = parentCh.dir;
    ch.isSubagent = true;
    ch.parentAgentId = parentAgentId;
    startMatrixEffect(ch, 'spawn');
    this.characters.set(id, ch);

    this.subagentIdMap.set(key, id);
    this.subagentMeta.set(id, { parentAgentId, parentToolId });
    return id;
  }

  /** Remove a specific sub-agent character and free its seat */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const key = `${parentAgentId}:${parentToolId}`;
    const id = this.subagentIdMap.get(key);
    if (id === undefined) return;

    const ch = this.characters.get(id);
    if (ch) {
      if (ch.matrixEffect === 'despawn') {
        // Already despawning — just clean up maps
        this.subagentIdMap.delete(key);
        this.subagentMeta.delete(id);
        return;
      }
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId);
        if (seat) seat.assigned = false;
      }
      // Start despawn animation — keep character in map for rendering
      startMatrixEffect(ch, 'despawn');
      ch.bubbleType = null;
    }
    // Clean up tracking maps immediately so keys don't collide
    this.subagentIdMap.delete(key);
    this.subagentMeta.delete(id);
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    const toRemove: string[] = [];
    for (const [key, id] of this.subagentIdMap) {
      const meta = this.subagentMeta.get(id);
      if (meta && meta.parentAgentId === parentAgentId) {
        const ch = this.characters.get(id);
        if (ch) {
          if (ch.matrixEffect === 'despawn') {
            // Already despawning — just clean up maps
            this.subagentMeta.delete(id);
            toRemove.push(key);
            continue;
          }
          if (ch.seatId) {
            const seat = this.seats.get(ch.seatId);
            if (seat) seat.assigned = false;
          }
          // Start despawn animation
          startMatrixEffect(ch, 'despawn');
          ch.bubbleType = null;
        }
        this.subagentMeta.delete(id);
        if (this.selectedAgentId === id) this.selectedAgentId = null;
        if (this.cameraFollowId === id) this.cameraFollowId = null;
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.subagentIdMap.delete(key);
    }
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(`${parentAgentId}:${parentToolId}`) ?? null;
  }

  setAgentActive(id: number, active: boolean): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.isActive = active;
      if (!active) {
        // Sentinel -1: signals turn just ended, skip next seat rest timer.
        // Prevents the WALK handler from setting a 2-4 min rest on arrival.
        ch.seatTimer = -1;
        ch.path = [];
        ch.moveProgress = 0;
      }
      this.rebuildFurnitureInstances();
    }
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    // Collect tiles where active agents face desks
    const autoOnTiles = new Set<string>();
    for (const ch of this.characters.values()) {
      if (!ch.isActive || !ch.seatId) continue;
      const seat = this.seats.get(ch.seatId);
      if (!seat) continue;
      // Find the desk tile(s) the agent faces from their seat
      const dCol =
        seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
      // Check tiles in the facing direction (desk could be 1-3 tiles deep)
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        const tileCol = seat.seatCol + dCol * d;
        const tileRow = seat.seatRow + dRow * d;
        autoOnTiles.add(`${tileCol},${tileRow}`);
      }
      // Also check tiles to the sides of the facing direction (desks can be wide)
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d;
        const baseRow = seat.seatRow + dRow * d;
        if (dCol !== 0) {
          // Facing left/right: check tiles above and below
          autoOnTiles.add(`${baseCol},${baseRow - 1}`);
          autoOnTiles.add(`${baseCol},${baseRow + 1}`);
        } else {
          // Facing up/down: check tiles left and right
          autoOnTiles.add(`${baseCol - 1},${baseRow}`);
          autoOnTiles.add(`${baseCol + 1},${baseRow}`);
        }
      }
    }

    // Desk decoration renders like furniture (z-sorted, on desks), blocking nothing.
    const decor = this.decorPieces().map((p) => p.instance);

    const placed = this.portalDressed(this.layout.furniture);
    if (autoOnTiles.size === 0) {
      const base = layoutToFurnitureInstances(this.dressed(placed));
      this.furniture = decor.length > 0 ? [...base, ...decor] : base;
      return;
    }

    // Build modified furniture list with auto-state and animation applied
    const animFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    const onTypeFor = (item: PlacedFurniture): string => {
      let onType = getOnStateType(item.type);
      if (onType === item.type) return item.type;
      // Check if the on-state type has animation frames
      const frames = getAnimationFrames(onType);
      if (frames && frames.length > 1) {
        onType = frames[animFrame % frames.length];
      }
      return onType;
    };
    const modifiedFurniture: PlacedFurniture[] = placed.map((item) => {
      const entry = getCatalogEntry(item.type);
      if (!entry) return item;
      // Check if any tile of this furniture overlaps an auto-on tile
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            const onType = onTypeFor(item);
            return onType !== item.type ? { ...item, type: onType } : item;
          }
        }
      }
      return item;
    });

    this.furniture = [...layoutToFurnitureInstances(this.dressed(modifiedFurniture)), ...decor];
  }

  /** Layout furniture as the room sees it: desks and chairs in the style their person
   *  picked (a turned desk's chair on its front side), and items people took off
   *  their desks left out. */
  private dressed(furniture: PlacedFurniture[]): PlacedFurniture[] {
    if (this.skins.size === 0 && this.hiddenUids.size === 0) return furniture;
    const out: PlacedFurniture[] = [];
    for (const item of this.withTurns(furniture)) {
      if (this.hiddenUids.has(item.uid)) continue;
      const skin = this.skins.get(item.uid);
      out.push(skin ? { ...item, type: skin } : item);
    }
    return out;
  }

  /** Furniture with the chairs of turned desks moved to where they now stand. */
  private withTurns(furniture: PlacedFurniture[]): PlacedFurniture[] {
    if (this.turns.size === 0) return furniture;
    const shift = new Map<string, number>();
    for (const t of this.turns.values()) shift.set(t.chairUid, t.to.row - t.from.row);
    return furniture.map((item) => {
      const dRow = shift.get(item.uid);
      return dRow ? { ...item, row: item.row + dRow } : item;
    });
  }

  /** Characters in PLAY state grouped by table uid. */
  private playersByTable(): Map<string, Character[]> {
    const byTable = new Map<string, Character[]>();
    for (const ch of this.characters.values()) {
      if (ch.state !== CharacterState.PLAY || !ch.playSlot) continue;
      const list = byTable.get(ch.playSlot.uid);
      if (list) list.push(ch);
      else byTable.set(ch.playSlot.uid, [ch]);
    }
    return byTable;
  }

  /** Simulate the rallies at tables with both ends taken.
   *
   *  rally  → ball flies to `to`; on arrival the receiver swings and returns it
   *           (hitsLeft--), or misses when hitsLeft is 0.
   *  miss   → ball flies past the end; the other side scores and celebrates.
   *  pickup → the loser turns around, fetches the ball, and serves it back.
   *  First to GAME_WIN_SCORE wins; after the winner's celebration both leave. */
  private updateMatches(dt: number): void {
    const byTable = this.playersByTable();
    for (const uid of [...this.matches.keys()]) {
      if ((byTable.get(uid)?.length ?? 0) < 2) this.matches.delete(uid); // someone left: reset
    }
    for (const [uid, players] of byTable) {
      if (players.length < 2) continue;
      const bySide = (side: 0 | 1) => players.find((p) => p.playSlot?.side === side);
      let match = this.matches.get(uid);
      if (!match) {
        const server: 0 | 1 = Math.random() < 0.5 ? 0 : 1;
        match = {
          uid,
          game: players[0].playSlot?.game ?? '',
          scores: [0, 0],
          phase: 'rally',
          to: other(server),
          t: 0,
          hitsLeft: randomHits(),
          winner: null,
        };
        const srv = bySide(server);
        if (srv) srv.swingTimer = GAME_SWING_SEC;
        this.matches.set(uid, match);
      }

      switch (match.phase) {
        case 'rally': {
          match.t += dt / GAME_RALLY_FLIGHT_SEC;
          if (match.t < 1) break;
          const receiver = bySide(match.to);
          if (match.hitsLeft > 0) {
            // Returned: swing, ball heads back the other way
            if (receiver) receiver.swingTimer = GAME_SWING_SEC;
            match.hitsLeft--;
            match.to = other(match.to);
            match.t = 0;
          } else {
            // Missed: the hitter scores
            const scorerSide = other(match.to);
            match.scores[scorerSide]++;
            const scorer = bySide(scorerSide);
            if (match.scores[scorerSide] >= GAME_WIN_SCORE) {
              match.winner = scorerSide;
              if (scorer) scorer.celebrateTimer = GAME_CELEBRATE_WIN_SEC;
            } else if (scorer) {
              scorer.celebrateTimer = GAME_CELEBRATE_POINT_SEC;
            }
            match.phase = 'miss';
            match.t = 0;
          }
          break;
        }
        case 'miss': {
          match.t += dt / GAME_MISS_SEC;
          if (match.t < 1) break;
          if (match.winner !== null) {
            // Game over: once the winner is done celebrating, either the loser
            // yields the end to whoever is waiting (winner stays on), or — with
            // nobody in line — the same two start a new game.
            const winner = bySide(match.winner);
            if (winner && winner.celebrateTimer > 0) break;
            const beaten = bySide(other(match.winner));
            if (beaten && this.queueHead(uid)) {
              this.rotateOut(beaten);
              this.matches.delete(uid); // the next match starts when the newcomer arrives
              break;
            }
            match.scores = [0, 0];
            match.winner = null;
          }
          // Loser turns to fetch the ball
          const loser = bySide(match.to);
          if (loser) loser.dir = Direction.DOWN;
          match.phase = 'pickup';
          match.t = 0;
          break;
        }
        case 'pickup': {
          match.t += dt / GAME_PICKUP_SEC;
          if (match.t < 1) break;
          // Serve from the loser's end
          const loser = bySide(match.to);
          if (loser?.playSlot) {
            loser.dir = loser.playSlot.dir;
            loser.swingTimer = GAME_SWING_SEC;
          }
          match.phase = 'rally';
          match.to = other(match.to);
          match.t = 0;
          match.hitsLeft = randomHits();
          break;
        }
      }
    }
  }

  /** Ball positions for every match in progress (world px), for the renderer. */
  getBalls(): GameBall[] {
    if (this.matches.size === 0) return [];
    const balls: GameBall[] = [];
    for (const m of this.matches.values()) {
      const item = this.layout.furniture.find((f) => f.uid === m.uid);
      const entry = item && getCatalogEntry(item.type);
      if (!item || !entry) continue;
      const style = GAME_BALL_STYLES[m.game] ?? GAME_BALL_STYLES.PING_PONG_TABLE;
      const xEnd: [number, number] = [
        item.col * TILE_SIZE + GAME_BALL_END_INSET_PX,
        (item.col + entry.footprintW) * TILE_SIZE - GAME_BALL_END_INSET_PX,
      ];
      const ySurface = item.row * TILE_SIZE + GAME_BALL_SURFACE_Y_PX;
      const dir = m.to === 1 ? 1 : -1; // +x when heading to the right end
      let x: number;
      let y: number;
      if (m.phase === 'rally') {
        const from = xEnd[other(m.to)];
        x = from + (xEnd[m.to] - from) * m.t;
        y = ySurface - style.arcPx * Math.sin(m.t * Math.PI);
      } else if (m.phase === 'miss') {
        if (m.winner !== null) continue; // game over: ball is gone
        x = xEnd[m.to] + dir * GAME_MISS_DISTANCE_PX * m.t;
        y = ySurface + GAME_MISS_DROP_PX * m.t * m.t;
      } else {
        if (m.t > 0.5) continue; // picked up
        x = xEnd[m.to] + dir * GAME_MISS_DISTANCE_PX;
        y = ySurface + GAME_MISS_DROP_PX;
      }
      balls.push({ x, y, color: style.color, shade: style.shade });
    }
    return balls;
  }

  /** Scoreboards for every match in progress, positioned above the table. */
  getScoreboards(): Scoreboard[] {
    if (this.matches.size === 0) return [];
    const boards: Scoreboard[] = [];
    for (const match of this.matches.values()) {
      const item = this.layout.furniture.find((f) => f.uid === match.uid);
      const entry = item && getCatalogEntry(item.type);
      if (!item || !entry) continue;
      boards.push({
        x: (item.col + entry.footprintW / 2) * TILE_SIZE,
        y: item.row * TILE_SIZE - SCOREBOARD_OFFSET_PX,
        text: `${match.scores[0]} - ${match.scores[1]}`,
      });
    }
    return boards;
  }

  /** Monotonic ticket for click-to-play queue joins (FSM joins use the module counter). */
  private queueTicket = 1_000_000;

  /** Game slots no character has claimed (walking to or playing at). */
  private freeGameSlots(): GameSlot[] {
    if (this.gameSlots.length === 0) return [];
    const claimed = new Set<string>();
    for (const ch of this.characters.values()) {
      if (ch.playSlot) claimed.add(`${ch.playSlot.col},${ch.playSlot.row}`);
    }
    return this.gameSlots.filter((s) => !claimed.has(`${s.col},${s.row}`));
  }

  /** Free ends `ch` is allowed to take: a table with a queue only offers its ends to
   *  the head of that queue, so newcomers never jump the line. */
  private freeGameSlotsFor(ch: Character): GameSlot[] {
    const free = this.freeGameSlots();
    if (free.length === 0) return free;
    return free.filter((s) => {
      const head = this.queueHead(s.uid);
      return head === null || head === ch;
    });
  }

  /** A beaten player gives up its end: it walks to the back of the line at the same
   *  table, or wanders off when every spectator spot is taken. */
  private rotateOut(loser: Character): void {
    const uid = loser.playSlot?.uid;
    loser.playSlot = null;
    loser.state = CharacterState.IDLE;
    loser.frame = 0;
    loser.frameTimer = 0;
    loser.wanderTimer = WANDER_PAUSE_MIN_SEC;
    if (!uid) return;
    for (const spot of this.freeWaitSpots().filter((s) => s.uid === uid)) {
      const path = findPath(
        loser.tileCol,
        loser.tileRow,
        spot.col,
        spot.row,
        this.tileMap,
        this.blockedTiles,
      );
      if (path.length === 0) continue;
      loser.waitSpot = spot;
      loser.queuedAt = ++this.queueTicket;
      loser.path = path;
      loser.moveProgress = 0;
      loser.state = CharacterState.WALK;
      return;
    }
  }

  /** Longest-waiting character queued (or walking to queue) at a table, or null. */
  private queueHead(uid: string): Character | null {
    let head: Character | null = null;
    for (const c of this.characters.values()) {
      if (c.waitSpot?.uid !== uid) continue;
      if (!head || c.queuedAt < head.queuedAt) head = c;
    }
    return head;
  }

  /** Spectator spots no character has claimed. */
  private freeWaitSpots(): WaitSpot[] {
    if (this.waitSpots.length === 0) return [];
    const claimed = new Set<string>();
    for (const ch of this.characters.values()) {
      if (ch.waitSpot) claimed.add(`${ch.waitSpot.col},${ch.waitSpot.row}`);
    }
    return this.waitSpots.filter(
      (s) => !claimed.has(`${s.col},${s.row}`) && !(s.seatId && this.seats.get(s.seatId)?.assigned),
    );
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.currentTool = tool;
    }
  }

  showPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'permission';
      ch.bubbleTimer = 0;
    }
  }

  clearPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch && ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    }
  }

  showWaitingBubble(id: number, awaitingInput = false): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'waiting';
      ch.waitingAwaitingInput = awaitingInput;
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
    }
  }

  /** Dismiss bubble on click — permission: instant, waiting: quick fade */
  dismissBubble(id: number): void {
    const ch = this.characters.get(id);
    if (!ch || !ch.bubbleType) return;
    if (ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    } else if (ch.bubbleType === 'waiting') {
      // Trigger immediate fade (0.3s remaining)
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
    }
  }

  // ── Pets ──────────────────────────────────────────────────────

  /**
   * Add a pet to the live runtime. Spawns at a uniformly-random walkable tile.
   * Mirror in `this.layout.pets` so debounced saveLayout serialises the roster.
   * Bounds-checks petType against the loaded sprite count to defend against stale layouts.
   */
  addPet(placedPet: PlacedPet): void {
    // Defensive guards (upstream 5e6c0a0)
    if (
      typeof placedPet.id !== 'string' ||
      placedPet.id.length === 0 ||
      placedPet.id.length > MAX_PET_ID_LENGTH
    ) {
      return;
    }
    if (
      !Number.isInteger(placedPet.petType) ||
      placedPet.petType < 0 ||
      placedPet.petType >= getPetCount()
    ) {
      return;
    }
    if (this.pets.some((p) => p.id === placedPet.id)) return; // de-dupe
    const tiles = this.walkableOnView();
    if (tiles.length === 0) return; // no spawn space — silently drop

    const spawn = tiles[Math.floor(Math.random() * tiles.length)];
    const pet = createPet(placedPet.id, placedPet.petType, spawn.col, spawn.row);
    pet.name = getPetName(placedPet.petType);
    this.pets.push(pet);
    this.syncLayoutPets();
  }

  /** Remove a pet by id. Idempotent. */
  removePet(id: string): void {
    const before = this.pets.length;
    this.pets = this.pets.filter((p) => p.id !== id);
    if (this.pets.length !== before) {
      this.syncLayoutPets();
    }
  }

  /** Shallow snapshot for external consumers (renderer, hooks). */
  getPets(): Pet[] {
    return this.pets.slice();
  }

  /** Unique petType values currently placed. Used by the Pets toolbar to mark active rows. */
  getActivePetTypes(): number[] {
    const seen = new Set<number>();
    for (const p of this.pets) seen.add(p.petType);
    return Array.from(seen);
  }

  /**
   * Hit-test pets at a pixel world position. Sorts back-to-front (largest y wins on tie)
   * so the visually-frontmost pet receives the click.
   * Returns the pet id or null.
   */
  getPetAt(worldX: number, worldY: number): string | null {
    const ordered = this.pets.slice().sort((a, b) => b.y - a.y);
    for (const pet of ordered) {
      if (!this.isOnView(pet)) continue;
      const left = pet.x - PET_HIT_HALF_WIDTH;
      const right = pet.x + PET_HIT_HALF_WIDTH;
      const top = pet.y - PET_HIT_HEIGHT;
      const bottom = pet.y;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return pet.id;
      }
    }
    return null;
  }

  /** Show the heart bubble on a pet for WAITING_BUBBLE_DURATION_SEC. */
  showPetBubble(petId: string): void {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet) return;
    pet.bubbleType = 'heart';
    pet.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
  }

  /** Dismiss the heart bubble on click; collapses timer to a fast fade. */
  dismissPetBubble(petId: string): void {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet || !pet.bubbleType) return;
    pet.bubbleTimer = Math.min(pet.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
  }

  /**
   * Reconcile `this.pets` to match the layout's placed-pet roster.
   * - Pets in layout but not in runtime → spawn via addPet().
   * - Pets in runtime but not in layout → remove.
   * - Pets in both → keep existing runtime state (position, FSM).
   *
   * Called from constructor and rebuildFromLayout. Always runs AFTER walkableTiles
   * is populated.
   */
  private rebuildPetsFromLayout(layout: OfficeLayout): void {
    const placed = layout.pets ?? [];
    const placedIds = new Set(placed.map((p) => p.id));

    // 1. Remove pets no longer in layout
    this.pets = this.pets.filter((p) => placedIds.has(p.id));

    // 2. Add pets that exist in layout but not in runtime
    const existingIds = new Set(this.pets.map((p) => p.id));
    for (const p of placed) {
      if (existingIds.has(p.id)) continue;
      this.addPet(p); // pushes onto this.pets, calls syncLayoutPets()
    }
    // syncLayoutPets() inside addPet keeps this.layout.pets coherent; one final
    // sync handles the removal-only branch where addPet was never called.
    this.syncLayoutPets();
  }

  /**
   * Re-export the current pet roster into `this.layout.pets`. Called only from
   * mutating methods (addPet / removePet / rebuildPetsFromLayout) — NEVER from
   * getLayout(), which runs on every render frame.
   */
  private syncLayoutPets(): void {
    this.layout.pets = this.pets.map((p) => ({ id: p.id, petType: p.petType }));
  }

  setTeamInfo(
    id: number,
    teamName?: string,
    agentName?: string,
    isTeamLead?: boolean,
    leadAgentId?: number,
    teamUsesTmux?: boolean,
  ): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    const wasUnlinked = ch.leadAgentId === undefined;
    ch.teamName = teamName;
    ch.agentName = agentName;
    ch.isTeamLead = isTeamLead;
    ch.leadAgentId = leadAgentId;
    if (teamUsesTmux !== undefined) {
      ch.teamUsesTmux = teamUsesTmux;
    }
    // A teammate is not a headless agent: clicking it focuses its lead's terminal.
    // Adopted sessions are marked headless at creation and only later discovered
    // to be teammates, so drop the mark once the link lands.
    if (leadAgentId !== undefined) {
      ch.isHeadless = false;
    }
    // A teammate discovered only after its plain external session was adopted is
    // linked here, not at creation, so it never went through the seat-next-to-lead
    // path addAgent runs for inline teammates. Cluster it now, once, on first link.
    if (wasUnlinked && leadAgentId !== undefined && !isTeamLead) {
      this.reseatNextToLead(id, leadAgentId);
    }
  }

  /** Mark a character as another office's agent (multiplayer). */
  setRemote(id: number, peerName: string, peerId?: string): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.isRemote = true;
    ch.remotePeerName = peerName;
    if (peerId !== undefined) ch.remotePeerId = peerId;
  }

  /** Another office's person: the look they picked, their status, the song they share. */
  setRemoteProfile(id: number, profile: PeerProfile | undefined): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.look = profile?.look ?? null;
    ch.personStatus = profile?.status;
    ch.statusText = profile?.statusText;
    ch.music = profile?.music ?? null;
  }

  /** Mark a remote character as its office's person (name tag, speaks its chat). */
  setRemoteAvatar(id: number, isAvatar: boolean): void {
    const ch = this.characters.get(id);
    if (ch) ch.isAvatar = isAvatar;
  }

  /** Mark an agent as headless (adopted, no terminal to focus). */
  setHeadless(id: number, headless: boolean): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.isHeadless = headless;
  }

  setAgentContext(id: number, contextTokens: number, maxContextTokens: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.contextTokens = contextTokens;
    ch.maxContextTokens = maxContextTokens;
  }

  // ── Multiplayer room: the person's character ─────────────────

  /** Put the person's character in the office (joined a room). The oldest local
   *  agent becomes it when one exists; otherwise a character of its own appears
   *  on a free walkable tile. Idempotent. */
  ensureAvatar(): void {
    if (this.avatarId !== null && this.characters.has(this.avatarId)) {
      const existing = this.characters.get(this.avatarId)!;
      if (existing.matrixEffect === 'despawn') startMatrixEffect(existing, 'spawn');
      return;
    }
    let oldest: Character | null = null;
    for (const ch of this.characters.values()) {
      if (ch.id <= 0 || ch.isSubagent || ch.isRemote || ch.matrixEffect === 'despawn') continue;
      if (!oldest || ch.id < oldest.id) oldest = ch;
    }
    if (oldest) {
      oldest.isAvatar = true;
      this.avatarId = oldest.id;
      this.applyLocalProfile();
      // The view goes to where the person is.
      const level = this.levelOf(oldest);
      if (level) this.viewLevelId = level.id;
      return;
    }
    const { palette, hueShift } = this.pickDiversePalette();
    const ch = createCharacter(AVATAR_LOCAL_ID, palette, null, null, hueShift);
    const view = this.getView();
    const spawn = this.closestFreeWalkableTile(
      view.col + Math.floor(view.cols / 2),
      view.row + Math.floor(view.rows / 2),
    );
    if (spawn) {
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
    }
    ch.state = CharacterState.IDLE;
    ch.isActive = false;
    ch.isAvatar = true;
    startMatrixEffect(ch, 'spawn');
    this.characters.set(AVATAR_LOCAL_ID, ch);
    this.avatarId = AVATAR_LOCAL_ID;
    this.applyLocalProfile();
  }

  /** Left the room: the person's own character goes (an agent driving it stays, as an agent). */
  removeAvatar(): void {
    const id = this.avatarId;
    this.avatarId = null;
    this.avatarHeldDir = null;
    this.stopFollowing();
    if (id === null) return;
    const ch = this.characters.get(id);
    if (!ch) return;
    ch.isAvatar = false;
    // An agent that was the person goes back to looking like an agent.
    ch.look = null;
    ch.personStatus = undefined;
    ch.statusText = undefined;
    ch.music = null;
    if (id === AVATAR_LOCAL_ID) this.removeAgent(id);
    this.refreshDecor();
  }

  // ── Multiplayer room: the person's profile ───────────────────

  /** The person's look / status / song: drawn on their character, kept for when it is re-created. */
  setLocalProfile(profile: Partial<LocalCharacterProfile>): void {
    this.localProfile = { ...this.localProfile, ...profile };
    this.applyLocalProfile();
  }

  getLocalProfile(): LocalCharacterProfile {
    return this.localProfile;
  }

  private applyLocalProfile(): void {
    if (this.avatarId === null) return;
    const ch = this.characters.get(this.avatarId);
    if (!ch) return;
    ch.look = this.localProfile.look;
    ch.personStatus = this.localProfile.status;
    ch.statusText = this.localProfile.statusText;
    ch.music = this.localProfile.music;
  }

  // ── Multiplayer room: following someone ─────────────────────

  /** Walk the person's character to someone ("Go to", once) or keep walking after them ("Follow").
   *  False when there is no such character, or it is the person. */
  followCharacter(targetId: number, once = false): boolean {
    if (this.avatarId === null || targetId === this.avatarId) return false;
    const target = this.characters.get(targetId);
    if (!target || target.matrixEffect === 'despawn') return false;
    this.avatarFollowId = targetId;
    this.avatarFollowOnce = once;
    this.followTimer = 0;
    this.followTargetTile = null;
    return true;
  }

  stopFollowing(): void {
    this.avatarFollowId = null;
    this.avatarFollowOnce = false;
    this.followTargetTile = null;
  }

  /** Free walkable tiles near (col,row), closest first — beside them before below, below
   *  before above (standing just above someone hides them behind your sprite). */
  private freeTilesNear(
    col: number,
    row: number,
    self: Character,
  ): Array<{ col: number; row: number }> {
    const occupied = new Set<string>();
    for (const c of this.characters.values()) {
      if (c !== self) occupied.add(`${c.tileCol},${c.tileRow}`);
    }
    return this.walkableFor({ tileCol: col })
      .filter((t) => !occupied.has(`${t.col},${t.row}`))
      .map((t) => ({ t, d: Math.abs(t.col - col) + Math.abs(t.row - row) }))
      .filter(({ d }) => d > 0)
      .map(({ t, d }) => ({ t, d: d + (t.row < row ? 0.5 : t.row > row ? 0.25 : 0) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8)
      .map(({ t }) => t);
  }

  /** Steer the person's character toward whoever it follows. Paused while Claude drives it. */
  private updateFollow(ch: Character, dt: number): void {
    const targetId = this.avatarFollowId;
    if (targetId === null) return;
    const target = this.characters.get(targetId);
    if (!target || target.matrixEffect === 'despawn') {
      this.stopFollowing();
      return;
    }
    if (ch.isActive || ch.matrixEffect !== null || ch.transit || target.transit) return;
    this.followTimer -= dt;
    if (this.followTimer > 0) return;
    this.followTimer = FOLLOW_REPATH_SEC;

    const tc = target.tileCol;
    const tr = target.tileRow;
    const dist = Math.abs(ch.tileCol - tc) + Math.abs(ch.tileRow - tr);
    const walking = ch.state === CharacterState.WALK && ch.path.length > 0;
    const sameLevel = this.levelOf(ch)?.id === this.levelOf(target)?.id;
    if (sameLevel && dist <= FOLLOW_ARRIVE_TILES) {
      if (!walking) {
        const dc = tc - ch.tileCol;
        const dr = tr - ch.tileRow;
        if (dc !== 0 || dr !== 0) {
          ch.dir =
            Math.abs(dc) >= Math.abs(dr)
              ? dc > 0
                ? Direction.RIGHT
                : Direction.LEFT
              : dr > 0
                ? Direction.DOWN
                : Direction.UP;
        }
        if (this.avatarFollowOnce) this.stopFollowing();
      }
      return;
    }
    const key = `${tc},${tr}`;
    if (key === this.followTargetTile && walking) return; // still on the way to where they were

    // Mid-step: keep the step being taken, plan the rest from where it lands.
    const midStep = walking && ch.moveProgress > 0;
    const from = midStep ? ch.path[0] : { col: ch.tileCol, row: ch.tileRow };
    for (const spot of this.freeTilesNear(tc, tr, ch)) {
      const path = this.withOwnSeatUnblocked(ch, () =>
        findPath(from.col, from.row, spot.col, spot.row, this.tileMap, this.blockedTiles),
      );
      if (path.length === 0 && (from.col !== spot.col || from.row !== spot.row)) continue;
      // Walking off ends a dance (reactions float on).
      if (ch.emote && EMOTES[ch.emote.kind].motion) ch.emote = null;
      ch.playSlot = null;
      ch.waitSpot = null;
      if (midStep) {
        ch.path = [from, ...path];
      } else {
        ch.path = path;
        ch.moveProgress = 0;
      }
      if (ch.path.length > 0 && ch.state !== CharacterState.WALK) {
        ch.state = CharacterState.WALK;
        ch.frame = 0;
        ch.frameTimer = 0;
      }
      this.followTargetTile = key;
      return;
    }
  }

  // ── Multiplayer room: desk decoration ───────────────────────

  /** The person's decoration (relative to their desk's chair). */
  setLocalDecor(items: DeskDecorItem[]): void {
    this.localDecor = items.slice();
    this.refreshDecor();
  }

  getLocalDecor(): DeskDecorItem[] {
    return this.localDecor;
  }

  /** Every other office's desk: its decoration, desk style and the items taken off it. */
  setRemoteDecor(
    list: Array<{
      desk: string | null | undefined;
      items: DeskDecorItem[] | undefined;
      deskStyle?: string | null;
      hidden?: string[];
    }>,
  ): void {
    const claimed = list.filter((d): d is typeof d & { desk: string } => !!d.desk);
    this.remoteDecor = claimed
      .filter((d) => !!d.items?.length)
      .map((d) => ({ desk: d.desk, items: d.items! }));
    this.remoteDressing = claimed
      .filter((d) => !!d.deskStyle || !!d.hidden?.length)
      .map((d) => ({ desk: d.desk, deskStyle: d.deskStyle ?? null, hidden: d.hidden ?? [] }));
    this.refreshDecor();
  }

  /** The person's desk style and the layout items taken off their desk. */
  setLocalDressing(dressing: Partial<DeskDressing>): void {
    this.localDressing = { ...this.localDressing, ...dressing };
    this.refreshDecor();
  }

  getLocalDressing(): DeskDressing {
    return this.localDressing;
  }

  /** Rebuild the furniture instances when the decoration (or the desk it hangs off) moved. */
  private refreshDecor(): void {
    const key = JSON.stringify([
      this.getDesk(),
      this.localDecor,
      this.remoteDecor,
      this.localDressing,
      this.remoteDressing,
    ]);
    if (key === this.decorKey) return;
    this.decorKey = key;
    this.followMovedSeats(this.computeDressing());
    this.rebuildFurnitureInstances();
  }

  /** While the layout editor is open, chairs stand where the room built them. */
  setTurnsPaused(paused: boolean): void {
    if (paused === this.turnsPaused) return;
    this.turnsPaused = paused;
    this.decorKey = '';
    this.refreshDecor();
  }

  /** A chair moved to the other side of its desk: whoever sat in it (or was on the
   *  way) goes round to it — or, with no way round, is simply there. */
  private followMovedSeats(moved: Array<{ seatId: string; from: TilePos }>): void {
    for (const { seatId, from } of moved) {
      const seat = this.seats.get(seatId);
      if (!seat) continue;
      for (const ch of this.characters.values()) {
        if (ch.seatId !== seatId || ch.remoteTarget) continue;
        const last = ch.path[ch.path.length - 1];
        const sitting = ch.path.length === 0 && ch.tileCol === from.col && ch.tileRow === from.row;
        const headed = !!last && last.col === from.col && last.row === from.row;
        if (!sitting && !headed) continue;
        const path = this.withOwnSeatUnblocked(ch, () =>
          findPath(
            ch.tileCol,
            ch.tileRow,
            seat.seatCol,
            seat.seatRow,
            this.tileMap,
            this.blockedTiles,
          ),
        );
        ch.moveProgress = 0;
        ch.frame = 0;
        ch.frameTimer = 0;
        if (path.length > 0) {
          ch.path = path;
          ch.state = CharacterState.WALK;
          continue;
        }
        ch.path = [];
        ch.tileCol = seat.seatCol;
        ch.tileRow = seat.seatRow;
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
        ch.dir = seat.facingDir;
      }
    }
  }

  /** The desk a seat faces, as a layout item. */
  private facedDesk(seat: Seat): { item: PlacedFurniture; entry: CatalogEntryWithCategory } | null {
    const { dCol, dRow } = seatFacingOffset(seat.facingDir);
    const fc = seat.seatCol + dCol;
    const fr = seat.seatRow + dRow;
    for (const item of this.layout.furniture) {
      const entry = getCatalogEntry(item.type);
      if (!entry?.isDesk) continue;
      if (
        fc >= item.col &&
        fc < item.col + entry.footprintW &&
        fr >= item.row &&
        fr < item.row + entry.footprintH
      ) {
        return { item, entry };
      }
    }
    return null;
  }

  /** Layout items standing on a desk (surface items overlapping its footprint). */
  private itemsOnDesk(
    desk: PlacedFurniture,
    deskEntry: CatalogEntryWithCategory,
  ): PlacedFurniture[] {
    return this.layout.furniture.filter((item) => {
      if (item === desk) return false;
      const e = getCatalogEntry(item.type);
      if (!e?.canPlaceOnSurfaces || e.canPlaceOnWalls) return false;
      return (
        item.col < desk.col + deskEntry.footprintW &&
        item.col + e.footprintW > desk.col &&
        item.row < desk.row + deskEntry.footprintH &&
        item.row + e.footprintH > desk.row
      );
    });
  }

  /** Re-derive skins, hidden items and turns from every dressing. Only a person's own
   *  desk (the one their chair faces) and chair are dressed, and only items standing on
   *  that desk can be taken off — whatever a dressing names beyond that is ignored.
   *  A styled desk faces the room: a chair behind it (the person facing the viewer,
   *  seeing the backs of their screens) moves to its front side, the person sitting
   *  with their back to the room. Returns the seats that moved, and from where. */
  private computeDressing(): Array<{ seatId: string; from: TilePos }> {
    // Seats back where the room built them before the turns are worked out again.
    const before = this.turns;
    for (const [seatId, t] of before) {
      const seat = this.seats.get(seatId);
      if (!seat) continue;
      seat.seatCol = t.from.col;
      seat.seatRow = t.from.row;
      seat.facingDir = t.from.dir;
    }
    this.turns = new Map();
    this.skins = new Map();
    this.hiddenUids = new Set();
    const apply = (deskSeat: string | null, dressing: DeskDressing) => {
      const seat = deskSeat ? this.seats.get(deskSeat) : undefined;
      if (!seat) return;
      const faced = this.facedDesk(seat);
      if (!faced) return;
      if (dressing.hidden.length > 0) {
        const wanted = new Set(dressing.hidden);
        for (const item of this.itemsOnDesk(faced.item, faced.entry)) {
          if (wanted.has(item.uid)) this.hiddenUids.add(item.uid);
        }
      }
      const style = dressing.deskStyle;
      if (!style || this.skins.has(faced.item.uid)) return;
      const deskSkin = deskStyleVariant(style, faced.entry);
      if (deskSkin) this.skins.set(faced.item.uid, deskSkin);
      const chairUid = deskSeat!.split(':')[0];
      const chair = this.layout.furniture.find((f) => f.uid === chairUid);
      const chairEntry = chair ? getCatalogEntry(chair.type) : undefined;
      if (!chair || !chairEntry) return;
      const to = this.turnTarget(deskSeat!, seat, faced, chairEntry);
      const chairSkin = chairStyleVariant(to ? Direction.UP : seat.facingDir, chairEntry);
      if (chairSkin) this.skins.set(chair.uid, chairSkin);
      if (!to) return;
      this.turns.set(deskSeat!, {
        from: { col: seat.seatCol, row: seat.seatRow, dir: seat.facingDir },
        to,
        chairUid: chair.uid,
      });
      seat.seatCol = to.col;
      seat.seatRow = to.row;
      seat.facingDir = Direction.UP;
    };
    apply(this.getDesk(), this.localDressing);
    for (const d of this.remoteDressing) apply(d.desk, d);
    this.skinKey = JSON.stringify([...this.skins]);

    // A moved chair frees the tile it stood on and takes the one it stands on now.
    if (before.size > 0 || this.turns.size > 0) {
      this.blockedTiles = getBlockedTiles(this.withTurns(this.layout.furniture));
      this.refreshWalkable();
    }
    const moved: Array<{ seatId: string; from: TilePos }> = [];
    for (const seatId of new Set([...before.keys(), ...this.turns.keys()])) {
      const seat = this.seats.get(seatId);
      if (!seat) continue;
      const from = before.get(seatId)?.to ?? this.turns.get(seatId)!.from;
      if (from.col !== seat.seatCol || from.row !== seat.seatRow) moved.push({ seatId, from });
    }
    return moved;
  }

  /**
   * Where a styled desk's chair goes to face the room: straight across the desk, on
   * the tile in front of it. Only a chair behind the desk (facing down) is turned,
   * only a one-seat chair with an office chair to draw from behind, and only onto
   * free floor — no furniture there at all, no other seat. Null: it stays put.
   */
  private turnTarget(
    seatId: string,
    seat: Seat,
    faced: { item: PlacedFurniture; entry: CatalogEntryWithCategory },
    chairEntry: CatalogEntryWithCategory,
  ): TilePos | null {
    if (this.turnsPaused || seat.facingDir !== Direction.DOWN) return null;
    if (seatId.includes(':') || this.seats.has(`${seatId}:1`)) return null;
    if (!chairStyleVariant(Direction.UP, chairEntry)) return null;
    const col = seat.seatCol;
    const row = faced.item.row + faced.entry.footprintH;
    const tile = this.tileMap[row]?.[col];
    if (tile === undefined || tile === TileType.WALL || tile === TileType.VOID) return null;
    for (const s of this.seats.values()) {
      if (s.seatCol === col && s.seatRow === row) return null;
    }
    for (const item of this.layout.furniture) {
      const e = getCatalogEntry(item.type);
      if (!e) continue;
      if (
        col >= item.col &&
        col < item.col + e.footprintW &&
        row >= item.row &&
        row < item.row + e.footprintH
      ) {
        return null;
      }
    }
    return { col, row };
  }

  /** Layout items on the person's desk: under a world point (topmost), for taking off. */
  deskLayoutItemAt(
    worldX: number,
    worldY: number,
  ): { uid: string; type: string; box: PixelRect } | null {
    const desk = this.getDesk();
    const seat = desk ? this.seats.get(desk) : undefined;
    const faced = seat ? this.facedDesk(seat) : null;
    if (!faced) return null;
    let hit: { uid: string; type: string; box: PixelRect } | null = null;
    for (const item of this.itemsOnDesk(faced.item, faced.entry)) {
      if (this.hiddenUids.has(item.uid)) continue;
      const entry = getCatalogEntry(item.type)!;
      let b = opaqueBox(entry.sprite);
      if (!b) continue;
      if (entry.mirrorSide && getOrientationInGroup(item.type) === 'left') {
        b = mirrorRect(b, entry.sprite[0]?.length ?? 0);
      }
      const box = {
        x0: item.col * TILE_SIZE + b.x0,
        y0: item.row * TILE_SIZE + b.y0,
        x1: item.col * TILE_SIZE + b.x1,
        y1: item.row * TILE_SIZE + b.y1,
      };
      if (worldX < box.x0 || worldX > box.x1 + 1 || worldY < box.y0 || worldY > box.y1 + 1)
        continue;
      if (!hit || box.y1 > hit.box.y1) hit = { uid: item.uid, type: item.type, box };
    }
    return hit;
  }

  /** Types of layout items (by uid), to name what was taken off the desk. */
  layoutItemType(uid: string): string | null {
    return this.layout.furniture.find((f) => f.uid === uid)?.type ?? null;
  }

  /**
   * Dress the person's desk with a preset — a desk style, everything that came
   * on the desk taken off, and a full setup placed on it and beside it,
   * arranged for where the chair is. Applied here; returns what to save.
   */
  applyDeskPreset(preset: DeskPreset): {
    decor: DeskDecorItem[];
    hidden: string[];
    deskStyle: string | null;
  } | null {
    const deskSeat = this.getDesk();
    const seat = deskSeat ? this.seats.get(deskSeat) : undefined;
    const faced = seat ? this.facedDesk(seat) : null;
    if (!seat || !faced) return null;
    const hidden = this.itemsOnDesk(faced.item, faced.entry).map((f) => f.uid);
    const deskStyle = deskStyleVariant(preset.deskStyle, faced.entry) ? preset.deskStyle : null;
    this.localDecor = [];
    this.setLocalDressing({ deskStyle, hidden });
    const top = this.topsFor(seat)[0];
    const decor: DeskDecorItem[] = [];
    if (top) {
      const { x0, y0, x1, y1 } = top.rect;
      // (fx, fy) are for a chair in front of the desk: fx left→right, fy back→front.
      const toWorld = (fx: number, fy: number): { x: number; y: number } => {
        let u = fx;
        let v = fy;
        if (seat.facingDir === Direction.DOWN) {
          u = 1 - fx;
          v = 1 - fy;
        } else if (seat.facingDir === Direction.RIGHT) {
          u = 1 - fy;
          v = fx;
        } else if (seat.facingDir === Direction.LEFT) {
          u = fy;
          v = 1 - fx;
        }
        return { x: x0 + u * (x1 - x0), y: y0 + v * (y1 - y0 + 2) };
      };
      for (const it of preset.items) {
        if (it.minWidth && Math.max(x1 - x0, y1 - y0) + 1 < it.minWidth) continue;
        const type = this.decorVariantForDesk(it.type);
        const at = toWorld(it.fx, it.fy);
        const placement = this.nearestValidPlacement(type, at.x, at.y);
        if (placement) {
          decor.push(placement);
          this.localDecor = [...decor];
        }
      }
    }
    // Floor pieces: beside the desk, on the person's left, as near the chair as it goes.
    for (const type of preset.floor) {
      const side = seatFacingOffset(
        seat.facingDir === Direction.UP
          ? Direction.LEFT
          : seat.facingDir === Direction.DOWN
            ? Direction.RIGHT
            : seat.facingDir === Direction.RIGHT
              ? Direction.UP
              : Direction.DOWN,
      );
      const targetCol = seat.seatCol + side.dCol * 2;
      const targetRow = seat.seatRow + side.dRow * 2;
      const candidates: Array<{ col: number; row: number; d: number }> = [];
      for (let dr = -DECOR_MAX_OFFSET; dr <= DECOR_MAX_OFFSET; dr++) {
        for (let dc = -DECOR_MAX_OFFSET; dc <= DECOR_MAX_OFFSET; dc++) {
          const col = seat.seatCol + dc;
          const row = seat.seatRow + dr;
          candidates.push({ col, row, d: Math.abs(col - targetCol) + Math.abs(row - targetRow) });
        }
      }
      candidates.sort((a, b) => a.d - b.d);
      for (const c of candidates) {
        const p = this.decorPlacementAt(type, c.col * TILE_SIZE + 8, c.row * TILE_SIZE + 8);
        if (p?.valid) {
          decor.push(p.item);
          this.localDecor = [...decor];
          break;
        }
      }
    }
    this.setLocalDecor(decor);
    return { decor, hidden, deskStyle };
  }

  /** A valid placement for a desk item as close as possible to (x, y). */
  private nearestValidPlacement(type: string, x: number, y: number): DeskDecorItem | null {
    for (let r = 0; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const p = this.decorPlacementAt(type, x + dx, y + dy);
          if (p?.valid) return p.item;
        }
      }
    }
    return null;
  }

  /** Tiles that furniture occupies for placement (background rows excluded), and desk tiles. */
  private decorGround(): { blocked: Set<string>; desks: Set<string>; seats: Set<string> } {
    const blocked = new Set<string>();
    const desks = new Set<string>();
    for (const item of this.withTurns(this.layout.furniture)) {
      const entry = getCatalogEntry(item.type);
      if (!entry) continue;
      const bgRows = entry.backgroundTiles || 0;
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          const key = `${item.col + dc},${item.row + dr}`;
          if (entry.isDesk) desks.add(key);
          if (dr >= bgRows) blocked.add(key);
        }
      }
    }
    const seats = new Set<string>();
    for (const s of this.seats.values()) seats.add(`${s.seatCol},${s.seatRow}`);
    return { blocked, desks, seats };
  }

  /** Whether a decoration can stand with its base on (col,row): wall pieces on a wall,
   *  desk pieces on a desk, the rest on free floor. Never on a chair. */
  private decorFits(
    entry: CatalogEntryWithCategory,
    col: number,
    row: number,
    ground: { blocked: Set<string>; desks: Set<string>; seats: Set<string> },
  ): boolean {
    if (entry.footprintW !== 1) return false;
    const tile = this.tileMap[row]?.[col];
    if (tile === undefined) return false;
    const key = `${col},${row}`;
    if (entry.canPlaceOnWalls) return tile === TileType.WALL;
    if (tile === TileType.WALL || tile === TileType.VOID || ground.seats.has(key)) return false;
    if (entry.canPlaceOnSurfaces) return ground.desks.has(key);
    return !ground.blocked.has(key);
  }

  /** A free spot to stand at the office's meeting place — beside a whiteboard, or a
   *  table that is neither a desk nor a game — closest to the person. Null when the
   *  office has none. */
  meetingSpot(): { col: number; row: number } | null {
    const self = this.avatarId !== null ? this.characters.get(this.avatarId) : undefined;
    if (!self) return null;
    const around = new Set<string>();
    for (const item of this.layout.furniture) {
      const entry = getCatalogEntry(item.type);
      if (!entry || entry.isDesk || isGameTable(item.type)) continue;
      if (!/WHITEBOARD|TABLE/i.test(item.type)) continue;
      for (let dr = -1; dr <= entry.footprintH; dr++) {
        for (let dc = -1; dc <= entry.footprintW; dc++) {
          around.add(`${item.col + dc},${item.row + dr}`);
        }
      }
    }
    if (around.size === 0) return null;
    const occupied = new Set<string>();
    for (const c of this.characters.values()) {
      if (c !== self) occupied.add(`${c.tileCol},${c.tileRow}`);
    }
    let best: { col: number; row: number } | null = null;
    let bestD = Infinity;
    for (const t of this.walkableTiles) {
      const key = `${t.col},${t.row}`;
      if (!around.has(key) || occupied.has(key)) continue;
      // Another level's meeting place counts as far away (stairs in between).
      const penalty = this.levelOf({ tileCol: t.col })?.id === this.levelOf(self)?.id ? 0 : 1000;
      const d = penalty + Math.abs(t.col - self.tileCol) + Math.abs(t.row - self.tileRow);
      if (d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best;
  }

  /** Walk the person's character to a tile (the meeting place). False when Claude has it or no path. */
  walkAvatarTo(col: number, row: number): boolean {
    if (this.avatarId === null || !this.avatarIsManual()) return false;
    this.stopFollowing();
    return this.walkToTile(this.avatarId, col, row);
  }

  // Desk items (monitors, mugs, a pie...) stand anywhere on the tabletop, to
  // the pixel: an item is anchored by the middle of its base, relative to the
  // desk's chair (`dc,dr` tiles + `px,py` pixels), and must stand fully on the
  // top face of the desk that chair faces. Floor and wall pieces snap to tiles.

  /** Every desk's tabletop in world px, and the depth the desk sorts at. */
  private deskTops(): DeskTop[] {
    const cache = this.deskTopCache;
    if (cache?.layout === this.layout && cache.skinKey === this.skinKey) return cache.tops;
    const tops: DeskTop[] = [];
    for (const item of this.layout.furniture) {
      // A dressed desk's top is the style's tabletop.
      const type = this.skins.get(item.uid) ?? item.type;
      const entry = getCatalogEntry(type);
      if (!entry?.isDesk) continue;
      let r = deskSurface(entry.sprite);
      if (!r) continue;
      if (entry.mirrorSide && getOrientationInGroup(type) === 'left') {
        r = mirrorRect(r, entry.sprite[0]?.length ?? 0);
      }
      const x = item.col * TILE_SIZE;
      const y = item.row * TILE_SIZE;
      const sprite = entry.sprite;
      const sw = sprite[0]?.length ?? 0;
      const mirrored = !!entry.mirrorSide && getOrientationInGroup(type) === 'left';
      tops.push({
        col: item.col,
        row: item.row,
        w: entry.footprintW,
        h: entry.footprintH,
        rect: { x0: x + r.x0, y0: y + r.y0, x1: x + r.x1, y1: y + r.y1 },
        zY: y + sprite.length,
        isTop: (wx, wy) => isTabletopPixel(sprite, mirrored ? sw - 1 - (wx - x) : wx - x, wy - y),
      });
    }
    this.deskTopCache = { layout: this.layout, skinKey: this.skinKey, tops };
    return tops;
  }

  /** The tabletops a person at `seat` decorates: the desk the chair faces, or —
   *  a chair facing no desk — any desk within reach. */
  private topsFor(seat: Seat): DeskTop[] {
    const all = this.deskTops();
    const { dCol, dRow } = seatFacingOffset(seat.facingDir);
    const fc = seat.seatCol + dCol;
    const fr = seat.seatRow + dRow;
    const faced = all.filter(
      (t) => fc >= t.col && fc < t.col + t.w && fr >= t.row && fr < t.row + t.h,
    );
    if (faced.length > 0) return faced;
    const reach = DECOR_MAX_OFFSET;
    return all.filter(
      (t) =>
        t.col - reach <= seat.seatCol &&
        seat.seatCol <= t.col + t.w - 1 + reach &&
        t.row - reach <= seat.seatRow &&
        seat.seatRow <= t.row + t.h - 1 + reach,
    );
  }

  /** Where a desk's decoration hangs (see DecorFrame). */
  private decorFrame(seatId: string | null): DecorFrame | null {
    const seat = seatId ? this.seats.get(seatId) : undefined;
    if (!seat) return null;
    const turn = this.turns.get(seatId!) ?? null;
    return { seat, col: turn?.from.col ?? seat.seatCol, row: turn?.from.row ?? seat.seatRow, turn };
  }

  /** A kept item as a turned desk draws it — or, from how it is drawn, as kept:
   *  the half turn is its own inverse. Unturned desks and wall pieces: unchanged. */
  private halfTurn(frame: DecorFrame, it: DeskDecorItem, tops: DeskTop[]): DeskDecorItem {
    const { turn } = frame;
    const entry = getCatalogEntry(it.type);
    if (!turn || !entry || entry.canPlaceOnWalls) return it;
    const type = halfTurned(it.type);
    if (!isDeskItem(entry)) {
      const col = turn.from.col + turn.to.col - (frame.col + it.dc);
      const row = turn.from.row + turn.to.row - (frame.row + it.dr);
      return { type, dc: col - frame.col, dr: row - frame.row };
    }
    const r = tops[0]?.rect;
    if (!r) return { ...it, type };
    // About the tabletop's middle: its base row keeps its depth from the other edge.
    const ax = r.x0 + r.x1 + 1 - ((frame.col + it.dc) * TILE_SIZE + (it.px ?? DECOR_DEFAULT_PX));
    const ay = r.y0 + r.y1 + 4 - ((frame.row + it.dr) * TILE_SIZE + (it.py ?? DECOR_DEFAULT_PY));
    const x = ax - frame.col * TILE_SIZE;
    const y = ay - frame.row * TILE_SIZE;
    const dc = Math.floor(x / TILE_SIZE);
    const dr = Math.floor(y / TILE_SIZE);
    return { type, dc, dr, px: x - dc * TILE_SIZE, py: y - dr * TILE_SIZE };
  }

  /** How a kept item looks and whether it fits, on the desk `frame` hangs off. */
  private pieceFor(
    frame: DecorFrame,
    kept: DeskDecorItem,
    tops: DeskTop[],
    ground: { blocked: Set<string>; desks: Set<string>; seats: Set<string> },
  ): Omit<DecorPiece, 'owner' | 'index' | 'item'> | null {
    const it = this.halfTurn(frame, kept, tops);
    const entry = getCatalogEntry(it.type);
    // Desk items may be any size (placed by pixel); floor and wall pieces hold one tile.
    if (!entry || (!isDeskItem(entry) && entry.footprintW !== 1)) return null;
    const mirrored = !!entry.mirrorSide && getOrientationInGroup(it.type) === 'left';
    const w = entry.sprite[0]?.length ?? 0;
    let b = opaqueBox(entry.sprite);
    if (!b) return null;
    if (mirrored) b = mirrorRect(b, w);

    if (isDeskItem(entry)) {
      const anchorX = (frame.col + it.dc) * TILE_SIZE + (it.px ?? DECOR_DEFAULT_PX);
      const anchorY = (frame.row + it.dr) * TILE_SIZE + (it.py ?? DECOR_DEFAULT_PY);
      const x = anchorX - Math.floor((b.x0 + b.x1 + 1) / 2);
      const y = anchorY - (b.y1 + 1);
      const box = { x0: x + b.x0, y0: y + b.y0, x1: x + b.x1, y1: y + b.y1 };
      const base = box.y1;
      // What it stands on (its lowest row) rests on the tabletop; the rest may overhang.
      let span = baseSpan(entry.sprite) ?? { x0: b.x0, x1: b.x1 };
      if (mirrored) span = { x0: w - 1 - span.x1, x1: w - 1 - span.x0 };
      const foot0 = x + span.x0;
      const foot1 = x + span.x1;
      const top = tops.find((t) => {
        if (foot0 < t.rect.x0 || foot1 > t.rect.x1) return false;
        if (base < t.rect.y0 + 1 || base > t.rect.y1 + 1) return false;
        // Both ends of the base on the top face itself (a curved desk's corners are round).
        const row = Math.min(base, t.rect.y1);
        return t.isTop(foot0, row) && t.isTop(foot1, row);
      });
      // In front of the desk; nearer the front edge, in front of the others.
      const zY = (top?.zY ?? anchorY) + 0.5 + (top ? (base - top.rect.y0) / 100 : 0);
      return {
        instance: { sprite: entry.sprite, x, y, zY, ...(mirrored ? { mirrored: true } : {}) },
        box,
        fits: !!top,
        tileKey: null,
      };
    }

    const col = frame.col + it.dc;
    const row = frame.row + it.dr;
    const [instance] = layoutToFurnitureInstances([
      { uid: 'decor', type: it.type, col, row: row - (entry.footprintH - 1) },
    ]);
    if (!instance) return null;
    return {
      instance,
      box: {
        x0: instance.x + b.x0,
        y0: instance.y + b.y0,
        x1: instance.x + b.x1,
        y1: instance.y + b.y1,
      },
      fits: this.decorFits(entry, col, row, ground),
      tileKey: `${col},${row}`,
    };
  }

  /** Every decoration to draw — the person's and the other offices' — where it fits. */
  decorPieces(): DecorPiece[] {
    if (this.localDecor.length === 0 && this.remoteDecor.length === 0) return [];
    const ground = this.decorGround();
    const out: DecorPiece[] = [];
    const takenTiles = new Set<string>();
    const add = (owner: 'self' | number, desk: string | null, items: DeskDecorItem[]) => {
      const frame = this.decorFrame(desk);
      if (!frame) return;
      const tops = this.topsFor(frame.seat);
      items.forEach((item, index) => {
        const piece = this.pieceFor(frame, item, tops, ground);
        if (!piece?.fits) return;
        if (piece.tileKey) {
          if (takenTiles.has(piece.tileKey)) return;
          takenTiles.add(piece.tileKey);
        }
        out.push({ owner, index, item, ...piece });
      });
    };
    add('self', this.getDesk(), this.localDecor);
    this.remoteDecor.forEach((d, n) => add(n, d.desk, d.items));
    return out;
  }

  /**
   * The decoration `type` would be with its base at world (x, y) — for the
   * decorate overlay's ghost. Desk items go to the pixel; floor and wall pieces
   * to the tile under the point. Null without a desk (or an unknown type).
   */
  decorPlacementAt(
    type: string,
    worldX: number,
    worldY: number,
  ): { item: DeskDecorItem; instance: FurnitureInstance; valid: boolean } | null {
    const frame = this.decorFrame(this.getDesk());
    const entry = getCatalogEntry(type);
    if (!frame || !entry) return null;
    const originX = frame.col * TILE_SIZE;
    const originY = frame.row * TILE_SIZE;
    let drawn: DeskDecorItem;
    if (isDeskItem(entry)) {
      const ax = Math.round(worldX) - originX;
      const ay = Math.round(worldY) - originY;
      const dc = Math.floor(ax / TILE_SIZE);
      const dr = Math.floor(ay / TILE_SIZE);
      drawn = { type, dc, dr, px: ax - dc * TILE_SIZE, py: ay - dr * TILE_SIZE };
    } else {
      drawn = {
        type,
        dc: Math.floor(worldX / TILE_SIZE) - frame.col,
        dr: Math.floor(worldY / TILE_SIZE) - frame.row,
      };
    }
    const tops = this.topsFor(frame.seat);
    // Kept as the desk would be unturned, so it stays put when the desk turns back.
    const item = this.halfTurn(frame, drawn, tops);
    const piece = this.pieceFor(frame, item, tops, this.decorGround());
    if (!piece) return null;
    const inReach = Math.abs(item.dc) <= DECOR_MAX_OFFSET && Math.abs(item.dr) <= DECOR_MAX_OFFSET;
    const tileFree = !piece.tileKey || !this.decorPieces().some((p) => p.tileKey === piece.tileKey);
    return { item, instance: piece.instance, valid: piece.fits && inReach && tileFree };
  }

  /** The person's decoration under a world point (topmost first), as its index; null for none. */
  decorAt(worldX: number, worldY: number): number | null {
    let hit: DecorPiece | null = null;
    for (const p of this.decorPieces()) {
      if (p.owner !== 'self') continue;
      const { x0, y0, x1, y1 } = p.box;
      if (worldX < x0 || worldX > x1 + 1 || worldY < y0 || worldY > y1 + 1) continue;
      if (!hit || p.instance.zY > hit.instance.zY) hit = p;
    }
    return hit ? hit.index : null;
  }

  /** The variant one of the person's items is drawn as (turned round on a turned desk). */
  drawnDecorType(item: DeskDecorItem): string {
    const frame = this.decorFrame(this.getDesk());
    return frame ? this.halfTurn(frame, item, this.topsFor(frame.seat)).type : item.type;
  }

  /** Tabletops the person can decorate, in world px (the overlay outlines them). */
  decorSurfaces(): PixelRect[] {
    const desk = this.getDesk();
    const seat = desk ? this.seats.get(desk) : undefined;
    return seat ? this.topsFor(seat).map((t) => t.rect) : [];
  }

  /** The variant of a desk item that faces the person's chair (a monitor's screen
   *  toward them), or `type` itself when it has no such variant. */
  decorVariantForDesk(type: string): string {
    const desk = this.getDesk();
    const seat = desk ? this.seats.get(desk) : undefined;
    if (!seat) return type;
    const orientation =
      seat.facingDir === Direction.UP
        ? 'front'
        : seat.facingDir === Direction.DOWN
          ? 'back'
          : seat.facingDir === Direction.RIGHT
            ? 'right'
            : 'left';
    return getVariantForOrientation(getFrontVariant(type), orientation);
  }

  /** The person's chosen desk (its character's seat), or null. */
  getDesk(): string | null {
    if (this.avatarId === null) return null;
    return this.characters.get(this.avatarId)?.seatId ?? null;
  }

  /** Whether a seat can be chosen as the person's desk right now. */
  isDeskAvailable(seatId: string): boolean {
    const seat = this.seats.get(seatId);
    if (!seat) return false;
    return !seat.assigned || this.getDesk() === seatId;
  }

  /** Choose the person's desk: the character walks there (and works there
   *  whenever Claude takes over). Null gives the desk up. False when taken. */
  setDesk(seatId: string | null): boolean {
    if (this.avatarId === null) return false;
    const ch = this.characters.get(this.avatarId);
    if (!ch) return false;
    if (seatId === ch.seatId) return true;
    if (seatId !== null && !this.isDeskAvailable(seatId)) return false;
    if (ch.seatId) {
      const old = this.seats.get(ch.seatId);
      if (old) old.assigned = false;
    }
    ch.seatId = seatId;
    if (seatId === null) {
      // Standing up from the desk we just gave away
      if (ch.state === CharacterState.TYPE) ch.state = CharacterState.IDLE;
      this.refreshDecor();
      return true;
    }
    const seat = this.seats.get(seatId)!;
    seat.assigned = true;
    const path = this.withOwnSeatUnblocked(ch, () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    ch.playSlot = null;
    ch.waitSpot = null;
    this.stopFollowing();
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
    } else {
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
    }
    ch.frame = 0;
    ch.frameTimer = 0;
    this.refreshDecor();
    return true;
  }

  /**
   * The person plays an emote. Reactions work any time; dance/jump/spin need
   * the character free (not Claude's, not walking) and stand it up from its
   * desk. Dance toggles. Returns false when it can't play now.
   */
  playEmote(kind: EmoteKind): boolean {
    if (this.avatarId === null) return false;
    const ch = this.characters.get(this.avatarId);
    if (!ch || ch.matrixEffect !== null || ch.transit) return false;
    const def = EMOTES[kind];
    if (def.motion) {
      if (ch.isActive) return false;
      if (kind === 'dance' && ch.emote?.kind === 'dance') {
        ch.emote = null;
        return true;
      }
      ch.path = [];
      ch.moveProgress = 0;
      if (ch.state === CharacterState.TYPE || ch.state === CharacterState.WALK) {
        ch.state = CharacterState.IDLE;
        ch.x = ch.tileCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = ch.tileRow * TILE_SIZE + TILE_SIZE / 2;
      }
    }
    ch.emote = { kind, t: 0, seq: ++this.emoteSeq };
    return true;
  }

  /** Whether the keyboard moves the person's character right now (Claude is not driving it). */
  avatarIsManual(): boolean {
    if (this.avatarId === null) return false;
    const ch = this.characters.get(this.avatarId);
    return !!ch && !ch.isActive && ch.matrixEffect === null;
  }

  /** Re-key the person's character to the agent that now drives it. */
  private bindAvatarToAgent(agentId: number): boolean {
    const ch = this.characters.get(AVATAR_LOCAL_ID);
    if (!ch || ch.matrixEffect === 'despawn') return false;
    this.characters.delete(AVATAR_LOCAL_ID);
    ch.id = agentId;
    this.characters.set(agentId, ch);
    this.avatarId = agentId;
    if (this.selectedAgentId === AVATAR_LOCAL_ID) this.selectedAgentId = agentId;
    if (this.cameraFollowId === AVATAR_LOCAL_ID) this.cameraFollowId = agentId;
    // Claude needs a desk to work at: take a free one when the person chose none.
    if (!ch.seatId) {
      const seatId = this.findFreeSeat();
      if (seatId) {
        this.seats.get(seatId)!.assigned = true;
        ch.seatId = seatId;
      }
    }
    return true;
  }

  /** The agent driving the person's character closed: hand the character back to the person. */
  private unbindAvatar(): void {
    if (this.avatarId === null) return;
    const ch = this.characters.get(this.avatarId);
    if (!ch) return;
    this.characters.delete(this.avatarId);
    if (this.selectedAgentId === this.avatarId) this.selectedAgentId = null;
    if (this.cameraFollowId === this.avatarId) this.cameraFollowId = null;
    ch.id = AVATAR_LOCAL_ID;
    ch.isActive = false;
    ch.currentTool = null;
    ch.bubbleType = null;
    ch.contextTokens = 0;
    ch.folderName = undefined;
    this.characters.set(AVATAR_LOCAL_ID, ch);
    this.avatarId = AVATAR_LOCAL_ID;
  }

  /** One keyboard step: from an idle stand (or the desk), toward the held direction. */
  private stepAvatar(ch: Character): void {
    const dir = this.avatarHeldDir;
    // Letting go of the key (or having stepped off) re-arms the portal just come out of.
    if (dir === null || this.portalRearm !== `${ch.tileCol},${ch.tileRow}`) this.portalRearm = null;
    if (dir === null || ch.isActive || ch.matrixEffect !== null || ch.transit) return;
    // The keyboard takes over from following someone.
    if (this.avatarFollowId !== null) this.stopFollowing();
    // Walking off ends a dance (reactions float on).
    if (ch.emote && EMOTES[ch.emote.kind].motion) ch.emote = null;
    if (ch.state === CharacterState.WALK && ch.path.length > 0) return; // mid-step
    const { dCol, dRow } = seatFacingOffset(dir);
    const col = ch.tileCol + dCol;
    const row = ch.tileRow + dRow;
    ch.playSlot = null;
    ch.waitSpot = null;
    ch.dir = dir;
    const free = this.withOwnSeatUnblocked(ch, () =>
      isWalkable(col, row, this.tileMap, this.blockedTiles),
    );
    if (!free) {
      // Pushing into stairs or an elevator door from in front of it: take it.
      if (this.enterPortal(ch, col, row)) return;
      // Bumping into something: just turn to face it (and stand up if seated).
      if (ch.state !== CharacterState.WALK) ch.state = CharacterState.IDLE;
      return;
    }
    ch.path = [{ col, row }];
    ch.moveProgress = 0;
    if (ch.state !== CharacterState.WALK) {
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    }
  }

  // ── Multiplayer room: other offices' characters on the shared map ──

  /** Where another office says its character is. The character stops running its
   *  own FSM and walks (or snaps) there; it holds no seat of ours. */
  setRemotePose(
    id: number,
    pose: RemotePose,
    readingTool: string | null,
    typingTool: string,
  ): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (!ch.remoteTarget) {
      // First pose: give back the seat addAgent picked for it, and appear in place.
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId);
        if (seat && !this.externalSeatClaims.has(ch.seatId)) seat.assigned = false;
        ch.seatId = null;
      }
      ch.x = pose.x;
      ch.y = pose.y;
      ch.path = [];
    }
    const dir = (pose.dir >= 0 && pose.dir <= 3 ? pose.dir : 0) as Direction;
    ch.remoteTarget = { x: pose.x, y: pose.y, dir, state: pose.state };
    // Its office started an emote (a new seq), or stopped a looping one.
    if (pose.emote && isEmoteKind(pose.emote)) {
      const seq = pose.emoteSeq ?? 0;
      if (!ch.emote || ch.emote.seq !== seq || ch.emote.kind !== pose.emote) {
        ch.emote = { kind: pose.emote, t: 0, seq };
      }
    } else if (ch.emote && EMOTES[ch.emote.kind].duration === Infinity) {
      ch.emote = null;
    }
    ch.currentTool =
      pose.state === 'read'
        ? (readingTool ?? typingTool)
        : pose.state === 'type'
          ? typingTool
          : null;
  }

  /** Seats other offices hold: their desks plus seats their characters sit in. */
  setExternalSeatClaims(desks: Iterable<string>): void {
    const claims = new Set<string>();
    for (const d of desks) if (this.seats.has(d)) claims.add(d);
    for (const ch of this.characters.values()) {
      const t = ch.remoteTarget;
      if (!t || (t.state !== 'type' && t.state !== 'read')) continue;
      const seatId = this.getSeatAtTile(Math.floor(t.x / TILE_SIZE), Math.floor(t.y / TILE_SIZE));
      if (seatId) claims.add(seatId);
    }
    this.applyExternalSeatClaims(claims);
  }

  private applyExternalSeatClaims(claims: Set<string>): void {
    const ownedLocally = new Set<string>();
    for (const ch of this.characters.values()) {
      if (ch.seatId && !ch.remoteTarget) ownedLocally.add(ch.seatId);
    }
    for (const uid of this.externalSeatClaims) {
      if (claims.has(uid) || ownedLocally.has(uid)) continue;
      const seat = this.seats.get(uid);
      if (seat) seat.assigned = false;
    }
    for (const uid of claims) {
      const seat = this.seats.get(uid);
      if (seat) seat.assigned = true;
    }
    this.externalSeatClaims = claims;
  }

  /** Walk toward where the owning office says the character is. */
  private followRemoteTarget(ch: Character, dt: number): void {
    const t = ch.remoteTarget!;
    const dx = t.x - ch.x;
    const dy = t.y - ch.y;
    const dist = Math.hypot(dx, dy);
    if (dist > REMOTE_POSE_SNAP_PX) {
      // Its office took stairs or an elevator: ride it here too.
      const col = Math.floor(t.x / TILE_SIZE);
      const row = Math.floor(t.y / TILE_SIZE);
      const edge = getPortalEdges(this.tileMap)
        ?.get(`${ch.tileCol},${ch.tileRow}`)
        ?.find((e) => e.col === col && e.row === row);
      if (edge) {
        ch.path = [];
        startTransit(ch, { col, row, portal: edge.hop });
        ch.state = CharacterState.WALK;
        return;
      }
      ch.x = t.x;
      ch.y = t.y;
    } else if (dist > REMOTE_POSE_EPSILON_PX) {
      const step = Math.min(dist, WALK_SPEED_PX_PER_SEC * REMOTE_POSE_SPEED_FACTOR * dt);
      ch.x += (dx / dist) * step;
      ch.y += (dy / dist) * step;
      if (Math.abs(dx) > Math.abs(dy)) ch.dir = dx > 0 ? Direction.RIGHT : Direction.LEFT;
      else ch.dir = dy > 0 ? Direction.DOWN : Direction.UP;
      ch.state = CharacterState.WALK;
    }
    ch.tileCol = Math.floor(ch.x / TILE_SIZE);
    ch.tileRow = Math.floor(ch.y / TILE_SIZE);
    if (Math.hypot(t.x - ch.x, t.y - ch.y) <= REMOTE_POSE_EPSILON_PX) {
      ch.x = t.x;
      ch.y = t.y;
      ch.dir = t.dir;
      if (t.state === 'type' || t.state === 'read') ch.state = CharacterState.TYPE;
      else if (t.state === 'walk') ch.state = CharacterState.WALK;
      else ch.state = CharacterState.IDLE;
    }
    // Animate: the walk cycle while moving, the typing/reading cycle while seated.
    ch.frameTimer += dt;
    const walking = ch.state === CharacterState.WALK;
    const frameSec = walking ? WALK_FRAME_DURATION_SEC : TYPE_FRAME_DURATION_SEC;
    if (ch.frameTimer >= frameSec) {
      ch.frameTimer -= frameSec;
      ch.frame = (ch.frame + 1) % (walking ? 4 : 2);
    }
    if (ch.state === CharacterState.IDLE) ch.frame = 0;
    if (ch.bubbleType === 'waiting') {
      ch.bubbleTimer -= dt;
      if (ch.bubbleTimer <= 0) {
        ch.bubbleType = null;
        ch.bubbleTimer = 0;
      }
    }
  }

  update(dt: number): void {
    // Furniture animation cycling
    const prevFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    this.furnitureAnimTimer += dt;
    const newFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    if (newFrame !== prevFrame) {
      this.rebuildFurnitureInstances();
    }

    // The greeter materializes and dematerializes like anyone else, but runs
    // no FSM — it stands where it spawned for as long as the ask is up.
    if (this.greeter && advanceMatrixEffect(this.greeter, dt) === 'despawned') {
      this.greeter = null;
    }

    const toDelete: number[] = [];
    for (const ch of this.characters.values()) {
      const effect = advanceMatrixEffect(ch, dt);
      if (effect !== 'none') {
        if (effect === 'despawned') toDelete.push(ch.id);
        continue; // skip normal FSM while the effect is (or just was) active
      }

      if (ch.emote) {
        const ended = !advanceEmote(ch.emote, dt);
        // Claude taking over the character ends a dance: back to the desk.
        const interrupted = ch.isActive && !ch.isRemote && EMOTES[ch.emote.kind].motion;
        if (ended || interrupted) ch.emote = null;
      }

      // Placed by its own office on the shared map: follow, don't simulate.
      if (ch.remoteTarget) {
        if (ch.transit) advanceTransit(ch, dt);
        else this.followRemoteTarget(ch, dt);
        continue;
      }
      if (ch.id === this.avatarId) {
        this.stepAvatar(ch);
        this.updateFollow(ch, dt);
      }

      // Temporarily unblock own seat so character can pathfind to it
      this.withOwnSeatUnblocked(ch, () =>
        updateCharacter(
          ch,
          dt,
          this.walkableFor(ch),
          this.seats,
          this.tileMap,
          this.blockedTiles,
          ch.isSubagent ? [] : this.freeGameSlotsFor(ch),
          ch.isSubagent ? [] : this.freeWaitSpots(),
        ),
      );

      // Tick bubble timer for waiting bubbles
      if (ch.bubbleType === 'waiting') {
        ch.bubbleTimer -= dt;
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null;
          ch.bubbleTimer = 0;
        }
      }
    }
    // Remove characters that finished despawn
    for (const id of toDelete) {
      this.characters.delete(id);
      this.seenLevel.delete(id);
    }
    this.trackLevels();
    this.updateDoors(dt);
    this.updateMatches(dt);

    // ── Pet FSM ────────────────────────────────────────────────
    for (const pet of this.pets) {
      updatePet(pet, dt, this.walkableFor(pet), this.characters, this.tileMap, this.blockedTiles);

      // Tick heart bubble timer (mirrors character waiting-bubble pattern)
      if (pet.bubbleType) {
        pet.bubbleTimer -= dt;
        if (pet.bubbleTimer <= 0) {
          pet.bubbleType = null;
          pet.bubbleTimer = 0;
        }
      }
    }
  }

  /** The `saveAgentSeats` payload: palette, hue and seat for every agent worth
   *  restoring. Sub-agents are excluded because they are derived state the
   *  runtime re-materializes, and the greeter never reaches here at all —
   *  it is not in `characters`. */
  getPersistableSeats(): Record<
    number,
    { palette: number; hueShift: number; seatId: string | null }
  > {
    const seats: Record<number, { palette: number; hueShift: number; seatId: string | null }> = {};
    for (const ch of this.characters.values()) {
      if (ch.isSubagent || ch.isRemote || ch.id === AVATAR_LOCAL_ID) continue;
      seats[ch.id] = { palette: ch.palette, hueShift: ch.hueShift, seatId: ch.seatId };
    }
    return seats;
  }

  /** Everything the renderer draws: the agents plus, while the first-run ask
   *  is up, the consent greeter. This is the ONE place the greeter joins the
   *  agents — every other consumer reads `characters` and gets agents only. */
  getCharacters(): Character[] {
    const chars = Array.from(this.characters.values());
    if (this.greeter) chars.push(this.greeter);
    return chars;
  }

  /** Get character at pixel position (for hit testing). Returns id or null.
   *  Agents only: clicks pass straight through the consent greeter, which is
   *  a prop, not something to select or follow. */
  getCharacterAt(worldX: number, worldY: number): number | null {
    const chars = Array.from(this.characters.values()).sort((a, b) => b.y - a.y);
    for (const ch of chars) {
      // Skip characters that are despawning, or on another level
      if (ch.matrixEffect === 'despawn' || !this.isOnView(ch)) continue;
      // Character sprite is 16x24, anchored bottom-center
      // Apply sitting offset to match visual position
      const sittingOffset = isSeatedPose(ch) ? CHARACTER_SITTING_OFFSET_PX : 0;
      const anchorY = ch.y + sittingOffset;
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH;
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH;
      const top = anchorY - CHARACTER_HIT_HEIGHT;
      const bottom = anchorY;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return ch.id;
      }
    }
    return null;
  }
}

/** The person stands in an elevator that stops at several other levels. */
export interface ElevatorPrompt {
  /** The tile they stand on (the question goes when they leave it). */
  col: number;
  row: number;
  fromUid: string;
  /** Every level it stops at, top floor first; `uid` null = the one they are on. */
  stops: Array<{ levelId: string; name: string; uid: string | null; rise: number }>;
}

/** A desk's tabletop in world px, with the depth the desk sorts at. */
interface DeskTop {
  col: number;
  row: number;
  w: number;
  h: number;
  rect: PixelRect;
  zY: number;
  /** Whether world pixel (x, y) is on this desk's top face. */
  isTop: (x: number, y: number) => boolean;
}

/** A decoration as drawn: whose it is, where, and whether it fits where it was put. */
export interface DecorPiece {
  /** 'self', or the index of the other office in the room. */
  owner: 'self' | number;
  /** Its index in the owner's decoration list. */
  index: number;
  item: DeskDecorItem;
  instance: FurnitureInstance;
  /** Visible pixels, world px (inclusive). */
  box: PixelRect;
  fits: boolean;
  /** Floor and wall pieces hold a whole tile; desk items share the tabletop. */
  tileKey: string | null;
}

/** A desk style (see decorCatalog DESK_STYLES) in the variant that fits a desk's footprint. */
function deskStyleVariant(style: string, desk: CatalogEntryWithCategory): string | null {
  if (!DESK_STYLES.some((s) => s.id === style)) return null;
  for (const id of [style, `${style}_3`, `${style}_2`]) {
    const e = getCatalogEntry(id);
    if (e && e.footprintW === desk.footprintW && e.footprintH === desk.footprintH) return id;
  }
  return null;
}

/** The office chair matching a chair's size, seen from where the person faces. */
function chairStyleVariant(facing: Direction, chair: CatalogEntryWithCategory): string | null {
  if (chair.category !== 'chairs' || chair.footprintW !== 1) return null;
  const base =
    chair.footprintH === 2 ? 'OFFICE_CHAIR' : chair.footprintH === 1 ? 'OFFICE_CHAIR_SMALL' : null;
  if (!base) return null;
  const id =
    facing === Direction.UP
      ? `${base}_BACK`
      : facing === Direction.DOWN
        ? `${base}_FRONT`
        : facing === Direction.RIGHT
          ? `${base}_SIDE`
          : `${base}_SIDE:left`;
  return getCatalogEntry(id) ? id : null;
}

/** A person's desk dressing, as shown to the room. */
export interface DeskDressing {
  /** Desk style id (DESK_STYLES), or null for the desk as the room built it. */
  deskStyle: string | null;
  /** Layout furniture uids taken off the desk. */
  hidden: string[];
}

interface TilePos {
  col: number;
  row: number;
}

/** A styled desk turned to face the room: its chair moved from behind it to its front. */
interface DeskTurn {
  /** The seat as the room built it. */
  from: TilePos & { dir: Direction };
  /** Where it is now, facing up at the desk. */
  to: TilePos;
  chairUid: string;
}

/**
 * Where a desk's decoration hangs. Items are kept relative to the chair's tile as
 * the room built it (`col,row`), so turning the desk doesn't lose them: on a turned
 * desk they are drawn half-turned — desk items about the middle of the tabletop,
 * floor pieces about the midpoint of the chair's two spots, each item turned round
 * (a screen that faced the old spot faces the new one). Wall pieces stay put.
 */
interface DecorFrame {
  seat: Seat;
  col: number;
  row: number;
  turn: DeskTurn | null;
}

/** The variant of an item turned half round (front ↔ back, left ↔ right), or itself. */
function halfTurned(type: string): string {
  const o = getOrientationInGroup(type);
  const opposite =
    o === 'front'
      ? 'back'
      : o === 'back'
        ? 'front'
        : o === 'left'
          ? 'right'
          : o === 'right'
            ? 'left'
            : null;
  if (!opposite) return type;
  const turned = getVariantForOrientation(type, opposite);
  // Only when the way back exists too, so turning twice gives the item back.
  return getVariantForOrientation(turned, o!) === type ? turned : type;
}

/** Desk items stand on tabletops; the rest on the floor or a wall. */
function isDeskItem(entry: CatalogEntryWithCategory): boolean {
  return !!entry.canPlaceOnSurfaces && !entry.canPlaceOnWalls;
}

/** The person's look, status and song, as their own office draws them. */
export interface LocalCharacterProfile {
  look: AvatarLook | null;
  status: PersonStatus;
  statusText: string;
  /** Shown on their character only while shared with the room. */
  music: SharedTrack | null;
}

function randomHits(): number {
  return GAME_HITS_MIN + Math.floor(Math.random() * (GAME_HITS_MAX - GAME_HITS_MIN + 1));
}

function other(side: 0 | 1): 0 | 1 {
  return side === 0 ? 1 : 0;
}
