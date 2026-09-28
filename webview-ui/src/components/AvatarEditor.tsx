import { useEffect, useMemo, useState } from 'react';

import type { AvatarLook } from '../../../core/src/messages.js';
import {
  HAIR_SWATCHES,
  LOOK_PREVIEW_SCALE,
  LOOK_PREVIEW_TURN_MS,
  OUTFIT_SWATCHES,
  WALK_FRAME_DURATION_SEC,
} from '../constants.js';
import { ACCESSORY_OPTIONS, isOnePiece } from '../office/sprites/avatarLook.js';
import { getCharacterSprites, getLoadedCharacterCount } from '../office/sprites/spriteData.js';
import { Direction } from '../office/types.js';
import { Modal } from './ui/Modal.js';
import { SpriteThumb } from './ui/SpriteThumb.js';

interface AvatarEditorProps {
  initial: AvatarLook;
  /** The person already has a look of their own (so "Automatic" means something). */
  hasCustomLook: boolean;
  onSave: (look: AvatarLook) => void;
  /** Back to the character the office picks. */
  onReset: () => void;
  onClose: () => void;
}

const TURN: Direction[] = [Direction.DOWN, Direction.RIGHT, Direction.UP, Direction.LEFT];

function SwatchRow({
  label,
  swatches,
  value,
  onChange,
  disabled,
}: {
  label: string;
  swatches: ReadonlyArray<{ label: string; color: string }>;
  value: number;
  onChange: (index: number) => void;
  disabled?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm text-text-muted">{label}</span>
      {disabled ? (
        <span className="text-2xs text-text-muted">{disabled}</span>
      ) : (
        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            title="Original"
            aria-label={`${label}: original`}
            onClick={() => onChange(-1)}
            className={`w-20 h-20 p-0 text-2xs bg-btn-bg text-text cursor-pointer border-2 ${value === -1 ? 'border-accent-bright' : 'border-border'}`}
          >
            –
          </button>
          {swatches.map((s, i) => (
            <button
              key={s.label}
              type="button"
              title={s.label}
              aria-label={`${label}: ${s.label}`}
              onClick={() => onChange(i)}
              className={`w-20 h-20 p-0 cursor-pointer border-2 ${value === i ? 'border-accent-bright' : 'border-border'}`}
              style={{ background: s.color }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Customize your character": body, hair color, clothes colors and an
 * accessory, with a live preview that walks and turns. Saved to the profile
 * and shown to everyone in the room.
 */
export function AvatarEditor({
  initial,
  hasCustomLook,
  onSave,
  onReset,
  onClose,
}: AvatarEditorProps) {
  const [look, setLook] = useState<AvatarLook>(initial);
  const [turn, setTurn] = useState(0);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTurn((n) => (n + 1) % TURN.length), LOOK_PREVIEW_TURN_MS);
    const w = setInterval(() => setStep((n) => (n + 1) % 4), WALK_FRAME_DURATION_SEC * 1000);
    return () => {
      clearInterval(t);
      clearInterval(w);
    };
  }, []);

  const bodies = getLoadedCharacterCount();
  const preview = useMemo(() => getCharacterSprites(look.body, 0, look), [look]);
  const set = (patch: Partial<AvatarLook>) => setLook((l) => ({ ...l, ...patch }));
  const onePiece = isOnePiece(look.body);

  return (
    <Modal isOpen onClose={onClose} title="Your character" zIndex={52}>
      <div
        className="px-10 pb-8 flex gap-14"
        style={{ maxWidth: 'calc(100vw - 40px)' }}
        data-testid="avatar-editor"
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-8">
          <div className="bg-bg-dark border-2 border-border p-8">
            <SpriteThumb
              sprite={preview.walk[TURN[turn]][step]}
              width={16 * LOOK_PREVIEW_SCALE}
              height={32 * LOOK_PREVIEW_SCALE}
              bottom
            />
          </div>
          <span
            className="text-2xs text-text-muted text-center"
            style={{ maxWidth: 16 * LOOK_PREVIEW_SCALE + 20 }}
          >
            Everyone in the room sees you like this.
          </span>
        </div>

        <div className="flex flex-col gap-10" style={{ width: 300, maxWidth: '60vw' }}>
          <div className="flex flex-col gap-4">
            <span className="text-sm text-text-muted">Body</span>
            <div className="flex flex-wrap gap-4">
              {Array.from({ length: bodies }, (_, i) => (
                <button
                  key={i}
                  type="button"
                  title={`Body ${i + 1}`}
                  aria-label={`Body ${i + 1}`}
                  onClick={() => set({ body: i, bottom: isOnePiece(i) ? -1 : look.bottom })}
                  className={`p-2 bg-bg-dark cursor-pointer border-2 ${look.body === i ? 'border-accent-bright' : 'border-border'}`}
                >
                  <SpriteThumb
                    sprite={getCharacterSprites(i, 0).walk[Direction.DOWN][1]}
                    width={32}
                    height={48}
                    bottom
                  />
                </button>
              ))}
            </div>
          </div>
          <SwatchRow
            label="Hair"
            swatches={HAIR_SWATCHES}
            value={look.hair}
            onChange={(hair) => set({ hair })}
          />
          <SwatchRow
            label={onePiece ? 'Outfit' : 'Top'}
            swatches={OUTFIT_SWATCHES}
            value={look.top}
            onChange={(top) => set({ top })}
          />
          <SwatchRow
            label="Bottom"
            swatches={OUTFIT_SWATCHES}
            value={look.bottom}
            onChange={(bottom) => set({ bottom })}
            disabled={onePiece ? 'This outfit is one piece: color it with the top.' : undefined}
          />
          <div className="flex flex-col gap-4">
            <span className="text-sm text-text-muted">Accessory</span>
            <div className="flex flex-wrap gap-4">
              {ACCESSORY_OPTIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => set({ accessory: a.id })}
                  className={`py-1 px-8 text-sm bg-btn-bg text-text cursor-pointer border-2 ${look.accessory === a.id ? 'border-accent-bright' : 'border-transparent'}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-8 mt-4">
            <button
              type="button"
              onClick={onReset}
              disabled={!hasCustomLook}
              title="Let the office pick your character again"
              className={`bg-transparent border-none text-text-muted text-sm underline p-0 ${hasCustomLook ? 'cursor-pointer' : 'opacity-[var(--btn-disabled-opacity)] cursor-default'}`}
            >
              Automatic
            </button>
            <button
              type="button"
              onClick={() => onSave(look)}
              className="py-4 px-20 text-lg bg-accent text-white border-2 border-accent rounded-none shadow-pixel cursor-pointer"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
