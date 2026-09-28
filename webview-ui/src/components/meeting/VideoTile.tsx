import { useEffect, useRef, useState } from 'react';

import type { TileInfo } from '../../meeting/model.js';

interface VideoTileProps {
  tile: TileInfo;
  stream: MediaStream | null;
  speaking: boolean;
  /** The peer connection behind a remote tile. */
  connection?: RTCPeerConnectionState;
  /** Reactions floating over the tile right now. */
  reactions?: Array<{ key: number; emoji: string }>;
  compact?: boolean;
  pinned?: boolean;
  onClick?: () => void;
}

/**
 * One person's camera, or one shared screen. Always muted: sound plays
 * through the call's hidden audio players, so a tile scrolled out of view
 * (or the minimized strip) never cuts anyone off.
 */
export function VideoTile({
  tile,
  stream,
  speaking,
  connection,
  reactions = [],
  compact = false,
  pinned = false,
  onClick,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Whether the element is showing frames. Read off the <video> itself: a
  // remote track's `muted` flag can stay stuck after a renegotiation while
  // frames keep arriving.
  const [hasFrames, setHasFrames] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    if (stream) void video.play().catch(() => {});
    const check = () => setHasFrames(video.videoWidth > 0 && video.readyState >= 2);
    check();
    const events = ['loadeddata', 'resize', 'playing', 'emptied'] as const;
    for (const e of events) video.addEventListener(e, check);
    // Events can be missed around track swaps; a slow poll keeps it honest.
    const timer = setInterval(check, 1000);
    return () => {
      for (const e of events) video.removeEventListener(e, check);
      clearInterval(timer);
    };
  }, [stream]);

  const showVideo = tile.videoOn && stream !== null && hasFrames;
  const screen = tile.kind === 'screen';
  const initial = (tile.name.trim()[0] ?? '?').toUpperCase();
  const trouble =
    !tile.self && connection && connection !== 'connected'
      ? connection === 'failed'
        ? 'no connection'
        : connection === 'disconnected'
          ? 'reconnecting…'
          : 'connecting…'
      : null;

  return (
    <div
      className={`relative w-full h-full min-h-0 overflow-hidden bg-bg-dark border-2 ${speaking && !screen ? 'border-accent-bright' : pinned ? 'border-accent' : 'border-border'} ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      title={onClick ? (pinned ? 'Unpin' : 'Pin to the big view') : undefined}
      data-testid="meeting-tile"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full"
        style={{
          objectFit: screen ? 'contain' : 'cover',
          // Your own camera reads like a mirror; everyone else sees it the right way round.
          transform: tile.self && !screen ? 'scaleX(-1)' : undefined,
          visibility: showVideo ? 'visible' : 'hidden',
        }}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          {screen ? (
            <span className="text-sm text-text-muted">Waiting for the screen…</span>
          ) : (
            <span
              className={`flex items-center justify-center bg-accent text-white ${compact ? 'w-32 h-32 text-lg' : 'w-64 h-64 text-3xl'}`}
            >
              {initial}
            </span>
          )}
        </div>
      )}
      <div className="absolute left-4 bottom-4 max-w-[calc(100%-8px)] flex items-center gap-4 bg-bg-dark/80 px-4 py-1 text-2xs leading-none whitespace-nowrap overflow-hidden">
        {!screen && !tile.micOn && <span title="Muted">🔇</span>}
        <span className="overflow-hidden text-ellipsis">{tile.label}</span>
      </div>
      {tile.hand && !screen && (
        <span className="absolute left-4 top-4 text-lg leading-none" title="Hand raised">
          ✋
        </span>
      )}
      {trouble && (
        <span className="absolute right-4 top-4 bg-bg-dark/80 px-4 py-1 text-2xs text-warning">
          {trouble}
        </span>
      )}
      {reactions.map((r, i) => (
        <span
          key={r.key}
          className="absolute pointer-events-none meeting-reaction-float"
          style={{ left: `${35 + ((i * 17) % 30)}%`, bottom: 12, fontSize: compact ? 22 : 36 }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
