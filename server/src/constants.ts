// ── JSONL File Watching ─────────────────────────────────────
export const JSONL_POLL_INTERVAL_MS = 1000;
export const FILE_WATCHER_POLL_INTERVAL_MS = 500;
export const PROJECT_SCAN_INTERVAL_MS = 1000;

// ── Heuristic Agent Status Detection ────────────────────────
// These timers are the fallback when CLI hooks are not active
// (hookDelivered = false). When hooks are working, these are
// suppressed and the server receives instant events instead.
/** Delay before sending agentToolDone (prevents UI flicker on rapid tool transitions) */
export const TOOL_DONE_DELAY_MS = 300;
/** Heuristic: time after a non-exempt tool starts before showing permission bubble.
 *  Not used for teammates -- false positives on slow tools (WebFetch/WebSearch).
 *  Teammates rely on the lead's routed Notification(permission_prompt) hook. */
export const PERMISSION_TIMER_DELAY_MS = 7000;
/** Heuristic: silence duration before marking a text-only turn as complete */
export const TEXT_IDLE_DELAY_MS = 5000;
/** Heuristic: idle threshold for per-agent /clear detection (content check prevents stealing) */
export const CLEAR_IDLE_THRESHOLD_MS = 2000;

// ── External Session Detection ──────────────────────────────
export const EXTERNAL_SCAN_INTERVAL_MS = 3000;
/** Only adopt JSONL files modified within this window */
export const EXTERNAL_ACTIVE_THRESHOLD_MS = 120_000; // 2 minutes
/** Remove external agents after this much inactivity */
// export const EXTERNAL_STALE_TIMEOUT_MS = 300_000; // 5 minutes - deprecated
export const EXTERNAL_STALE_CHECK_INTERVAL_MS = 30_000;
/** Cooldown after user closes an agent via X. Must be > EXTERNAL_ACTIVE_THRESHOLD_MS
 *  so the file's mtime becomes stale before the dismissal expires. */
export const DISMISSED_COOLDOWN_MS = 180_000; // 3 minutes

// ── Context Window Usage ────────────────────────────────────
/** Window size assumed until a transcript proves otherwise. Transcripts never
 *  state the model's context limit, so this is the floor, not the truth. */
export const DEFAULT_MAX_CONTEXT_TOKENS = 200_000;
/** Known window sizes, ascending. The smallest tier that fits the largest
 *  context observed so far wins; beyond the last tier we round up to a whole
 *  multiple of it, so an unknown future window still reads under 100%. */
export const CONTEXT_WINDOW_TIERS = [200_000, 1_000_000] as const;
/** How much of a transcript's tail to read when seeding an agent's context on
 *  adoption or restore. Comfortably more than one turn's worth of records. */
export const CONTEXT_SEED_TAIL_BYTES = 256 * 1024;

// ── Global Session Scanning ─────────────────────────────────
/** Only adopt global JSONL files larger than this (filters out empty/init-only sessions) */
export const GLOBAL_SCAN_ACTIVE_MIN_SIZE = 3_072; // 3KB
/** Only adopt global JSONL files modified within this window */
export const GLOBAL_SCAN_ACTIVE_MAX_AGE_MS = 600_000; // 10 minutes

// ── Display Truncation + Pixel Agents Server paths ──────────
// Centralized in core/src/constants.ts; re-exported here for back-compat.
export {
  BASH_COMMAND_DISPLAY_MAX_LENGTH,
  HOOK_API_PREFIX,
  HOOK_SCRIPTS_DIR,
  SERVER_JSON_DIR,
  SERVER_JSON_NAME,
  TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
} from '../../core/src/constants.js';

// ── Multi-Server Discovery ──────────────────────────────────
/** Subdirectory (under SERVER_JSON_DIR) holding one registry entry per live
 *  server, so a hook event can fan out to every running instance instead of
 *  only the single legacy server.json pointer. See server/src/server.ts. */
export const SERVERS_DIR = 'servers';
/** Valid explicit TCP port range. Port 0 remains an internal-only signal for
 *  OS-assigned ephemeral binding and is never accepted from persisted records
 *  or the CLI's --port option. */
export const MIN_PORT = 1;
export const MAX_PORT = 65_535;
/** Format version stamped on every registry entry (both the per-server records
 *  and the legacy server.json). Bump on breaking field changes; additive
 *  fields (servesSpa, protocol itself) don't require a bump -- readers already
 *  tolerate unknown/missing fields (see ServerConfig.debugLog precedent). */
export const SERVER_REGISTRY_PROTOCOL_VERSION = 1;

// ── WebSocket close codes (application range 4000-4999) ────
/** Embedded mode: Bearer token missing or wrong. */
export const WS_CLOSE_UNAUTHORIZED = 4001;
/** Standalone mode: the handshake's Origin is not this server's own origin.
 *  WebSocket connects bypass CORS, so this is the only thing standing between
 *  a drive-by web page and the privileged client-message channel. */
export const WS_CLOSE_FORBIDDEN_ORIGIN = 4003;

export const HOOK_EVENT_BUFFER_MS = 5_000;
/** Grace period after SessionEnd(reason=clear/resume) before triggering onSessionEnd.
 *  /clear and /resume fire SessionEnd then SessionStart within ms. This timeout is a
 *  safety net: if SessionStart never arrives (e.g. the CLI crashes mid-transition),
 *  the agent is cleaned up instead of staying as a zombie with pendingClear forever. */
export const SESSION_END_GRACE_MS = 2000;
export const MAX_HOOK_BODY_SIZE = 65_536; // 64KB

// ── Layout/Config Persistence ──────────────────────────────
export const LAYOUT_FILE_DIR = '.pixel-agents';
export const LAYOUT_FILE_NAME = 'layout.json';
export const LAYOUT_FILE_POLL_INTERVAL_MS = 2000;
export const LAYOUT_REVISION_KEY = 'layoutRevision';
export const CONFIG_FILE_NAME = 'config.json';
/** Multiplayer relay settings, hand-written (see getMultiplayerSettings). */
export const MULTIPLAYER_FILE_NAME = 'multiplayer.json';

// ── Avatar Customization ────────────────────────────────────
/** Number of pre-colored bundled character palettes (char_0.png–char_5.png).
 *  Mirrors `PALETTE_COUNT` in webview-ui/src/constants.ts; kept separate
 *  because the server has no DOM/sprite access and cannot import the webview
 *  constant. The two values must stay in sync. */
export const PALETTE_COUNT = 6;
/** Inclusive upper bound for a valid agent hue shift, in degrees. Used by
 *  clientMessageHandler to guard saveAgentSeats payloads from a remote or
 *  hand-edited source corrupting the stored values with out-of-range values. */
export const HUE_SHIFT_MAX_DEG = 360;

// ── Multiplayer (relay sync of agent state between offices) ─
/** Relay wire-protocol version. Bump on breaking changes to the relay frames. */
export const MULTIPLAYER_PROTOCOL_VERSION = 1;
/** Default port for `pixel-agents relay`. */
export const MULTIPLAYER_RELAY_DEFAULT_PORT = 4100;
/** Largest relay frame accepted, in bytes — a full snapshot is a few hundred. */
export const MULTIPLAYER_MAX_FRAME_BYTES = 16_384;
/** Peers allowed in one room; the relay refuses the next join. */
export const MULTIPLAYER_MAX_PEERS_PER_ROOM = 32;
/** Agents published per peer; extras are dropped, never relayed. */
export const MULTIPLAYER_MAX_AGENTS_PER_PEER = 32;
/** Longest display name / room name kept after sanitizing. */
export const MULTIPLAYER_MAX_NAME_LENGTH = 32;
export const MULTIPLAYER_MAX_ROOM_LENGTH = 64;
/** Longest relay address the join screen accepts. */
export const MULTIPLAYER_MAX_RELAY_URL_LENGTH = 512;
/** Coalesce bursts of local state changes into one publish. */
export const MULTIPLAYER_PUBLISH_DEBOUNCE_MS = 150;
/** Relay: state frames allowed per peer per second before frames are dropped. */
export const MULTIPLAYER_MAX_FRAMES_PER_SEC = 20;
/** Longest chat message kept after sanitizing, in characters. */
export const MULTIPLAYER_MAX_CHAT_LENGTH = 280;
/** Relay: chat messages allowed per peer per window; extras are dropped. */
export const MULTIPLAYER_MAX_CHATS_PER_WINDOW = 5;
export const MULTIPLAYER_CHAT_WINDOW_MS = 10_000;
/** Chat messages a peer keeps in memory for webview reloads (never persisted). */
export const MULTIPLAYER_CHAT_HISTORY_LIMIT = 100;
/** Shared room layout: the only frame allowed past MULTIPLAYER_MAX_FRAME_BYTES. */
export const MULTIPLAYER_MAX_LAYOUT_BYTES = 512 * 1024;
/** Office: minimum gap between two layout frames it sends (it holds the newest back). */
export const MULTIPLAYER_LAYOUT_MIN_INTERVAL_MS = 300;
/** An older relay drops layout frames closer than this, so a room's creator on one keeps to it. */
export const MULTIPLAYER_LEGACY_LAYOUT_INTERVAL_MS = 1000;
/** Relay: layout edits accepted per peer per window; extras are refused and the office retries. */
export const MULTIPLAYER_MAX_LAYOUTS_PER_WINDOW = 8;
export const MULTIPLAYER_LAYOUT_WINDOW_MS = 2000;
/** Longest id a page may give one of its edits of the room's map. */
export const MULTIPLAYER_MAX_EDIT_ID_LENGTH = 64;
/** Relay: a room's map is written to disk this long after its last edit (one write per burst). */
export const MULTIPLAYER_ROOM_SAVE_DEBOUNCE_MS = 2000;
/** Relay: room maps kept on disk; the least recently edited are forgotten first. */
export const MULTIPLAYER_MAX_SAVED_ROOMS = 500;
/** Relay: folder under ~/.pixel-agents where `pixel-agents relay` keeps room maps by default. */
export const MULTIPLAYER_RELAY_ROOMS_DIR_NAME = 'relay-rooms';
/** Sanity bounds on a relayed layout (mirror the webview's MAX_COLS/MAX_ROWS). */
export const MULTIPLAYER_MAX_LAYOUT_DIM = 64;
/** A building's levels stand side by side in one grid, a column apart (mirror the
 *  webview's MAX_LEVELS): the grid may be that many levels wide. */
export const MULTIPLAYER_MAX_LEVELS = 8;
export const MULTIPLAYER_MAX_LAYOUT_COLS =
  MULTIPLAYER_MAX_LEVELS * (MULTIPLAYER_MAX_LAYOUT_DIM + 1);
export const MULTIPLAYER_MAX_LEVEL_NAME_LENGTH = 24;
export const MULTIPLAYER_MAX_LAYOUT_FURNITURE = 2000;
/** Longest furniture uid / type id / seat id kept when relaying. */
export const MULTIPLAYER_MAX_ID_LENGTH = 128;
/** Where the last name/room typed on the join screen is remembered. */
export const MULTIPLAYER_PROFILE_FILE_NAME = 'multiplayer-profile.json';
/** Relay: ping interval; a peer that misses one pong is dropped. */
export const MULTIPLAYER_HEARTBEAT_MS = 30_000;
/** Client reconnect backoff (doubles from min up to max). */
export const MULTIPLAYER_RECONNECT_MIN_MS = 1_000;
export const MULTIPLAYER_RECONNECT_MAX_MS = 30_000;
/** WebSocket close codes the relay uses (application range). */
export const MULTIPLAYER_CLOSE_BAD_HELLO = 4400;
export const MULTIPLAYER_CLOSE_ROOM_FULL = 4409;
/** Profile (look, status, desk decoration, shared song) sanity bounds, relay and peers alike. */
export const MULTIPLAYER_MAX_STATUS_LENGTH = 60;
export const MULTIPLAYER_MAX_DECOR_ITEMS = 12;
/** Decoration sits at most this many tiles from the desk's chair, in each axis. */
export const MULTIPLAYER_DECOR_MAX_OFFSET = 3;
/** Swatch indexes an avatar look may carry (-1 = the sprite's own colors). */
export const MULTIPLAYER_MAX_SWATCH_INDEX = 63;
/** Longest song title / artist kept. */
export const MULTIPLAYER_MAX_TRACK_TEXT = 100;
/** Rooms whose last desk the profile remembers (the oldest is forgotten first). */
export const MULTIPLAYER_MAX_REMEMBERED_DESKS = 20;

// ── Meetings (video calls inside a room) ─────────────────────
/** A signal frame carries an SDP offer: several m-lines once screens are shared. */
export const MULTIPLAYER_MAX_SIGNAL_BYTES = 64 * 1024;
export const MEETING_MAX_SDP_LENGTH = 60_000;
export const MEETING_MAX_ICE_CANDIDATE_LENGTH = 2_048;
/** Meeting notes are the largest meeting event. */
export const MULTIPLAYER_MAX_MEET_FRAME_BYTES = 32 * 1024;
/** Relay: WebRTC signals per peer per window (a negotiation is an offer, an answer and a few dozen candidates). */
export const MULTIPLAYER_MAX_SIGNALS_PER_WINDOW = 400;
export const MULTIPLAYER_SIGNAL_WINDOW_MS = 10_000;
/** Relay: meeting events (chat, reactions, captions, notes) per peer per window. */
export const MULTIPLAYER_MAX_MEET_EVENTS_PER_WINDOW = 40;
export const MULTIPLAYER_MEET_WINDOW_MS = 10_000;
export const MEETING_MAX_ID_LENGTH = 64;
export const MEETING_MAX_TITLE_LENGTH = 60;
export const MEETING_MAX_SCREENS = 4;
export const MEETING_MAX_SCREEN_LABEL_LENGTH = 60;
export const MEETING_MAX_CHAT_LENGTH = 500;
export const MEETING_MAX_CAPTION_LENGTH = 500;
export const MEETING_MAX_NOTES_LENGTH = 8_000;
export const MEETING_MAX_TRACK_ID_LENGTH = 32;
export const MEETING_MAX_ICE_SERVERS = 8;
/** The webview re-sends its presence every 5 s; three misses and the call is left (a closed tab). */
export const MEETING_PRESENCE_TTL_MS = 16_000;
/** Meeting notes: `claude -p` gets this long, and at most this much transcript. */
export const MEETING_NOTES_TIMEOUT_MS = 180_000;
export const MEETING_NOTES_MAX_INPUT_CHARS = 400_000;
/** Notes and transcripts are saved under ~/.pixel-agents/<this>/. */
export const MEETING_NOTES_DIR = 'meetings';
/** Set in the environment of the `claude -p` that writes notes: the hook script
 *  stays quiet, so that session never shows up as an agent in the office. */
export const PIXEL_AGENTS_SKIP_HOOK_ENV = 'PIXEL_AGENTS_SKIP_HOOK';

// ── Games (Pixel Frag matches inside a room) ─────────────────
/** A `play` frame is a few dozen bytes, except the office map a host sends a newcomer. */
export const MULTIPLAYER_MAX_PLAY_FRAME_BYTES = 64 * 1024;
/** Relay: match frames per peer per window. A player sends ~15 positions a second
 *  plus its hits; a host adds ~10 bot updates. Extras are dropped. */
export const MULTIPLAYER_MAX_PLAY_FRAMES_PER_WINDOW = 80;
export const MULTIPLAYER_PLAY_WINDOW_MS = 1_000;
/** The webview re-sends its match presence every 5 s; three misses and it left the match (a closed tab). */
export const GAME_PRESENCE_TTL_MS = 16_000;
export const GAME_MAX_ID_LENGTH = 64;
export const GAME_MAX_TITLE_LENGTH = 60;
/** Pixel Frag bounds, relay and peers alike (mirror webview-ui/src/constants.ts FPS_*). */
export const FPS_MAX_BOTS = 8;
export const FPS_MAX_FRAG_LIMIT = 100;
export const FPS_MAX_TIME_LIMIT_MIN = 60;
/** An office floor (at most 64 tiles a side) plus the wall put round it. */
export const FPS_MAX_MAP_DIM = 66;
export const FPS_MAX_MAP_SURFACES = 26;
export const FPS_MAX_MAP_BLOCKS = 10;
export const FPS_MAX_MAP_PROPS = 400;
export const FPS_MAX_MAP_SPAWNS = 32;
export const FPS_MAX_MAP_ITEMS = 32;
export const FPS_MAX_BLOCK_HEIGHT = 0.45;
export const FPS_MAX_HP = 200;
export const FPS_MAX_WEAPON_SLOT = 8;

// ── Calendar integration ─────────────────────────────────────
/** Secret iCal feed URLs live here, mode 0600 (a feed URL is a read credential). */
export const CALENDAR_FILE_NAME = 'calendar.json';
export const CALENDAR_MAX_FEEDS = 5;
/** How often the feeds are fetched again. */
export const CALENDAR_SYNC_INTERVAL_MS = 5 * 60_000;
/** How often "is a meeting in progress?" is re-evaluated between syncs. */
export const CALENDAR_TICK_MS = 30_000;
/** Events shown: from now (plus the ones still in progress) up to this far ahead. */
export const CALENDAR_WINDOW_MS = 24 * 60 * 60_000;
export const CALENDAR_MAX_EVENTS = 50;
export const CALENDAR_FETCH_TIMEOUT_MS = 15_000;
/** A feed bigger than this is refused rather than parsed. */
export const CALENDAR_MAX_FEED_BYTES = 10 * 1024 * 1024;
/** Recurring events: occurrences generated per series before giving up. */
export const CALENDAR_MAX_OCCURRENCES = 2000;

// ── Spotify integration ──────────────────────────────────────
/** Access + refresh tokens live here, mode 0600. */
export const SPOTIFY_FILE_NAME = 'spotify.json';
/** Fixed loopback port for the OAuth redirect: Spotify needs the exact redirect URI registered in the app, so it
 *  cannot follow the server's (ephemeral) port. Only listening while a sign-in is in progress. */
export const SPOTIFY_CALLBACK_PORT = 43117;
export const SPOTIFY_CALLBACK_PATH = '/spotify/callback';
/** A sign-in not completed within this long is abandoned (the callback listener closes). */
export const SPOTIFY_AUTH_TIMEOUT_MS = 5 * 60_000;
/** How often "what is playing" is asked while connected. */
export const SPOTIFY_POLL_MS = 10_000;
export const SPOTIFY_FETCH_TIMEOUT_MS = 10_000;
export const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
];
/** The loopback page the Spotify sign-in lands on (dark, like the office). */
export const SPOTIFY_CALLBACK_PAGE_STYLE = 'font-family:sans-serif;padding:40px;color-scheme:dark';
