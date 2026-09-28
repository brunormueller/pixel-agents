import type { ReactNode } from 'react';

import { SIDE_PANEL_WIDTH_PX } from '../../constants.js';
import { Button } from './Button.js';

interface SidePanelProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}

/** A panel docked on the right (people, calendar, music, decorate) — one at a time, like the chat. */
export function SidePanel({ title, onClose, children, testId }: SidePanelProps) {
  return (
    <div
      className="absolute top-10 right-10 bottom-80 z-30 pixel-panel flex flex-col"
      style={{ width: SIDE_PANEL_WIDTH_PX, maxWidth: 'calc(100% - 20px)' }}
      data-testid={testId}
      // Typing here must not reach the window-level shortcuts (movement keys, editor keys).
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-center justify-between px-8 py-4 border-b-2 border-border">
        <span className="text-lg text-accent-bright">{title}</span>
        <Button variant="ghost" size="icon" onClick={onClose} title="Close">
          ×
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto pixel-scrollbar px-8 py-6 flex flex-col gap-8">
        {children}
      </div>
    </div>
  );
}
