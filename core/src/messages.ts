/**
 * AUTO-GENERATED FROM core/asyncapi.yaml. DO NOT EDIT MANUALLY.
 *
 * Run `npm run asyncapi:generate` to regenerate.
 *
 * Source of truth: the yaml at core/asyncapi.yaml.
 * Editors and clients in any language can consume the spec directly.
 */

export type ServerMessage =
  | ProviderCapabilities
  | AgentCreated
  | AgentClosed
  | AgentSelected
  | ExistingAgents
  | AgentStatus
  | AgentToolStart
  | AgentToolDone
  | AgentToolsClear
  | AgentToolPermission
  | AgentToolPermissionClear
  | SubagentToolStart
  | SubagentToolDone
  | SubagentClear
  | SubagentToolPermission
  | AgentTeamInfo
  | AgentContextUsage
  | RemotePeers
  | ChatMessage
  | ChatHistory
  | MultiplayerStatus
  | RoomLayout
  | RoomLayoutRejected
  | ProfileLoaded
  | MeetingSignal
  | MeetingEvent
  | MeetingNotesResult
  | CalendarState
  | SpotifyStatus
  | OpenExternalUrl
  | OfficeInBrowser
  | LayoutLoaded
  | FurnitureAssetsLoaded
  | CharacterSpritesLoaded
  | PetSpritesLoaded
  | FloorTilesLoaded
  | WallTilesLoaded
  | CarpetTilesLoaded
  | SettingsLoaded
  | HooksStatus
  | HooksConsentRequest
  | ExternalAssetDirectoriesUpdated
  | AreaMappingsLoaded
  | WorkspaceFolders
  | AgentDiagnostics;

export type ClientMessage =
  | WebviewReady
  | LaunchAgent
  | FocusAgent
  | CloseAgent
  | SaveAgentSeats
  | SaveLayout
  | SetSoundEnabled
  | SetLastSeenVersion
  | SetAlwaysShowLabels
  | SetGhostHeadlessAgents
  | SetHooksEnabled
  | HooksConsentResponse
  | SetHooksInfoShown
  | SetWatchAllSessions
  | ExportLayout
  | ImportLayout
  | OpenSessionsFolder
  | AddExternalAssetDirectory
  | RemoveExternalAssetDirectory
  | SaveAreaMappings
  | SetShowAreas
  | RequestDiagnostics
  | SendChat
  | JoinRoom
  | LeaveRoom
  | PresenceUpdate
  | SaveRoomLayout
  | UpdateProfile
  | ConfigureCalendar
  | SpotifyCommand
  | OpenExternal
  | CopyWebLink
  | UpdateMeetingPresence
  | SendMeetingSignal
  | SendMeetingEvent
  | GenerateMeetingNotes;

export interface ProviderCapabilities {
  type: 'providerCapabilities';
  readingTools: string[];
  subagentToolNames: string[];
}

export interface AgentCreated {
  type: 'agentCreated';
  id: number;
  folderName?: string;
  isExternal?: boolean;
  palette?: number;
  hueShift?: number;
}

export interface AgentClosed {
  type: 'agentClosed';
  id: number;
}

export interface AgentSelected {
  type: 'agentSelected';
  id: number;
}

export interface ExistingAgents {
  type: 'existingAgents';
  agents: number[];
  agentMeta: Record<string, AgentSeatMeta>;
  folderNames: Record<string, string>;
  externalAgents: Record<string, boolean>;
}

export interface AgentSeatMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

export interface AgentStatus {
  type: 'agentStatus';
  id: number;
  status: AgentActivityStatus;
  awaitingInput?: boolean;
}

export type AgentActivityStatus = 'active' | 'waiting';

export interface AgentToolStart {
  type: 'agentToolStart';
  id: number;
  toolId: string;
  status: string;
  toolName?: string;
  permissionActive?: boolean;
  runInBackground?: boolean;
  isTeammateSpawn?: boolean;
}

export interface AgentToolDone {
  type: 'agentToolDone';
  id: number;
  toolId: string;
}

export interface AgentToolsClear {
  type: 'agentToolsClear';
  id: number;
}

export interface AgentToolPermission {
  type: 'agentToolPermission';
  id: number;
}

export interface AgentToolPermissionClear {
  type: 'agentToolPermissionClear';
  id: number;
}

export interface SubagentToolStart {
  type: 'subagentToolStart';
  id: number;
  parentToolId: string;
  toolId: string;
  status: string;
}

export interface SubagentToolDone {
  type: 'subagentToolDone';
  id: number;
  parentToolId: string;
  toolId: string;
}

export interface SubagentClear {
  type: 'subagentClear';
  id: number;
  parentToolId: string;
}

export interface SubagentToolPermission {
  type: 'subagentToolPermission';
  id: number;
  parentToolId: string;
}

export interface AgentTeamInfo {
  type: 'agentTeamInfo';
  id: number;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}

export interface AgentContextUsage {
  type: 'agentContextUsage';
  id: number;
  contextTokens: number;
  maxContextTokens: number;
}

export interface RemotePeers {
  type: 'remotePeers';
  peers: RemotePeer[];
}

export interface RemotePeer {
  peerId: string;
  name: string;
  agents: RemoteAgent[];
  desk?: string | null;
  since?: number;
  profile?: PeerProfile;
  meeting?: MeetingPresence;
}

export interface RemoteAgent {
  id: number;
  palette: number;
  hueShift: number;
  status: AgentActivityStatus;
  activity: RemoteActivity | null;
  permission: boolean;
  awaitingInput: boolean;
  isAvatar?: boolean;
  pose?: RemotePose;
}

export type RemoteActivity = 'typing' | 'reading';

export interface RemotePose {
  x: number;
  y: number;
  dir: number;
  state: RemotePoseState;
  emote?: RemoteEmote | null;
  emoteSeq?: number;
}

export type RemotePoseState = 'idle' | 'walk' | 'type' | 'read';

export type RemoteEmote = 'dance' | 'jump' | 'spin' | 'wave' | 'heart' | 'clap' | 'laugh' | 'party';

export interface PeerProfile {
  look?: AvatarLook;
  status?: PersonStatus;
  statusText?: string;
  music?: SharedTrack | null;
  decor?: DeskDecorItem[];
  deskStyle?: string;
  hidden?: string[];
}

export interface AvatarLook {
  body: number;
  hair: number;
  top: number;
  bottom: number;
  accessory: AvatarAccessory;
}

export type AvatarAccessory =
  | 'none'
  | 'cap'
  | 'beanie'
  | 'tophat'
  | 'crown'
  | 'partyhat'
  | 'headphones'
  | 'glasses'
  | 'sunglasses'
  | 'flower'
  | 'bow'
  | 'halo';

export type PersonStatus = 'available' | 'busy' | 'meeting' | 'away';

export interface SharedTrack {
  title: string;
  artist: string;
  trackUrl?: string;
}

export interface DeskDecorItem {
  type: string;
  dc: number;
  dr: number;
  px?: number;
  py?: number;
}

export interface MeetingPresence {
  id: string;
  title: string;
  since: number;
  mic: boolean;
  cam: boolean;
  stream?: string;
  screens: MeetingScreen[];
  hand: boolean;
  handAt?: number;
  rec: boolean;
  captions: boolean;
  transcribe?: MeetingSwitch;
  music?: MeetingMusic;
}

export interface MeetingScreen {
  stream: string;
  label?: string;
  audio?: boolean;
}

export interface MeetingSwitch {
  on: boolean;
  at: number;
}

export interface MeetingMusic {
  track: string;
  at: number;
}

export interface ChatMessage {
  type: 'chatMessage';
  message: ChatEntry;
}

export interface ChatEntry {
  peerId: string;
  name: string;
  text: string;
  ts: number;
  self: boolean;
}

export interface ChatHistory {
  type: 'chatHistory';
  messages: ChatEntry[];
}

export interface MultiplayerStatus {
  type: 'multiplayerStatus';
  available: boolean;
  joined: boolean;
  connected: boolean;
  room: string;
  name: string;
  relayUrl: string;
  layoutOwner: boolean;
  since?: number;
  peerId?: string;
  clockOffset?: number;
  iceServers?: IceServer[];
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface RoomLayout {
  type: 'roomLayout';
  layout: Record<string, any> | null;
  editable: boolean;
  rev?: number;
  editId?: string;
}

export interface RoomLayoutRejected {
  type: 'roomLayoutRejected';
  editId: string;
  rev: number;
  reason: RoomLayoutRejectReason;
}

export type RoomLayoutRejectReason =
  'stale' | 'busy' | 'replaced' | 'offline' | 'invalid' | 'forbidden';

export interface ProfileLoaded {
  type: 'profileLoaded';
  desk: string | null;
  look: AvatarLook | null;
  status: PersonStatus;
  statusText: string;
  decor: DeskDecorItem[];
  shareMusic: boolean;
  deskStyle: string | null;
  hidden: string[];
}

export interface MeetingSignal {
  type: 'meetingSignal';
  from: string;
  data: MeetingSignalData;
}

export interface MeetingSignalData {
  kind: MeetingSignalKind;
  sid: number;
  tsid: number;
  description?: MeetingSdp;
  candidate?: MeetingIceCandidate;
  meetingId?: string;
  title?: string;
}

export type MeetingSignalKind = 'sdp' | 'ice' | 'invite';

export interface MeetingSdp {
  type: MeetingSdpType;
  sdp: string;
}

export type MeetingSdpType = 'offer' | 'answer' | 'pranswer' | 'rollback';

export interface MeetingIceCandidate {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  usernameFragment?: string;
}

export interface MeetingEvent {
  type: 'meetingEvent';
  from: string;
  name: string;
  meetingId: string;
  ts: number;
  self: boolean;
  event: MeetingEventBody;
}

export interface MeetingEventBody {
  kind: MeetingEventKind;
  text: string;
}

export type MeetingEventKind = 'chat' | 'reaction' | 'caption' | 'notes';

export interface MeetingNotesResult {
  type: 'meetingNotesResult';
  requestId: string;
  ok: boolean;
  text?: string;
  savedTo?: string;
  error?: string;
}

export interface CalendarState {
  type: 'calendarState';
  feeds: CalendarFeedInfo[];
  events: CalendarEvent[];
  autoStatus: boolean;
  inMeeting: boolean;
  syncedAt?: number;
  error?: string;
}

export interface CalendarFeedInfo {
  id: string;
  label: string;
  ok: boolean;
  error?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  joinUrl?: string;
  location?: string;
}

export interface SpotifyStatus {
  type: 'spotifyStatus';
  clientId: string;
  redirectUri: string;
  connected: boolean;
  pendingAuth: boolean;
  nowPlaying: SpotifyTrack | null;
  error?: string;
}

export interface SpotifyTrack {
  title: string;
  artist: string;
  album?: string;
  isPlaying: boolean;
  trackUrl?: string;
  progressMs?: number;
  durationMs?: number;
}

export interface OpenExternalUrl {
  type: 'openExternalUrl';
  url: string;
}

export interface OfficeInBrowser {
  type: 'officeInBrowser';
  open: boolean;
}

export interface LayoutLoaded {
  type: 'layoutLoaded';
  layout: Record<string, any> | null;
  wasReset?: boolean;
}

export interface FurnitureAssetsLoaded {
  type: 'furnitureAssetsLoaded';
  catalog: FurnitureAssetMessage[];
  sprites: Record<string, string[][]>;
}

export interface FurnitureAssetMessage {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

export interface CharacterSpritesLoaded {
  type: 'characterSpritesLoaded';
  characters: CharacterSpriteSet[];
}

export interface CharacterSpriteSet {
  down: string[][][];
  up: string[][][];
  right: string[][][];
}

export interface PetSpritesLoaded {
  type: 'petSpritesLoaded';
  pets: PetSpriteFrameSet[];
  petNames: string[];
}

export interface PetSpriteFrameSet {
  walkDown: string[][][];
  idleDown: string[][][];
  walkUp: string[][][];
  idleUp: string[][][];
  walkRight: string[][][];
}

export interface FloorTilesLoaded {
  type: 'floorTilesLoaded';
  sprites: string[][][];
}

export interface WallTilesLoaded {
  type: 'wallTilesLoaded';
  sets: string[][][][];
}

export interface CarpetTilesLoaded {
  type: 'carpetTilesLoaded';
  sets: string[][][][];
}

export interface SettingsLoaded {
  type: 'settingsLoaded';
  soundEnabled: boolean;
  lastSeenVersion: string;
  extensionVersion: string;
  watchAllSessions: boolean;
  alwaysShowLabels: boolean;
  ghostHeadlessAgents: boolean;
  hooksEnabled: boolean;
  hooksInfoShown: boolean;
  externalAssetDirectories: string[];
  showAreas: boolean;
}

export interface HooksStatus {
  type: 'hooksStatus';
  providerId: string;
  installed: boolean;
}

export interface HooksConsentRequest {
  type: 'hooksConsentRequest';
  providerId: string;
  headline: string;
  disclosure: string;
}

export interface ExternalAssetDirectoriesUpdated {
  type: 'externalAssetDirectoriesUpdated';
  dirs: string[];
}

export interface AreaMappingsLoaded {
  type: 'areaMappingsLoaded';
  mappings: Record<string, string[]>;
}

export interface WorkspaceFolders {
  type: 'workspaceFolders';
  folders: WorkspaceFolder[];
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

export interface AgentDiagnostics {
  type: 'agentDiagnostics';
  agents: Record<string, any>[];
}

export interface WebviewReady {
  type: 'webviewReady';
}

export interface LaunchAgent {
  type: 'launchAgent';
  folderPath?: string;
  bypassPermissions?: boolean;
}

export interface FocusAgent {
  type: 'focusAgent';
  id: number;
}

export interface CloseAgent {
  type: 'closeAgent';
  id: number;
}

export interface SaveAgentSeats {
  type: 'saveAgentSeats';
  seats: Record<string, SeatAssignment>;
}

export interface SeatAssignment {
  palette: number;
  hueShift: number;
  seatId: string | null;
}

export interface SaveLayout {
  type: 'saveLayout';
  layout: Record<string, any>;
}

export interface SetSoundEnabled {
  type: 'setSoundEnabled';
  enabled: boolean;
}

export interface SetLastSeenVersion {
  type: 'setLastSeenVersion';
  version: string;
}

export interface SetAlwaysShowLabels {
  type: 'setAlwaysShowLabels';
  enabled: boolean;
}

export interface SetGhostHeadlessAgents {
  type: 'setGhostHeadlessAgents';
  enabled: boolean;
}

export interface SetHooksEnabled {
  type: 'setHooksEnabled';
  providerId: string;
  enabled: boolean;
}

export interface HooksConsentResponse {
  type: 'hooksConsentResponse';
  providerId: string;
  choice: HooksConsentChoice;
}

export type HooksConsentChoice = 'install' | 'notNow' | 'never';

export interface SetHooksInfoShown {
  type: 'setHooksInfoShown';
}

export interface SetWatchAllSessions {
  type: 'setWatchAllSessions';
  enabled: boolean;
}

export interface ExportLayout {
  type: 'exportLayout';
}

export interface ImportLayout {
  type: 'importLayout';
}

export interface OpenSessionsFolder {
  type: 'openSessionsFolder';
}

export interface AddExternalAssetDirectory {
  type: 'addExternalAssetDirectory';
  path?: string;
}

export interface RemoveExternalAssetDirectory {
  type: 'removeExternalAssetDirectory';
  path: string;
}

export interface SaveAreaMappings {
  type: 'saveAreaMappings';
  mappings: Record<string, string[]>;
}

export interface SetShowAreas {
  type: 'setShowAreas';
  enabled: boolean;
}

export interface RequestDiagnostics {
  type: 'requestDiagnostics';
}

export interface SendChat {
  type: 'sendChat';
  text: string;
}

export interface JoinRoom {
  type: 'joinRoom';
  name: string;
  room: string;
  relayUrl?: string;
}

export interface LeaveRoom {
  type: 'leaveRoom';
}

export interface PresenceUpdate {
  type: 'presenceUpdate';
  characters: PresenceCharacter[];
  desk: string | null;
}

export interface PresenceCharacter {
  id: number;
  isAvatar: boolean;
  palette?: number;
  hueShift?: number;
  pose: RemotePose;
}

export interface SaveRoomLayout {
  type: 'saveRoomLayout';
  layout: Record<string, any>;
  base: number;
  editId: string;
}

export interface UpdateProfile {
  type: 'updateProfile';
  look?: AvatarLook | null;
  status?: PersonStatus;
  statusText?: string;
  decor?: DeskDecorItem[];
  shareMusic?: boolean;
  deskStyle?: string | null;
  hidden?: string[];
}

export interface ConfigureCalendar {
  type: 'configureCalendar';
  addFeed?: string;
  removeFeed?: string;
  autoStatus?: boolean;
  refresh?: boolean;
}

export interface SpotifyCommand {
  type: 'spotifyCommand';
  action: SpotifyAction;
  clientId?: string;
}

export type SpotifyAction =
  'connect' | 'disconnect' | 'play' | 'pause' | 'next' | 'previous' | 'refresh';

export interface OpenExternal {
  type: 'openExternal';
  url: string;
}

export interface CopyWebLink {
  type: 'copyWebLink';
}

export interface UpdateMeetingPresence {
  type: 'updateMeetingPresence';
  meeting: MeetingPresence | null;
}

export interface SendMeetingSignal {
  type: 'sendMeetingSignal';
  to: string;
  data: MeetingSignalData;
}

export interface SendMeetingEvent {
  type: 'sendMeetingEvent';
  event: MeetingEventBody;
}

export interface GenerateMeetingNotes {
  type: 'generateMeetingNotes';
  requestId: string;
  title: string;
  transcript: MeetingLine[];
  chat: MeetingLine[];
}

export interface MeetingLine {
  name: string;
  text: string;
  ts: number;
}
