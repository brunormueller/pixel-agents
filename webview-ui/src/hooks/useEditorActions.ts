import { useCallback, useRef, useState } from 'react';

import type { ColorValue } from '../components/ui/types.js';
import {
  CARPET_DEFAULT_ACCENT_COLOR,
  CARPET_DEFAULT_COLOR,
  LAYOUT_SAVE_DEBOUNCE_MS,
  ZOOM_DEFAULT_DPR_FACTOR,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../constants.js';
import type { ExpandDirection } from '../office/editor/editorActions.js';
import {
  addArea,
  canPlaceFurniture,
  eraseArea,
  eraseCarpet,
  expandLayout,
  getWallPlacementRow,
  moveFurniture,
  openDoorway,
  paintArea,
  paintCarpet,
  paintTile,
  placeFurniture,
  removeArea,
  removeFurniture,
  renameArea,
  rotateFurniture,
  toggleFurnitureState,
  updateAreaColor,
} from '../office/editor/editorActions.js';
import type { EditorState } from '../office/editor/editorState.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { doorTypeFor, isDoorType } from '../office/layout/doors.js';
import {
  getCatalogEntry,
  getRotatedType,
  getToggledType,
} from '../office/layout/furnitureCatalog.js';
import type { LevelEdge, TileRemap } from '../office/layout/levels.js';
import {
  addLevel,
  expandLevel,
  inRect,
  moveLevel,
  removeLevel,
  renameLevel,
} from '../office/layout/levels.js';
import {
  linkNewPortal,
  portalKindOf,
  removePortal,
  setElevatorStop,
  setStairsTarget,
} from '../office/layout/portals.js';
import type { RoomLayoutRebase, RoomLayoutSync } from '../office/layout/roomLayoutSync.js';
import type {
  EditTool as EditToolType,
  OfficeLayout,
  PlacedFurniture,
  PlacedPet,
  TileType as TileTypeVal,
} from '../office/types.js';
import { EditTool } from '../office/types.js';
import { TileType } from '../office/types.js';
import { transport } from '../transport/index.js';

interface EditorActions {
  isEditMode: boolean;
  editorTick: number;
  isDirty: boolean;
  zoom: number;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
  saveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setLastSavedLayout: (layout: OfficeLayout) => void;
  /** Put a revision of the room's shared map on screen (RoomLayoutSync's host). */
  showRoomLayout: (layout: OfficeLayout, rebase: RoomLayoutRebase | null) => void;
  /** Clear the dirty flag (used after a browser import applies a new saved baseline). */
  markClean: () => void;
  handleOpenClaude: () => void;
  handleToggleEditMode: () => void;
  handleToolChange: (tool: EditToolType) => void;
  handleTileTypeChange: (type: TileTypeVal) => void;
  handleFloorColorChange: (color: ColorValue) => void;
  handleWallColorChange: (color: ColorValue) => void;
  handleWallSetChange: (setIndex: number) => void;
  handleSelectedFurnitureColorChange: (color: ColorValue | null) => void;
  handlePickedFurnitureColorChange: (color: ColorValue | null) => void;
  handleFurnitureTypeChange: (type: string) => void; // FurnitureType enum or asset ID
  handleDeleteSelected: () => void;
  handleRotateSelected: () => void;
  handleToggleState: () => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleReset: () => void;
  handleSave: () => void;
  handleZoomChange: (zoom: number) => void;
  handleEditorTileAction: (col: number, row: number) => void;
  handleEditorEraseAction: (col: number, row: number) => void;
  handleEditorSelectionChange: () => void;
  handleDragMove: (uid: string, newCol: number, newRow: number) => void;
  handlePetToggle: (petType: number, active: boolean) => void;
  // Carpet state + handlers
  carpetVariant: number;
  carpetColor: ColorValue;
  carpetAccentColor: ColorValue;
  handleCarpetVariantChange: (variant: number) => void;
  handleCarpetColorChange: (color: ColorValue) => void;
  handleCarpetAccentColorChange: (color: ColorValue) => void;
  handleResetCarpetColor: () => void;
  handleResetCarpetAccentColor: () => void;
  // Area state + handlers (selection lives on editorState for imperative access)
  selectedAreaLabel: string | null;
  handleSelectArea: (label: string | null) => void;
  handleAddArea: (label: string, color: string) => void;
  handleRemoveArea: (label: string) => void;
  handleRenameArea: (oldLabel: string, newLabel: string) => void;
  handleAreaColorChange: (label: string, color: string) => void;
  // Levels (floors of the building) + portals
  handleViewLevel: (levelId: string) => void;
  handleAddLevel: (where: 'above' | 'below') => void;
  handleRemoveLevel: (levelId: string) => void;
  handleRenameLevel: (levelId: string, name: string) => void;
  handleMoveLevel: (levelId: string, direction: 'up' | 'down') => void;
  handleSetStairsTarget: (uid: string, levelId: string) => void;
  handleSetElevatorStop: (uid: string, levelId: string, stops: boolean) => void;
}

/** Default integer zoom (device pixels per sprite pixel) for a fresh session.
 *  Lives here, with the zoom state it seeds, rather than in the office modules:
 *  it reads `devicePixelRatio`, and a viewport concern in a state module drags
 *  the DOM into every graph that imports it (OfficeState's included). */
function defaultZoom(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(ZOOM_MIN, Math.round(ZOOM_DEFAULT_DPR_FACTOR * dpr));
}

export function useEditorActions(
  getOfficeState: () => OfficeState,
  editorState: EditorState,
  /** While a room's shared map is on screen, edits go to the room instead of layout.json. */
  roomLayoutSync: RoomLayoutSync,
): EditorActions {
  const [isEditMode, setIsEditMode] = useState(false);
  const [editorTick, setEditorTick] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [zoom, setZoom] = useState(defaultZoom);
  const [carpetVariant, setCarpetVariantState] = useState<number>(editorState.carpetVariant);
  const [carpetColor, setCarpetColorState] = useState<ColorValue>(editorState.carpetColor);
  const [carpetAccentColor, setCarpetAccentColorState] = useState<ColorValue>(
    editorState.carpetAccentColor,
  );
  const [selectedAreaLabel, setSelectedAreaLabelState] = useState<string | null>(
    editorState.selectedAreaLabel,
  );
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panRef = useRef({ x: 0, y: 0 });
  const lastSavedLayoutRef = useRef<OfficeLayout | null>(null);

  // Called by useExtensionMessages on layoutLoaded to set the initial checkpoint
  const setLastSavedLayout = useCallback((layout: OfficeLayout) => {
    lastSavedLayoutRef.current = structuredClone(layout);
  }, []);

  // Clear the dirty flag after a browser layout import: the imported layout is the
  // new saved baseline (already persisted via saveLayout). setIsDirty also forces a
  // re-render so dirty-gated UI (EditActionBar, areasAvailable) reflects the import.
  const markClean = useCallback(() => {
    editorState.isDirty = false;
    setIsDirty(false);
  }, [editorState]);

  // Debounced layout save. A room's shared map takes every edit at once (it
  // batches while one is in flight): a change from someone else landing inside
  // the debounce has to see our edit to merge it in.
  const saveLayout = useCallback(
    (layout: OfficeLayout) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (roomLayoutSync.localEdit(layout)) return;
      saveTimerRef.current = setTimeout(() => {
        transport.send({
          type: 'saveLayout',
          layout: layout as unknown as Record<string, unknown>,
        });
      }, LAYOUT_SAVE_DEBOUNCE_MS);
    },
    [roomLayoutSync],
  );

  const showRoomLayout = useCallback(
    (layout: OfficeLayout, rebase: RoomLayoutRebase | null) => {
      // A copy: the office may keep and touch what it is given; the sync keeps its own.
      getOfficeState().rebuildFromLayout(structuredClone(layout));
      if (rebase) {
        // Undo must take back our own edits only, never the change that just arrived.
        editorState.rebaseHistory(rebase);
        if (lastSavedLayoutRef.current) {
          lastSavedLayoutRef.current = rebase(lastSavedLayoutRef.current);
        }
      } else {
        editorState.clearHistory();
        lastSavedLayoutRef.current = structuredClone(layout);
      }
      const exists = (uid: string | null) => !uid || layout.furniture.some((f) => f.uid === uid);
      if (!exists(editorState.selectedFurnitureUid)) editorState.clearSelection();
      if (!exists(editorState.dragUid)) editorState.clearDrag();
      setEditorTick((n) => n + 1);
    },
    [getOfficeState, editorState],
  );

  // Apply a layout edit: push undo, clear redo, rebuild state, save, mark dirty
  const applyEdit = useCallback(
    (newLayout: OfficeLayout, remap?: TileRemap) => {
      const os = getOfficeState();
      editorState.pushUndo(os.getLayout());
      editorState.clearRedo();
      editorState.isDirty = true;
      setIsDirty(true);
      os.rebuildFromLayout(newLayout, remap);
      saveLayout(newLayout);
      setEditorTick((n) => n + 1);
    },
    [getOfficeState, editorState, saveLayout],
  );

  /** Whether a tile is on the level being edited (the whole grid for a one-level office). */
  const inView = useCallback(
    (col: number, row: number) => inRect(getOfficeState().getView(), col, row),
    [getOfficeState],
  );

  const handleOpenClaude = useCallback(() => {
    transport.send({ type: 'launchAgent' });
  }, []);

  const handleToggleEditMode = useCallback(() => {
    setIsEditMode((prev) => {
      const next = !prev;
      editorState.isEditMode = next;
      if (next) {
        // Initialize wallColor from existing wall tiles so new walls match
        const os = getOfficeState();
        const layout = os.getLayout();
        if (layout.tileColors) {
          for (let i = 0; i < layout.tiles.length; i++) {
            if (layout.tiles[i] === TileType.WALL && layout.tileColors[i]) {
              editorState.wallColor = { ...layout.tileColors[i]! };
              break;
            }
          }
        }
      } else {
        editorState.clearSelection();
        editorState.clearGhost();
        editorState.clearDrag();
        wallColorEditActiveRef.current = false;
      }
      return next;
    });
  }, [editorState, getOfficeState]);

  // Tool toggle: clicking already-active tool deselects it (returns to SELECT)
  const handleToolChange = useCallback(
    (tool: EditToolType) => {
      const next = editorState.activeTool === tool ? EditTool.SELECT : tool;
      editorState.activeTool = next;
      editorState.clearSelection();
      editorState.clearGhost();
      editorState.clearDrag();
      colorEditUidRef.current = null;
      wallColorEditActiveRef.current = false;
      // Reset carpet stroke buffer whenever leaving the carpet paint flow so the
      // next click starts a fresh undo entry.
      if (next !== EditTool.CARPET_PAINT) {
        editorState.carpetStrokeInitialLayout = null;
        editorState.carpetDragErasing = null;
      }
      if (next !== EditTool.AREA_PAINT) {
        editorState.areaDragErasing = null;
      }
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  // ── Carpet handlers ──────────────────────────────────────────────
  const handleCarpetVariantChange = useCallback(
    (variant: number) => {
      editorState.carpetVariant = variant;
      setCarpetVariantState(variant);
    },
    [editorState],
  );

  const handleCarpetColorChange = useCallback(
    (color: ColorValue) => {
      editorState.carpetColor = color;
      setCarpetColorState(color);
    },
    [editorState],
  );

  const handleCarpetAccentColorChange = useCallback(
    (color: ColorValue) => {
      editorState.carpetAccentColor = color;
      setCarpetAccentColorState(color);
    },
    [editorState],
  );

  const handleResetCarpetColor = useCallback(() => {
    const next: ColorValue = { ...CARPET_DEFAULT_COLOR };
    editorState.carpetColor = next;
    setCarpetColorState(next);
  }, [editorState]);

  const handleResetCarpetAccentColor = useCallback(() => {
    const next: ColorValue = { ...CARPET_DEFAULT_ACCENT_COLOR };
    editorState.carpetAccentColor = next;
    setCarpetAccentColorState(next);
  }, [editorState]);

  // ── Area handlers ──────────────────────────────────────────────
  const handleSelectArea = useCallback(
    (label: string | null) => {
      editorState.selectedAreaLabel = label;
      setSelectedAreaLabelState(label);
      // Reset stroke direction so the next drag re-decides paint vs erase.
      editorState.areaDragErasing = null;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  const handleAddArea = useCallback(
    (label: string, color: string) => {
      const os = getOfficeState();
      const layout = os.getLayout();
      const next = addArea(layout, label, color);
      if (next !== layout) {
        applyEdit(next);
      }
    },
    [getOfficeState, applyEdit],
  );

  const handleRemoveArea = useCallback(
    (label: string) => {
      const os = getOfficeState();
      const layout = os.getLayout();
      const next = removeArea(layout, label);
      if (next !== layout) {
        if (editorState.selectedAreaLabel === label) {
          editorState.selectedAreaLabel = null;
          setSelectedAreaLabelState(null);
        }
        applyEdit(next);
      }
    },
    [getOfficeState, editorState, applyEdit],
  );

  const handleRenameArea = useCallback(
    (oldLabel: string, newLabel: string) => {
      const os = getOfficeState();
      const layout = os.getLayout();
      const next = renameArea(layout, oldLabel, newLabel);
      if (next !== layout) {
        const trimmed = newLabel.trim();
        if (editorState.selectedAreaLabel === oldLabel) {
          editorState.selectedAreaLabel = trimmed;
          setSelectedAreaLabelState(trimmed);
        }
        applyEdit(next);
      }
    },
    [getOfficeState, editorState, applyEdit],
  );

  const handleAreaColorChange = useCallback(
    (label: string, color: string) => {
      const os = getOfficeState();
      const layout = os.getLayout();
      const next = updateAreaColor(layout, label, color);
      if (next !== layout) {
        applyEdit(next);
      }
    },
    [getOfficeState, applyEdit],
  );

  const handleTileTypeChange = useCallback(
    (type: TileTypeVal) => {
      editorState.selectedTileType = type;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  const handleFloorColorChange = useCallback(
    (color: ColorValue) => {
      editorState.floorColor = color;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  // Track whether we've already pushed undo for the current wall color editing session
  const wallColorEditActiveRef = useRef(false);

  const handleWallColorChange = useCallback(
    (color: ColorValue) => {
      editorState.wallColor = color;

      // Update all existing wall tiles to the new color
      const os = getOfficeState();
      const layout = os.getLayout();
      const existingColors = layout.tileColors || new Array(layout.tiles.length).fill(null);
      const newColors = [...existingColors];
      let changed = false;
      // Each level keeps its own wall color: recolor the walls of the one on screen.
      const view = os.getView();
      for (let i = 0; i < layout.tiles.length; i++) {
        if (!inRect(view, i % layout.cols, Math.floor(i / layout.cols))) continue;
        if (layout.tiles[i] === TileType.WALL) {
          newColors[i] = { ...color };
          changed = true;
        }
      }
      if (changed) {
        // Push undo only once per editing session (first slider touch)
        if (!wallColorEditActiveRef.current) {
          editorState.pushUndo(layout);
          editorState.clearRedo();
          wallColorEditActiveRef.current = true;
        }
        const newLayout = { ...layout, tileColors: newColors };
        editorState.isDirty = true;
        setIsDirty(true);
        os.rebuildFromLayout(newLayout);
        saveLayout(newLayout);
      }
      setEditorTick((n) => n + 1);
    },
    [editorState, getOfficeState, saveLayout],
  );

  const handleWallSetChange = useCallback(
    (setIndex: number) => {
      editorState.selectedWallSet = setIndex;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  // Track which uid we've already pushed undo for during color editing
  // so dragging sliders doesn't create N undo entries
  const colorEditUidRef = useRef<string | null>(null);

  const handleSelectedFurnitureColorChange = useCallback(
    (color: ColorValue | null) => {
      const uid = editorState.selectedFurnitureUid;
      if (!uid) return;
      const os = getOfficeState();
      const layout = os.getLayout();

      // Push undo only once per selection (first slider touch)
      if (colorEditUidRef.current !== uid) {
        editorState.pushUndo(layout);
        editorState.clearRedo();
        colorEditUidRef.current = uid;
      }

      // Update color on the placed furniture item (null removes color)
      const newFurniture = layout.furniture.map((f) =>
        f.uid === uid ? { ...f, color: color ?? undefined } : f,
      );
      const newLayout = { ...layout, furniture: newFurniture };

      editorState.isDirty = true;
      setIsDirty(true);
      os.rebuildFromLayout(newLayout);
      saveLayout(newLayout);
      setEditorTick((n) => n + 1);
    },
    [getOfficeState, editorState, saveLayout],
  );

  // Color applied to NEWLY placed furniture (and the palette/ghost previews).
  // Stored imperatively on editorState; placement reads it in the click handler.
  const handlePickedFurnitureColorChange = useCallback(
    (color: ColorValue | null) => {
      editorState.pickedFurnitureColor = color;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  const handleFurnitureTypeChange = useCallback(
    (type: string) => {
      // Clicking the same item deselects it (no ghost), stays in furniture mode
      if (editorState.selectedFurnitureType === type) {
        editorState.selectedFurnitureType = '';
        editorState.clearGhost();
      } else {
        editorState.selectedFurnitureType = type;
      }
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  const handleDeleteSelected = useCallback(() => {
    const uid = editorState.selectedFurnitureUid;
    if (!uid) return;
    const os = getOfficeState();
    const layout = os.getLayout();
    const item = layout.furniture.find((f) => f.uid === uid);
    // Stairs go with their other end; an elevator loses just this stop.
    const newLayout =
      item && portalKindOf(item.type) ? removePortal(layout, uid) : removeFurniture(layout, uid);
    if (newLayout !== os.getLayout()) {
      applyEdit(newLayout);
      editorState.clearSelection();
      colorEditUidRef.current = null;
    }
  }, [getOfficeState, editorState, applyEdit]);

  const handleRotateSelected = useCallback(() => {
    // If in furniture placement mode, cycle the selected type through the rotation group
    if (editorState.activeTool === EditTool.FURNITURE_PLACE) {
      const rotated = getRotatedType(editorState.selectedFurnitureType, 'cw');
      if (rotated) {
        editorState.selectedFurnitureType = rotated;
        setEditorTick((n) => n + 1);
      }
      return;
    }
    // Otherwise rotate the selected placed furniture
    const uid = editorState.selectedFurnitureUid;
    if (!uid) return;
    const os = getOfficeState();
    const newLayout = rotateFurniture(os.getLayout(), uid, 'cw');
    if (newLayout !== os.getLayout()) {
      applyEdit(newLayout);
    }
  }, [getOfficeState, editorState, applyEdit]);

  const handleToggleState = useCallback(() => {
    // If in furniture placement mode, toggle the selected type's state
    if (editorState.activeTool === EditTool.FURNITURE_PLACE) {
      const toggled = getToggledType(editorState.selectedFurnitureType);
      if (toggled) {
        editorState.selectedFurnitureType = toggled;
        setEditorTick((n) => n + 1);
      }
      return;
    }
    // Otherwise toggle the selected placed furniture's state
    const uid = editorState.selectedFurnitureUid;
    if (!uid) return;
    const os = getOfficeState();
    const newLayout = toggleFurnitureState(os.getLayout(), uid);
    if (newLayout !== os.getLayout()) {
      applyEdit(newLayout);
    }
  }, [getOfficeState, editorState, applyEdit]);

  const handleUndo = useCallback(() => {
    const prev = editorState.popUndo();
    if (!prev) return;
    const os = getOfficeState();
    // Push current layout to redo stack before restoring
    editorState.pushRedo(os.getLayout());
    os.rebuildFromLayout(prev);
    saveLayout(prev);
    editorState.isDirty = true;
    setIsDirty(true);
    setEditorTick((n) => n + 1);
  }, [getOfficeState, editorState, saveLayout]);

  const handleRedo = useCallback(() => {
    const next = editorState.popRedo();
    if (!next) return;
    const os = getOfficeState();
    // Push current layout to undo stack before restoring
    editorState.pushUndo(os.getLayout());
    os.rebuildFromLayout(next);
    saveLayout(next);
    editorState.isDirty = true;
    setIsDirty(true);
    setEditorTick((n) => n + 1);
  }, [getOfficeState, editorState, saveLayout]);

  const handleReset = useCallback(() => {
    if (!lastSavedLayoutRef.current) return;
    const saved = structuredClone(lastSavedLayoutRef.current);
    applyEdit(saved);
    editorState.reset();
    setIsDirty(false);
  }, [editorState, applyEdit]);

  const handleSave = useCallback(() => {
    // Flush any pending debounced save immediately
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const os = getOfficeState();
    const layout = os.getLayout();
    lastSavedLayoutRef.current = structuredClone(layout);
    // A room's map already has every edit: Save only moves the Reset point.
    if (!roomLayoutSync.active) {
      transport.send({ type: 'saveLayout', layout: layout as unknown as Record<string, unknown> });
    }
    editorState.isDirty = false;
    setIsDirty(false);
  }, [getOfficeState, editorState, roomLayoutSync]);

  // Notify React that imperative editor selection changed (e.g., from OfficeCanvas mouseUp)
  const handleEditorSelectionChange = useCallback(() => {
    colorEditUidRef.current = null;
    setEditorTick((n) => n + 1);
  }, []);

  const handleZoomChange = useCallback((newZoom: number) => {
    setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom)));
  }, []);

  const handleDragMove = useCallback(
    (uid: string, newCol: number, newRow: number) => {
      const os = getOfficeState();
      const layout = os.getLayout();
      let newLayout = moveFurniture(layout, uid, newCol, newRow);
      // A door moved into another wall opens a doorway there.
      const moved = newLayout.furniture.find((f) => f.uid === uid);
      if (newLayout !== layout && moved && isDoorType(moved.type)) {
        newLayout = openDoorway(newLayout, moved.type, newCol, newRow);
      }
      if (newLayout !== layout) {
        applyEdit(newLayout);
      }
    },
    [getOfficeState, applyEdit],
  );

  /**
   * Expand layout if click is on a ghost border tile (outside current bounds).
   * Returns the expanded layout and adjusted col/row, or null if no expansion needed.
   */
  const maybeExpand = useCallback(
    (
      layout: OfficeLayout,
      col: number,
      row: number,
    ): {
      layout: OfficeLayout;
      col: number;
      row: number;
      shift: { col: number; row: number } | TileRemap;
    } | null => {
      // A building: the level on screen grows, the others stay as they are.
      if (layout.levels && layout.levels.length > 0) {
        const level = getOfficeState().getViewLevel();
        if (inRect(level, col, row)) return null;
        const edges: LevelEdge[] = [];
        if (col < level.col) edges.push('left');
        if (col >= level.col + level.cols) edges.push('right');
        if (row < level.row) edges.push('up');
        if (row >= level.row + level.rows) edges.push('down');
        let current = layout;
        let tile = { col, row };
        const remaps: TileRemap[] = [];
        for (const edge of edges) {
          const result = expandLevel(current, level.id, edge, tile);
          if (!result) return null; // exceeded max
          current = result.layout;
          tile = result.tile;
          remaps.push(result.remap);
        }
        const remap: TileRemap = (c, r) => {
          let at: { col: number; row: number } | null = { col: c, row: r };
          for (const m of remaps) at = at ? m(at.col, at.row) : null;
          return at;
        };
        return { layout: current, col: tile.col, row: tile.row, shift: remap };
      }
      if (col >= 0 && col < layout.cols && row >= 0 && row < layout.rows) return null;

      // Determine which directions to expand
      const directions: ExpandDirection[] = [];
      if (col < 0) directions.push('left');
      if (col >= layout.cols) directions.push('right');
      if (row < 0) directions.push('up');
      if (row >= layout.rows) directions.push('down');

      let current = layout;
      let totalShiftCol = 0;
      let totalShiftRow = 0;
      for (const dir of directions) {
        const result = expandLayout(current, dir);
        if (!result) return null; // exceeded max
        current = result.layout;
        totalShiftCol += result.shift.col;
        totalShiftRow += result.shift.row;
      }

      return {
        layout: current,
        col: col + totalShiftCol,
        row: row + totalShiftRow,
        shift: { col: totalShiftCol, row: totalShiftRow },
      };
    },
    [getOfficeState],
  );

  const handlePetToggle = useCallback(
    (petType: number, active: boolean) => {
      const os = getOfficeState();
      const layout = os.getLayout();
      const currentPets: PlacedPet[] = layout.pets ?? [];

      let newPets: PlacedPet[];
      if (active) {
        // Idempotent: if this pet type is already placed, no-op (prevent double-write).
        if (currentPets.some((p) => p.petType === petType)) {
          return;
        }
        newPets = [...currentPets, { id: crypto.randomUUID(), petType }];
      } else {
        newPets = currentPets.filter((p) => p.petType !== petType);
        // Idempotent: nothing to remove → no-op.
        if (newPets.length === currentPets.length) {
          return;
        }
      }

      const newLayout: OfficeLayout = { ...layout, pets: newPets };
      applyEdit(newLayout);
    },
    [getOfficeState, applyEdit],
  );

  const handleEditorTileAction = useCallback(
    (col: number, row: number) => {
      const os = getOfficeState();
      let layout = os.getLayout();
      let effectiveCol = col;
      let effectiveRow = row;

      // Handle ghost border expansion for floor/wall tools
      if (
        editorState.activeTool === EditTool.TILE_PAINT ||
        editorState.activeTool === EditTool.WALL_PAINT
      ) {
        const expansion = maybeExpand(layout, col, row);
        if (expansion) {
          layout = expansion.layout;
          effectiveCol = expansion.col;
          effectiveRow = expansion.row;
          // Rebuild from expanded layout first, shifting character positions
          os.rebuildFromLayout(layout, expansion.shift);
        }
      }

      if (editorState.activeTool === EditTool.TILE_PAINT) {
        const newLayout = paintTile(
          layout,
          effectiveCol,
          effectiveRow,
          editorState.selectedTileType,
          editorState.floorColor,
        );
        if (newLayout !== layout) {
          applyEdit(newLayout);
        }
      } else if (editorState.activeTool === EditTool.WALL_PAINT) {
        const idx = effectiveRow * layout.cols + effectiveCol;
        const isWall = layout.tiles[idx] === TileType.WALL;

        // First tile of drag sets direction
        if (editorState.wallDragAdding === null) {
          editorState.wallDragAdding = !isWall;
        }

        if (editorState.wallDragAdding) {
          // Add wall with color
          const newLayout = paintTile(
            layout,
            effectiveCol,
            effectiveRow,
            TileType.WALL,
            editorState.wallColor,
          );
          if (newLayout !== layout) {
            applyEdit(newLayout);
          }
        } else {
          // Remove wall → paint floor with current floor settings
          if (isWall) {
            const newLayout = paintTile(
              layout,
              effectiveCol,
              effectiveRow,
              editorState.selectedTileType,
              editorState.floorColor,
            );
            if (newLayout !== layout) {
              applyEdit(newLayout);
            }
          }
        }
      } else if (editorState.activeTool === EditTool.ERASE) {
        if (!inView(col, row)) return;
        const idx = row * layout.cols + col;
        if (layout.tiles[idx] === TileType.VOID) return;
        const newLayout = paintTile(layout, col, row, TileType.VOID);
        if (newLayout !== layout) {
          applyEdit(newLayout);
        }
      } else if (editorState.activeTool === EditTool.FURNITURE_PLACE) {
        // A door turns to fit the wall it goes in.
        const type = doorTypeFor(layout, editorState.selectedFurnitureType, col, row);
        if (type === '') {
          // No item selected — act like SELECT (find furniture hit)
          const hit = layout.furniture.find((f) => {
            const entry = getCatalogEntry(f.type);
            if (!entry) return false;
            return (
              col >= f.col &&
              col < f.col + entry.footprintW &&
              row >= f.row &&
              row < f.row + entry.footprintH
            );
          });
          editorState.selectedFurnitureUid = hit ? hit.uid : null;
          setEditorTick((n) => n + 1);
        } else {
          const placementRow = getWallPlacementRow(type, row);
          if (!canPlaceFurniture(layout, type, col, placementRow)) return;
          const uid = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const placed: PlacedFurniture = { uid, type, col, row: placementRow };
          if (editorState.pickedFurnitureColor) {
            placed.color = { ...editorState.pickedFurnitureColor };
          }
          // A door's wall tile becomes its doorway.
          const base = isDoorType(type) ? openDoorway(layout, type, col, placementRow) : layout;
          let newLayout = placeFurniture(base, placed);
          if (newLayout === base) newLayout = layout;
          // Stairs get their other end upstairs (or downstairs); an elevator a door on every level.
          if (newLayout !== layout && portalKindOf(type)) newLayout = linkNewPortal(newLayout, uid);
          if (newLayout !== layout) {
            applyEdit(newLayout);
          }
        }
      } else if (editorState.activeTool === EditTool.FURNITURE_PICK) {
        // Find furniture at clicked tile, copy its type and color for placement
        const hit = layout.furniture.find((f) => {
          const entry = getCatalogEntry(f.type);
          if (!entry) return false;
          return (
            col >= f.col &&
            col < f.col + entry.footprintW &&
            row >= f.row &&
            row < f.row + entry.footprintH
          );
        });
        if (hit) {
          editorState.selectedFurnitureType = hit.type;
          editorState.pickedFurnitureColor = hit.color ? { ...hit.color } : null;
          editorState.activeTool = EditTool.FURNITURE_PLACE;
        }
        setEditorTick((n) => n + 1);
      } else if (editorState.activeTool === EditTool.EYEDROPPER) {
        const idx = row * layout.cols + col;
        const tile = layout.tiles[idx];
        if (tile !== undefined && tile !== TileType.WALL && tile !== TileType.VOID) {
          editorState.selectedTileType = tile;
          const color = layout.tileColors?.[idx];
          if (color) {
            editorState.floorColor = { ...color };
          }
          editorState.activeTool = EditTool.TILE_PAINT;
        } else if (tile === TileType.WALL) {
          // Pick wall color and switch to wall tool
          const color = layout.tileColors?.[idx];
          if (color) {
            editorState.wallColor = { ...color };
          }
          editorState.activeTool = EditTool.WALL_PAINT;
        }
        setEditorTick((n) => n + 1);
      } else if (editorState.activeTool === EditTool.AREA_PAINT) {
        // Area paint/erase is direction-aware: the first tile of a drag decides
        // whether the rest of the stroke paints (default) or erases (when the
        // first tile already had this label). Each tile pushes its own undo
        // entry — area painting is deliberate and low-velocity, unlike carpet.
        if (!inView(col, row)) return;
        const label = editorState.selectedAreaLabel;
        if (!label) return;
        const idx = row * layout.cols + col;
        const tileVal = layout.tiles[idx];
        if (tileVal === TileType.VOID || tileVal === TileType.WALL) return;

        if (editorState.areaDragErasing === null) {
          const existing = layout.areaTiles?.[idx] ?? null;
          editorState.areaDragErasing = existing === label;
        }
        const newLayout = editorState.areaDragErasing
          ? eraseArea(layout, col, row)
          : paintArea(layout, col, row, label);
        if (newLayout !== layout) {
          applyEdit(newLayout);
        }
      } else if (editorState.activeTool === EditTool.CARPET_PAINT) {
        // Drag-paint carpet with stroke-based undo: snapshot once per stroke, then
        // mutate in-place without pushing further undo entries. Stroke resets
        // happen in OfficeCanvas onMouseUp/onMouseLeave and on tool change.
        if (!inView(col, row)) return;
        const idx = row * layout.cols + col;
        const tileVal = layout.tiles[idx];
        if (tileVal === TileType.VOID || tileVal === TileType.WALL) return;

        // Snapshot the layout exactly once per stroke for undo.
        if (editorState.carpetStrokeInitialLayout === null) {
          editorState.carpetStrokeInitialLayout = layout;
          editorState.pushUndo(layout);
          editorState.clearRedo();
        }

        const newLayout = paintCarpet(
          layout,
          col,
          row,
          editorState.carpetVariant,
          editorState.carpetColor,
          editorState.carpetAccentColor,
        );
        if (newLayout !== layout) {
          editorState.isDirty = true;
          setIsDirty(true);
          os.rebuildFromLayout(newLayout);
          saveLayout(newLayout);
          setEditorTick((n) => n + 1);
        }
      } else if (editorState.activeTool === EditTool.CARPET_PICK) {
        if (!inView(col, row)) return;
        const idx = row * layout.cols + col;
        const tile = layout.carpetTiles?.[idx];
        if (!tile) return;
        editorState.carpetVariant = tile.variant;
        setCarpetVariantState(tile.variant);
        if (tile.color) {
          const next = { ...tile.color };
          editorState.carpetColor = next;
          setCarpetColorState(next);
        }
        if (tile.accentColor) {
          const next = { ...tile.accentColor };
          editorState.carpetAccentColor = next;
          setCarpetAccentColorState(next);
        }
        editorState.activeTool = EditTool.CARPET_PAINT;
        setEditorTick((n) => n + 1);
      } else if (editorState.activeTool === EditTool.SELECT) {
        const hit = layout.furniture.find((f) => {
          const entry = getCatalogEntry(f.type);
          if (!entry) return false;
          return (
            col >= f.col &&
            col < f.col + entry.footprintW &&
            row >= f.row &&
            row < f.row + entry.footprintH
          );
        });
        editorState.selectedFurnitureUid = hit ? hit.uid : null;
        setEditorTick((n) => n + 1);
      }
    },
    [getOfficeState, editorState, applyEdit, maybeExpand, saveLayout, inView],
  );

  const handleEditorEraseAction = useCallback(
    (col: number, row: number) => {
      const os = getOfficeState();
      const layout = os.getLayout();
      if (!inView(col, row)) return;

      // Right-click while in AREA_PAINT unconditionally clears the area on the
      // dragged tile (regardless of which label is selected). Per-tile undo
      // matches the left-click area paint semantics.
      if (editorState.activeTool === EditTool.AREA_PAINT) {
        if (!layout.areaTiles || layout.areaTiles[row * layout.cols + col] == null) return;
        const newLayout = eraseArea(layout, col, row);
        if (newLayout !== layout) {
          applyEdit(newLayout);
        }
        return;
      }

      // Right-click while in CARPET_PAINT removes carpets from the dragged path.
      // Reuses the same stroke-based undo machinery as left-click painting so a
      // single click-drag-release becomes one undo entry, not many.
      if (editorState.activeTool === EditTool.CARPET_PAINT) {
        if (!layout.carpetTiles || layout.carpetTiles[row * layout.cols + col] == null) return;
        if (editorState.carpetStrokeInitialLayout === null) {
          editorState.carpetStrokeInitialLayout = layout;
          editorState.pushUndo(layout);
          editorState.clearRedo();
        }
        const newLayout = eraseCarpet(layout, col, row);
        if (newLayout !== layout) {
          editorState.isDirty = true;
          setIsDirty(true);
          os.rebuildFromLayout(newLayout);
          saveLayout(newLayout);
          setEditorTick((n) => n + 1);
        }
        return;
      }

      const idx = row * layout.cols + col;
      // Only erase non-VOID tiles
      if (layout.tiles[idx] === TileType.VOID) return;
      const newLayout = paintTile(layout, col, row, TileType.VOID);
      if (newLayout !== layout) {
        applyEdit(newLayout);
      }
    },
    [getOfficeState, editorState, applyEdit, saveLayout, inView],
  );

  // ── Levels (floors of the building) ────────────────────────────
  const handleViewLevel = useCallback(
    (levelId: string) => {
      const os = getOfficeState();
      os.setViewLevel(levelId);
      // A different floor: what was selected or held here doesn't carry over.
      editorState.clearSelection();
      editorState.clearGhost();
      editorState.clearDrag();
      panRef.current = { x: 0, y: 0 };
      setEditorTick((n) => n + 1);
    },
    [getOfficeState, editorState],
  );

  const handleAddLevel = useCallback(
    (where: 'above' | 'below') => {
      const os = getOfficeState();
      const id = `level-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const result = addLevel(os.getLayout(), where, os.getViewLevel().id, id);
      if (!result) return;
      applyEdit(result.layout);
      // Straight to the new floor, to lay it out.
      handleViewLevel(result.level.id);
    },
    [getOfficeState, applyEdit, handleViewLevel],
  );

  const handleRemoveLevel = useCallback(
    (levelId: string) => {
      const os = getOfficeState();
      const result = removeLevel(os.getLayout(), levelId);
      if (!result) return;
      editorState.clearSelection();
      applyEdit(result.layout, result.remap);
    },
    [getOfficeState, editorState, applyEdit],
  );

  const handleRenameLevel = useCallback(
    (levelId: string, name: string) => {
      const layout = getOfficeState().getLayout();
      const next = renameLevel(layout, levelId, name);
      if (next !== layout) applyEdit(next);
    },
    [getOfficeState, applyEdit],
  );

  const handleMoveLevel = useCallback(
    (levelId: string, direction: 'up' | 'down') => {
      const layout = getOfficeState().getLayout();
      const next = moveLevel(layout, levelId, direction);
      if (next !== layout) applyEdit(next);
    },
    [getOfficeState, applyEdit],
  );

  const handleSetStairsTarget = useCallback(
    (uid: string, levelId: string) => {
      const layout = getOfficeState().getLayout();
      const next = setStairsTarget(layout, uid, levelId);
      if (next !== layout) applyEdit(next);
    },
    [getOfficeState, applyEdit],
  );

  const handleSetElevatorStop = useCallback(
    (uid: string, levelId: string, stops: boolean) => {
      const layout = getOfficeState().getLayout();
      const next = setElevatorStop(layout, uid, levelId, stops);
      if (next !== layout) applyEdit(next);
    },
    [getOfficeState, applyEdit],
  );

  return {
    isEditMode,
    editorTick,
    isDirty,
    zoom,
    panRef,
    saveTimerRef,
    setLastSavedLayout,
    showRoomLayout,
    markClean,
    handleOpenClaude,
    handleToggleEditMode,
    handleToolChange,
    handleTileTypeChange,
    handleFloorColorChange,
    handleWallColorChange,
    handleWallSetChange,
    handleSelectedFurnitureColorChange,
    handlePickedFurnitureColorChange,
    handleFurnitureTypeChange,
    handleDeleteSelected,
    handleRotateSelected,
    handleToggleState,
    handleUndo,
    handleRedo,
    handleReset,
    handleSave,
    handleZoomChange,
    handleEditorTileAction,
    handleEditorEraseAction,
    handleEditorSelectionChange,
    handleDragMove,
    handlePetToggle,
    carpetVariant,
    carpetColor,
    carpetAccentColor,
    handleCarpetVariantChange,
    handleCarpetColorChange,
    handleCarpetAccentColorChange,
    handleResetCarpetColor,
    handleResetCarpetAccentColor,
    selectedAreaLabel,
    handleSelectArea,
    handleAddArea,
    handleRemoveArea,
    handleRenameArea,
    handleAreaColorChange,
    handleViewLevel,
    handleAddLevel,
    handleRemoveLevel,
    handleRenameLevel,
    handleMoveLevel,
    handleSetStairsTarget,
    handleSetElevatorStop,
  };
}
