import { useEffect, useState } from 'react';

import { LEVEL_NAME_MAX_LENGTH, LEVEL_SWITCHER_REFRESH_MS, MAX_LEVELS } from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { levelsTopDown } from '../office/layout/levels.js';
import type { OfficeLevel } from '../office/types.js';
import { Button } from './ui/Button.js';

interface LevelSwitcherProps {
  officeState: OfficeState;
  isEditMode: boolean;
  onView: (levelId: string) => void;
  onAdd: (where: 'above' | 'below') => void;
  onRemove: (levelId: string) => void;
  onRename: (levelId: string, name: string) => void;
  onMove: (levelId: string, direction: 'up' | 'down') => void;
}

/**
 * The building's floors, top floor first: click one to look at it. Shows how
 * many people are on each and where you are. In the layout editor it also adds,
 * renames, reorders (which way the stairs go follows the order) and removes them.
 */
export function LevelSwitcher({
  officeState,
  isEditMode,
  onView,
  onAdd,
  onRemove,
  onRename,
  onMove,
}: LevelSwitcherProps) {
  // Who is where changes as people take the stairs: re-read a few times a second.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), LEVEL_SWITCHER_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const levels = officeState.levels;
  if (levels.length <= 1 && !isEditMode) return null;
  const view = officeState.getViewLevel();
  const counts = officeState.levelHeadcount();
  const here = officeState.avatarLevelId();
  const ordered = levelsTopDown(levels);
  const lowest = ordered[ordered.length - 1];
  const highest = ordered[0];

  const commitRename = (level: OfficeLevel) => {
    setRenaming(null);
    if (draft.trim() && draft.trim() !== level.name) onRename(level.id, draft);
  };

  return (
    <div
      className="absolute left-8 z-10 pixel-panel p-4 flex flex-col gap-2"
      style={{ top: 100, minWidth: 128, maxWidth: isEditMode ? 260 : 200 }}
      data-testid="level-switcher"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="text-2xs text-text-muted uppercase tracking-[0.08em] px-4">Floors</span>
      {ordered.map((level) => {
        const active = level.id === view.id;
        const count = counts.get(level.id) ?? 0;
        return (
          <div key={level.id} className="flex items-center gap-2">
            {renaming === level.id ? (
              <input
                type="text"
                value={draft}
                autoFocus
                maxLength={LEVEL_NAME_MAX_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(level)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(level);
                  else if (e.key === 'Escape') setRenaming(null);
                }}
                className="flex-1 min-w-0 text-sm py-1 px-4 bg-bg-dark border-2 border-accent rounded-none text-text"
                data-testid="level-rename-input"
              />
            ) : (
              <button
                type="button"
                onClick={() => onView(level.id)}
                onDoubleClick={() => {
                  if (!isEditMode) return;
                  setDraft(level.name);
                  setRenaming(level.id);
                }}
                title={
                  isEditMode ? `${level.name} — double-click to rename` : `Look at ${level.name}`
                }
                className={`flex-1 min-w-0 flex items-center gap-4 text-left text-sm py-1 px-6 border-2 rounded-none cursor-pointer ${
                  active
                    ? 'bg-active-bg border-accent text-text'
                    : 'bg-btn-bg border-transparent hover:bg-btn-hover text-text'
                }`}
                data-testid="level-button"
                data-level-id={level.id}
                data-active={active}
              >
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {level.name}
                </span>
                {here === level.id && (
                  <span
                    className="text-accent-bright"
                    title="You are here"
                    aria-label="You are here"
                  >
                    ●
                  </span>
                )}
                {count > 0 && (
                  <span className="text-2xs text-text-muted tabular-nums">{count}</span>
                )}
              </button>
            )}
            {isEditMode && active && levels.length > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2! disabled:opacity-(--btn-disabled-opacity) disabled:cursor-default"
                  onClick={() => onMove(level.id, 'up')}
                  disabled={level.id === highest.id}
                  title="Move this floor up (stairs to it then go the other way)"
                >
                  ▲
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2! disabled:opacity-(--btn-disabled-opacity) disabled:cursor-default"
                  onClick={() => onMove(level.id, 'down')}
                  disabled={level.id === lowest.id}
                  title="Move this floor down"
                >
                  ▼
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2! disabled:opacity-(--btn-disabled-opacity) disabled:cursor-default"
                  onClick={() => {
                    if (confirmRemove === level.id) {
                      setConfirmRemove(null);
                      onRemove(level.id);
                    } else {
                      setConfirmRemove(level.id);
                    }
                  }}
                  onBlur={() => setConfirmRemove(null)}
                  title="Remove this floor and everything on it"
                  data-testid="level-remove"
                >
                  {confirmRemove === level.id ? 'Sure?' : 'x'}
                </Button>
              </>
            )}
          </div>
        );
      })}
      {isEditMode && (
        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            className="flex-1 px-4! disabled:opacity-(--btn-disabled-opacity) disabled:cursor-default"
            onClick={() => onAdd('above')}
            disabled={levels.length >= MAX_LEVELS}
            title="Add a floor on top (a copy of this floor's walls and floor)"
            data-testid="level-add-above"
          >
            + Up
          </Button>
          <Button
            size="sm"
            className="flex-1 px-4! disabled:opacity-(--btn-disabled-opacity) disabled:cursor-default"
            onClick={() => onAdd('below')}
            disabled={levels.length >= MAX_LEVELS}
            title="Add a floor underneath (a basement)"
            data-testid="level-add-below"
          >
            + Down
          </Button>
        </div>
      )}
    </div>
  );
}
