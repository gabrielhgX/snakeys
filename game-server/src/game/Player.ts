export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerState {
  id: string;        // userId from backend
  socketId: string;
  email: string;
  mass: number;
  position: Vec2;
  direction: Vec2;   // unit vector — client sends mouse position, server normalises
  speed: number;
  alive: boolean;
  sprinting: boolean;
}

export function createPlayer(userId: string, socketId: string, email: string): PlayerState {
  return {
    id: userId,
    socketId,
    email,
    mass: 100,
    position: { x: Math.random() * 4000, y: Math.random() * 4000 },
    direction: { x: 1, y: 0 },
    speed: 5,
    alive: true,
    sprinting: false,
  };
}

// Mass drained per tick when sprinting
export const SPRINT_MASS_COST = 0.5;
// Mass drained by hunger mechanic every hunger interval
export const HUNGER_DRAIN_RATE = 0.02; // fraction of current mass
