import { useEffect, useState } from 'react';

import { ELEVATOR_PICKER_REFRESH_MS } from '../constants.js';
import type { OfficeState } from '../office/engine/officeState.js';

interface ElevatorPickerProps {
  officeState: OfficeState;
}

/**
 * The person walked into an elevator that stops at more than one other floor:
 * which one? Number keys pick too (1 = top floor). Walking away closes it.
 */
export function ElevatorPicker({ officeState }: ElevatorPickerProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), ELEVATOR_PICKER_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  const prompt = officeState.elevatorPrompt;

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        officeState.closeElevatorPrompt();
        setTick((n) => n + 1);
        return;
      }
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1) return;
      const stop = prompt.stops[n - 1];
      if (stop?.uid) {
        // The number keys are emotes otherwise: this one is the elevator's.
        e.preventDefault();
        e.stopImmediatePropagation();
        officeState.rideElevator(stop.uid);
        setTick((t) => t + 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [prompt, officeState]);

  if (!prompt) return null;
  return (
    <div
      className="absolute bottom-60 left-1/2 -translate-x-1/2 z-30 pixel-panel py-6 px-10 flex flex-col gap-4 items-center"
      data-testid="elevator-picker"
    >
      <span className="text-sm">Elevator — which floor?</span>
      <div className="flex flex-wrap gap-4 justify-center">
        {prompt.stops.map((stop, i) => (
          <button
            key={stop.levelId}
            type="button"
            disabled={!stop.uid}
            onClick={() => {
              if (stop.uid) officeState.rideElevator(stop.uid);
              setTick((n) => n + 1);
            }}
            className={`text-sm py-2 px-10 border-2 rounded-none ${
              stop.uid
                ? 'bg-btn-bg border-transparent hover:bg-btn-hover cursor-pointer'
                : 'bg-active-bg border-accent cursor-default'
            }`}
            title={stop.uid ? `Press ${i + 1}` : 'You are here'}
            data-testid="elevator-stop"
          >
            {stop.uid ? `${stop.rise > 0 ? '▲' : '▼'} ${stop.name}` : `● ${stop.name}`}
          </button>
        ))}
      </div>
    </div>
  );
}
