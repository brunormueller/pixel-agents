import { useState } from 'react';

import { FPS_MAX_BOTS } from '../../constants.js';
import { MAP_CHOICES, mapName } from '../../games/fps/maps.js';
import { loadFpsSettings, saveFpsSettings } from '../../games/fps/settings.js';
import type { FpsConfig, FpsDifficulty } from '../../games/fps/types.js';
import { DEFAULT_FPS_CONFIG } from '../../games/fps/types.js';
import { cleanConfig, describeConfig } from '../../games/model.js';
import type { GamesController } from '../../games/useGames.js';
import { Button } from '../ui/Button.js';
import { SidePanel } from '../ui/SidePanel.js';

interface GamesPanelProps {
  g: GamesController;
  /** In a room at all (hosting needs its connection too). */
  inRoom: boolean;
  onClose: () => void;
}

const DIFFICULTIES: Array<{ id: FpsDifficulty; label: string }> = [
  { id: 'easy', label: 'Easy' },
  { id: 'normal', label: 'Normal' },
  { id: 'hard', label: 'Hard' },
];
const FRAG_LIMITS = [5, 10, 20, 0];
const TIME_LIMITS = [3, 5, 10, 0];

/** A row of choices, one of them picked. */
function Choices<T extends string | number>({
  label,
  options,
  value,
  onChange,
  testId,
}: {
  label: string;
  options: Array<{ id: T; label: string; title?: string }>;
  value: T;
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      <span className="text-sm text-text-muted">{label}</span>
      <div className="flex flex-wrap gap-4">
        {options.map((o) => (
          <Button
            key={String(o.id)}
            size="sm"
            variant={o.id === value ? 'active' : 'default'}
            title={o.title}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Games you can play from the office. The first is Pixel Frag, a first-person
 * shooter: alone against bots (no room needed), or with the people in the room.
 */
export function GamesPanel({ g, inRoom, onClose }: GamesPanelProps) {
  const [cfg, setCfg] = useState<FpsConfig>(() =>
    cleanConfig(loadFpsSettings().lastConfig ?? DEFAULT_FPS_CONFIG),
  );
  const update = (patch: Partial<FpsConfig>) => {
    const next = cleanConfig({ ...cfg, ...patch });
    setCfg(next);
    saveFpsSettings({ ...loadFpsSettings(), lastConfig: next });
  };
  const others = g.matches.filter((m) => m.id !== g.current?.id);

  return (
    <SidePanel title="Games" onClose={onClose} testId="games-panel">
      <div className="flex flex-col gap-4 border-2 border-accent p-8">
        <span className="text-lg text-accent-bright">Pixel Frag</span>
        <span className="text-2xs text-text-muted">
          A first-person shooter in pixels. Play your own office — desks, walls and all — or an
          arena, against bots or the people in your room.
        </span>
      </div>

      {g.current && (
        <div className="flex flex-col gap-4 border-2 border-accent p-8">
          <span className="text-2xs text-text-muted">You are playing</span>
          <span className="text-base text-text">{g.current.title}</span>
          <span className="text-2xs text-text-muted">
            {g.current.players.map((p) => (p.self ? 'you' : p.name)).join(', ')}
          </span>
          <Button size="md" onClick={g.leave}>
            Leave the match
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-8 border-2 border-border p-8">
        <span className="text-base text-text">New match</span>
        <Choices
          label="Map"
          options={MAP_CHOICES.map((m) => ({ id: m.id, label: m.name, title: m.description }))}
          value={cfg.map}
          onChange={(map) => update({ map })}
          testId="fps-map"
        />
        <div className="flex flex-col gap-4">
          <span className="text-sm text-text-muted">Bots</span>
          <div className="flex items-center gap-6">
            <Button
              size="sm"
              onClick={() => update({ bots: Math.max(0, cfg.bots - 1) })}
              title="Fewer bots"
            >
              −
            </Button>
            <span className="text-base text-text w-24 text-center" data-testid="fps-bots">
              {cfg.bots}
            </span>
            <Button
              size="sm"
              onClick={() => update({ bots: Math.min(FPS_MAX_BOTS, cfg.bots + 1) })}
              title="More bots"
            >
              +
            </Button>
          </div>
        </div>
        {cfg.bots > 0 && (
          <Choices
            label="Bot skill"
            options={DIFFICULTIES}
            value={cfg.difficulty}
            onChange={(difficulty) => update({ difficulty })}
          />
        )}
        <Choices
          label="Frag limit"
          options={FRAG_LIMITS.map((n) => ({ id: n, label: n === 0 ? 'None' : `${n}` }))}
          value={cfg.fragLimit}
          onChange={(fragLimit) => update({ fragLimit })}
        />
        <Choices
          label="Time limit"
          options={TIME_LIMITS.map((n) => ({ id: n, label: n === 0 ? 'None' : `${n} min` }))}
          value={cfg.timeLimit}
          onChange={(timeLimit) => update({ timeLimit })}
        />
        <div className="flex flex-col gap-4">
          <Button
            variant="accent"
            size="md"
            onClick={() => g.startSolo(cfg)}
            title={
              cfg.bots === 0
                ? 'Walk the map alone (add bots to have someone to shoot)'
                : 'Just you and the bots'
            }
            data-testid="fps-play-solo"
          >
            Play solo
          </Button>
          <Button
            variant="default"
            size="md"
            onClick={() => g.host(cfg)}
            disabled={!g.available}
            title={
              g.available
                ? 'Start a match everyone in the room can join'
                : 'Join a room to play with other people'
            }
            data-testid="fps-host"
          >
            Host in the room
          </Button>
          {!inRoom && (
            <span className="text-2xs text-text-muted">
              Join a room (toolbar) to play with other people.
            </span>
          )}
          {g.notice && <span className="text-2xs text-warning">{g.notice}</span>}
        </div>
      </div>

      {inRoom && (
        <div className="flex flex-col gap-6">
          <span className="text-sm text-text-muted">
            {others.length === 0 ? 'No other matches in the room.' : 'Matches in the room'}
          </span>
          {others.map((m) => (
            <div
              key={m.id}
              className="flex flex-col gap-4 border-b-2 border-border pb-6"
              data-testid="room-match"
            >
              <span className="text-base text-text" style={{ overflowWrap: 'anywhere' }}>
                {m.title}
              </span>
              <span className="text-2xs text-text-muted">{describeConfig(m.cfg)}</span>
              <span className="text-2xs text-text-muted" style={{ overflowWrap: 'anywhere' }}>
                {m.players.map((p, i) => `${p.name}${i === 0 ? ' (host)' : ''}`).join(', ')}
              </span>
              <Button
                variant="accent"
                size="sm"
                disabled={!g.available}
                onClick={() => g.join(m.id)}
                data-testid="join-match"
              >
                Join · {mapName(m.cfg.map)}
              </Button>
            </div>
          ))}
        </div>
      )}
    </SidePanel>
  );
}
