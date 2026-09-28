import { useEffect, useRef } from 'react';

import { getCachedSprite } from '../../office/sprites/spriteCache.js';
import type { SpriteData } from '../../office/types.js';

interface SpriteThumbProps {
  sprite: SpriteData | null;
  /** Canvas size in CSS px; the sprite is scaled to fit, pixel-sharp. */
  width: number;
  height: number;
  /** Anchor the sprite to the bottom (characters, standing things) instead of centering it. */
  bottom?: boolean;
  className?: string;
}

/** A sprite drawn pixel-perfect into a small canvas (avatar preview, decoration picker). */
export function SpriteThumb({ sprite, width, height, bottom, className }: SpriteThumbProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!sprite || sprite.length === 0) return;
    const sw = sprite[0]?.length ?? 0;
    const sh = sprite.length;
    if (sw === 0) return;
    // Integer device pixels per sprite pixel keeps it crisp.
    const zoom = Math.max(1, Math.floor(Math.min(canvas.width / sw, canvas.height / sh)));
    const cached = getCachedSprite(sprite, zoom);
    const x = Math.floor((canvas.width - cached.width) / 2);
    const y = bottom
      ? canvas.height - cached.height
      : Math.floor((canvas.height - cached.height) / 2);
    ctx.drawImage(cached, x, y);
  }, [sprite, width, height, bottom]);
  return (
    <canvas
      ref={ref}
      style={{ width, height, imageRendering: 'pixelated' }}
      className={className}
    />
  );
}
