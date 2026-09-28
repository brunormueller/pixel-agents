// webview-ui/src/meeting/useMeeting.ts
//
// The meeting controller: joins and leaves calls, owns the person's devices,
// the WebRTC mesh, recording, transcription and the soundtrack, and turns the
// room's presences and meeting events into what the meeting UI renders.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  MeetingMusic,
  MeetingPresence,
  MeetingSignalData,
  MeetingSwitch,
  MultiplayerStatus,
  RemotePeer,
  ServerMessage,
} from '../../../core/src/messages.js';
import {
  MEETING_CAPTION_MAX_LENGTH,
  MEETING_CHAT_MAX_LENGTH,
  MEETING_DEFAULT_ICE_SERVERS,
  MEETING_MAX_SCREENS,
  MEETING_MUSIC_DEFAULT_VOLUME,
  MEETING_PRESENCE_HEARTBEAT_MS,
  MEETING_REACTION_FLOAT_MS,
  MEETING_TITLE_MAX_LENGTH,
} from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { transport } from '../transport/index.js';
import type { DeviceChoice, MediaSupport } from './media.js';
import {
  downloadBlob,
  loadDeviceChoice,
  mediaErrorText,
  mediaSupport,
  openCamera,
  openMic,
  openScreen,
  saveDeviceChoice,
  SpeakingMeter,
} from './media.js';
import type { LocalMedia } from './mesh.js';
import { MeshSession } from './mesh.js';
import type { MeetingLine, Participant, Reaction, RoomMeeting, TileInfo } from './model.js';
import {
  defaultMeetingTitle,
  latest,
  meetingFileName,
  meetingTiles,
  newMeetingId,
  REACTION_EMOTES,
  roomMeetings,
  transcriptMarkdown,
} from './model.js';
import { MeetingMusic as MusicEngine } from './music.js';
import type { RecordingSource } from './recorder.js';
import { MeetingRecorder } from './recorder.js';
import { Transcriber } from './transcriber.js';

export interface LocalScreen {
  stream: MediaStream;
  audio: boolean;
}

export interface FloatingReaction {
  key: number;
  peerId: string;
  emoji: string;
  at: number;
}

export interface MeetingInvite {
  from: string;
  name: string;
  meetingId: string;
  title: string;
  at: number;
}

export interface MeetingNotes {
  text: string;
  by: string;
  ts: number;
  /** Where this office saved them (only on the office that asked Claude). */
  savedTo?: string;
}

/** 'ask' until the person answers the transcription prompt for this meeting. */
export type CaptionsChoice = 'ask' | 'yes' | 'no';

export interface MeetingController {
  /** In a room with a live relay connection: meetings are possible. */
  available: boolean;
  support: MediaSupport;
  selfPeerId: string;
  meetings: RoomMeeting[];
  /** The meeting this office is in, as the room sees it. */
  current: RoomMeeting | null;
  others: Participant[];
  tiles: TileInfo[];
  micOn: boolean;
  camOn: boolean;
  hand: boolean;
  screens: LocalScreen[];
  /** Resolve the stream a tile shows. Changes identity when streams change. */
  streamFor: (tile: TileInfo) => MediaStream | null;
  /** Every remote stream carrying audio (for the hidden players), keyed `${peerId}:${streamId}`. */
  audioStreams: Array<{ key: string; stream: MediaStream }>;
  peerStates: Record<string, RTCPeerConnectionState>;
  speaking: ReadonlySet<string>;
  chat: MeetingLine[];
  transcript: MeetingLine[];
  interim: string;
  notes: MeetingNotes[];
  notesPending: boolean;
  reactions: FloatingReaction[];
  invites: MeetingInvite[];
  transcribeOn: boolean;
  captionsChoice: CaptionsChoice;
  transcriberRunning: boolean;
  transcribeSupported: boolean;
  transcriptLang: string;
  music: MeetingMusic | null;
  musicVolume: number;
  recordingSince: number | null;
  recordSupported: boolean;
  /** Who else is recording (names). */
  recorders: string[];
  devices: DeviceChoice;
  notice: string | null;
  relayNow: () => number;

  start: (title: string, opts: { mic: boolean; cam: boolean }) => void;
  join: (meetingId: string, opts: { mic: boolean; cam: boolean }) => void;
  leave: () => void;
  toggleMic: () => void;
  toggleCam: () => void;
  shareScreen: (audio: boolean) => void;
  stopScreen: (streamId: string) => void;
  toggleHand: () => void;
  react: (emoji: Reaction) => void;
  sendChat: (text: string) => void;
  setTranscription: (on: boolean) => void;
  answerCaptions: (yes: boolean) => void;
  setTranscriptLang: (lang: string) => void;
  generateNotes: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  setMusic: (track: string | null) => void;
  setMusicVolume: (volume: number) => void;
  invite: (peerId: string) => void;
  acceptInvite: (invite: MeetingInvite) => void;
  dismissInvite: (invite: MeetingInvite) => void;
  selectDevices: (choice: DeviceChoice) => void;
  downloadTranscript: () => void;
  clearNotice: () => void;
}

interface Joined {
  id: string;
  title: string;
  /** Relay clock at join: names this join (MeetingPresence.since). */
  sid: number;
}

const emptyLocal = (): LocalMedia => ({
  base: new MediaStream(),
  mic: null,
  cam: null,
  screens: [],
});

const LANG_KEY = 'pixelAgents.transcriptLang';
const VOLUME_KEY = 'pixelAgents.meetingMusicVolume';
const INVITE_TTL_MS = 60_000;

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private window */
  }
}

export function useMeeting(getOfficeState: () => OfficeState, selfName: string): MeetingController {
  const support = useMemo(() => mediaSupport(), []);
  const [status, setStatus] = useState<MultiplayerStatus | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [hand, setHand] = useState<{ up: boolean; at: number }>({ up: false, at: 0 });
  const [screens, setScreens] = useState<LocalScreen[]>([]);
  const [transcribeSwitch, setTranscribeSwitch] = useState<MeetingSwitch | undefined>();
  const [musicSwitch, setMusicSwitch] = useState<MeetingMusic | undefined>();
  const [captionsChoice, setCaptionsChoice] = useState<CaptionsChoice>('ask');
  const [transcriberRunning, setTranscriberRunning] = useState(false);
  const [interim, setInterim] = useState('');
  const [chat, setChat] = useState<MeetingLine[]>([]);
  const [transcript, setTranscript] = useState<MeetingLine[]>([]);
  const [notes, setNotes] = useState<MeetingNotes[]>([]);
  const [notesPending, setNotesPending] = useState(false);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [invites, setInvites] = useState<MeetingInvite[]>([]);
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(() => new Set());
  const [peerStates, setPeerStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [streamsVersion, setStreamsVersion] = useState(0);
  const [devices, setDevices] = useState<DeviceChoice>(() => loadDeviceChoice());
  const [notice, setNotice] = useState<string | null>(null);
  const [transcriptLang, setTranscriptLangState] = useState(
    () => readStored(LANG_KEY) ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US'),
  );
  const [musicVolume, setMusicVolumeState] = useState(() => {
    const v = Number(readStored(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : MEETING_MUSIC_DEFAULT_VOLUME;
  });

  // Imperative pieces.
  const localRef = useRef<LocalMedia>(null as unknown as LocalMedia);
  localRef.current ??= emptyLocal();
  const meshRef = useRef<MeshSession | null>(null);
  const remoteStreamsRef = useRef(new Map<string, Map<string, MediaStream>>());
  const meterRef = useRef<SpeakingMeter | null>(null);
  const transcriberRef = useRef<Transcriber | null>(null);
  const recorderRef = useRef<MeetingRecorder | null>(null);
  const musicRef = useRef<MusicEngine | null>(null);
  const reactionKeyRef = useRef(0);
  /** Signals that arrived before this join's mesh existed. */
  const pendingSignalsRef = useRef<Array<{ from: string; data: MeetingSignalData }>>([]);
  const notesRequestRef = useRef<string | null>(null);
  const joinedRef = useRef<Joined | null>(null);
  joinedRef.current = joined;
  const statusRef = useRef<MultiplayerStatus | null>(null);
  statusRef.current = status;

  const selfPeerId = status?.peerId ?? '';
  const available = status?.joined === true && status.connected && selfPeerId !== '';
  const relayNow = useCallback(() => Date.now() + (statusRef.current?.clockOffset ?? 0), []);
  const say = useCallback((text: string) => {
    if (text) setNotice(text);
  }, []);

  // ── What this office publishes ──────────────────────────────
  const presence = useMemo<MeetingPresence | null>(() => {
    if (!joined) return null;
    const local = localRef.current;
    const p: MeetingPresence = {
      id: joined.id,
      title: joined.title,
      since: joined.sid,
      mic: micOn && local.mic !== null,
      cam: camOn && local.cam !== null,
      stream: local.base.id,
      screens: screens.map((s, i) => ({
        stream: s.stream.id,
        label: `${selfName || 'Screen'}${screens.length > 1 ? ` — screen ${i + 1}` : ' — screen'}`,
        ...(s.audio ? { audio: true } : {}),
      })),
      hand: hand.up,
      rec: recordingSince !== null,
      captions: transcriberRunning,
    };
    if (hand.up) p.handAt = hand.at;
    if (transcribeSwitch) p.transcribe = transcribeSwitch;
    if (musicSwitch) p.music = musicSwitch;
    return p;
  }, [
    joined,
    micOn,
    camOn,
    screens,
    hand,
    recordingSince,
    transcriberRunning,
    transcribeSwitch,
    musicSwitch,
    selfName,
  ]);

  const selfParticipant = useMemo<Participant | null>(
    () =>
      presence
        ? { peerId: selfPeerId || 'self', name: selfName || 'You', self: true, presence }
        : null,
    [presence, selfPeerId, selfName],
  );
  const meetings = useMemo(() => roomMeetings(selfParticipant, peers), [selfParticipant, peers]);
  const current = useMemo(
    () => (joined ? (meetings.find((m) => m.id === joined.id) ?? null) : null),
    [meetings, joined],
  );
  const others = useMemo(() => current?.participants.filter((p) => !p.self) ?? [], [current]);
  const tiles = useMemo(() => (current ? meetingTiles(current.participants) : []), [current]);
  const effectiveTranscribe = latest([
    transcribeSwitch,
    ...others.map((p) => p.presence.transcribe),
  ]);
  const effectiveMusic = latest([musicSwitch, ...others.map((p) => p.presence.music)]);
  const transcribeOn = effectiveTranscribe?.on === true;

  // Meeting-wide switches: take on the newest, so they outlive whoever set them.
  useEffect(() => {
    if (effectiveTranscribe && effectiveTranscribe !== transcribeSwitch) {
      if (JSON.stringify(effectiveTranscribe) !== JSON.stringify(transcribeSwitch)) {
        setTranscribeSwitch(effectiveTranscribe);
      }
    }
    if (effectiveMusic && JSON.stringify(effectiveMusic) !== JSON.stringify(musicSwitch)) {
      setMusicSwitch(effectiveMusic);
    }
  }, [effectiveTranscribe, effectiveMusic, transcribeSwitch, musicSwitch]);

  // Publish on every change, and keep it alive while in the call (the server
  // drops a presence nobody refreshes: that is how a closed tab leaves).
  const presenceJson = presence ? JSON.stringify(presence) : 'null';
  useEffect(() => {
    if (!presence) return; // leaving says so itself (leave())
    transport.send({ type: 'updateMeetingPresence', meeting: presence });
    const t = setInterval(
      () => transport.send({ type: 'updateMeetingPresence', meeting: presence }),
      MEETING_PRESENCE_HEARTBEAT_MS,
    );
    return () => clearInterval(t);
    // presenceJson stands for presence (a new object each render with the same content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceJson]);

  // ── Leaving ─────────────────────────────────────────────────
  const teardown = useCallback(() => {
    const title = joinedRef.current?.title ?? 'meeting';
    meshRef.current?.close();
    meshRef.current = null;
    const local = localRef.current;
    for (const t of local.base.getTracks()) t.stop();
    for (const s of local.screens) for (const t of s.getTracks()) t.stop();
    localRef.current = emptyLocal();
    joinedRef.current = null;
    pendingSignalsRef.current = [];
    remoteStreamsRef.current.clear();
    meterRef.current?.dispose();
    meterRef.current = null;
    transcriberRef.current?.stop();
    transcriberRef.current = null;
    musicRef.current?.stop();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder?.recording) {
      void recorder
        .stop()
        .then((blob) => downloadBlob(blob, meetingFileName(title, new Date(), 'webm')))
        .catch(() => {});
    }
    setJoined(null);
    setMicOn(false);
    setCamOn(false);
    setHand({ up: false, at: 0 });
    setScreens([]);
    setTranscribeSwitch(undefined);
    setMusicSwitch(undefined);
    setCaptionsChoice('ask');
    setTranscriberRunning(false);
    setInterim('');
    setRecordingSince(null);
    setSpeaking(new Set());
    setPeerStates({});
    setNotesPending(false);
    notesRequestRef.current = null;
    setStreamsVersion((v) => v + 1);
  }, []);

  const leave = useCallback(() => {
    if (!joinedRef.current) return;
    teardown();
    transport.send({ type: 'updateMeetingPresence', meeting: null });
  }, [teardown]);

  // Out of the room (left it, or the office went solo): out of the call too.
  useEffect(() => {
    if (joined && status && !status.joined) leave();
  }, [joined, status, leave]);

  // Closing the tab: say goodbye now rather than after the server's timeout.
  useEffect(() => {
    const bye = () => {
      if (joinedRef.current) transport.send({ type: 'updateMeetingPresence', meeting: null });
    };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  // ── Devices ─────────────────────────────────────────────────
  const pushLocal = useCallback(() => {
    meshRef.current?.setLocal(localRef.current);
    setStreamsVersion((v) => v + 1);
  }, []);

  const setMicTrack = useCallback(
    (track: MediaStreamTrack | null) => {
      const local = localRef.current;
      if (local.mic) {
        local.base.removeTrack(local.mic);
        local.mic.stop();
      }
      local.mic = track;
      if (track) local.base.addTrack(track);
      meterRef.current?.watch('self', track);
      pushLocal();
    },
    [pushLocal],
  );

  const setCamTrack = useCallback(
    (track: MediaStreamTrack | null) => {
      const local = localRef.current;
      if (local.cam) {
        local.base.removeTrack(local.cam);
        local.cam.stop();
      }
      local.cam = track;
      if (track) local.base.addTrack(track);
      pushLocal();
    },
    [pushLocal],
  );

  const enableMic = useCallback(async (): Promise<boolean> => {
    const local = localRef.current;
    if (local.mic && local.mic.readyState === 'live') {
      local.mic.enabled = true;
      return true;
    }
    if (!support.capture) return false;
    try {
      const track = await openMic(devices.mic);
      if (!joinedRef.current) {
        track.stop();
        return false;
      }
      setMicTrack(track);
      return true;
    } catch (err) {
      say(mediaErrorText(err, 'microphone'));
      return false;
    }
  }, [support.capture, devices.mic, setMicTrack, say]);

  const enableCam = useCallback(async (): Promise<boolean> => {
    if (!support.capture) return false;
    try {
      const track = await openCamera(devices.cam);
      if (!joinedRef.current) {
        track.stop();
        return false;
      }
      track.onended = () => {
        if (localRef.current.cam === track) {
          setCamTrack(null);
          setCamOn(false);
        }
      };
      setCamTrack(track);
      return true;
    } catch (err) {
      say(mediaErrorText(err, 'camera'));
      return false;
    }
  }, [support.capture, devices.cam, setCamTrack, say]);

  const toggleMic = useCallback(() => {
    if (!joinedRef.current) return;
    if (micOn) {
      // Muted keeps the device open (unmuting is instant) but sends silence.
      if (localRef.current.mic) localRef.current.mic.enabled = false;
      setMicOn(false);
      return;
    }
    void enableMic().then((ok) => {
      if (ok) setMicOn(true);
    });
  }, [micOn, enableMic]);

  const toggleCam = useCallback(() => {
    if (!joinedRef.current) return;
    if (camOn) {
      setCamTrack(null); // off releases the camera (its light goes out)
      setCamOn(false);
      return;
    }
    void enableCam().then((ok) => {
      if (ok) setCamOn(true);
    });
  }, [camOn, enableCam, setCamTrack]);

  const stopScreen = useCallback(
    (streamId: string) => {
      const local = localRef.current;
      const stream = local.screens.find((s) => s.id === streamId);
      if (!stream) return;
      for (const t of stream.getTracks()) t.stop();
      local.screens = local.screens.filter((s) => s !== stream);
      setScreens((list) => list.filter((s) => s.stream !== stream));
      pushLocal();
    },
    [pushLocal],
  );

  const shareScreen = useCallback(
    (audio: boolean) => {
      if (!joinedRef.current || !support.screen) return;
      if (localRef.current.screens.length >= MEETING_MAX_SCREENS) {
        say(`You can share up to ${MEETING_MAX_SCREENS} screens at once.`);
        return;
      }
      void openScreen(audio)
        .then((stream) => {
          if (!joinedRef.current) {
            for (const t of stream.getTracks()) t.stop();
            return;
          }
          // The browser's own "Stop sharing" button ends the track.
          stream.getVideoTracks()[0]?.addEventListener('ended', () => stopScreen(stream.id));
          localRef.current.screens = [...localRef.current.screens, stream];
          setScreens((list) => [...list, { stream, audio: stream.getAudioTracks().length > 0 }]);
          pushLocal();
        })
        .catch((err: unknown) => say(mediaErrorText(err, 'screen')));
    },
    [support.screen, stopScreen, pushLocal, say],
  );

  const selectDevices = useCallback(
    (choice: DeviceChoice) => {
      setDevices(choice);
      saveDeviceChoice(choice);
      if (!joinedRef.current) return;
      const local = localRef.current;
      // Swap the open devices for the chosen ones.
      if (local.mic && choice.mic !== devices.mic) {
        void openMic(choice.mic)
          .then((track) => {
            track.enabled = micOn;
            setMicTrack(track);
          })
          .catch((err: unknown) => say(mediaErrorText(err, 'microphone')));
      }
      if (local.cam && choice.cam !== devices.cam) {
        void openCamera(choice.cam)
          .then((track) => setCamTrack(track))
          .catch((err: unknown) => say(mediaErrorText(err, 'camera')));
      }
    },
    [devices, micOn, setMicTrack, setCamTrack, say],
  );

  // ── Joining ─────────────────────────────────────────────────
  const enter = useCallback(
    (id: string, title: string, opts: { mic: boolean; cam: boolean }) => {
      if (!available) return;
      if (joinedRef.current) teardown();
      const next: Joined = {
        id,
        title: title.slice(0, MEETING_TITLE_MAX_LENGTH) || 'Meeting',
        sid: Math.max(1, relayNow()),
      };
      joinedRef.current = next;
      setJoined(next);
      setChat([]);
      setTranscript([]);
      setNotes([]);
      setReactions([]);
      setInvites((list) => list.filter((i) => i.meetingId !== id));
      meterRef.current = new SpeakingMeter(setSpeaking);
      if (opts.mic) {
        void enableMic().then((ok) => {
          if (ok) setMicOn(true);
        });
      }
      if (opts.cam) {
        void enableCam().then((ok) => {
          if (ok) setCamOn(true);
        });
      }
      // The character heads for the office's meeting place.
      const os = getOfficeState();
      const spot = os.meetingSpot();
      if (spot && os.walkAvatarTo(spot.col, spot.row)) os.cameraFollowId = os.avatarId;
    },
    [available, teardown, relayNow, enableMic, enableCam, getOfficeState],
  );

  const start = useCallback(
    (title: string, opts: { mic: boolean; cam: boolean }) =>
      enter(newMeetingId(), title.trim() || defaultMeetingTitle(selfName), opts),
    [enter, selfName],
  );

  const join = useCallback(
    (meetingId: string, opts: { mic: boolean; cam: boolean }) => {
      const m = meetings.find((x) => x.id === meetingId);
      enter(meetingId, m?.title ?? 'Meeting', opts);
    },
    [meetings, enter],
  );

  // ── The mesh ────────────────────────────────────────────────
  const iceServers = useMemo<RTCIceServer[]>(() => {
    const list = status?.iceServers ?? [];
    return list.length > 0 ? list : MEETING_DEFAULT_ICE_SERVERS;
  }, [status?.iceServers]);

  // One mesh per (join, own peer id): a relay reconnect hands us a new id, and
  // everyone else sees a new peer to connect to.
  useEffect(() => {
    if (!joined || !selfPeerId) return;
    const mesh = new MeshSession(selfPeerId, joined.sid, iceServers, {
      sendSignal: (to, data) => transport.send({ type: 'sendMeetingSignal', to, data }),
      onRemoteStream: (peerId, stream) => {
        let map = remoteStreamsRef.current.get(peerId);
        if (!map) remoteStreamsRef.current.set(peerId, (map = new Map()));
        map.set(stream.id, stream);
        stream.onaddtrack = () => setStreamsVersion((v) => v + 1);
        stream.onremovetrack = () => setStreamsVersion((v) => v + 1);
        setStreamsVersion((v) => v + 1);
      },
      onPeerState: (peerId, state) => {
        setPeerStates((prev) => {
          if (state === 'closed') {
            const { [peerId]: _gone, ...rest } = prev;
            void _gone;
            remoteStreamsRef.current.delete(peerId);
            return rest;
          }
          return prev[peerId] === state ? prev : { ...prev, [peerId]: state };
        });
      },
    });
    mesh.setLocal(localRef.current);
    meshRef.current = mesh;
    for (const s of pendingSignalsRef.current.splice(0)) mesh.handleSignal(s.from, s.data);
    return () => {
      mesh.close();
      if (meshRef.current === mesh) meshRef.current = null;
    };
  }, [joined, selfPeerId, iceServers]);

  const othersKey = others.map((p) => `${p.peerId}@${p.presence.since}`).join(',');
  useEffect(() => {
    meshRef.current?.sync(others.map((p) => ({ peerId: p.peerId, sid: p.presence.since })));
    // othersKey stands for others (same people, same joins = nothing to do)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [othersKey, joined, selfPeerId]);

  // Speaking outlines: the audio track of each person's camera stream.
  useEffect(() => {
    const meter = meterRef.current;
    if (!meter) return;
    const keys = new Set<string>(['self']);
    for (const p of others) {
      const stream = p.presence.stream
        ? remoteStreamsRef.current.get(p.peerId)?.get(p.presence.stream)
        : undefined;
      meter.watch(p.peerId, stream?.getAudioTracks()[0] ?? null);
      keys.add(p.peerId);
    }
    meter.retain(keys);
  }, [others, streamsVersion]);

  const streamFor = useCallback(
    (tile: TileInfo): MediaStream | null => {
      if (!tile.streamId) return null;
      if (tile.self) {
        const local = localRef.current;
        if (tile.kind === 'camera') return local.base;
        return local.screens.find((s) => s.id === tile.streamId) ?? null;
      }
      return remoteStreamsRef.current.get(tile.peerId)?.get(tile.streamId) ?? null;
    },
    // streamsVersion makes the callback new whenever a stream arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streamsVersion],
  );

  const audioStreams = useMemo(() => {
    const out: Array<{ key: string; stream: MediaStream }> = [];
    for (const p of others) {
      const map = remoteStreamsRef.current.get(p.peerId);
      if (!map) continue;
      for (const [id, stream] of map) {
        if (stream.getAudioTracks().length > 0) out.push({ key: `${p.peerId}:${id}`, stream });
      }
    }
    return out;
    // streamsVersion: the streams live in a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [others, streamsVersion]);

  // ── Messages from the server ────────────────────────────────
  const handleSignal = useCallback((from: string, data: MeetingSignalData, fromName: string) => {
    if (data.kind === 'invite') {
      if (!data.meetingId || joinedRef.current?.id === data.meetingId) return;
      const invite: MeetingInvite = {
        from,
        name: fromName,
        meetingId: data.meetingId,
        title: data.title ?? 'Meeting',
        at: Date.now(),
      };
      setInvites((list) => [...list.filter((i) => i.meetingId !== invite.meetingId), invite]);
      return;
    }
    const mesh = meshRef.current;
    if (mesh) mesh.handleSignal(from, data);
    else if (joinedRef.current) pendingSignalsRef.current.push({ from, data });
  }, []);

  const peersRef = useRef<RemotePeer[]>([]);
  peersRef.current = peers;

  useEffect(() => {
    const onMessage = (msg: ServerMessage) => {
      switch (msg.type) {
        case 'multiplayerStatus':
          setStatus(msg);
          break;
        case 'remotePeers':
          setPeers(Array.isArray(msg.peers) ? msg.peers : []);
          break;
        case 'meetingSignal': {
          const name = peersRef.current.find((p) => p.peerId === msg.from)?.name ?? 'Someone';
          handleSignal(msg.from, msg.data, name);
          break;
        }
        case 'meetingEvent': {
          const j = joinedRef.current;
          if (!j || msg.meetingId !== j.id) break;
          const line: MeetingLine = {
            peerId: msg.from,
            name: msg.name,
            text: msg.event.text,
            ts: msg.ts,
            self: msg.self,
          };
          if (msg.event.kind === 'chat') setChat((list) => [...list, line]);
          else if (msg.event.kind === 'caption') setTranscript((list) => [...list, line]);
          else if (msg.event.kind === 'notes') {
            setNotes((list) => [...list, { text: line.text, by: line.name, ts: line.ts }]);
          } else if (msg.event.kind === 'reaction') {
            const key = reactionKeyRef.current++;
            const peerId = msg.self ? statusRef.current?.peerId || 'self' : msg.from;
            setReactions((list) => [...list, { key, peerId, emoji: line.text, at: Date.now() }]);
          }
          break;
        }
        case 'meetingNotesResult': {
          if (msg.requestId !== notesRequestRef.current) break;
          notesRequestRef.current = null;
          setNotesPending(false);
          if (msg.ok && msg.text) {
            // Shared with the meeting; the echo adds it to everyone's list, ours included.
            transport.send({ type: 'sendMeetingEvent', event: { kind: 'notes', text: msg.text } });
            if (msg.savedTo) say(`Notes saved to ${msg.savedTo}`);
          } else {
            say(msg.error ?? 'Claude could not write the notes.');
          }
          break;
        }
        default:
          break;
      }
    };
    return transport.onMessage(onMessage);
  }, [handleSignal, say]);

  // Reactions float for a moment; invites wait a minute.
  useEffect(() => {
    if (reactions.length === 0 && invites.length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setReactions((list) => {
        const next = list.filter((r) => now - r.at < MEETING_REACTION_FLOAT_MS);
        return next.length === list.length ? list : next;
      });
      setInvites((list) => {
        const next = list.filter((i) => now - i.at < INVITE_TTL_MS);
        return next.length === list.length ? list : next;
      });
    }, 250);
    return () => clearInterval(t);
  }, [reactions.length, invites.length]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Speaking up ─────────────────────────────────────────────
  const sendEvent = useCallback((kind: 'chat' | 'reaction' | 'caption', text: string) => {
    if (joinedRef.current) transport.send({ type: 'sendMeetingEvent', event: { kind, text } });
  }, []);

  const sendChat = useCallback(
    (text: string) => {
      const t = text.trim().slice(0, MEETING_CHAT_MAX_LENGTH);
      if (t) sendEvent('chat', t);
    },
    [sendEvent],
  );

  const react = useCallback(
    (emoji: Reaction) => {
      sendEvent('reaction', emoji);
      // The character acts it out in the office too, for the whole room.
      const emote = REACTION_EMOTES[emoji];
      if (emote) getOfficeState().playEmote(emote);
    },
    [sendEvent, getOfficeState],
  );

  const toggleHand = useCallback(() => {
    setHand((h) => (h.up ? { up: false, at: 0 } : { up: true, at: relayNow() }));
  }, [relayNow]);

  // ── Transcription ───────────────────────────────────────────
  const setTranscription = useCallback(
    (on: boolean) => {
      setTranscribeSwitch({ on, at: relayNow() });
      if (on) setCaptionsChoice('yes');
    },
    [relayNow],
  );
  const answerCaptions = useCallback((yes: boolean) => setCaptionsChoice(yes ? 'yes' : 'no'), []);
  const setTranscriptLang = useCallback((lang: string) => {
    setTranscriptLangState(lang);
    writeStored(LANG_KEY, lang);
  }, []);
  const transcribeSupported = Transcriber.isSupported();

  // Transcribe only the person's own voice, only while unmuted, only if they agreed.
  const shouldTranscribe =
    joined !== null && transcribeOn && captionsChoice === 'yes' && micOn && transcribeSupported;
  useEffect(() => {
    if (!shouldTranscribe) {
      transcriberRef.current?.stop();
      transcriberRef.current = null;
      setTranscriberRunning(false);
      setInterim('');
      return;
    }
    const t = new Transcriber({
      lang: transcriptLang,
      onFinal: (text) => sendEvent('caption', text.slice(0, MEETING_CAPTION_MAX_LENGTH)),
      onInterim: setInterim,
      onError: say,
    });
    transcriberRef.current = t;
    t.start();
    setTranscriberRunning(true);
    return () => {
      t.stop();
      if (transcriberRef.current === t) transcriberRef.current = null;
    };
  }, [shouldTranscribe, transcriptLang, sendEvent, say]);

  // ── Notes by Claude ─────────────────────────────────────────
  const generateNotes = useCallback(() => {
    const j = joinedRef.current;
    if (!j || notesRequestRef.current) return;
    const requestId = newMeetingId();
    notesRequestRef.current = requestId;
    setNotesPending(true);
    const strip = (l: MeetingLine) => ({ name: l.name, text: l.text, ts: l.ts });
    transport.send({
      type: 'generateMeetingNotes',
      requestId,
      title: j.title,
      transcript: transcript.map(strip),
      chat: chat.map(strip),
    });
  }, [transcript, chat]);

  const downloadTranscript = useCallback(() => {
    const title = joinedRef.current?.title ?? current?.title ?? 'Meeting';
    const md = transcriptMarkdown(
      title,
      new Date(),
      transcript,
      chat,
      notes.length > 0 ? notes[notes.length - 1].text : null,
    );
    downloadBlob(
      new Blob([md], { type: 'text/markdown' }),
      meetingFileName(title, new Date(), 'md'),
    );
  }, [transcript, chat, notes, current]);

  // ── Recording ───────────────────────────────────────────────
  const recordSupported = support.capture && MeetingRecorder.isSupported();
  const tilesRef = useRef<TileInfo[]>([]);
  tilesRef.current = tiles;
  const speakingRef = useRef<ReadonlySet<string>>(speaking);
  speakingRef.current = speaking;
  const streamForRef = useRef(streamFor);
  streamForRef.current = streamFor;

  const startRecording = useCallback(() => {
    if (!joinedRef.current || recorderRef.current || !recordSupported) return;
    const recorder = new MeetingRecorder({
      getSources: (): RecordingSource[] =>
        tilesRef.current.map((tile) => ({
          key: tile.key,
          name: tile.label,
          stream: streamForRef.current(tile),
          kind: tile.kind,
          videoOn: tile.videoOn,
          speaking:
            speakingRef.current.has(tile.self ? 'self' : tile.peerId) && tile.kind === 'camera',
        })),
      getAudioStreams: () => {
        const list: MediaStream[] = [localRef.current.base, ...localRef.current.screens];
        for (const map of remoteStreamsRef.current.values()) list.push(...map.values());
        const music = musicRef.current?.captureStream();
        if (music) list.push(music);
        return list;
      },
    });
    try {
      recorder.start();
      recorderRef.current = recorder;
      setRecordingSince(Date.now());
    } catch (err) {
      say(err instanceof Error ? err.message : 'Recording could not start.');
    }
  }, [recordSupported, say]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecordingSince(null);
    if (!recorder) return;
    const title = joinedRef.current?.title ?? 'meeting';
    void recorder
      .stop()
      .then((blob) => downloadBlob(blob, meetingFileName(title, new Date(), 'webm')))
      .catch((err: unknown) => say(err instanceof Error ? err.message : 'Recording failed.'));
  }, [say]);

  // ── Music ───────────────────────────────────────────────────
  const setMusic = useCallback(
    (track: string | null) => setMusicSwitch({ track: track ?? '', at: relayNow() }),
    [relayNow],
  );
  const setMusicVolume = useCallback((volume: number) => {
    const v = Math.max(0, Math.min(1, volume));
    setMusicVolumeState(v);
    writeStored(VOLUME_KEY, String(v));
    musicRef.current?.setVolume(v);
  }, []);

  const musicTrack = joined && effectiveMusic?.track ? effectiveMusic : null;
  useEffect(() => {
    if (!musicTrack) {
      musicRef.current?.stop();
      return;
    }
    musicRef.current ??= new MusicEngine();
    musicRef.current.setVolume(musicVolume);
    musicRef.current.play(musicTrack.track, Math.max(0, (relayNow() - musicTrack.at) / 1000));
    // musicVolume changes go through setMusicVolume without restarting the song
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicTrack?.track, musicTrack?.at, relayNow]);
  useEffect(
    () => () => {
      musicRef.current?.dispose();
      musicRef.current = null;
    },
    [],
  );

  // ── Invites ─────────────────────────────────────────────────
  const invite = useCallback((peerId: string) => {
    const j = joinedRef.current;
    if (!j) return;
    transport.send({
      type: 'sendMeetingSignal',
      to: peerId,
      data: { kind: 'invite', sid: j.sid, tsid: 0, meetingId: j.id, title: j.title },
    });
  }, []);
  const dismissInvite = useCallback(
    (inv: MeetingInvite) => setInvites((list) => list.filter((i) => i !== inv)),
    [],
  );
  const acceptInvite = useCallback(
    (inv: MeetingInvite) => {
      setInvites((list) => list.filter((i) => i !== inv));
      enter(inv.meetingId, meetings.find((m) => m.id === inv.meetingId)?.title ?? inv.title, {
        mic: true,
        cam: false,
      });
    },
    [enter, meetings],
  );

  const recorders = (current?.participants ?? [])
    .filter((p) => p.presence.rec)
    .map((p) => (p.self ? 'You' : p.name));

  return {
    available,
    support,
    selfPeerId,
    meetings,
    current,
    others,
    tiles,
    micOn,
    camOn,
    hand: hand.up,
    screens,
    streamFor,
    audioStreams,
    peerStates,
    speaking,
    chat,
    transcript,
    interim,
    notes,
    notesPending,
    reactions,
    invites,
    transcribeOn,
    captionsChoice,
    transcriberRunning,
    transcribeSupported,
    transcriptLang,
    music: musicTrack,
    musicVolume,
    recordingSince,
    recordSupported,
    recorders,
    devices,
    notice,
    relayNow,
    start,
    join,
    leave,
    toggleMic,
    toggleCam,
    shareScreen,
    stopScreen,
    toggleHand,
    react,
    sendChat,
    setTranscription,
    answerCaptions,
    setTranscriptLang,
    generateNotes,
    startRecording,
    stopRecording,
    setMusic,
    setMusicVolume,
    invite,
    acceptInvite,
    dismissInvite,
    selectDevices,
    downloadTranscript,
    clearNotice: useCallback(() => setNotice(null), []),
  };
}
