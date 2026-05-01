import type { Snake, Food, Vector2 } from './types';

const MAX_TURN = Math.PI * 2.2; // rad/s — snappy but not instant

export function updateBotAngle(
  bot: Snake,
  foods: Food[],
  playerSnake: Snake | null,
  dt: number,
  mapRadius: number,
): void {
  const head = bot.segments[0];
  const distFromCenter = Math.sqrt(head.x ** 2 + head.y ** 2);

  let target: Vector2;

  if (distFromCenter > mapRadius * 0.88) {
    // Hard steer toward center to avoid going out of bounds
    target = { x: 0, y: 0 };
  } else {
    target = pickTarget(bot, head, foods, playerSnake);
  }

  steerToward(bot, head, target, dt);
}

function pickTarget(
  bot: Snake,
  head: Vector2,
  foods: Food[],
  playerSnake: Snake | null,
): Vector2 {
  // Flee from player if player is close and larger
  if (playerSnake && !playerSnake.isGhost && playerSnake.mass > bot.mass * 1.4) {
    const ph = playerSnake.segments[0];
    const dx = ph.x - head.x;
    const dy = ph.y - head.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 350 * 350) {
      return { x: head.x - dx * 2.5, y: head.y - dy * 2.5 };
    }
  }

  // Find nearest food
  let nearestFood: Food | null = null;
  let nearestD2 = Infinity;
  for (const f of foods) {
    const dx = f.x - head.x;
    const dy = f.y - head.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < nearestD2) {
      nearestD2 = d2;
      nearestFood = f;
    }
  }
  if (nearestFood) return { x: nearestFood.x, y: nearestFood.y };

  // Wander
  return wanderTarget(bot, head);
}

function wanderTarget(bot: Snake, head: Vector2): Vector2 {
  bot.botWanderTimer = (bot.botWanderTimer ?? 0) - 0.016; // approx 1 frame
  if ((bot.botWanderTimer ?? 0) <= 0) {
    bot.botWanderAngle = Math.random() * Math.PI * 2;
    bot.botWanderTimer = 1.5 + Math.random() * 2.5;
  }
  const a = bot.botWanderAngle ?? 0;
  return { x: head.x + Math.cos(a) * 300, y: head.y + Math.sin(a) * 300 };
}

function steerToward(bot: Snake, head: Vector2, target: Vector2, dt: number): void {
  const dx = target.x - head.x;
  const dy = target.y - head.y;
  const targetAngle = Math.atan2(dy, dx);

  let diff = targetAngle - bot.angle;
  // Normalize to [-π, π]
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;

  const maxTurn = MAX_TURN * dt;
  bot.angle += Math.sign(diff) * Math.min(Math.abs(diff), maxTurn);
}
