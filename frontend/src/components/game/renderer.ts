import type { Snake, Food, PoolEvent, Vector2 } from './types';

export interface RenderPayload {
  snakes: Snake[];
  foods: Food[];
  pools: PoolEvent[];
  mapRadius: number;
  playerHead: Vector2 | null;
  gameTime: number;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  render(payload: RenderPayload): void {
    const { ctx } = this;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // Background
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, w, h);

    const camX = payload.playerHead?.x ?? 0;
    const camY = payload.playerHead?.y ?? 0;

    ctx.save();
    ctx.translate(w / 2 - camX, h / 2 - camY);

    this.drawGrid(camX, camY, w, h);
    this.drawMapBoundary(payload.mapRadius);

    for (const pool of payload.pools) {
      this.drawPool(pool, payload.gameTime);
    }

    this.drawFoods(payload.foods);

    // Sort so larger snakes render behind smaller (bigger = drawn first)
    const sorted = [...payload.snakes].sort((a, b) => b.mass - a.mass);
    for (const snake of sorted) {
      if (snake.alive) this.drawSnake(snake);
    }

    for (const snake of payload.snakes) {
      if (snake.alive) this.drawLabels(snake);
    }

    ctx.restore();
  }

  private drawGrid(camX: number, camY: number, vw: number, vh: number): void {
    const { ctx } = this;
    const spacing = 120;
    const ox = Math.floor((camX - vw / 2) / spacing) * spacing;
    const oy = Math.floor((camY - vh / 2) / spacing) * spacing;

    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let x = ox; x <= ox + vw + spacing; x += spacing) {
      for (let y = oy; y <= oy + vh + spacing; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawMapBoundary(r: number): void {
    const { ctx } = this;

    // Boundary ring
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 14]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Dark vignette outside boundary
    ctx.beginPath();
    ctx.arc(0, 0, r + 1, 0, Math.PI * 2);
    ctx.rect(-(r + 1000), -(r + 1000), (r + 1000) * 2, (r + 1000) * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fill('evenodd');
  }

  private drawPool(pool: PoolEvent, gameTime: number): void {
    const { ctx } = this;
    const pulse = 0.5 + 0.5 * Math.sin(gameTime * 5);
    const baseAlpha = pool.active ? 0.55 : 0.25 + pulse * 0.12;

    ctx.beginPath();
    ctx.arc(pool.x, pool.y, pool.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,190,40,${baseAlpha * 0.28})`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pool.x, pool.y, pool.radius * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,200,60,${baseAlpha * 0.45})`;
    ctx.fill();

    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `rgba(255,220,80,${Math.min(1, baseAlpha + 0.3)})`;
    ctx.fillText('POOL', pool.x, pool.y - pool.radius - 14);
    ctx.fillText(`${Math.ceil(pool.remainingMass)}`, pool.x, pool.y);
  }

  private drawFoods(foods: Food[]): void {
    const { ctx } = this;
    for (const f of foods) {
      const r = 3 + f.mass * 0.8;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fillStyle = f.color;
      ctx.fill();
    }
  }

  private drawSnake(snake: Snake): void {
    const { ctx } = this;
    if (!snake.segments.length) return;

    const sr = segRadius(snake.mass);
    const headR = sr * 1.28;

    ctx.globalAlpha = snake.isGhost ? 0.35 : 1.0;

    // Body (tail → neck, skip index 0)
    ctx.fillStyle = snake.color;
    for (let i = snake.segments.length - 1; i >= 1; i--) {
      const seg = snake.segments[i];
      ctx.beginPath();
      ctx.arc(seg.x, seg.y, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Head
    const head = snake.segments[0];
    ctx.beginPath();
    ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
    ctx.fill();

    // Sprint shimmer: slightly lighter ring around head
    if (snake.isSprinting && !snake.isGhost) {
      ctx.beginPath();
      ctx.arc(head.x, head.y, headR + 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,200,0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    this.drawEyes(head, snake.angle, headR, snake.isPlayer);

    ctx.globalAlpha = 1.0;
  }

  private drawEyes(head: Vector2, angle: number, headR: number, isPlayer: boolean): void {
    const { ctx } = this;
    const eyeDist = headR * 0.52;
    const eyeR = headR * 0.3;
    const pupilR = eyeR * 0.52;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    for (const side of [-1, 1] as const) {
      const ex = head.x + cos * eyeDist * 0.75 + (-sin) * side * eyeDist * 0.6;
      const ey = head.y + sin * eyeDist * 0.75 + cos * side * eyeDist * 0.6;

      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = isPlayer ? '#fff' : '#ddd';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(ex + cos * pupilR * 0.5, ey + sin * pupilR * 0.5, pupilR, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
    }
  }

  private drawLabels(snake: Snake): void {
    const { ctx } = this;
    if (!snake.segments.length) return;

    const head = snake.segments[0];
    const headR = segRadius(snake.mass) * 1.28;
    let yBase = head.y - headR - 6;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    if (snake.isGhost && snake.ghostTimer > 0) {
      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = 'rgba(140,190,255,0.92)';
      ctx.fillText(`👻 ${Math.ceil(snake.ghostTimer)}s`, head.x, yBase);
      yBase -= 14;
    }

    const showName = snake.isPlayer || snake.mass > 18;
    if (showName) {
      ctx.font = snake.isPlayer ? 'bold 12px sans-serif' : '11px sans-serif';
      ctx.fillStyle = snake.isPlayer
        ? 'rgba(74,222,128,0.96)'
        : 'rgba(200,200,200,0.65)';
      ctx.fillText(snake.name, head.x, yBase);
    }
  }
}

// Exported so bots.ts and GameEngine can share this formula
export function segRadius(mass: number): number {
  return Math.min(6 + Math.sqrt(mass) * 1.2, 26);
}
