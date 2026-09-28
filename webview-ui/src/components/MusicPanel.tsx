import { useState } from 'react';

import type { SpotifyStatus } from '../../../core/src/messages.js';
import { SidePanel } from './ui/SidePanel.js';

type SpotifyAction = 'connect' | 'disconnect' | 'play' | 'pause' | 'next' | 'previous' | 'refresh';

interface MusicPanelProps {
  spotify: SpotifyStatus | null;
  /** Null when the office is not in a room (nothing to share with). */
  shareMusic: boolean | null;
  onCommand: (action: SpotifyAction, clientId?: string) => void;
  onShareChange: (share: boolean) => void;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
}

const DASHBOARD_URL = 'https://developer.spotify.com/dashboard';

const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Spotify: what is playing, the playback controls (Spotify Premium), and
 * whether the room sees the song on your character. Signing in uses the
 * person's own Spotify app — Pixel Agents ships no Spotify credentials.
 */
export function MusicPanel({
  spotify,
  shareMusic,
  onCommand,
  onShareChange,
  onOpenUrl,
  onClose,
}: MusicPanelProps) {
  const [clientId, setClientId] = useState(spotify?.clientId ?? '');
  const [copied, setCopied] = useState(false);
  const np = spotify?.nowPlaying ?? null;
  const connected = spotify?.connected === true;

  const controlClass =
    'py-1 px-10 text-base bg-btn-bg text-text border-2 border-transparent cursor-pointer hover:bg-btn-hover';

  return (
    <SidePanel title="Music" onClose={onClose} testId="music-panel">
      {connected ? (
        <>
          {np ? (
            <div className="flex flex-col gap-4 border-2 border-border p-8">
              <span className="text-base" style={{ overflowWrap: 'anywhere' }}>
                {np.title}
              </span>
              <span className="text-sm text-text-muted" style={{ overflowWrap: 'anywhere' }}>
                {np.artist}
                {np.album ? ` · ${np.album}` : ''}
              </span>
              {np.durationMs !== undefined && np.durationMs > 0 && (
                <div className="flex items-center gap-6">
                  <div className="flex-1 h-4 bg-bg-dark border border-border">
                    <div
                      className="h-full bg-accent"
                      style={{
                        width: `${Math.min(100, ((np.progressMs ?? 0) / np.durationMs) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-2xs text-text-muted">
                    {clock(np.progressMs ?? 0)} / {clock(np.durationMs)}
                  </span>
                </div>
              )}
              <div className="flex gap-4 mt-2">
                <button
                  type="button"
                  className={controlClass}
                  title="Previous"
                  onClick={() => onCommand('previous')}
                >
                  ⏮
                </button>
                <button
                  type="button"
                  className={controlClass}
                  title={np.isPlaying ? 'Pause' : 'Play'}
                  onClick={() => onCommand(np.isPlaying ? 'pause' : 'play')}
                  data-testid="music-play-pause"
                >
                  {np.isPlaying ? '⏸' : '▶'}
                </button>
                <button
                  type="button"
                  className={controlClass}
                  title="Next"
                  onClick={() => onCommand('next')}
                >
                  ⏭
                </button>
                {np.trackUrl && (
                  <button
                    type="button"
                    onClick={() => onOpenUrl(np.trackUrl!)}
                    className="ml-auto bg-transparent border-none text-accent-bright underline p-0 cursor-pointer text-sm"
                  >
                    Open in Spotify
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-muted m-0">
              Nothing playing. Start something in any Spotify app and it shows up here.
            </p>
          )}
          {shareMusic !== null && (
            <label className="flex items-center gap-6 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={shareMusic}
                onChange={(e) => onShareChange(e.target.checked)}
                data-testid="share-music"
              />
              Show the room what I am listening to
            </label>
          )}
          <span className="text-2xs text-text-muted">
            Play, pause and skip need Spotify Premium and an active Spotify app.
          </span>
          <button
            type="button"
            onClick={() => onCommand('disconnect')}
            className="self-start bg-transparent border-none text-text-muted underline p-0 cursor-pointer text-sm"
          >
            Disconnect Spotify
          </button>
        </>
      ) : (
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            onCommand('connect', clientId.trim());
          }}
        >
          <span className="text-sm">Connect Spotify</span>
          <ol className="text-2xs text-text-muted flex flex-col gap-4 m-0 pl-14">
            <li>
              Create an app in the{' '}
              <button
                type="button"
                onClick={() => onOpenUrl(DASHBOARD_URL)}
                className="bg-transparent border-none text-accent-bright underline p-0 cursor-pointer text-2xs"
              >
                Spotify developer dashboard
              </button>{' '}
              (any name; tick <i>Web API</i>).
            </li>
            <li>
              Add this Redirect URI to it:
              <div className="flex items-center gap-4 mt-2">
                <code
                  className="text-text bg-bg-dark border border-border px-4 py-1"
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {spotify?.redirectUri ?? 'http://127.0.0.1:43117/spotify/callback'}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(spotify?.redirectUri ?? '')
                      .then(() => setCopied(true))
                      .catch(() => undefined);
                  }}
                  className="py-0 px-6 text-2xs bg-btn-bg text-text border-none cursor-pointer"
                >
                  {copied ? 'copied' : 'copy'}
                </button>
              </div>
            </li>
            <li>Paste the app&apos;s Client ID below and connect.</li>
          </ol>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID"
            aria-label="Spotify Client ID"
            className="w-full bg-bg-dark text-text border-2 border-border rounded-none px-6 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!clientId.trim() || spotify?.pendingAuth === true}
            className="self-start py-1 px-10 text-sm bg-accent text-white border-2 border-accent cursor-pointer disabled:opacity-[var(--btn-disabled-opacity)] disabled:cursor-default"
          >
            {spotify?.pendingAuth ? 'Waiting for Spotify…' : 'Connect'}
          </button>
          {spotify?.pendingAuth && (
            <span className="text-2xs text-text-muted">
              Finish signing in in the browser tab that opened.
            </span>
          )}
          <span className="text-2xs text-text-muted">
            The sign-in stays on this computer. The room only sees a song if you choose to share it.
          </span>
        </form>
      )}
      {spotify?.error && <span className="text-2xs text-danger">{spotify.error}</span>}
    </SidePanel>
  );
}
