import { useEffect, useRef, useState } from 'react';

import { MEETING_MAX_SCREENS } from '../../constants.js';
import { canPickSpeaker, listDevices } from '../../meeting/media.js';
import { REACTIONS } from '../../meeting/model.js';
import { MUSIC_TRACKS } from '../../meeting/music.js';
import type { MeetingController } from '../../meeting/useMeeting.js';

export type SidebarTab = 'chat' | 'transcript' | 'notes' | 'people';
type Menu = 'share' | 'react' | 'record' | 'music' | 'devices' | null;

interface MeetingControlsProps {
  m: MeetingController;
  compact: boolean;
  tab: SidebarTab | null;
  onTab: (tab: SidebarTab) => void;
  chatUnread: number;
  onExpand?: () => void;
}

const btn =
  'flex items-center gap-4 py-2 px-8 text-sm border-2 rounded-none cursor-pointer whitespace-nowrap disabled:opacity-[var(--btn-disabled-opacity)] disabled:cursor-default';
const idle = `${btn} bg-btn-bg border-transparent hover:bg-btn-hover text-text`;
const on = `${btn} bg-active-bg border-accent text-text`;
const off = `${btn} bg-danger/70 border-danger hover:bg-danger text-white`;

function Popover({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <div className={`absolute bottom-full ${align === 'left' ? 'left-0' : 'right-0'} pb-6 z-10`}>
      <div className="bg-bg border-2 border-border shadow-pixel p-6 flex flex-col gap-4 min-w-160">
        {children}
      </div>
    </div>
  );
}

/** The call's buttons: devices, screens, reactions, hand, panels, recording, music, leave. */
export function MeetingControls({
  m,
  compact,
  tab,
  onTab,
  chatUnread,
  onExpand,
}: MeetingControlsProps) {
  const [menu, setMenu] = useState<Menu>(null);
  const [deviceList, setDeviceList] = useState<MediaDeviceInfo[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  useEffect(() => {
    if (menu === 'devices') void listDevices().then(setDeviceList);
  }, [menu]);
  const toggle = (next: Menu) => setMenu((cur) => (cur === next ? null : next));
  const capture = m.support.capture;

  const micButton = (
    <button
      type="button"
      className={m.micOn ? on : off}
      onClick={m.toggleMic}
      disabled={!capture}
      title={capture ? (m.micOn ? 'Mute' : 'Unmute') : (m.support.reason ?? '')}
      data-testid="meeting-mic"
    >
      {m.micOn ? '🎤' : '🔇'}
      {!compact && (m.micOn ? 'Mic' : 'Muted')}
    </button>
  );
  const camButton = (
    <button
      type="button"
      className={m.camOn ? on : idle}
      onClick={m.toggleCam}
      disabled={!capture}
      title={capture ? (m.camOn ? 'Turn camera off' : 'Turn camera on') : (m.support.reason ?? '')}
      data-testid="meeting-cam"
    >
      {m.camOn ? '📷' : '🚫'}
      {!compact && 'Camera'}
    </button>
  );
  const shareButton = (
    <div className="relative">
      <button
        type="button"
        className={m.screens.length > 0 ? on : idle}
        onClick={() => toggle('share')}
        disabled={!m.support.screen}
        title={
          m.support.screen
            ? 'Share screens'
            : (m.support.reason ?? 'Screen sharing is not available here')
        }
        data-testid="meeting-share"
      >
        🖥{!compact && (m.screens.length > 0 ? `Sharing ${m.screens.length}` : 'Share')}
      </button>
      {menu === 'share' && (
        <Popover>
          <button
            type="button"
            className={idle}
            disabled={m.screens.length >= MEETING_MAX_SCREENS}
            onClick={() => {
              m.shareScreen(false);
              setMenu(null);
            }}
          >
            {m.screens.length > 0 ? 'Share another screen' : 'Share a screen'}
          </button>
          <button
            type="button"
            className={idle}
            disabled={m.screens.length >= MEETING_MAX_SCREENS}
            onClick={() => {
              m.shareScreen(true);
              setMenu(null);
            }}
            title="Chrome and Edge can share a tab's or the system's sound too"
          >
            …with its sound
          </button>
          {m.screens.map((s, i) => (
            <button
              key={s.stream.id}
              type="button"
              className={off}
              onClick={() => m.stopScreen(s.stream.id)}
            >
              Stop screen {i + 1}
              {s.audio ? ' 🔊' : ''}
            </button>
          ))}
          <span className="text-2xs text-text-muted max-w-200">
            Up to {MEETING_MAX_SCREENS} at once. Everyone can share at the same time.
          </span>
        </Popover>
      )}
    </div>
  );
  const reactButton = (
    <div className="relative">
      <button type="button" className={idle} onClick={() => toggle('react')} title="React">
        😀{!compact && 'React'}
      </button>
      {menu === 'react' && (
        <Popover>
          <div className="flex gap-2">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="bg-transparent border-2 border-transparent hover:border-accent cursor-pointer text-xl px-2"
                onClick={() => m.react(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
  const handButton = (
    <button
      type="button"
      className={m.hand ? on : idle}
      onClick={m.toggleHand}
      title={m.hand ? 'Lower your hand' : 'Raise your hand'}
      data-testid="meeting-hand"
    >
      ✋{!compact && (m.hand ? 'Lower' : 'Hand')}
    </button>
  );
  const leaveButton = (
    <button
      type="button"
      className={off}
      onClick={m.leave}
      title="Leave the call"
      data-testid="meeting-leave"
    >
      {compact ? '✕' : 'Leave'}
    </button>
  );

  if (compact) {
    return (
      <div ref={rootRef} className="flex items-center gap-4 flex-wrap justify-center">
        {micButton}
        {camButton}
        {shareButton}
        {reactButton}
        {handButton}
        <button type="button" className={idle} onClick={onExpand} title="Open the call">
          ⛶
        </button>
        {leaveButton}
      </div>
    );
  }

  const tabButton = (id: SidebarTab, label: string, icon: string, badge = 0) => (
    <button
      type="button"
      className={`${tab === id ? on : idle} relative`}
      onClick={() => onTab(id)}
      data-testid={`meeting-tab-${id}`}
    >
      {icon}
      {label}
      {badge > 0 && (
        <span className="absolute -top-8 -right-8 min-w-16 h-16 px-2 bg-accent text-white text-2xs leading-none flex items-center justify-center border-2 border-border">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );

  return (
    <div
      ref={rootRef}
      className="flex items-center gap-4 flex-wrap justify-center px-6 py-6 border-t-2 border-border"
    >
      {micButton}
      {camButton}
      {shareButton}
      {reactButton}
      {handButton}
      <span className="w-8" />
      {tabButton('chat', 'Chat', '💬', chatUnread)}
      {tabButton('transcript', 'Transcript', '📝')}
      {tabButton('notes', 'Notes', '✨')}
      {tabButton('people', `People ${m.current?.participants.length ?? 1}`, '👥')}
      <span className="w-8" />
      <div className="relative">
        <button
          type="button"
          className={m.recordingSince !== null ? off : idle}
          onClick={() => (m.recordingSince !== null ? m.stopRecording() : toggle('record'))}
          disabled={!m.recordSupported && m.recordingSince === null}
          title={
            m.recordSupported
              ? 'Record the call to a video file'
              : 'Recording needs the browser (and a camera/microphone-capable page)'
          }
          data-testid="meeting-record"
        >
          ⏺{m.recordingSince !== null ? 'Stop recording' : 'Record'}
        </button>
        {menu === 'record' && (
          <Popover>
            <span className="text-sm max-w-240">
              Everyone in the call will see that you are recording. The video is saved on this
              computer when you stop.
            </span>
            <button
              type="button"
              className={off}
              onClick={() => {
                m.startRecording();
                setMenu(null);
              }}
            >
              Start recording
            </button>
          </Popover>
        )}
      </div>
      <button
        type="button"
        className={m.transcribeOn ? on : idle}
        onClick={() => m.setTranscription(!m.transcribeOn)}
        title={
          m.transcribeOn
            ? 'Turn transcription off for everyone'
            : 'Transcribe the call (each person decides for their own voice)'
        }
        data-testid="meeting-captions"
      >
        CC{m.transcribeOn ? ' on' : ''}
      </button>
      <div className="relative">
        <button
          type="button"
          className={m.music ? on : idle}
          onClick={() => toggle('music')}
          title="Background music for the call"
        >
          ♪{m.music ? ' Music' : 'Music'}
        </button>
        {menu === 'music' && (
          <Popover align="right">
            <span className="text-2xs text-text-muted max-w-240">
              Everyone in the call hears the same song, in sync. Built-in chiptunes, no account
              needed.
            </span>
            {MUSIC_TRACKS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={m.music?.track === t.id ? on : idle}
                onClick={() => m.setMusic(t.id)}
              >
                {m.music?.track === t.id ? '▶ ' : ''}
                {t.title}
                <span className="text-2xs text-text-muted">
                  {t.mood} · {t.bpm} bpm
                </span>
              </button>
            ))}
            <button
              type="button"
              className={idle}
              disabled={!m.music}
              onClick={() => m.setMusic(null)}
            >
              ■ Stop for everyone
            </button>
            <label className="flex items-center gap-6 text-2xs text-text-muted">
              Your volume
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(m.musicVolume * 100)}
                onChange={(e) => m.setMusicVolume(Number(e.target.value) / 100)}
                className="pixel-range flex-1"
                style={{ ['--range-fill' as string]: `${Math.round(m.musicVolume * 100)}%` }}
              />
            </label>
          </Popover>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          className={idle}
          onClick={() => toggle('devices')}
          title="Microphone, camera and speaker"
        >
          ⚙
        </button>
        {menu === 'devices' && (
          <Popover align="right">
            {(['audioinput', 'videoinput', 'audiooutput'] as const).map((kind) => {
              if (kind === 'audiooutput' && !canPickSpeaker()) return null;
              const key = kind === 'audioinput' ? 'mic' : kind === 'videoinput' ? 'cam' : 'speaker';
              const list = deviceList.filter((d) => d.kind === kind);
              return (
                <label key={kind} className="flex flex-col gap-2 text-2xs text-text-muted">
                  {kind === 'audioinput'
                    ? 'Microphone'
                    : kind === 'videoinput'
                      ? 'Camera'
                      : 'Speaker'}
                  <select
                    value={m.devices[key] ?? ''}
                    onChange={(e) =>
                      m.selectDevices({ ...m.devices, [key]: e.target.value || null })
                    }
                    className="bg-bg-dark text-text border-2 border-border rounded-none text-sm px-4 py-2 max-w-260"
                  >
                    <option value="">Default</option>
                    {list.map((d, i) => (
                      <option key={d.deviceId || i} value={d.deviceId}>
                        {d.label ||
                          `${kind === 'audioinput' ? 'Microphone' : kind === 'videoinput' ? 'Camera' : 'Speaker'} ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
            {!capture && (
              <span className="text-2xs text-warning max-w-240">{m.support.reason}</span>
            )}
          </Popover>
        )}
      </div>
      <span className="w-8" />
      {leaveButton}
    </div>
  );
}
