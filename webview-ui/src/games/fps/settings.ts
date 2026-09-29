// webview-ui/src/games/fps/settings.ts
//
// The player's own Pixel Frag settings, remembered in this browser only.

import {
  FPS_DEFAULT_FOV_DEG,
  FPS_DEFAULT_SENSITIVITY,
  FPS_DEFAULT_VOLUME,
  FPS_MAX_FOV_DEG,
  FPS_MIN_FOV_DEG,
  FPS_SETTINGS_STORAGE_KEY,
} from '../../constants.js';
import type { FpsConfig } from './types.js';

export interface FpsSettings {
  sensitivity: number;
  fovDeg: number;
  volume: number;
  minimap: boolean;
  /** The match setup chosen last. */
  lastConfig?: FpsConfig;
}

export const DEFAULT_FPS_SETTINGS: FpsSettings = {
  sensitivity: FPS_DEFAULT_SENSITIVITY,
  fovDeg: FPS_DEFAULT_FOV_DEG,
  volume: FPS_DEFAULT_VOLUME,
  minimap: true,
};

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;

export function loadFpsSettings(): FpsSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(FPS_SETTINGS_STORAGE_KEY) ?? 'null') as Record<
      string,
      unknown
    > | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_FPS_SETTINGS };
    return {
      sensitivity: clamp(raw.sensitivity, 0.2, 3, FPS_DEFAULT_SENSITIVITY),
      fovDeg: clamp(raw.fovDeg, FPS_MIN_FOV_DEG, FPS_MAX_FOV_DEG, FPS_DEFAULT_FOV_DEG),
      volume: clamp(raw.volume, 0, 1, FPS_DEFAULT_VOLUME),
      minimap: raw.minimap !== false,
      ...(raw.lastConfig && typeof raw.lastConfig === 'object'
        ? { lastConfig: raw.lastConfig as FpsConfig }
        : {}),
    };
  } catch {
    return { ...DEFAULT_FPS_SETTINGS };
  }
}

export function saveFpsSettings(settings: FpsSettings): void {
  try {
    localStorage.setItem(FPS_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private window, blocked storage */
  }
}
