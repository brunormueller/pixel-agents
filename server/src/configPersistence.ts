import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  CONFIG_FILE_NAME,
  LAYOUT_FILE_DIR,
  MULTIPLAYER_FILE_NAME,
  MULTIPLAYER_PROFILE_FILE_NAME,
} from './constants.js';
import type { MultiplayerSettings } from './multiplayer/multiplayerClient.js';
import type { AvatarLook, DeskDecorItem, PersonStatus } from './multiplayer/protocol.js';
import {
  sanitizeDecor,
  sanitizeDesks,
  sanitizeDeskStyle,
  sanitizeHidden,
  sanitizeIceServers,
  sanitizeLook,
  sanitizeRelayUrl,
  sanitizeStatus,
  sanitizeStatusText,
} from './multiplayer/protocol.js';

export interface AdapterSettings {
  soundEnabled: boolean;
  lastSeenVersion: string;
  alwaysShowLabels: boolean;
  ghostHeadlessAgents: boolean;
  watchAllSessions: boolean;
  hooksInfoShown: boolean;
  showAreas: boolean;
  areaMappings: Record<string, string[]>;
}

/** All keys in AdapterSettings. Used by adapters to map `pixel-agents.foo` → `foo`.
 *  The hooks preference is NOT here: it is per-provider and machine-global
 *  (the hooks it governs live in one home-directory file per provider), so it
 *  lives beside `hooksConsent` at the config top level, not per namespace. */
export const ADAPTER_SETTING_KEYS = [
  'soundEnabled',
  'lastSeenVersion',
  'alwaysShowLabels',
  'ghostHeadlessAgents',
  'watchAllSessions',
  'hooksInfoShown',
  'showAreas',
  'areaMappings',
] as const;

export type AdapterSettingKey = (typeof ADAPTER_SETTING_KEYS)[number];

/** Namespaces = adapter identities sharing the same config.json file. */
export type ConfigNamespace = 'vscode' | 'standalone';

/** What the user answered a provider's consent ask with, durably. `granted` is recorded BEFORE the install writes, so
 *  it can exist with nothing on disk; `declined` means the ANSWER itself turned hooks off, the provenance a revised
 *  "Not Now" needs to know the preference is its to take back (a Settings toggle never records consent). Absent =
 *  unanswered, the ask is still open. */
export type HooksConsentState = 'granted' | 'declined';

export interface PixelAgentsConfig {
  vscode: AdapterSettings;
  standalone: AdapterSettings;
  externalAssetDirectories: string[];
  /** Per-provider consent to modify that provider's settings file (Claude:
   *  ~/.claude/settings.json). Shared across surfaces — consent is per-human
   *  per-provider, not per-adapter. A provider absent from the map has never
   *  been answered. */
  hooksConsent: Record<string, HooksConsentState>;
  /** Per-provider hooks preference, machine-global for the same reason as the
   *  consent above. A provider absent from the map takes the default (true). */
  hooksEnabled: Record<string, boolean>;
}

const DEFAULT_ADAPTER_SETTINGS: AdapterSettings = {
  soundEnabled: true,
  lastSeenVersion: '',
  alwaysShowLabels: false,
  ghostHeadlessAgents: false,
  watchAllSessions: false,
  hooksInfoShown: false,
  showAreas: false,
  areaMappings: {},
};

function getConfigFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, CONFIG_FILE_NAME);
}

/** Coerce a loose object into the per-provider consent map, dropping entries whose value is not exactly 'granted' or
 *  'declined'. */
function parseHooksConsent(raw: unknown): Record<string, HooksConsentState> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, HooksConsentState> = {};
  for (const [providerId, state] of Object.entries(raw as Record<string, unknown>)) {
    if (state === 'granted' || state === 'declined') out[providerId] = state;
  }
  return out;
}

/** Coerce a loose object into the per-provider hooks-preference map, dropping non-boolean values. */
function parseHooksEnabled(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [providerId, enabled] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof enabled === 'boolean') out[providerId] = enabled;
  }
  return out;
}

/**
 * Coerce a loose object into `Record<string, string[]>`, dropping any entries whose value is not an array of strings.
 * Returns `{}` if the input isn't an object. Used to defensively load folder→area mappings from config.json, which
 * may have been hand-edited or written by an older build.
 */
export function parseAreaMappings(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [folder, labels] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof folder !== 'string') {
      continue;
    }
    if (!Array.isArray(labels)) {
      continue;
    }
    const filtered = labels.filter((l): l is string => typeof l === 'string');
    out[folder] = filtered;
  }
  return out;
}

/** Coerce a loose object into a valid AdapterSettings with defaults for missing/wrong-typed fields. */
function parseAdapterSettings(raw: unknown): AdapterSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdapterSettings>;
  return {
    soundEnabled:
      typeof obj.soundEnabled === 'boolean'
        ? obj.soundEnabled
        : DEFAULT_ADAPTER_SETTINGS.soundEnabled,
    lastSeenVersion:
      typeof obj.lastSeenVersion === 'string'
        ? obj.lastSeenVersion
        : DEFAULT_ADAPTER_SETTINGS.lastSeenVersion,
    alwaysShowLabels:
      typeof obj.alwaysShowLabels === 'boolean'
        ? obj.alwaysShowLabels
        : DEFAULT_ADAPTER_SETTINGS.alwaysShowLabels,
    ghostHeadlessAgents:
      typeof obj.ghostHeadlessAgents === 'boolean'
        ? obj.ghostHeadlessAgents
        : DEFAULT_ADAPTER_SETTINGS.ghostHeadlessAgents,
    watchAllSessions:
      typeof obj.watchAllSessions === 'boolean'
        ? obj.watchAllSessions
        : DEFAULT_ADAPTER_SETTINGS.watchAllSessions,
    hooksInfoShown:
      typeof obj.hooksInfoShown === 'boolean'
        ? obj.hooksInfoShown
        : DEFAULT_ADAPTER_SETTINGS.hooksInfoShown,
    showAreas:
      typeof obj.showAreas === 'boolean' ? obj.showAreas : DEFAULT_ADAPTER_SETTINGS.showAreas,
    areaMappings: parseAreaMappings(obj.areaMappings),
  };
}

export function readConfig(): PixelAgentsConfig {
  const filePath = getConfigFilePath();
  try {
    if (!fs.existsSync(filePath)) {
      return {
        vscode: { ...DEFAULT_ADAPTER_SETTINGS },
        standalone: { ...DEFAULT_ADAPTER_SETTINGS },
        externalAssetDirectories: [],
        hooksConsent: {},
        hooksEnabled: {},
      };
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PixelAgentsConfig>;
    return {
      vscode: parseAdapterSettings(parsed.vscode),
      standalone: parseAdapterSettings(parsed.standalone),
      externalAssetDirectories: Array.isArray(parsed.externalAssetDirectories)
        ? parsed.externalAssetDirectories.filter((d): d is string => typeof d === 'string')
        : [],
      hooksConsent: parseHooksConsent(parsed.hooksConsent),
      hooksEnabled: parseHooksEnabled(parsed.hooksEnabled),
    };
  } catch (err) {
    console.error('[Pixel Agents] Failed to read config file:', err);
    return {
      vscode: { ...DEFAULT_ADAPTER_SETTINGS },
      standalone: { ...DEFAULT_ADAPTER_SETTINGS },
      externalAssetDirectories: [],
      hooksConsent: {},
      hooksEnabled: {},
    };
  }
}

const nonEmpty = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v : undefined;

/** Coerce the hand-written multiplayer.json. The URL must be ws:// or wss://; anything else reads as "multiplayer
 *  off" rather than a half-configured connection. `room` and `displayName` are optional: they only prefill the join
 *  screen, which is where a room is actually entered. */
export function parseMultiplayer(raw: unknown): MultiplayerSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { relayUrl, room, displayName, iceServers } = raw as Record<string, unknown>;
  if (typeof relayUrl !== 'string' || !/^wss?:\/\//i.test(relayUrl)) return undefined;
  const settings: MultiplayerSettings = {
    relayUrl,
    room: nonEmpty(room),
    displayName: nonEmpty(displayName),
  };
  const ice = sanitizeIceServers(iceServers);
  if (ice.length > 0) settings.iceServers = ice;
  return settings;
}

/** multiplayer.json's `iceServers` alone (STUN/TURN for meetings) — for an office
 *  whose relay came from the command line. Empty when absent or unreadable. */
export function readMultiplayerIceServers(): MultiplayerSettings['iceServers'] {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), LAYOUT_FILE_DIR, MULTIPLAYER_FILE_NAME), 'utf-8'),
    ) as Record<string, unknown>;
    return sanitizeIceServers(raw?.iceServers);
  } catch {
    return [];
  }
}

function multiplayerProfilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, MULTIPLAYER_PROFILE_FILE_NAME);
}

/** Who the person is in a room, machine-wide (both surfaces): the join screen's last answer, plus the profile they
 *  show the room — their character's look, a status, their desk decoration, whether the song playing is shared. */
export interface MultiplayerProfile {
  room?: string;
  displayName?: string;
  /** The relay typed on the join screen (wins over multiplayer.json and the build's default). */
  relayUrl?: string;
  /** Null/absent = no look chosen: the office picks a character, as before. */
  look?: AvatarLook | null;
  status?: PersonStatus;
  statusText?: string;
  decor?: DeskDecorItem[];
  shareMusic?: boolean;
  /** The desk last claimed in each room (room → seat uid). */
  desks?: Record<string, string>;
  deskStyle?: string | null;
  hidden?: string[];
}

/** Read multiplayer-profile.json, sanitized field by field (a hand edit can't smuggle anything past the relay's own
 *  rules, and a malformed field reads as unset instead of failing the whole file). */
export function readMultiplayerProfile(): MultiplayerProfile {
  try {
    const raw = JSON.parse(fs.readFileSync(multiplayerProfilePath(), 'utf-8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const r = raw as Record<string, unknown>;
    const profile: MultiplayerProfile = {
      room: nonEmpty(r.room),
      displayName: nonEmpty(r.displayName),
    };
    const relayUrl = sanitizeRelayUrl(r.relayUrl);
    if (relayUrl) profile.relayUrl = relayUrl;
    const look = sanitizeLook(r.look);
    if (look) profile.look = look;
    if (r.status !== undefined) profile.status = sanitizeStatus(r.status);
    if (typeof r.statusText === 'string') profile.statusText = sanitizeStatusText(r.statusText);
    if (Array.isArray(r.decor)) profile.decor = sanitizeDecor(r.decor);
    if (typeof r.shareMusic === 'boolean') profile.shareMusic = r.shareMusic;
    if (r.desks && typeof r.desks === 'object') profile.desks = sanitizeDesks(r.desks);
    if ('deskStyle' in r) profile.deskStyle = sanitizeDeskStyle(r.deskStyle);
    if (Array.isArray(r.hidden)) profile.hidden = sanitizeHidden(r.hidden);
    return profile;
  } catch {
    return {};
  }
}

/** Merge `patch` into the saved profile. Its own file for the same reason as multiplayer.json: an older build
 *  rewriting config.json would drop the keys. Written atomically; a failure only costs remembering it. */
export function writeMultiplayerProfile(patch: MultiplayerProfile): void {
  const filePath = multiplayerProfilePath();
  try {
    const next: Record<string, unknown> = { ...readMultiplayerProfile(), ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.warn('[Pixel Agents] Multiplayer: could not save the profile:', err);
  }
}

/** The relay a build ships with: `PIXEL_AGENTS_DEFAULT_RELAY` at build time (esbuild inlines it) or, for an
 *  unbundled run, in the environment. Lets a team hand out an extension whose join screen already knows the relay. */
export function defaultRelayUrl(): string | undefined {
  return sanitizeRelayUrl(process.env.PIXEL_AGENTS_DEFAULT_RELAY) ?? undefined;
}

/** The hand-written `~/.pixel-agents/multiplayer.json`, or undefined when absent or invalid. */
function readMultiplayerFile(): MultiplayerSettings | undefined {
  const filePath = path.join(os.homedir(), LAYOUT_FILE_DIR, MULTIPLAYER_FILE_NAME);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
  try {
    const settings = parseMultiplayer(JSON.parse(raw));
    if (!settings) {
      console.warn(
        `[Pixel Agents] Multiplayer: ignoring ${filePath} (needs "relayUrl" starting with ws:// or wss://)`,
      );
    }
    return settings;
  } catch (err) {
    console.warn(`[Pixel Agents] Multiplayer: ${filePath} is not valid JSON: ${err}`);
    return undefined;
  }
}

/**
 * Every office can join a room: this is what its join screen starts from. The relay is, newest first, the one
 * typed on the join screen last time, `~/.pixel-agents/multiplayer.json`'s, or the build's default — or '' when
 * none is known, and the join screen asks for it. Room and name only prefill. multiplayer.json is a file of its own
 * rather than a config.json key: every build — including released ones that predate multiplayer — rewrites
 * config.json from the fields it knows, so a key there is silently dropped by the next write of an older extension
 * running in another window.
 */
export function getMultiplayerSettings(): MultiplayerSettings {
  const file = readMultiplayerFile();
  // The join screen's last answer is newer than the hand-written file.
  const profile = readMultiplayerProfile();
  return {
    relayUrl: profile.relayUrl ?? file?.relayUrl ?? defaultRelayUrl() ?? '',
    room: profile.room ?? file?.room,
    displayName: profile.displayName ?? file?.displayName,
    ...(file?.iceServers ? { iceServers: file.iceServers } : {}),
  };
}

// ── Per-provider hooks consent + preference ─────────────────
// The provider id keys these maps (HookProvider.id — 'claude' today). All
// writers go through readConfig→writeConfig, so a hand-edited or older file
// degrades to "unanswered"/default rather than crashing.

/** What the user durably answered this provider's ask with, or 'unanswered'. */
export function getHooksConsent(providerId: string): HooksConsentState | 'unanswered' {
  return readConfig().hooksConsent[providerId] ?? 'unanswered';
}

/** Persist the one-time approval for modifying this provider's settings file. A grant REPLACING a decline also
 *  deletes that decline's hooks-off remnant in the same write: without it, an install that then FAILS leaves a grant
 *  beside the retracted hooks-off, and a later "Not Now" (which leaves the preference alone, since the grant never
 *  wrote it) ends at unanswered + hooks-off — an ask that never returns. A successful install persists hooks-on
 *  anyway, so this only changes the failure path. */
export function grantHooksConsent(providerId: string): void {
  const cfg = readConfig();
  if (cfg.hooksConsent[providerId] !== 'granted') {
    const replacingDecline = cfg.hooksConsent[providerId] === 'declined';
    cfg.hooksConsent[providerId] = 'granted';
    if (replacingDecline) delete cfg.hooksEnabled[providerId];
    writeConfig(cfg);
  }
}

/** Record a durable decline ("Don't Ask Again"): consent 'declined' AND hooks-off, in ONE readConfig→writeConfig
 *  cycle. They are one logical answer — split across two writes, a failed second leaves a state the answer disavows
 *  (a decline with the default-on preference, or a hooks-off with no provenance). */
export function recordHooksDecline(providerId: string): void {
  const cfg = readConfig();
  if (cfg.hooksConsent[providerId] !== 'declined' || cfg.hooksEnabled[providerId] !== false) {
    cfg.hooksConsent[providerId] = 'declined';
    cfg.hooksEnabled[providerId] = false;
    writeConfig(cfg);
  }
}

/** Un-record an answer AND restore the preference default in ONE cycle — the revised-notNow revert over a decline.
 *  Both keys go together so "never answered" and "answered and reverted" are indistinguishable on disk, and no
 *  partial-write order can leave a half-reverted answer. */
export function clearHooksAnswer(providerId: string): void {
  const cfg = readConfig();
  if (providerId in cfg.hooksConsent || providerId in cfg.hooksEnabled) {
    delete cfg.hooksConsent[providerId];
    delete cfg.hooksEnabled[providerId];
    writeConfig(cfg);
  }
}

/** Un-record an answer entirely, so the ask genuinely returns. Used when the
 *  user walks the Intro back from its closing step and revises an earlier
 *  answer down to "Not Now": whatever that answer left (a grant, a decline)
 *  must go, or the consent gate reads it as asked-and-answered forever.
 *  Callers only clear a grant after any uninstall verifiably landed. */
export function clearHooksConsent(providerId: string): void {
  const cfg = readConfig();
  if (providerId in cfg.hooksConsent) {
    delete cfg.hooksConsent[providerId];
    writeConfig(cfg);
  }
}

/** The per-provider hooks preference. Absent = the default, true. */
export function getHooksEnabled(providerId: string): boolean {
  return readConfig().hooksEnabled[providerId] ?? true;
}

export function setHooksEnabled(providerId: string, enabled: boolean): void {
  const cfg = readConfig();
  if (cfg.hooksEnabled[providerId] !== enabled) {
    cfg.hooksEnabled[providerId] = enabled;
    writeConfig(cfg);
  }
}

/** Restore the provider's preference to its default (true) by REMOVING the key. Deleting rather than writing `true`
 *  keeps "never answered" and "answered and reverted" indistinguishable on disk. */
export function clearHooksEnabled(providerId: string): void {
  const cfg = readConfig();
  if (providerId in cfg.hooksEnabled) {
    delete cfg.hooksEnabled[providerId];
    writeConfig(cfg);
  }
}

/** Called on extension uninstall: return every hooks-related choice to factory state — all providers' consent and
 *  preferences cleared, hooksInfoShown back to default in both namespaces. Those choices belonged to an installation
 *  that no longer exists, so a future install starts from the first-run experience rather than inheriting a stale
 *  hooks-off that would skip the ask forever. */
export function resetHooksConfig(): void {
  const cfg = readConfig();
  cfg.hooksConsent = {};
  cfg.hooksEnabled = {};
  for (const ns of ['vscode', 'standalone'] as const) {
    cfg[ns].hooksInfoShown = DEFAULT_ADAPTER_SETTINGS.hooksInfoShown;
  }
  writeConfig(cfg);
}

export function writeConfig(config: PixelAgentsConfig): void {
  const filePath = getConfigFilePath();
  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const json = JSON.stringify(config, null, 2);
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('[Pixel Agents] Failed to write config file:', err);
  }
}
