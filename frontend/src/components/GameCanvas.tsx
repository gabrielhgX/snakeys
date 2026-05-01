import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createWorld, updateWorld, type World } from '../game/engine';
import { createMode, type ModeController } from '../game/modes';
import {
  makeViewport,
  renderWorld,
  zoomForMass,
} from '../game/renderer';
import type { GameModeKey, WorldSnapshot } from '../game/types';
import GameHUD from './GameHUD';

/**
 * Thin React wrapper around the engine. Owns:
 *   - the <canvas> element + DPR-correct resize
 *   - the `requestAnimationFrame` game loop with dt clamping
 *   - mouse / keyboard input capture
 *   - a throttled `snapshot` state that feeds the HUD (React layer stays
 *     at ~15 renders/sec even while the game runs at 60fps)
 *
 * Engine state lives in refs — mutating it does NOT trigger React
 * re-renders. That separation is what lets us push 60fps simulation
 * alongside React without jank.
 */
export interface GameCanvasProps {
  mode: GameModeKey;
  playerName: string;
  playerColor?: string;
  /**
   * R$ pot the player committed (already debited by the lobby). Plumbed
   * into `createWorld` so every snake in this match carries the same
   * pot value — Hunt-Hunt steals it on kill, Big Fish sums it into the
   * round pool.
   */
  pot: number;
  /** Server-issued match id from `walletApi.matchEntry`. Threaded back
   *  through `onExit` so the page above can call `matchSettle`. */
  matchId: string;
  /** Called once with the final snapshot when the match ends. May be
   *  async — the parent typically awaits a settlement POST inside. */
  onExit: (finalSnapshot: WorldSnapshot) => void | Promise<void>;
}

interface InputState {
  /** CSS-pixel coords relative to the canvas. */
  mouseX: number;
  mouseY: number;
  hasPointer: boolean;
  sprinting: boolean;
}

interface EngineBundle {
  world: World;
  mode: ModeController;
  input: InputState;
}

// Rebuild snapshot for React no more than every 70ms — HUD doesn't need
// 60fps. Timers are rendered from ms fields so small jitter is invisible.
const SNAPSHOT_INTERVAL_MS = 70;

export default function GameCanvas({
  mode,
  playerName,
  playerColor,
  pot,
  onExit,
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<EngineBundle | null>(null);

  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  // Latched end-of-match snapshot. We only set this once; after that the
  // HUD shows the end screen and the rAF loop stops calling setSnapshot.
  const [finalSnapshot, setFinalSnapshot] = useState<WorldSnapshot | null>(
    null,
  );

  // ─── Initialize engine ─────────────────────────────────────────────
  // Reset when any identity input changes — mode / player / pot all
  // affect the world contents (bots inherit the player's pot for
  // matchmaking-by-value), so a change in any of them must rebuild.
  useEffect(() => {
    const world = createWorld({
      playerName,
      playerColor,
      mode,
      pot,
    });
    const modeCtl = createMode(mode, world);
    engineRef.current = {
      world,
      mode: modeCtl,
      input: {
        mouseX: 0,
        mouseY: 0,
        hasPointer: false,
        sprinting: false,
      },
    };
    setSnapshot(modeCtl.snapshot(world));
    setFinalSnapshot(null);
    return () => {
      engineRef.current = null;
    };
  }, [mode, playerName, playerColor, pot]);

  // ─── Canvas sizing (DPR-aware) ─────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      const ctx = canvas.getContext('2d');
      // Reset transform so our renderer can apply world transforms in
      // CSS-pixel space independent of DPR.
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // ─── Input handlers ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const eng = engineRef.current;
      if (!eng) return;
      eng.input.mouseX = e.clientX - rect.left;
      eng.input.mouseY = e.clientY - rect.top;
      eng.input.hasPointer = true;
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const eng = engineRef.current;
      if (!eng) return;
      eng.input.sprinting = true;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const eng = engineRef.current;
      if (!eng) return;
      eng.input.sprinting = false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Space as an alt sprint key for laptops without a mouse.
      if (e.code === 'Space') {
        const eng = engineRef.current;
        if (eng) eng.input.sprinting = true;
        e.preventDefault();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const eng = engineRef.current;
        if (eng) eng.input.sprinting = false;
      }
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    canvas.addEventListener('mousemove', onMouseMove);
    // Mouse up is attached to window so releasing outside the canvas
    // (e.g. over the HUD) still stops sprinting.
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // ─── Game loop ────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let prevT = performance.now();
    let lastSnapshotT = prevT;
    let stopped = false;

    const loop = (t: number) => {
      if (stopped) return;

      const dtRaw = (t - prevT) / 1000;
      // Clamp dt so that a tab-switch doesn't teleport snakes across the
      // map when the tab resumes. 1/30 = hard cap at ~33ms per step.
      const dt = Math.min(Math.max(dtRaw, 0), 1 / 30);
      prevT = t;

      const eng = engineRef.current;
      if (!eng) {
        rafId = requestAnimationFrame(loop);
        return;
      }

      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;

      // Compute target angle from current mouse position. Camera is
      // centered on the head so the angle is simply mouse - screen
      // center — zoom doesn't factor in.
      const input = {
        targetAngle: eng.input.hasPointer
          ? Math.atan2(
              eng.input.mouseY - cssH / 2,
              eng.input.mouseX - cssW / 2,
            )
          : null,
        sprinting: eng.input.sprinting,
      };

      // Don't run updates once the match has ended — the renderer keeps
      // painting the last frame so the end-screen modal has a live-ish
      // backdrop rather than a black wall.
      const preSnap = eng.mode.snapshot(eng.world);
      if (!preSnap.ended) {
        updateWorld(eng.world, dt, input);
        eng.mode.update(eng.world, dt);
      }

      const zoom = zoomForMass(eng.world.self.mass);
      const vp = makeViewport(
        cssW,
        cssH,
        eng.world.self.headX,
        eng.world.self.headY,
        zoom,
      );
      // Take the post-update snapshot once and reuse for both render
      // (pool warning) and HUD dispatch.
      const snap = preSnap.ended ? preSnap : eng.mode.snapshot(eng.world);
      renderWorld(ctx, eng.world, vp, snap.bigFish?.poolWarning ?? null);

      if (t - lastSnapshotT >= SNAPSHOT_INTERVAL_MS) {
        lastSnapshotT = t;
        setSnapshot(snap);
        if (snap.ended) {
          setFinalSnapshot((prev) => prev ?? snap);
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  // ─── HUD callbacks ────────────────────────────────────────────────────
  const handleCashOut = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || !eng.mode.tryCashOut) return;
    eng.mode.tryCashOut(eng.world);
  }, []);

  const handleQuit = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.mode.tryQuit(eng.world);
  }, []);

  const handleExit = useCallback(() => {
    const eng = engineRef.current;
    const snap = finalSnapshot ?? (eng ? eng.mode.snapshot(eng.world) : null);
    if (snap) onExit(snap);
  }, [finalSnapshot, onExit]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair"
      />
      {snapshot && (
        <GameHUD
          snapshot={snapshot}
          onCashOut={handleCashOut}
          onQuit={handleQuit}
          onExit={handleExit}
        />
      )}
    </div>
  );
}

