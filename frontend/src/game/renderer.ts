// Canvas renderer. World-space drawing via a camera transform.
// Keeps the DOM contract minimal: `render(ctx, world, viewport)` and that's it.
// No React state here — the React layer owns the <canvas> + dt loop and calls us.

import { WORLD_RADIUS, bodyLengthOf, radiusOf } from './engine';
import type { World } from './engine';
import type { Pellet, PoolWarning, Snake } from './types';

// Matte palette — no neon tones, no glow shadows.
const BG_COLOR = '#0b0e12';
const GRID_DOT_COLOR = '#141820';
const WORLD_EDGE_COLOR = '#1c2230';
const WORLD_EDGE_WARN_COLOR = '#2b1f1f';

export interface Viewport {
  /** CSS-pixel width/height of the drawing surface. */
  width: number;
  height: number;
  /** World coord at screen center. */
  cameraX: number;
  cameraY: number;
  /** World units per CSS pixel. `<1` zooms out (shows more world). */
  zoom: number;
}

/**
 * Derives a stable zoom factor from mass: bigger snake → camera pulls out.
 * Log curve so early growth is felt but late game doesn't zoom to oblivion.
 */
export function zoomForMass(mass: number): number {
  return 1 / (0.82 + Math.log1p(mass) * 0.095);
}

/**
 * Compute viewport for a given canvas size + camera anchor. Separate
 * function so the UI layer can reuse zoom logic (e.g. for the pool arrow).
 */
export function makeViewport(
  cssWidth: number,
  cssHeight: number,
  cameraX: number,
  cameraY: number,
  zoom: number,
): Viewport {
  return { width: cssWidth, height: cssHeight, cameraX, cameraY, zoom };
}

// ─── Public entry ─────────────────────────────────────────────────────────────
export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  viewport: Viewport,
  warning: PoolWarning | null,
): void {
  // Background (identity transform).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, viewport.width, viewport.height);

  // World-space transform.
  const halfW = viewport.width / 2;
  const halfH = viewport.height / 2;
  ctx.setTransform(
    viewport.zoom,
    0,
    0,
    viewport.zoom,
    halfW - viewport.cameraX * viewport.zoom,
    halfH - viewport.cameraY * viewport.zoom,
  );

  // AABB of the visible world.
  const invZ = 1 / viewport.zoom;
  const vMinX = viewport.cameraX - halfW * invZ;
  const vMaxX = viewport.cameraX + halfW * invZ;
  const vMinY = viewport.cameraY - halfH * invZ;
  const vMaxY = viewport.cameraY + halfH * invZ;

  drawGridDots(ctx, vMinX, vMinY, vMaxX, vMaxY);
  drawWorldBoundary(ctx);
  drawPellets(ctx, world, vMinX, vMinY, vMaxX, vMaxY);
  drawSnakes(ctx, world, vMinX, vMinY, vMaxX, vMaxY);

  // Pool warning (screen-space overlay).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (warning) drawPoolWarning(ctx, viewport, warning);

  // Minimap (always on, bottom-left).
  drawMinimap(ctx, world, viewport);
}

// ─── Background + boundary ───────────────────────────────────────────────────
function drawGridDots(
  ctx: CanvasRenderingContext2D,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  // Subtle dot grid every 120 world units — matte, no lines (lines create
  // busy ceiling/floor vibes that fight the matte aesthetic).
  const step = 120;
  const startX = Math.floor(minX / step) * step;
  const startY = Math.floor(minY / step) * step;
  ctx.fillStyle = GRID_DOT_COLOR;
  for (let x = startX; x <= maxX; x += step) {
    for (let y = startY; y <= maxY; y += step) {
      if (x * x + y * y > WORLD_RADIUS * WORLD_RADIUS) continue;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }
}

function drawWorldBoundary(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = WORLD_EDGE_WARN_COLOR;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, WORLD_RADIUS - 8, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = WORLD_EDGE_COLOR;
  ctx.stroke();
}

// ─── Pellets ─────────────────────────────────────────────────────────────────
/**
 * Draws only pellets whose bounding rect intersects the viewport, batched
 * by color so we pay one fill() per color, not one per pellet.
 *
 * Batching produces a measurable win because with ~400 visible pellets
 * over 6 palette colors we drop from ~400 state changes to 6.
 */
function drawPellets(
  ctx: CanvasRenderingContext2D,
  world: World,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  // Bucket indices by color. Using objects keyed by hex keeps GC churn low
  // (same string refs every frame from PELLET_COLORS).
  const buckets = new Map<string, Pellet[]>();
  world.grid.forEachInRect(minX, minY, maxX, maxY, (idx: number) => {
    const p = world.pellets[idx];
    if (!p.alive) return;
    let arr = buckets.get(p.color);
    if (!arr) {
      arr = [];
      buckets.set(p.color, arr);
    }
    arr.push(p);
  });

  // Non-pool pellets: flat disc, no outline.
  buckets.forEach((arr, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (p.pool) continue;
      ctx.moveTo(p.x + p.size, p.y);
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    }
    ctx.fill();
  });

  // Pool pellets: filled disc + thin matte ring so they read as "special"
  // without any glow effect. Second pass to keep them above field pellets.
  buckets.forEach((arr) => {
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p.pool) continue;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#0b0e12';
      ctx.stroke();
    }
  });
}
// ─── Snakes ──────────────────────────────────────────────────────────────────
function drawSnakes(
  ctx: CanvasRenderingContext2D,
  world: World,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  // Draw bots first so the self snake is always on top.
  for (let i = 0; i < world.bots.length; i++) {
    drawOneSnake(ctx, world.bots[i], world.now, minX, minY, maxX, maxY);
  }
  if (world.self.alive || world.self.trail.length > 0) {
    drawOneSnake(ctx, world.self, world.now, minX, minY, maxX, maxY);
  }
}

function drawOneSnake(
  ctx: CanvasRenderingContext2D,
  snake: Snake,
  now: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): void {
  if (!snake.alive) return;

  // Viewport cull: skip if the snake's AABB is off-screen. AABB padded by
  // body length (mass-driven) so long bodies don't pop in.
  const pad = bodyLengthOf(snake.mass) + 20;
  if (
    snake.headX + pad < minX ||
    snake.headX - pad > maxX ||
    snake.headY + pad < minY ||
    snake.headY - pad > maxY
  ) {
    return;
  }

  const radius = radiusOf(snake.mass);
  const trail = snake.trail;
  if (trail.length < 2) return;

  const isGhost = now < snake.ghostUntil;
  const prevAlpha = ctx.globalAlpha;
  if (isGhost) ctx.globalAlpha = 0.32;

  // Build body path once, stroke twice (outline then fill).
  ctx.beginPath();
  ctx.moveTo(trail[trail.length - 1].x, trail[trail.length - 1].y);
  for (let i = trail.length - 2; i >= 0; i--) {
    ctx.lineTo(trail[i].x, trail[i].y);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.lineWidth = (radius + 2.2) * 2;
  ctx.strokeStyle = snake.outlineColor;
  ctx.stroke();

  ctx.lineWidth = radius * 2;
  ctx.strokeStyle = snake.color;
  ctx.stroke();

  drawSnakeHead(ctx, snake, radius);
  drawSnakeLabel(ctx, snake);

  ctx.globalAlpha = prevAlpha;
}

function drawSnakeHead(
  ctx: CanvasRenderingContext2D,
  snake: Snake,
  radius: number,
): void {
  // Two matte eyes with dark pupils, offset along the heading vector.
  const eyeOffset = radius * 0.55;
  const eyeRadius = Math.max(2.5, radius * 0.28);
  const pupilRadius = Math.max(1.3, eyeRadius * 0.55);
  const perp = snake.angle + Math.PI / 2;
  const cosP = Math.cos(perp);
  const sinP = Math.sin(perp);
  const cosA = Math.cos(snake.angle);
  const sinA = Math.sin(snake.angle);

  // Eyes slightly ahead of the head center for direction clarity.
  const forward = radius * 0.25;
  const eyeCX = snake.headX + cosA * forward;
  const eyeCY = snake.headY + sinA * forward;

  for (const s of [1, -1]) {
    const ex = eyeCX + cosP * eyeOffset * s;
    const ey = eyeCY + sinP * eyeOffset * s;
    ctx.fillStyle = '#f2f4f7';
    ctx.beginPath();
    ctx.arc(ex, ey, eyeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b0e12';
    ctx.beginPath();
    ctx.arc(
      ex + cosA * eyeRadius * 0.35,
      ey + sinA * eyeRadius * 0.35,
      pupilRadius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawSnakeLabel(
  ctx: CanvasRenderingContext2D,
  snake: Snake,
): void {
  const r = radiusOf(snake.mass);
  ctx.font =
    '600 13px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = snake.isBot ? '#cbd5e1' : '#ffffff';
  ctx.fillText(snake.name, snake.headX, snake.headY - r - 6);
}

// ─── Pool warning (screen-space arrow) ───────────────────────────────────────
/**
 * Projects the pool target onto the viewport edge and draws a matte arrow
 * pointing toward it. No glow — matte triangle + thin label.
 */
function drawPoolWarning(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  w: PoolWarning,
): void {
  const halfW = vp.width / 2;
  const halfH = vp.height / 2;
  const dx = w.x - vp.cameraX;
  const dy = w.y - vp.cameraY;
  const sx = halfW + dx * vp.zoom;
  const sy = halfH + dy * vp.zoom;

  // If target is already visible, draw a crosshair ring; else draw an
  // edge arrow pointing toward it.
  const inside =
    sx > 40 && sx < vp.width - 40 && sy > 40 && sy < vp.height - 40;

  ctx.save();
  if (inside) {
    ctx.strokeStyle = '#e6b04a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx, sy, 36, 0, Math.PI * 2);
    ctx.strokeStyle = '#e6b04a55';
    ctx.stroke();
  } else {
    // Clip the line from screen center to the target against the viewport
    // rect, inset by 32px. The clipped endpoint is where we draw the arrow.
    const pad = 44;
    const vx = sx - halfW;
    const vy = sy - halfH;
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx / len;
    const uy = vy / len;

    // Scale so the arrow sits on the inset rect edge.
    const tX = (Math.sign(ux) * (halfW - pad)) / (ux || 1e-6);
    const tY = (Math.sign(uy) * (halfH - pad)) / (uy || 1e-6);
    const t = Math.min(Math.abs(tX), Math.abs(tY));
    const ax = halfW + ux * t;
    const ay = halfH + uy * t;

    const ang = Math.atan2(uy, ux);
    const size = 16;
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.fillStyle = '#e6b04a';
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.7, size * 0.65);
    ctx.lineTo(-size * 0.4, 0);
    ctx.lineTo(-size * 0.7, -size * 0.65);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// ─── Minimap ─────────────────────────────────────────────────────────────────
/**
 * Bottom-RIGHT minimap. Shows world disc, self as a colored dot, bots
 * as muted dots. Flat matte panel — no background glow, no shadow.
 *
 * Anchored bottom-right so the cash-out / mass HUD on the bottom-left
 * has its own breathing room.
 */
function drawMinimap(
  ctx: CanvasRenderingContext2D,
  world: World,
  vp: Viewport,
): void {
  const size = 140;
  const pad = 16;
  // Panel rect anchored to the bottom-right corner.
  const panelX = vp.width - pad - size - 4;
  const panelY = vp.height - pad - size - 4;
  const panelW = size + 8;
  const panelH = size + 8;
  // Disc center derived from the panel rect (so changes to padding only
  // need to be made once).
  const cx = panelX + 4 + size / 2;
  const cy = panelY + 4 + size / 2;

  // Flat background panel (thin matte border, no shadow).
  ctx.fillStyle = '#10141a';
  ctx.fillRect(panelX, panelY, panelW, panelH);
  ctx.strokeStyle = '#1f2631';
  ctx.lineWidth = 1;
  ctx.strokeRect(panelX, panelY, panelW, panelH);

  // World disc.
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = '#0b0e12';
  ctx.fill();
  ctx.strokeStyle = '#1c2230';
  ctx.stroke();

  const scale = (size / 2 - 6) / WORLD_RADIUS;

  // Bots
  ctx.fillStyle = '#6b7280';
  for (let i = 0; i < world.bots.length; i++) {
    const b = world.bots[i];
    if (!b.alive) continue;
    ctx.fillRect(cx + b.headX * scale - 1, cy + b.headY * scale - 1, 2, 2);
  }

  // Self
  if (world.self.alive) {
    ctx.fillStyle = world.self.color;
    ctx.beginPath();
    ctx.arc(
      cx + world.self.headX * scale,
      cy + world.self.headY * scale,
      3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}
