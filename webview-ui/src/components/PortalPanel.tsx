import { levelsTopDown } from '../office/layout/levels.js';
import type { PortalInfo } from '../office/layout/portals.js';
import type { OfficeLevel } from '../office/types.js';
import { Checkbox } from './ui/Checkbox.js';

interface PortalPanelProps {
  info: PortalInfo;
  levels: OfficeLevel[];
  onSetStairsTarget: (uid: string, levelId: string) => void;
  onSetElevatorStop: (uid: string, levelId: string, stops: boolean) => void;
}

/** Up or down, by the two levels' order in the building. */
function direction(from: OfficeLevel | null, to: OfficeLevel): string {
  return (to.elevation ?? 0) > (from?.elevation ?? 0) ? 'up' : 'down';
}

/**
 * The layout editor's settings for the selected stairs or elevator: which floor
 * the stairs lead to (their other end moves there), and which floors the
 * elevator stops at (a door appears on each). Up or down follows the floors'
 * order — reorder the floors to flip it.
 */
export function PortalPanel({
  info,
  levels,
  onSetStairsTarget,
  onSetElevatorStop,
}: PortalPanelProps) {
  const others = levelsTopDown(levels).filter((l) => l.id !== info.level?.id);
  return (
    <div
      className="absolute bottom-76 right-10 z-10 pixel-panel p-8 flex flex-col gap-6"
      style={{ width: 230 }}
      data-testid="portal-panel"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="text-base">{info.kind === 'stairs' ? 'Stairs' : 'Elevator'}</span>
      {others.length === 0 ? (
        <span className="text-sm text-text-muted">
          Add another floor (Floors panel, + Up / + Down) to connect it.
        </span>
      ) : info.kind === 'stairs' ? (
        <>
          <span className="text-sm text-text-muted" data-testid="stairs-summary">
            {info.target
              ? `Go ${direction(info.level, info.target)} to ${info.target.name}.`
              : 'Leads nowhere yet: pick a floor.'}
          </span>
          <span className="text-2xs text-text-muted uppercase tracking-[0.08em]">Lead to</span>
          <div className="flex flex-col gap-2">
            {others.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onSetStairsTarget(info.uid, l.id)}
                className={`flex items-center justify-between text-sm py-1 px-6 border-2 rounded-none cursor-pointer ${
                  info.target?.id === l.id
                    ? 'bg-active-bg border-accent'
                    : 'bg-btn-bg border-transparent hover:bg-btn-hover'
                }`}
                data-testid="stairs-target"
              >
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{l.name}</span>
                <span className="text-2xs text-text-muted">
                  {direction(info.level, l) === 'up' ? '▲ up' : '▼ down'}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <span className="text-2xs text-text-muted uppercase tracking-[0.08em]">Stops at</span>
          <div className="flex flex-col">
            {levelsTopDown(levels).map((l) => {
              const own = l.id === info.level?.id;
              const stops = info.stops.includes(l.id);
              return (
                <Checkbox
                  key={l.id}
                  checked={stops}
                  label={own ? `${l.name} (this door)` : l.name}
                  onChange={() => {
                    if (!own) onSetElevatorStop(info.uid, l.id, !stops);
                  }}
                  className="text-sm py-2!"
                />
              );
            })}
          </div>
        </>
      )}
      <span className="text-2xs text-text-muted">
        Used from the tile in front of it. Walk into it (or let Claude take it) to change floors.
      </span>
    </div>
  );
}
