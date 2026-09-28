import { useEffect, useMemo, useRef, useState } from 'react';

import {
  MEETING_CAPTION_SHOW_MS,
  MEETING_STAGE_Z_INDEX,
  MEETING_STRIP_MAX_TILES,
  MEETING_STRIP_TILE_H,
  MEETING_STRIP_TILE_W,
  MEETING_STRIP_Z_INDEX,
} from '../../constants.js';
import type { TileInfo } from '../../meeting/model.js';
import { formatElapsed, gridColumns } from '../../meeting/model.js';
import { musicTrack } from '../../meeting/music.js';
import type { MeetingController } from '../../meeting/useMeeting.js';
import type { SidebarTab } from './MeetingControls.js';
import { MeetingControls } from './MeetingControls.js';
import { MeetingSidebar } from './MeetingSidebar.js';
import { VideoTile } from './VideoTile.js';

interface MeetingViewProps {
  m: MeetingController;
  /** Everyone in the room (to invite the ones not in the call). */
  roomPeople: Array<{ peerId: string; name: string }>;
  /** The full view is open (App keeps the office's keyboard out of it). */
  onStageChange: (open: boolean) => void;
}

/** Plays every remote voice (and shared screen sound), whatever the view shows. */
function AudioSinks({ m }: { m: MeetingController }) {
  return (
    <div style={{ display: 'none' }}>
      {m.audioStreams.map(({ key, stream }) => (
        <AudioSink key={key} stream={stream} speaker={m.devices.speaker} />
      ))}
    </div>
  );
}

function AudioSink({ stream, speaker }: { stream: MediaStream; speaker: string | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    void el.play().catch(() => {});
  }, [stream]);
  useEffect(() => {
    const el = ref.current as
      (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId) void el.setSinkId(speaker ?? '').catch(() => {});
  }, [speaker]);
  return <audio ref={ref} autoPlay />;
}

function Elapsed({ since, now }: { since: number; now: () => number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="text-2xs text-text-muted">{formatElapsed(now() - since)}</span>;
}

/** Captions: the last things said, fading after a few seconds, plus your own words as they come. */
function Captions({ m }: { m: MeetingController }) {
  const [relay, setRelay] = useState(() => m.relayNow());
  const { relayNow, transcribeOn } = m;
  useEffect(() => {
    if (!transcribeOn) return;
    const t = setInterval(() => setRelay(relayNow()), 1000);
    return () => clearInterval(t);
  }, [transcribeOn, relayNow]);
  if (!transcribeOn) return null;
  const recent = m.transcript.filter((l) => relay - l.ts < MEETING_CAPTION_SHOW_MS).slice(-2);
  if (recent.length === 0 && !m.interim) return null;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-10 max-w-[80%] flex flex-col items-center gap-2 pointer-events-none z-10">
      {recent.map((l, i) => (
        <div key={`${l.ts}:${i}`} className="bg-bg-dark/90 px-8 py-2 text-sm text-center">
          <span className="text-accent-bright">{l.self ? 'You' : l.name}:</span> {l.text}
        </div>
      ))}
      {m.interim && (
        <div className="bg-bg-dark/90 px-8 py-2 text-sm text-center text-text-muted">
          <span className="text-accent-bright">You:</span> {m.interim}…
        </div>
      )}
    </div>
  );
}

function Banners({ m, inline = false }: { m: MeetingController; inline?: boolean }) {
  return (
    <div
      className={`${inline ? '' : 'absolute left-1/2 -translate-x-1/2 top-6 z-10 max-w-[90%]'} flex flex-col items-center gap-4`}
    >
      {m.transcribeOn && m.captionsChoice === 'ask' && (
        <div
          className="pixel-panel px-10 py-6 text-sm flex flex-col gap-6"
          data-testid="captions-consent"
        >
          {m.transcribeSupported ? (
            <>
              <span>
                Transcription is on. Transcribe your voice too? Your browser does it (Chrome and
                Edge send the audio to Google or Microsoft) and the text is shared with this call.
                Only while you are unmuted.
              </span>
              <div className="flex gap-6">
                <button
                  type="button"
                  className="py-1 px-10 bg-accent text-white border-2 border-accent cursor-pointer"
                  onClick={() => m.answerCaptions(true)}
                >
                  Transcribe me
                </button>
                <button
                  type="button"
                  className="py-1 px-10 bg-btn-bg text-text border-2 border-transparent cursor-pointer"
                  onClick={() => m.answerCaptions(false)}
                >
                  Not me
                </button>
              </div>
            </>
          ) : (
            <span>
              Transcription is on, but this browser cannot transcribe your voice (Chrome and Edge
              can). You still see what the others say.
              <button
                type="button"
                className="ml-8 bg-transparent border-none text-accent-bright underline cursor-pointer p-0 text-sm"
                onClick={() => m.answerCaptions(false)}
              >
                OK
              </button>
            </span>
          )}
        </div>
      )}
      {m.notice && (
        <div
          className="pixel-panel px-10 py-4 text-sm flex items-center gap-8"
          data-testid="meeting-notice"
        >
          <span style={{ overflowWrap: 'anywhere' }}>{m.notice}</span>
          <button
            type="button"
            className="bg-transparent border-none text-text-muted cursor-pointer p-0 text-base"
            onClick={m.clearNotice}
          >
            ×
          </button>
        </div>
      )}
      {!m.support.capture && m.support.reason && (
        <div className="bg-bg-dark/90 px-8 py-2 text-2xs text-warning">{m.support.reason}</div>
      )}
    </div>
  );
}

/** The call's big view: screens first (all of them, side by side), cameras in a
 *  filmstrip; with no screen, cameras in a grid. A pinned tile takes the stage. */
function Stage({
  m,
  tiles,
  pinned,
  onPin,
}: {
  m: MeetingController;
  tiles: TileInfo[];
  pinned: string | null;
  onPin: (key: string | null) => void;
}) {
  const reactionsFor = (tile: TileInfo) =>
    tile.kind === 'camera' ? m.reactions.filter((r) => r.peerId === tile.peerId) : [];
  const render = (tile: TileInfo, compact = false) => (
    <VideoTile
      key={tile.key}
      tile={tile}
      stream={m.streamFor(tile)}
      speaking={m.speaking.has(tile.self ? 'self' : tile.peerId)}
      connection={m.peerStates[tile.peerId]}
      reactions={reactionsFor(tile)}
      compact={compact}
      pinned={pinned === tile.key}
      onClick={() => onPin(pinned === tile.key ? null : tile.key)}
    />
  );
  const pinnedTile = pinned ? tiles.find((t) => t.key === pinned) : undefined;
  const screens = tiles.filter((t) => t.kind === 'screen');
  const cams = tiles.filter((t) => t.kind === 'camera');
  const main = pinnedTile ? [pinnedTile] : screens;
  const strip = pinnedTile ? tiles.filter((t) => t !== pinnedTile) : cams;

  if (main.length === 0) {
    const cols = gridColumns(cams.length);
    return (
      <div
        className="w-full h-full grid gap-6 p-6"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(0, 1fr)',
        }}
      >
        {cams.map((t) => render(t))}
      </div>
    );
  }
  const mainCols = main.length === 1 ? 1 : 2;
  return (
    <div className="w-full h-full flex flex-col gap-6 p-6">
      <div
        className="flex-1 min-h-0 grid gap-6"
        style={{
          gridTemplateColumns: `repeat(${mainCols}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(0, 1fr)',
        }}
      >
        {main.map((t) => render(t))}
      </div>
      {strip.length > 0 && (
        <div
          className="flex gap-6 overflow-x-auto pixel-scrollbar shrink-0"
          style={{ height: 112 }}
        >
          {strip.map((t) => (
            <div key={t.key} className="shrink-0 h-full" style={{ width: 184 }}>
              {render(t, true)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A meeting on screen. Opens full (the stage: tiles, side panel, all the
 * buttons) and minimizes to a strip of small tiles along the top of the
 * office, so people can keep walking around while they talk.
 */
export function MeetingView({ m, roomPeople, onStageChange }: MeetingViewProps) {
  const [mode, setMode] = useState<'stage' | 'strip'>('stage');
  const [tab, setTab] = useState<SidebarTab | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [chatSeen, setChatSeen] = useState(0);
  const current = m.current;

  useEffect(() => onStageChange(mode === 'stage'), [mode, onStageChange]);
  useEffect(() => () => onStageChange(false), [onStageChange]);
  // A pinned tile that went away (screen stopped, person left) unpins.
  useEffect(() => {
    if (pinned && !m.tiles.some((t) => t.key === pinned)) setPinned(null);
  }, [pinned, m.tiles]);
  useEffect(() => {
    if (tab === 'chat') setChatSeen(m.chat.length);
  }, [tab, m.chat.length]);
  const chatUnread = tab === 'chat' ? 0 : m.chat.filter((l, i) => i >= chatSeen && !l.self).length;

  const stripTiles = useMemo(() => {
    const cams = m.tiles.filter((t) => t.kind === 'camera');
    // Whoever is talking comes first in the little strip.
    cams.sort(
      (a, b) =>
        Number(m.speaking.has(b.self ? 'self' : b.peerId)) -
        Number(m.speaking.has(a.self ? 'self' : a.peerId)),
    );
    return cams.slice(0, MEETING_STRIP_MAX_TILES);
  }, [m.tiles, m.speaking]);
  const screenCount = m.tiles.filter((t) => t.kind === 'screen').length;

  if (!current) return <AudioSinks m={m} />;

  const badges = (
    <>
      {m.recorders.length > 0 && (
        <span className="text-2xs text-white bg-danger px-4 py-1" data-testid="meeting-rec-badge">
          ● REC {m.recorders.join(', ')}
        </span>
      )}
      {m.transcribeOn && <span className="text-2xs bg-active-bg px-4 py-1">CC</span>}
      {m.music && (
        <span className="text-2xs bg-active-bg px-4 py-1">
          ♪ {musicTrack(m.music.track)?.title ?? 'Music'}
        </span>
      )}
    </>
  );

  if (mode === 'strip') {
    return (
      <>
        <AudioSinks m={m} />
        <div
          className="absolute top-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4"
          style={{ zIndex: MEETING_STRIP_Z_INDEX, maxWidth: 'calc(100% - 20px)' }}
          data-testid="meeting-strip"
        >
          <div className="flex gap-4 items-stretch">
            {stripTiles.map((t) => (
              <div
                key={t.key}
                style={{ width: MEETING_STRIP_TILE_W, height: MEETING_STRIP_TILE_H }}
              >
                <VideoTile
                  tile={t}
                  stream={m.streamFor(t)}
                  speaking={m.speaking.has(t.self ? 'self' : t.peerId)}
                  connection={m.peerStates[t.peerId]}
                  reactions={m.reactions.filter((r) => r.peerId === t.peerId)}
                  compact
                  onClick={() => setMode('stage')}
                />
              </div>
            ))}
            {(screenCount > 0 ||
              m.tiles.filter((t) => t.kind === 'camera').length > stripTiles.length) && (
              <button
                type="button"
                className="pixel-panel px-8 text-sm cursor-pointer text-text"
                onClick={() => setMode('stage')}
              >
                {screenCount > 0
                  ? `🖥 ${screenCount} screen${screenCount > 1 ? 's' : ''}`
                  : '+ more'}
              </button>
            )}
          </div>
          <div className="pixel-panel p-4 flex items-center gap-6 flex-wrap justify-center">
            <span className="text-sm text-accent-bright px-4">{current.title}</span>
            {badges}
            <MeetingControls
              m={m}
              compact
              tab={null}
              onTab={() => {}}
              chatUnread={0}
              onExpand={() => setMode('stage')}
            />
          </div>
          <Banners m={m} inline />
        </div>
      </>
    );
  }

  return (
    <>
      <AudioSinks m={m} />
      <div
        className="absolute inset-10 pixel-panel flex flex-col"
        style={{ zIndex: MEETING_STAGE_Z_INDEX }}
        data-testid="meeting-stage"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') setMode('strip');
        }}
      >
        <div className="flex items-center gap-8 px-8 py-4 border-b-2 border-border flex-wrap">
          <span className="text-lg text-accent-bright">{current.title}</span>
          <span className="text-2xs text-text-muted">
            {current.participants.length} {current.participants.length === 1 ? 'person' : 'people'}
          </span>
          <Elapsed since={current.startedAt} now={m.relayNow} />
          {badges}
          <button
            type="button"
            className="ml-auto py-1 px-8 text-sm bg-btn-bg text-text border-2 border-transparent cursor-pointer hover:bg-btn-hover"
            onClick={() => setMode('strip')}
            title="Back to the office (the call goes on in a small strip) — Esc"
            data-testid="meeting-minimize"
          >
            ▁ Office
          </button>
        </div>
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 relative">
            {current.participants.length === 1 && m.tiles.length === 1 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-10 p-10">
                <div style={{ width: 'min(480px, 90%)', aspectRatio: '16 / 9' }}>
                  <Stage m={m} tiles={m.tiles} pinned={null} onPin={() => {}} />
                </div>
                <span className="text-sm text-text-muted text-center">
                  You are the only one here. Invite people from the People tab, or wait for them to
                  join from the Meet panel.
                </span>
              </div>
            ) : (
              <Stage m={m} tiles={m.tiles} pinned={pinned} onPin={setPinned} />
            )}
            <Banners m={m} />
            <Captions m={m} />
          </div>
          {tab && (
            <MeetingSidebar m={m} tab={tab} onClose={() => setTab(null)} roomPeople={roomPeople} />
          )}
        </div>
        <MeetingControls
          m={m}
          compact={false}
          tab={tab}
          onTab={(t) => setTab((cur) => (cur === t ? null : t))}
          chatUnread={chatUnread}
        />
      </div>
    </>
  );
}
