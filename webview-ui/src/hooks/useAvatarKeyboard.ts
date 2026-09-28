import { useEffect } from 'react';

import { emoteForKey } from '../office/engine/emotes.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { keyToDirection } from '../office/engine/presence.js';

const isTypingTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
};

/**
 * Arrow keys / WASD walk the person's character around the room — only while
 * Claude isn't driving it (then it works at the desk). Holding a key keeps
 * walking: the office steps the character tile by tile while the key is down.
 * Number keys 1-8 play emotes (dance toggles). `onBusy` fires when a movement
 * key or a motion emote is pressed while Claude has the character.
 */
export function useAvatarKeyboard(
  getOfficeState: () => OfficeState,
  enabled: boolean,
  onBusy: () => void,
): void {
  useEffect(() => {
    if (!enabled) return;
    const os = getOfficeState();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const emote = emoteForKey(e.key);
      if (emote && os.avatarId !== null) {
        if (!e.repeat && !os.playEmote(emote)) onBusy();
        return;
      }
      const dir = keyToDirection(e.key);
      if (dir === null || os.avatarId === null) return;
      e.preventDefault(); // arrows would scroll the page
      if (!os.avatarIsManual()) {
        if (!e.repeat) onBusy();
        return;
      }
      os.avatarHeldDir = dir;
      os.cameraFollowId = os.avatarId;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (keyToDirection(e.key) === os.avatarHeldDir) os.avatarHeldDir = null;
    };
    const release = () => {
      os.avatarHeldDir = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      release();
    };
  }, [getOfficeState, enabled, onBusy]);
}
