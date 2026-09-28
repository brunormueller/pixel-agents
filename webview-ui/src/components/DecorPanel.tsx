import type { DeskDecorItem } from '../../../core/src/messages.js';
import { DECOR_MAX_ITEMS } from '../constants.js';
import type { DecorItem, DeskPreset } from '../office/engine/decorCatalog.js';
import {
  DECOR_GROUPS,
  DECOR_ITEMS,
  decorItem,
  DESK_PRESETS,
  DESK_STYLES,
  isAvailable,
  seasonLabel,
} from '../office/engine/decorCatalog.js';
import { getCatalogEntry, getFrontVariant } from '../office/layout/furnitureCatalog.js';
import { SidePanel } from './ui/SidePanel.js';
import { SpriteThumb } from './ui/SpriteThumb.js';

interface DecorPanelProps {
  decor: DeskDecorItem[];
  hasDesk: boolean;
  /** Item in hand (a catalog variant; its ghost follows the mouse on the map), or null. */
  selected: string | null;
  onSelect: (type: string | null) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onPickDesk: () => void;
  onClose: () => void;
  /** Style your desk and chair are drawn in (null = as the room built them). */
  deskStyle: string | null;
  onDeskStyle: (style: string | null) => void;
  /** Items that came with the desk (the room's computer...) and were taken off. */
  takenOff: Array<{ uid: string; type: string }>;
  onPutBack: (uid: string) => void;
  onPreset: (preset: DeskPreset) => void;
}

function CatalogThumb({ type, size = 32 }: { type: string; size?: number }) {
  const entry = getCatalogEntry(type);
  return <SpriteThumb sprite={entry?.sprite ?? null} width={size} height={size} bottom />;
}

function Thumb({ item, dim }: { item: DecorItem; dim?: boolean }) {
  const entry = getCatalogEntry(item.id);
  return (
    <SpriteThumb
      sprite={entry?.sprite ?? null}
      width={32}
      height={32}
      bottom
      className={dim ? 'opacity-40' : undefined}
    />
  );
}

/**
 * Decorate your desk: pick an item from the catalog and put it down on the
 * map — desk items anywhere on your tabletop, to the pixel, turned toward your
 * chair (R turns them); plants on the floor, clocks and paintings on the wall.
 * The room sees it; it moves with you when you change desks. Seasonal items
 * are only offered around their date — placed ones stay.
 */
export function DecorPanel({
  decor,
  hasDesk,
  selected,
  onSelect,
  onRemove,
  onClear,
  onPickDesk,
  onClose,
  deskStyle,
  onDeskStyle,
  takenOff,
  onPutBack,
  onPreset,
}: DecorPanelProps) {
  const today = new Date();
  const full = decor.length >= DECOR_MAX_ITEMS;
  const known = DECOR_ITEMS.filter((i) => getCatalogEntry(i.id));
  const selectedId = selected ? getFrontVariant(selected) : null;

  return (
    <SidePanel title="Decorate your desk" onClose={onClose} testId="decor-panel">
      {!hasDesk ? (
        <div className="flex flex-col gap-6">
          <p className="text-sm text-text-muted m-0">
            Pick a desk first — decoration goes around it.
          </p>
          <button
            type="button"
            onClick={onPickDesk}
            className="self-start py-1 px-10 text-sm bg-accent text-white border-2 border-accent cursor-pointer"
          >
            Choose a desk
          </button>
        </div>
      ) : (
        <>
          {DESK_PRESETS.map((preset) => (
            <div key={preset.id} className="flex flex-col gap-4 border-2 border-accent p-6">
              <span className="text-sm text-accent-bright">{preset.label}</span>
              <span className="text-2xs text-text-muted">{preset.description}</span>
              <button
                type="button"
                onClick={() => onPreset(preset)}
                className="self-start py-1 px-10 text-sm bg-accent text-white border-2 border-accent cursor-pointer"
                data-testid="desk-preset"
              >
                Set up my desk like this
              </button>
              <span className="text-2xs text-text-muted">
                Replaces what is on your desk now. Move or remove anything afterwards.
              </span>
            </div>
          ))}
          <div className="flex flex-col gap-4">
            <span className="text-sm">Desk style</span>
            <div className="flex flex-wrap gap-4">
              {[{ id: null as string | null, label: 'As built' }, ...DESK_STYLES].map((s) => (
                <button
                  key={s.id ?? 'none'}
                  type="button"
                  onClick={() => onDeskStyle(s.id)}
                  title={
                    s.id ? `${s.label} desk, office chair` : 'The desk the room was built with'
                  }
                  className={`flex flex-col items-center gap-2 p-2 bg-bg-dark border-2 cursor-pointer ${deskStyle === s.id ? 'border-accent-bright' : 'border-border'}`}
                  data-testid="desk-style"
                  data-style={s.id ?? 'none'}
                >
                  {s.id ? (
                    <CatalogThumb type={`${s.id}_3`} size={40} />
                  ) : (
                    <span className="w-40 h-40 flex items-center justify-center text-2xs text-text-muted">
                      —
                    </span>
                  )}
                  <span className="text-2xs leading-none">{s.label}</span>
                </button>
              ))}
            </div>
            <span className="text-2xs text-text-muted">
              A styled desk faces the room: a chair behind it moves to the front, when there is
              room.
            </span>
          </div>
          {takenOff.length > 0 && (
            <div className="flex flex-col gap-4">
              <span className="text-sm">Taken off your desk</span>
              {takenOff.map((t) => (
                <div key={t.uid} className="flex items-center gap-6">
                  <CatalogThumb type={t.type} size={24} />
                  <span className="text-2xs flex-1">
                    {getCatalogEntry(t.type)?.label ?? t.type}
                  </span>
                  <button
                    type="button"
                    onClick={() => onPutBack(t.uid)}
                    className="bg-transparent border-none text-accent-bright underline p-0 cursor-pointer text-2xs"
                  >
                    put back
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="text-2xs text-text-muted m-0">
            {selected
              ? 'Move it over your desk and click to put it down (green = it fits). R turns it, Esc puts it back.'
              : full
                ? `Your desk is full (${DECOR_MAX_ITEMS} items). Remove one to add another.`
                : 'Pick an item and put it on your desk. On the map: click an item on your desk (yours, or the computer it came with) to move it, right-click to remove it.'}
          </p>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">
                On your desk ({decor.length}/{DECOR_MAX_ITEMS})
              </span>
              {decor.length > 0 && (
                <button
                  type="button"
                  onClick={onClear}
                  className="bg-transparent border-none text-text-muted underline p-0 cursor-pointer text-2xs"
                >
                  clear all
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-4">
              {decor.map((d, i) => {
                const item = decorItem(getFrontVariant(d.type));
                return (
                  <button
                    key={`${d.type}:${d.dc}:${d.dr}:${d.px ?? ''}:${d.py ?? ''}`}
                    type="button"
                    onClick={() => onRemove(i)}
                    title={`Remove ${item?.label ?? d.type}`}
                    className="relative p-2 bg-bg-dark border-2 border-border cursor-pointer"
                  >
                    {item ? <Thumb item={item} /> : <span className="text-2xs">{d.type}</span>}
                    <span className="absolute -top-6 -right-6 text-2xs bg-danger text-white px-2 leading-none">
                      ×
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {DECOR_GROUPS.map((group) => {
        const items = known.filter((i) => i.group === group.id);
        if (items.length === 0) return null;
        return (
          <div key={group.id} className="flex flex-col gap-4">
            <span className="text-sm text-text-muted">{group.label}</span>
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
            >
              {items.map((item) => {
                const available = isAvailable(item, today);
                const disabled = !hasDesk || !available || (full && selectedId !== item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => onSelect(selectedId === item.id ? null : item.id)}
                    title={
                      available
                        ? item.label
                        : `${item.label} — ${item.season?.name}: ${seasonLabel(item)}`
                    }
                    className={`flex flex-col items-center gap-2 p-2 bg-bg-dark border-2 ${selectedId === item.id ? 'border-accent-bright' : 'border-border'} ${disabled ? 'cursor-default' : 'cursor-pointer hover:border-accent'}`}
                    data-testid="decor-item"
                    data-decor-id={item.id}
                  >
                    <Thumb item={item} dim={!available} />
                    <span
                      className="text-2xs leading-none text-center"
                      style={{ overflowWrap: 'anywhere' }}
                    >
                      {item.label}
                    </span>
                    {item.season && (
                      <span
                        className={`text-2xs leading-none ${available ? 'text-accent-bright' : 'text-text-muted'}`}
                      >
                        {available ? item.season.name : seasonLabel(item).split(' – ')[0]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </SidePanel>
  );
}
