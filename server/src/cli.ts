#!/usr/bin/env node

/**
 * Standalone CLI entry point: `npx pixel-agents`
 *
 * Starts the Fastify server in standalone mode with SPA serving and WebSocket.
 * Loads all assets (PNGs -> SpriteData) on startup and caches in memory.
 * Each connecting WebSocket client receives the full state on webviewReady.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AgentRuntime } from './agentRuntime.js';
import { AgentStateStore } from './agentStateStore.js';
import {
  buildAssetCache,
  loadAllCharacters,
  loadAllFurniture,
  loadAllPets,
} from './assetReload.js';
import type { AssetCache, ReloadAssetsSideEffect } from './clientMessageHandler.js';
import {
  getHooksConsent,
  getHooksEnabled,
  getMultiplayerSettings,
  grantHooksConsent,
  readConfig,
  readMultiplayerIceServers,
  readMultiplayerProfile,
  writeMultiplayerProfile,
} from './configPersistence.js';
import {
  LAYOUT_FILE_DIR,
  MAX_PORT,
  MIN_PORT,
  MULTIPLAYER_RELAY_DEFAULT_PORT,
  MULTIPLAYER_RELAY_ROOMS_DIR_NAME,
} from './constants.js';
import { FileStateAdapter } from './fileStateAdapter.js';
import { Integrations } from './integrations/index.js';
import { readLayoutFromFile } from './layoutPersistence.js';
import type { MultiplayerSettings } from './multiplayer/multiplayerClient.js';
import { MultiplayerClient } from './multiplayer/multiplayerClient.js';
import type { IceServer } from './multiplayer/protocol.js';
import { sanitizeIceServers } from './multiplayer/protocol.js';
import { startRelayServer } from './multiplayer/relayServer.js';
import { claudeProvider, copyHookScript, hookProviderById } from './providers/index.js';
import { PixelAgentsServer } from './server.js';

// ── Argument parsing ──────────────────────────────────────────

export interface CliArgs {
  /** Unset -> ephemeral (OS-assigned) port, so multiple standalone instances
   *  can run at once without a collision. --port picks a fixed one. */
  port?: number;
  host: string;
  /** Multiplayer: this relay (overrides ~/.pixel-agents/multiplayer.json). With --room the office joins at start;
   *  without it the page shows the join screen. */
  relay?: string;
  room?: string;
  name?: string;
}

/** `pixel-agents relay [--port N] [--host H] [--ice-servers F] [--rooms-dir D | --no-save-rooms]` — run a
 *  multiplayer relay instead of an office. */
export interface RelayCliArgs {
  port: number;
  host: string;
  /** JSON file with STUN/TURN servers every office gets for meeting media. */
  iceServers?: string;
  /** Where room maps are kept (default ~/.pixel-agents/relay-rooms). */
  roomsDir?: string;
  /** --no-save-rooms: room maps live in memory only, gone once a room empties. */
  saveRooms?: false;
}

/** Thrown by parseArgs on an invalid --port. Kept separate from process.exit so
 *  the parsing logic stays a pure, unit-testable function -- main() is the only
 *  place that turns a bad argument into an exit code. */
export class CliArgsError extends Error {}

function parsePort(flag: string, raw: string | undefined): number {
  if (raw === undefined) {
    throw new CliArgsError(
      `Missing value for ${flag}: expected an integer between ${MIN_PORT} and ${MAX_PORT}.`,
    );
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
    throw new CliArgsError(
      `Invalid --port "${raw}": must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
    );
  }
  return parsed;
}

function requireValue(flag: string, raw: string | undefined): string {
  if (raw === undefined || raw.startsWith('--')) {
    throw new CliArgsError(`Missing value for ${flag}.`);
  }
  return raw;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') {
      args.port = parsePort(argv[i], argv[i + 1]);
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--relay') {
      const url = requireValue(argv[i], argv[i + 1]);
      if (!/^wss?:\/\//i.test(url)) {
        throw new CliArgsError(`Invalid --relay "${url}": must be a ws:// or wss:// URL.`);
      }
      args.relay = url;
      i++;
    } else if (argv[i] === '--room') {
      args.room = requireValue(argv[i], argv[i + 1]);
      i++;
    } else if (argv[i] === '--name') {
      args.name = requireValue(argv[i], argv[i + 1]);
      i++;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-agents [options]
       pixel-agents relay [--port <number>] [--host <string>] [--ice-servers <file.json>]
                          [--rooms-dir <dir> | --no-save-rooms]

Options:
  --port, -p <number>   Port to listen on (default: OS-assigned ephemeral port)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --relay <url>         Multiplayer: ws:// or wss:// URL of a pixel-agents relay (the page asks name + room)
  --room <string>       Multiplayer: join this room right away, skipping the join screen (treat it like a password)
  --name <string>       Multiplayer: name shown to the other people in the room
  --help                Show this help message

Commands:
  relay                 Run a multiplayer relay (default port ${MULTIPLAYER_RELAY_DEFAULT_PORT})`);
      process.exit(0);
    }
  }
  return args;
}

export function parseRelayArgs(argv: string[]): RelayCliArgs {
  const args: RelayCliArgs = { port: MULTIPLAYER_RELAY_DEFAULT_PORT, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') {
      args.port = parsePort(argv[i], argv[i + 1]);
      i++;
    } else if (argv[i] === '--host') {
      args.host = requireValue(argv[i], argv[i + 1]);
      i++;
    } else if (argv[i] === '--ice-servers') {
      args.iceServers = requireValue(argv[i], argv[i + 1]);
      i++;
    } else if (argv[i] === '--rooms-dir') {
      args.roomsDir = requireValue(argv[i], argv[i + 1]);
      i++;
    } else if (argv[i] === '--no-save-rooms') {
      args.saveRooms = false;
    }
  }
  if (args.roomsDir && args.saveRooms === false) {
    throw new CliArgsError('--rooms-dir and --no-save-rooms contradict each other: pick one.');
  }
  return args;
}

/** Resolve the multiplayer settings: CLI flags win over multiplayer.json, and both over the join screen's last
 *  answer (which only prefills). Always settings: without a relay the page's join screen asks for one. */
export function resolveMultiplayerSettings(args: CliArgs): MultiplayerSettings {
  if (args.relay) {
    const profile = readMultiplayerProfile();
    const iceServers = readMultiplayerIceServers();
    return {
      relayUrl: args.relay,
      room: args.room ?? profile.room,
      displayName:
        args.name ?? profile.displayName ?? (args.room ? os.userInfo().username : undefined),
      ...(iceServers && iceServers.length > 0 ? { iceServers } : {}),
    };
  }
  return getMultiplayerSettings();
}

// ── Hooks consent ─────────────────────────────────────────────
// First-run consent is asked IN THE APP, not here: the server sends a
// hooksConsentRequest to privileged (tokened) connections during the
// webviewReady handshake (clientMessageHandler.ts), and the browser renders
// the dialog — the same UX the VS Code webview shows. The CLI itself never
// prompts; a headless run just starts without hooks until consent is granted
// through the UI. The one exception that needs no dialog is the silent-grant
// migration below (our hooks already installed by a pre-consent version).

/**
 * Copy the bundled hook script into ~/.pixel-agents/hooks/, reporting failure.
 *
 * Callers run this BEFORE installing the settings.json entries and abort when
 * it returns false: an entry whose command points at a missing script makes
 * Claude Code spawn a dead `node` process for every event, which is strictly
 * worse than no hooks at all.
 */
function copyHookScriptOrReport(packageRoot: string, context = ''): boolean {
  if (copyHookScript(packageRoot)) return true;
  console.error(`[Pixel Agents] Hooks NOT installed${context}: hook script missing.`);
  return false;
}

// ── Main ──────────────────────────────────────────────────────

async function runRelay(argv: string[]): Promise<void> {
  let args: RelayCliArgs;
  try {
    args = parseRelayArgs(argv);
  } catch (err) {
    console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  let iceServers: IceServer[] = [];
  if (args.iceServers) {
    try {
      iceServers = sanitizeIceServers(JSON.parse(fs.readFileSync(args.iceServers, 'utf-8')));
    } catch (err) {
      console.error(`[Pixel Agents] --ice-servers: cannot read ${args.iceServers}: ${err}`);
      process.exit(1);
    }
    if (iceServers.length === 0) {
      console.error(
        `[Pixel Agents] --ice-servers: ${args.iceServers} has no usable entry (expected [{ "urls": ["turn:host:3478"], "username": "...", "credential": "..." }]).`,
      );
      process.exit(1);
    }
  }
  const roomsDir =
    args.saveRooms === false
      ? undefined
      : path.resolve(
          args.roomsDir ??
            path.join(os.homedir(), LAYOUT_FILE_DIR, MULTIPLAYER_RELAY_ROOMS_DIR_NAME),
        );
  const relay = await startRelayServer({
    host: args.host,
    port: args.port,
    verbose: true,
    iceServers,
    roomsDir,
  });
  console.log(`\n  Pixel Agents relay listening on ws://${args.host}:${relay.port}/\n`);
  console.log(
    roomsDir
      ? `  Room maps are kept in ${roomsDir} (anyone in a room may edit its map).\n`
      : '  Room maps are kept in memory only: a room forgets its map once everyone left.\n',
  );
  if (iceServers.length > 0) {
    console.log(`  Meetings: ${iceServers.length} ICE server(s) handed to every office.\n`);
  }
  const shutdown = () => {
    void relay.close().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main(): Promise<void> {
  if (process.argv[2] === 'relay') {
    await runRelay(process.argv.slice(3));
    return;
  }
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // dist/ contains both the CLI bundle and the assets/ + webview/ directories
  const distRoot = __dirname;
  const packageRoot = path.dirname(distRoot);
  const staticDir = path.join(distRoot, 'webview');

  // ── Load assets on startup (same pipeline as VS Code extension) ──
  // External asset directories are merged at startup too, so directories added
  // in a previous session survive a restart. buildAssetCache is the shared
  // loader used by both the standalone server and the VS Code adapter.
  console.log('[Pixel Agents] Loading assets...');
  const assetCache: AssetCache = await buildAssetCache(
    distRoot,
    readConfig().externalAssetDirectories,
  );
  const charCount = assetCache.characters?.characters.length ?? 0;
  const petCount = assetCache.pets?.pets.length ?? 0;
  const furnitureCount = assetCache.furniture?.catalog.length ?? 0;
  console.log(
    `[Pixel Agents] Assets loaded: ${charCount} characters, ${petCount} pets, ${furnitureCount} furniture items`,
  );

  // ── Store + adapter (shared settings + standalone-scoped agents/seats) ──
  const store = new AgentStateStore();
  const adapter = new FileStateAdapter({ namespace: 'standalone' });
  store.setAdapter(adapter);

  // ── Create server ──
  const server = new PixelAgentsServer();

  try {
    // Create runtime first (before server.start, so we can pass it in)
    const runtime = new AgentRuntime(store, claudeProvider);

    // Multiplayer: publish this office's agents to a relay, draw the room's.
    const multiplayerSettings = resolveMultiplayerSettings(args);
    const multiplayer = new MultiplayerClient(
      store,
      multiplayerSettings,
      claudeProvider.readingTools,
      {
        getLocalLayout: () => readLayoutFromFile() ?? assetCache.defaultLayout ?? null,
        rememberProfile: writeMultiplayerProfile,
        initialProfile: readMultiplayerProfile(),
      },
    );
    // The person's calendar and Spotify. The page opens the Spotify sign-in itself (openExternalUrl).
    const integrations = new Integrations(store, { multiplayer });

    // Wire hook events: HTTP POST -> runtime -> hookEventHandler -> agents
    server.onHookEvent((providerId, event) => {
      runtime.handleHookEvent(providerId, event);
    });

    // onSetHooksEnabled side effect: install/uninstall the named provider's
    // hooks when the user toggles in the UI (or answers the consent ask).
    // Captures config from the outer scope after server.start().
    let currentConfig: { port: number; token: string } | null = null;
    const onSetHooksEnabled = async (providerId: string, enabled: boolean): Promise<void> => {
      if (!currentConfig) return;
      const provider = hookProviderById(providerId);
      if (!provider) return; // unknown id: nothing to install into
      if (enabled) {
        // An explicit toggle in the UI IS the consent to modify the
        // provider's settings file. The bundled claude-hook.js script belongs
        // to the Claude provider alone; another provider's install must
        // neither copy it nor be blocked by it.
        grantHooksConsent(provider.id);
        if (
          provider.id === claudeProvider.id &&
          !copyHookScriptOrReport(packageRoot, ' (user toggle)')
        ) {
          return;
        }
        try {
          await provider.installHooks(
            `http://127.0.0.1:${currentConfig.port}`,
            currentConfig.token,
          );
        } catch (err) {
          console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        console.log('[Pixel Agents] Hooks installed (user toggle)');
      } else {
        try {
          await provider.uninstallHooks();
          console.log('[Pixel Agents] Hooks uninstalled (user toggle)');
        } catch (err) {
          console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };

    // onReloadAssets side effect: re-run the shared loaders (bundled + external
    // dirs) after an external-asset-directory change, then re-broadcast the
    // updated sprites to the requesting client. Mutates the assetCache object in
    // place so already-open sockets (which captured the same reference) and
    // future webviewReady handshakes both observe the new assets. Only
    // characters/pets/furniture can come from external dirs, so only those three
    // are reloaded and re-sent (mirrors the VS Code reload path).
    const onReloadAssets: ReloadAssetsSideEffect = async (send): Promise<void> => {
      const externalDirs = readConfig().externalAssetDirectories;
      const [characters, pets, furniture] = await Promise.all([
        loadAllCharacters(distRoot, externalDirs),
        loadAllPets(distRoot, externalDirs),
        loadAllFurniture(distRoot, externalDirs),
      ]);
      assetCache.characters = characters;
      assetCache.pets = pets;
      assetCache.furniture = furniture;
      if (characters) {
        send({ type: 'characterSpritesLoaded', characters: characters.characters });
      }
      if (pets) {
        send({
          type: 'petSpritesLoaded',
          pets: pets.pets,
          petNames: pets.manifests.map((m) => m.name),
        });
      }
      if (furniture) {
        send({
          type: 'furnitureAssetsLoaded',
          catalog: furniture.catalog,
          sprites: Object.fromEntries(furniture.sprites),
        });
      }
      console.log('[Pixel Agents] Assets reloaded (external directory change)');
    };

    const config = await server.start({
      store,
      runtime,
      embedded: false,
      host: args.host,
      port: args.port,
      staticDir,
      assetCache,
      onSetHooksEnabled,
      onReloadAssets,
      multiplayer,
      integrations,
      // --relay names a distinct office, so it gets its own server (and page). Reusing a running one would open
      // THAT office, while this process published agents nobody could see.
      reuseExisting: !args.relay,
    });
    if (server.isOwner()) {
      if (args.room && multiplayerSettings.relayUrl) {
        console.log(`[Pixel Agents] Multiplayer: joining ${multiplayerSettings.relayUrl}`);
        multiplayer.start();
      } else if (multiplayerSettings.relayUrl) {
        console.log(
          `[Pixel Agents] Multiplayer: relay ${multiplayerSettings.relayUrl} — open the page below to enter your name and room.`,
        );
      }
    } else {
      // The running server owns the office on screen; it joins the room itself when asked to.
      if (args.room) {
        console.log(
          '[Pixel Agents] Multiplayer: reusing a running server, so it is that server that joins the room (or not). Pass --relay to start a separate office.',
        );
      }
      multiplayer.dispose();
    }
    // Only the server that owns the page polls the person's apps.
    if (server.isOwner()) integrations.start();
    currentConfig = { port: config.port, token: config.token };

    // Sync runtime refs with persisted settings BEFORE first scan tick. The
    // runtime's single hooksEnabled ref follows the Claude provider until the
    // scanners grow per-provider awareness alongside the Settings UI.
    runtime.hooksEnabled.current = getHooksEnabled(claudeProvider.id);
    runtime.watchAllSessions.current = adapter.getSetting('pixel-agents.watchAllSessions', false);

    // Install hooks on startup if the persisted setting says so — gated on the
    // one-time consent to modify ~/.claude/settings.json.
    if (runtime.hooksEnabled.current) {
      let consent = getHooksConsent(claudeProvider.id) === 'granted';
      if (!consent && (await claudeProvider.areHooksInstalled())) {
        // Our hooks are already installed and already firing — a pre-consent
        // version put them there. Grant and continue with NO prompt: the
        // install below is the 14 -> 12 migration, and it only ever REDUCES
        // scope (it drops UserPromptSubmit and TaskCreated, the two events that
        // forwarded prompt text and were consumed by nothing). Asking would buy
        // this user no protection they do not already have, so they are not
        // asked. A fresh install still is, in full — in the browser UI, when a
        // tokened client connects (clientMessageHandler's webviewReady).
        grantHooksConsent(claudeProvider.id);
        consent = true;
      }
      if (!consent) {
        console.log(
          '[Pixel Agents] Hooks not installed: modifying ~/.claude/settings.json needs one-time approval — open the URL below to review and approve it.',
        );
      } else if (copyHookScriptOrReport(packageRoot)) {
        try {
          await claudeProvider.installHooks(`http://127.0.0.1:${config.port}`, config.token);
          console.log('[Pixel Agents] Hooks installed');
        } catch (err) {
          console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } else {
      // Without this line, a persisted hooks-off makes startup skip the entire
      // consent/install flow with zero output — indistinguishable from a bug.
      console.log(
        '[Pixel Agents] Hooks disabled — enable "Instant Detection (Hooks)" in the UI settings to install them.',
      );
    }

    // Start scanning for external sessions (Claude running in user's terminal)
    const cwd = process.cwd();
    const dirs = claudeProvider.getSessionDirs?.(cwd);
    if (dirs && dirs[0]) {
      const projectDir = dirs[0];
      console.log(`[Pixel Agents] Scanning project dir: ${projectDir}`);
      runtime.startProjectScan(projectDir);
      runtime.startExternalScanning(projectDir);
      runtime.startStaleCheck();
    }

    // The URL the operator opens has to be REACHABLE (a wildcard bind address
    // is a bind target, not an address you can browse to — `--host 0.0.0.0`
    // used to print a dead `http://0.0.0.0:PORT`) and has to carry the token,
    // which is what makes the session it loads privileged enough to approve a
    // hook install (see standaloneTokenValid in httpServer.ts). Under `--host
    // 0.0.0.0` the office stays readable from the LAN at this machine's own
    // address; only the consent-bearing toggle needs the token.
    const displayHost =
      args.host === '0.0.0.0' || args.host === '::' || args.host === '' ? '127.0.0.1' : args.host;
    console.log(
      `\n  Pixel Agents server running at http://${displayHost}:${config.port}/?token=${config.token}\n`,
    );

    // ── Graceful shutdown ──
    function shutdown(): void {
      console.log('\nShutting down...');
      multiplayer?.dispose();
      integrations.dispose();
      runtime.dispose();
      server.stop();
      process.exit(0);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Only auto-run when this file is executed directly (`node dist/cli.js`), not
// when it's imported for its exports (e.g. `parseArgs` in tests) -- importing
// it unconditionally used to start a real server and install real Claude
// hooks as a side effect of module load.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
