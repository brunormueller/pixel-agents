// webview-ui/src/games/useGames.ts
//
// The games controller: starts a solo match (bots only, no room needed), hosts
// or joins a match in the room, keeps this office's presence in it alive, and
// feeds the room's frames to the running session.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AvatarLook,
  FpsConfig,
  GamePresence,
  MultiplayerStatus,
  RemotePeer,
  ServerMessage,
} from '../../../core/src/messages.js';
import { FPS_PRESENCE_HEARTBEAT_MS, MEETING_TITLE_MAX_LENGTH } from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { transport } from '../transport/index.js';
import { builtinMap, isBuiltinMap, localMap, mapName } from './fps/maps.js';
import type { FpsNet } from './fps/session.js';
import { FpsSession } from './fps/session.js';
import type { MatchPlayer, RoomMatch } from './model.js';
import { cleanConfig, newMatchId, roomMatches } from './model.js';

interface Playing {
  mode: 'solo' | 'room';
  matchId: string | null;
  cfg: FpsConfig;
  title: string;
  /** Relay clock this office joined the match at. */
  since: number;
  palette: number;
  hueShift: number;
  look: AvatarLook | null;
}

export interface GamesController {
  /** In a room with a live relay connection: room matches are possible. */
  available: boolean;
  /** Matches going on in the room (ours included). */
  matches: RoomMatch[];
  /** The running match's session, or null. */
  session: FpsSession | null;
  /** What is being played, for the game's title bar. */
  playing: { mode: 'solo' | 'room'; title: string; matchId: string | null } | null;
  /** The room match this office is in. */
  current: RoomMatch | null;
  notice: string | null;
  startSolo: (cfg: FpsConfig) => void;
  host: (cfg: FpsConfig) => void;
  join: (matchId: string) => void;
  leave: () => void;
  clearNotice: () => void;
}

const TOO_SMALL = 'This floor is too small to play on — pick another map.';

export function useGames(getOfficeState: () => OfficeState, selfName: string): GamesController {
  const [status, setStatus] = useState<MultiplayerStatus | null>(null);
  const [peers, setPeers] = useState<RemotePeer[]>([]);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [session, setSession] = useState<FpsSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const statusRef = useRef<MultiplayerStatus | null>(null);
  statusRef.current = status;
  const playingRef = useRef<Playing | null>(null);
  playingRef.current = playing;
  const sessionRef = useRef<FpsSession | null>(null);
  sessionRef.current = session;

  const selfPeerId = status?.peerId ?? '';
  const available = status?.joined === true && status.connected && selfPeerId !== '';
  const relayNow = useCallback(() => Date.now() + (statusRef.current?.clockOffset ?? 0), []);

  /** How the person looks in the office (their character carries into the match). */
  const appearance = useCallback(() => {
    const os = getOfficeState();
    const ch = os.avatarId !== null ? os.characters.get(os.avatarId) : undefined;
    const look = os.getLocalProfile().look ?? null;
    return {
      palette: look ? look.body : (ch?.palette ?? 0),
      hueShift: look ? 0 : (ch?.hueShift ?? 0),
      look,
    };
  }, [getOfficeState]);

  // ── The room's matches ──────────────────────────────────────
  const presence = useMemo<GamePresence | null>(() => {
    if (!playing || playing.mode !== 'room' || !playing.matchId) return null;
    return {
      id: playing.matchId,
      game: 'fps',
      title: playing.title,
      since: playing.since,
      cfg: playing.cfg,
      palette: playing.palette,
      hueShift: playing.hueShift,
    };
  }, [playing]);

  const selfPlayer = useMemo<MatchPlayer | null>(
    () =>
      presence
        ? {
            peerId: selfPeerId || 'self',
            name: selfName || 'You',
            self: true,
            presence,
            look: playing?.look ?? null,
          }
        : null,
    [presence, selfPeerId, selfName, playing],
  );
  const matches = useMemo(() => roomMatches(selfPlayer, peers), [selfPlayer, peers]);
  const current = useMemo(
    () => (playing?.matchId ? (matches.find((m) => m.id === playing.matchId) ?? null) : null),
    [matches, playing],
  );

  // Who else is in it, and who hosts.
  useEffect(() => {
    const s = sessionRef.current;
    if (!s || !current) return;
    s.setParticipants(
      current.players
        .filter((p) => !p.self)
        .map((p) => ({
          id: p.peerId,
          name: p.name,
          palette: p.presence.palette,
          hueShift: p.presence.hueShift,
          look: p.look,
        })),
      current.hostId,
    );
  }, [current]);

  // Published on every change and kept alive while playing (a presence nobody
  // refreshes expires: that is how a closed tab leaves the match).
  const presenceJson = presence ? JSON.stringify(presence) : 'null';
  useEffect(() => {
    if (!presence) return;
    transport.send({ type: 'updateGamePresence', game: presence });
    const t = setInterval(
      () => transport.send({ type: 'updateGamePresence', game: presence }),
      FPS_PRESENCE_HEARTBEAT_MS,
    );
    return () => clearInterval(t);
    // presenceJson stands for presence (a new object each render with the same content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenceJson]);

  useEffect(() => {
    const onMessage = (msg: ServerMessage) => {
      switch (msg.type) {
        case 'multiplayerStatus':
          setStatus(msg);
          break;
        case 'remotePeers':
          setPeers(Array.isArray(msg.peers) ? msg.peers : []);
          break;
        case 'gameFrame': {
          const p = playingRef.current;
          if (p?.matchId && msg.gameId === p.matchId)
            sessionRef.current?.receive(msg.from, msg.frame);
          break;
        }
      }
    };
    return transport.onMessage(onMessage);
  }, []);

  // ── Starting and leaving ────────────────────────────────────
  const leave = useCallback(() => {
    const p = playingRef.current;
    if (!p) return;
    if (p.mode === 'room') transport.send({ type: 'updateGamePresence', game: null });
    playingRef.current = null;
    sessionRef.current = null;
    setPlaying(null);
    setSession(null);
  }, []);

  const roomNet = useMemo<FpsNet>(
    () => ({ send: (frame) => transport.send({ type: 'sendGameFrame', frame }) }),
    [],
  );

  const start = useCallback((p: Playing, s: FpsSession) => {
    playingRef.current = p;
    sessionRef.current = s;
    setPlaying(p);
    setSession(s);
    setNotice(null);
  }, []);

  const startSolo = useCallback(
    (raw: FpsConfig) => {
      const cfg = cleanConfig(raw);
      const map = localMap(cfg.map, getOfficeState());
      if (!map) {
        setNotice(TOO_SMALL);
        return;
      }
      leave();
      const look = appearance();
      const s = new FpsSession({
        self: { id: 'me', name: selfName || 'You', ...look },
        cfg,
        map,
        net: null,
        now: Date.now,
      });
      start(
        {
          mode: 'solo',
          matchId: null,
          cfg,
          title: `Solo — ${mapName(cfg.map)}`,
          since: Date.now(),
          ...look,
        },
        s,
      );
    },
    [getOfficeState, leave, appearance, selfName, start],
  );

  const host = useCallback(
    (raw: FpsConfig) => {
      if (!available) return;
      const cfg = cleanConfig(raw);
      const map = localMap(cfg.map, getOfficeState());
      if (!map) {
        setNotice(TOO_SMALL);
        return;
      }
      leave();
      const look = appearance();
      const title = `${selfName || 'Someone'}'s match`.slice(0, MEETING_TITLE_MAX_LENGTH);
      const p: Playing = {
        mode: 'room',
        matchId: newMatchId(),
        cfg,
        title,
        since: Math.max(1, Math.round(relayNow())),
        ...look,
      };
      // The presence goes out before any frame, so the relay knows where to route them.
      transport.send({
        type: 'updateGamePresence',
        game: {
          id: p.matchId!,
          game: 'fps',
          title,
          since: p.since,
          cfg,
          palette: look.palette,
          hueShift: look.hueShift,
        },
      });
      const s = new FpsSession({
        self: { id: selfPeerId, name: selfName || 'You', ...look },
        cfg,
        map,
        net: roomNet,
        now: relayNow,
      });
      s.setParticipants([], selfPeerId);
      start(p, s);
    },
    [available, getOfficeState, leave, appearance, selfName, relayNow, selfPeerId, roomNet, start],
  );

  const join = useCallback(
    (matchId: string) => {
      const m = matches.find((x) => x.id === matchId);
      if (!m || !available || playingRef.current?.matchId === matchId) return;
      leave();
      const look = appearance();
      const latest = Math.max(...m.players.map((pl) => pl.presence.since));
      const p: Playing = {
        mode: 'room',
        matchId,
        cfg: m.cfg,
        title: m.title,
        since: Math.max(Math.round(relayNow()), latest + 1),
        ...look,
      };
      transport.send({
        type: 'updateGamePresence',
        game: {
          id: matchId,
          game: 'fps',
          title: m.title,
          since: p.since,
          cfg: m.cfg,
          palette: look.palette,
          hueShift: look.hueShift,
        },
      });
      const s = new FpsSession({
        self: { id: selfPeerId, name: selfName || 'You', ...look },
        cfg: m.cfg,
        // A built-in map is the same here; an office map comes from the host.
        map: isBuiltinMap(m.cfg.map) ? builtinMap(m.cfg.map) : null,
        net: roomNet,
        now: relayNow,
      });
      s.setParticipants(
        m.players.map((pl) => ({
          id: pl.peerId,
          name: pl.name,
          palette: pl.presence.palette,
          hueShift: pl.presence.hueShift,
          look: pl.look,
        })),
        m.hostId,
      );
      start(p, s);
    },
    [matches, available, leave, appearance, relayNow, selfPeerId, selfName, roomNet, start],
  );

  // Out of the room: out of its match too.
  useEffect(() => {
    if (playing?.mode === 'room' && status && !status.joined) leave();
  }, [playing, status, leave]);

  // Closing the tab: say goodbye now rather than after the server's timeout.
  useEffect(() => {
    const bye = () => {
      if (playingRef.current?.mode === 'room')
        transport.send({ type: 'updateGamePresence', game: null });
    };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  return {
    available,
    matches,
    session,
    playing: playing
      ? { mode: playing.mode, title: playing.title, matchId: playing.matchId }
      : null,
    current,
    notice,
    startSolo,
    host,
    join,
    leave,
    clearNotice: useCallback(() => setNotice(null), []),
  };
}
