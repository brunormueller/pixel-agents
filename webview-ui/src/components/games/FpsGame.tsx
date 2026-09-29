import { useEffect, useRef, useState } from 'react';

import {
  FPS_DEAD_EYE_HEIGHT,
  FPS_EYE_HEIGHT,
  FPS_KEY_TURN_SPEED,
  FPS_MAX_FOV_DEG,
  FPS_MIN_FOV_DEG,
  FPS_MOUSE_RADIANS_PER_PX,
  FPS_OVERLAY_Z_INDEX,
  FPS_PUFF_SEC,
  FPS_RENDER_HEIGHT,
  FPS_RENDER_MAX_WIDTH,
  FPS_RENDER_MIN_WIDTH,
} from '../../constants.js';
import { FpsAudio } from '../../games/fps/audio.js';
import { drawHud } from '../../games/fps/hud.js';
import type { FpsView } from '../../games/fps/render.js';
import { FpsRenderer } from '../../games/fps/render.js';
import type { FpsSession } from '../../games/fps/session.js';
import type { FpsSettings } from '../../games/fps/settings.js';
import { loadFpsSettings, saveFpsSettings } from '../../games/fps/settings.js';
import type { Billboard, WorldTextures } from '../../games/fps/sprites.js';
import {
  actorBillboard,
  buildWorldTextures,
  clearPropCache,
  propBillboard,
} from '../../games/fps/sprites.js';
import type { FpsInput, WeaponSlot } from '../../games/fps/types.js';
import { NO_INPUT } from '../../games/fps/types.js';
import {
  FPS_BLOOD_ART,
  FPS_ITEM_ART,
  FPS_MUZZLE_FLASH_ART,
  FPS_PUFF_ART,
} from '../../office/sprites/fpsArt.js';
import { Button } from '../ui/Button.js';
import { Checkbox } from '../ui/Checkbox.js';

interface FpsGameProps {
  session: FpsSession;
  title: string;
  solo: boolean;
  onLeave: () => void;
}

/** Keys the game takes for itself while it is open (the office never sees them). */
const GAME_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'KeyM',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
  'Space',
  'Tab',
  'Digit1',
  'Digit2',
  'Digit3',
]);

/** World units per pickup-art pixel. */
const ITEM_UNITS_PER_PX = 1 / 36;

/**
 * Pixel Frag, full screen over the office: the first-person view, the HUD,
 * and the menu (Esc) with the player's settings and the way out.
 */
export function FpsGame({ session, title, solo, onLeave }: FpsGameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<FpsSettings>(() => loadFpsSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(false);
  menuRef.current = menuOpen;
  const [locked, setLocked] = useState(false);
  const [lockFailed, setLockFailed] = useState(false);
  const lockFailedRef = useRef(false);
  lockFailedRef.current = lockFailed;
  const audioRef = useRef<FpsAudio | null>(null);

  // A solo game waits while its menu is open; a room match goes on.
  useEffect(() => {
    session.paused = solo && menuOpen;
  }, [session, solo, menuOpen]);

  useEffect(() => {
    saveFpsSettings(settings);
    audioRef.current?.setVolume(settings.volume);
  }, [settings]);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const renderer = new FpsRenderer();
    const audio = new FpsAudio();
    audio.setVolume(settingsRef.current.volume);
    audioRef.current = audio;
    const keys = new Set<string>();
    let turnPx = 0;
    let cycle = 0;
    let pick: WeaponSlot | null = null;
    let mouseFire = false;
    let mapVersion = -1;
    let textures: WorldTextures | null = null;
    let props: Billboard[] = [];
    let raf = 0;
    let last = performance.now();
    let wasLocked = false;
    let uiScale = 1;

    session.onSound = (sound, x, y) => {
      let gain = 1;
      if (x !== undefined && y !== undefined) {
        const d = Math.hypot(x - session.me.x, y - session.me.y);
        gain = 1 / (1 + (d * d) / 30);
      }
      audio.play(sound, gain);
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      uiScale = dpr * Math.max(0.6, Math.min(1.5, rect.height / 720));
      const aspect = rect.width / Math.max(1, rect.height);
      let h = FPS_RENDER_HEIGHT;
      let w = Math.round(h * aspect);
      if (w > FPS_RENDER_MAX_WIDTH) {
        w = FPS_RENDER_MAX_WIDTH;
        h = Math.max(1, Math.round(w / aspect));
      } else if (w < FPS_RENDER_MIN_WIDTH) {
        w = FPS_RENDER_MIN_WIDTH;
        h = Math.max(1, Math.round(w / aspect));
      }
      renderer.resize(w, h);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const requestLock = () => {
      try {
        const result = canvas.requestPointerLock() as unknown;
        if (result instanceof Promise) result.catch(() => setLockFailed(true));
      } catch {
        setLockFailed(true);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        // With the mouse caught, the browser takes Esc to let it go (and the menu opens then).
        if (document.pointerLockElement !== canvas) setMenuOpen((open) => !open);
        return;
      }
      if (menuRef.current || !GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      audio.unlock();
      if (e.code.startsWith('Digit')) pick = (Number(e.code.slice(5)) - 1) as WeaponSlot;
      else if (e.code === 'KeyM' && !e.repeat) {
        setSettings((s) => ({ ...s, minimap: !s.minimap }));
      }
      keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
      if (!menuRef.current && GAME_KEYS.has(e.code)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onBlur = () => {
      keys.clear();
      mouseFire = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (menuRef.current) return;
      // Caught mouse: every movement turns. Otherwise: drag with the right button held.
      if (document.pointerLockElement === canvas || (e.buttons & 2) !== 0) turnPx += e.movementX;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current || e.target !== canvas) return;
      audio.unlock();
      if (e.button !== 0) return;
      if (document.pointerLockElement !== canvas && !lockFailedRef.current) {
        requestLock();
        return;
      }
      mouseFire = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) mouseFire = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (menuRef.current) return;
      e.preventDefault();
      cycle += e.deltaY > 0 ? 1 : -1;
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onLockChange = () => {
      const isLocked = document.pointerLockElement === canvas;
      setLocked(isLocked);
      if (wasLocked && !isLocked) {
        mouseFire = false;
        setMenuOpen(true);
      }
      wasLocked = isLocked;
    };
    const onLockError = () => setLockFailed(true);

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('pointerlockerror', onLockError);

    const readInput = (dt: number): FpsInput => {
      if (menuRef.current) {
        turnPx = 0;
        return NO_INPUT;
      }
      const has = (...codes: string[]) => codes.some((c) => keys.has(c));
      const keyTurn = (has('ArrowRight', 'KeyE') ? 1 : 0) - (has('ArrowLeft', 'KeyQ') ? 1 : 0);
      const input: FpsInput = {
        forward: (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0),
        strafe: (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0),
        turn:
          turnPx * FPS_MOUSE_RADIANS_PER_PX * settingsRef.current.sensitivity +
          keyTurn * FPS_KEY_TURN_SPEED * dt,
        run: has('ShiftLeft', 'ShiftRight'),
        fire: mouseFire || has('Space'),
        weapon: pick,
        cycle: Math.sign(cycle),
      };
      turnPx = 0;
      pick = null;
      cycle = 0;
      return input;
    };

    const draw = () => {
      const world = session.world;
      const st = settingsRef.current;
      ctx.imageSmoothingEnabled = false;
      if (world) {
        if (session.mapVersion !== mapVersion || !textures) {
          mapVersion = session.mapVersion;
          clearPropCache();
          textures = buildWorldTextures(world.data);
          props = world.data.props.map((p) => propBillboard(p.t, p.x, p.y, p.z ?? 0));
        }
        const me = session.me;
        const walking = me.moving && me.alive;
        const time = performance.now() / 1000;
        const billboards: Billboard[] = [...props];
        for (const it of session.itemStates()) {
          if (!it.available) continue;
          const tex = FPS_ITEM_ART[it.k];
          billboards.push({
            x: it.x,
            y: it.y,
            z: 0.05 + Math.sin(time * 3 + it.x * 2) * 0.03,
            w: tex.w * ITEM_UNITS_PER_PX,
            h: tex.h * ITEM_UNITS_PER_PX,
            tex,
          });
        }
        for (const a of session.others()) {
          billboards.push(actorBillboard(a, me.x, me.y));
          if (a.flash > 0 && a.alive) {
            billboards.push({
              x: a.x + Math.cos(a.a) * 0.3,
              y: a.y + Math.sin(a.a) * 0.3,
              z: 0.35,
              w: 0.32,
              h: 0.26,
              tex: FPS_MUZZLE_FLASH_ART,
            });
          }
        }
        for (const p of session.puffs) {
          // One at the camera (a hit on you) would fill the screen.
          if (Math.hypot(p.x - me.x, p.y - me.y) < 0.6) continue;
          const size = 0.1 + (1 - p.t / FPS_PUFF_SEC) * 0.12;
          billboards.push({
            x: p.x,
            y: p.y,
            z: FPS_EYE_HEIGHT - size / 2,
            w: size,
            h: size,
            tex: p.blood ? FPS_BLOOD_ART : FPS_PUFF_ART,
          });
        }
        const sway = walking ? 1 : 0;
        const view: FpsView = {
          world,
          textures,
          x: me.x,
          y: me.y,
          a: me.a,
          fovRad: (st.fovDeg * Math.PI) / 180,
          eye: me.alive
            ? FPS_EYE_HEIGHT + Math.sin(me.walkPhase * 2.2) * 0.012 * sway
            : FPS_DEAD_EYE_HEIGHT,
          billboards,
          weapon:
            me.alive && !session.over
              ? {
                  slot: me.weapon,
                  kick: session.kick,
                  flash: me.flash > 0,
                  alt: me.shot % 2 === 1,
                  bobX: Math.sin(me.walkPhase * 1.1) * 3 * sway,
                  bobY: Math.abs(Math.cos(me.walkPhase * 1.1)) * 3 * sway,
                }
              : null,
        };
        ctx.drawImage(renderer.render(view), 0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      drawHud(ctx, session, {
        w: canvas.width,
        h: canvas.height,
        scale: uiScale,
        showScores: keys.has('Tab'),
        minimap: st.minimap,
      });
    };

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
      last = t;
      session.update(dt, readInput(dt));
      draw();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('pointerlockerror', onLockError);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      session.onSound = null;
      audio.dispose();
      audioRef.current = null;
    };
  }, [session]);

  const resume = () => {
    setMenuOpen(false);
    if (!lockFailed) {
      try {
        const result = canvasRef.current?.requestPointerLock() as unknown;
        if (result instanceof Promise) result.catch(() => setLockFailed(true));
      } catch {
        setLockFailed(true);
      }
    }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="absolute inset-0 bg-bg-dark outline-none"
      style={{ zIndex: FPS_OVERLAY_Z_INDEX }}
      data-testid="fps-game"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ imageRendering: 'pixelated', cursor: locked ? 'none' : 'crosshair' }}
      />

      {!locked && !menuOpen && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-120 pixel-panel py-6 px-12 text-sm text-center pointer-events-none">
          {lockFailed ? (
            <>
              Turn with ← → (or hold the right mouse button and drag) · click or Space to fire
              <br />
              <span className="text-text-muted">
                WASD move · Shift run · 1-3 weapons · Tab scores · Esc menu
              </span>
            </>
          ) : (
            <>
              Click to play
              <br />
              <span className="text-text-muted">WASD move · mouse aim · click fire · Esc menu</span>
            </>
          )}
        </div>
      )}

      {menuOpen && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <div
            className="pixel-panel p-12 flex flex-col gap-8"
            style={{ width: 380, maxWidth: 'calc(100% - 32px)' }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span className="text-xl text-accent-bright">Pixel Frag</span>
            <span className="text-sm text-text-muted" style={{ overflowWrap: 'anywhere' }}>
              {title}
              {solo ? ' — paused' : ' — the match goes on'}
            </span>
            <Button variant="accent" size="md" onClick={resume} data-testid="fps-resume">
              Resume
            </Button>
            <Slider
              label={`Mouse sensitivity ${settings.sensitivity.toFixed(1)}`}
              min={0.2}
              max={3}
              step={0.1}
              value={settings.sensitivity}
              onChange={(sensitivity) => setSettings((s) => ({ ...s, sensitivity }))}
            />
            <Slider
              label={`Field of view ${settings.fovDeg}°`}
              min={FPS_MIN_FOV_DEG}
              max={FPS_MAX_FOV_DEG}
              step={1}
              value={settings.fovDeg}
              onChange={(fovDeg) => setSettings((s) => ({ ...s, fovDeg }))}
            />
            <Slider
              label={`Volume ${Math.round(settings.volume * 100)}%`}
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(volume) => setSettings((s) => ({ ...s, volume }))}
            />
            <Checkbox
              checked={settings.minimap}
              onChange={() => setSettings((s) => ({ ...s, minimap: !s.minimap }))}
              label="Minimap (M)"
            />
            <p className="text-2xs text-text-muted m-0">
              WASD / arrows move · mouse or Q E turn · click or Space fire · Shift run · 1-3 or
              wheel switch weapon · Tab scoreboard
            </p>
            <Button variant="default" size="md" onClick={onLeave} data-testid="fps-leave">
              {solo ? 'Quit' : 'Leave the match'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}
