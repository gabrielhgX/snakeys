export type GameModeKey = 'hunt-hunt' | 'big-fish';

export interface Vector2 {
  x: number;
  y: number;
}

export interface Snake {
  id: string;
  name: string;
  segments: Vector2[];
  angle: number;
  speed: number;
  mass: number;
  color: string;
  isPlayer: boolean;
  isGhost: boolean;
  ghostTimer: number;   // seconds remaining in ghost mode
  isSprinting: boolean;
  alive: boolean;
  // bot-only steering state
  botWanderAngle?: number;
  botWanderTimer?: number;
}

export interface Food {
  id: string;
  x: number;
  y: number;
  mass: number;
  color: string;
}

export interface PoolEvent {
  id: string;
  x: number;
  y: number;
  radius: number;
  remainingMass: number;
  active: boolean;
  spawnAt: number;    // gameTime (s) when pool becomes active
  removeAt: number;  // gameTime (s) when pool is removed
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  mass: number;
}

// Snapshot sent to React HUD ~10fps
export interface UIState {
  playerMass: number;
  playerAlive: boolean;
  mapRadius: number;
  gameTime: number;
  fps: number;
  entityCount: number;
  huntHunt?: {
    sessionTimeLeft: number;
    playerTimeInSession: number;
    canExitClean: boolean;
    ghostTimer: number;
  };
  bigFish?: {
    matchTimeLeft: number;
    nextPoolIn: number;
    poolWarning: boolean;
    poolAngle: number | null;  // radians, world-space angle from player to pool
    matchEnded: boolean;
    drainRate: number;
    leaderboard: LeaderboardEntry[];
  };
}

export interface InputState {
  mouseCanvas: Vector2;
  sprint: boolean;
}

export interface EngineCallbacks {
  onUIUpdate: (state: UIState) => void;
  onPlayerDeath: (mass: number) => void;
  onMatchEnd?: (leaderboard: LeaderboardEntry[]) => void;
}
