import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameEngine } from './GameEngine';
import type { GameModeKey, UIState, LeaderboardEntry } from './types';

const IS_DEV = import.meta.env.DEV;

interface Props {
  mode: GameModeKey;
  playerName?: string;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const DEFAULT_UI: UIState = {
  playerMass: 10,
  playerAlive: true,
  mapRadius: 8000,
  gameTime: 0,
  fps: 60,
  entityCount: 0,
};

export default function GameCanvas({ mode, playerName = 'Você' }: Props) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const uiRef = useRef<UIState>(DEFAULT_UI);

  const [ui, setUi] = useState<UIState>(DEFAULT_UI);
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
  const [deathToast, setDeathToast] = useState<string | null>(null);
  const [exitModal, setExitModal] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugTime, setDebugTime] = useState('');

  // ── Engine lifecycle ────────────────────────────────────────────────────────

  const handlePlayerDeath = useCallback((mass: number) => {
    setDeathToast(`Você morreu! Massa: ${Math.floor(mass)}`);
    setTimeout(() => setDeathToast(null), 2500);
  }, []);

  const handleMatchEnd = useCallback((_lb: LeaderboardEntry[]) => {
    // Match end is displayed via UIState.bigFish.matchEnded — no extra state needed
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas, mode, {
      onUIUpdate: (state) => { uiRef.current = state; },
      onPlayerDeath: handlePlayerDeath,
      onMatchEnd: handleMatchEnd,
    }, playerName);

    engineRef.current = engine;
    engine.start();

    // ── Mouse input ─────────────────────────────────────────────────────────
    let sprinting = false;

    function onMouseMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      engineRef.current?.setInput({
        mouseCanvas: { x: e.clientX - rect.left, y: e.clientY - rect.top },
        sprint: sprinting,
      });
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button === 0) { sprinting = true; }
      engineRef.current?.setInput({
        mouseCanvas: { x: e.offsetX, y: e.offsetY },
        sprint: sprinting,
      });
    }

    function onMouseUp(e: MouseEvent) {
      if (e.button === 0) { sprinting = false; }
      engineRef.current?.setInput({
        mouseCanvas: { x: e.offsetX, y: e.offsetY },
        sprint: sprinting,
      });
    }

    function onContextMenu(e: MouseEvent) { e.preventDefault(); }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      engine.stop();
      engineRef.current = null;
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [mode, playerName, handlePlayerDeath, handleMatchEnd]);

  // ── HUD update at ~10fps ───────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      setUi({ ...uiRef.current });
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // ── Canvas resizing ────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        canvas.width = Math.round(width);
        canvas.height = Math.round(height);
        setCanvasSize({ w: Math.round(width), h: Math.round(height) });
      }
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Debug key toggle ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!IS_DEV) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === '`') setDebugOpen(v => !v);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Derived values ─────────────────────────────────────────────────────────
  const isBF = mode === 'big-fish';
  const isHH = mode === 'hunt-hunt';
  const bf = ui.bigFish;
  const hh = ui.huntHunt;
  const matchEnded = bf?.matchEnded ?? false;

  // Pool arrow position
  let arrowStyle: CSSProperties | null = null;
  if (bf?.poolWarning && bf.poolAngle !== null) {
    const dist = Math.min(canvasSize.w, canvasSize.h) * 0.38;
    const ax = canvasSize.w / 2 + Math.cos(bf.poolAngle) * dist;
    const ay = canvasSize.h / 2 + Math.sin(bf.poolAngle) * dist;
    arrowStyle = {
      left: ax,
      top: ay,
      transform: `translate(-50%,-50%) rotate(${bf.poolAngle * (180 / Math.PI) + 90}deg)`,
    };
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleExitClick() {
    if (mode === 'hunt-hunt') {
      setExitModal(true);
    } else {
      navigate('/lobby');
    }
  }

  function confirmExit() {
    navigate('/lobby');
  }

  const exitInfo = engineRef.current?.getExitInfo();

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-[#0d0d14]">
      {/* ── Game canvas ─────────────────────────────────────────────────── */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* ── HUD overlay (pointer-events-none by default) ─────────────── */}
      <div className="pointer-events-none absolute inset-0 select-none">

        {/* Mass + sprint (top-left) */}
        <div className="absolute left-4 top-4 flex flex-col gap-1">
          <div className="flex items-center gap-2 rounded-lg bg-black/50 px-3 py-2 backdrop-blur-sm">
            <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">Massa</span>
            <span className="font-mono text-lg font-bold tabular-nums text-white">{ui.playerMass}</span>
            {ui.playerAlive && (
              <span className="ml-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
                {mode === 'hunt-hunt' ? 'HH' : 'BF'}
              </span>
            )}
          </div>
          {/* Ghost mode */}
          {(hh?.ghostTimer ?? 0) > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-900/50 px-3 py-1.5">
              <span className="text-sm">👻</span>
              <span className="font-mono text-sm font-bold text-blue-300">
                {formatTime(hh?.ghostTimer ?? 0)}
              </span>
            </div>
          )}
        </div>

        {/* Timer / session info (top-right) */}
        <div className="absolute right-4 top-4 flex flex-col items-end gap-2">
          {isBF && bf && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2 rounded-lg bg-black/50 px-3 py-2 backdrop-blur-sm">
                <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">Tempo</span>
                <span className={`font-mono text-xl font-bold tabular-nums ${
                  bf.matchTimeLeft < 60 ? 'text-red-400' : 'text-white'
                }`}>
                  {formatTime(bf.matchTimeLeft)}
                </span>
              </div>
              {bf.drainRate > 0 && (
                <div className="rounded-md bg-red-900/40 px-2 py-1 font-mono text-[10px] text-red-300">
                  -{bf.drainRate}/s
                </div>
              )}
            </div>
          )}

          {isHH && hh && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2 rounded-lg bg-black/50 px-3 py-2 backdrop-blur-sm">
                <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">Sessão</span>
                <span className="font-mono text-sm font-bold tabular-nums text-white">
                  {formatTime(hh.sessionTimeLeft)}
                </span>
              </div>
              <div className="rounded-md bg-black/40 px-2 py-1 font-mono text-[10px] text-zinc-400">
                Em jogo: {formatTime(hh.playerTimeInSession)}
              </div>
            </div>
          )}
        </div>

        {/* BigFish leaderboard (right side) */}
        {isBF && bf && (
          <div className="absolute right-4 top-28 w-44">
            <Leaderboard entries={bf.leaderboard} />
          </div>
        )}

        {/* Pool warning banner (bottom-center) */}
        {isBF && bf?.poolWarning && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2">
            <div className="flex items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-500/20 px-5 py-3 shadow-lg backdrop-blur-sm">
              <span className="text-2xl">⚠️</span>
              <div>
                <div className="font-mono text-xs font-bold uppercase tracking-widest text-amber-200">
                  POOL CHEGANDO
                </div>
                <div className="font-mono text-lg font-bold text-amber-300">
                  {formatTime(bf.nextPoolIn)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pool direction arrow */}
        {arrowStyle && (
          <div className="absolute pointer-events-none" style={arrowStyle}>
            <div className="flex flex-col items-center gap-0.5">
              <div className="font-mono text-[9px] font-bold text-amber-300">POOL</div>
              <div className="text-2xl">🔺</div>
            </div>
          </div>
        )}

        {/* Death toast */}
        {deathToast && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="rounded-2xl border border-red-500/30 bg-red-900/70 px-8 py-4 text-center backdrop-blur-sm">
              <div className="text-3xl">💀</div>
              <div className="mt-1 font-mono text-sm font-bold text-red-200">{deathToast}</div>
              <div className="mt-1 font-mono text-[10px] text-red-400">Revivendo...</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Interactive HUD (pointer-events enabled) ─────────────────── */}

      {/* Exit button */}
      <div className="pointer-events-auto absolute bottom-4 left-4">
        <button
          type="button"
          onClick={handleExitClick}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/60 px-4 py-2 text-sm font-semibold text-zinc-300 backdrop-blur-sm transition hover:border-red-500/40 hover:bg-red-900/30 hover:text-red-200"
        >
          ← Lobby
          {isHH && hh && !hh.canExitClean && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-mono text-[10px] text-red-300">
              -30%
            </span>
          )}
          {isHH && hh?.canExitClean && (
            <span className="rounded-full bg-green-500/20 px-2 py-0.5 font-mono text-[10px] text-green-300">
              ✓
            </span>
          )}
        </button>
      </div>

      {/* ── HuntHunt exit modal ──────────────────────────────────────── */}
      {exitModal && exitInfo && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-80 rounded-2xl border border-white/10 bg-zinc-900 p-6">
            <h2 className="font-mono text-lg font-bold text-white">Sair da Sessão</h2>
            {exitInfo.canExitClean ? (
              <>
                <p className="mt-2 text-sm text-zinc-400">
                  Você cumpriu o tempo mínimo. Sída limpa!
                </p>
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-900/30 p-3">
                  <span className="font-mono text-xl font-bold text-green-300">{exitInfo.playerMass}</span>
                  <span className="text-sm text-green-400">pontos (100%)</span>
                </div>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-zinc-400">
                  Saída antecipada — penalidade de 30%.
                </p>
                <div className="mt-4 flex items-center gap-3 rounded-lg bg-red-900/20 p-3">
                  <div>
                    <div className="font-mono text-xs text-zinc-500 line-through">{exitInfo.playerMass}</div>
                    <div className="font-mono text-xl font-bold text-amber-300">{exitInfo.penaltyMass}</div>
                  </div>
                  <span className="text-sm text-zinc-400">pontos (70%)</span>
                </div>
              </>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setExitModal(false)}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-sm text-zinc-300 hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => confirmExit()}
                className="flex-1 rounded-lg bg-snake-500 py-2 text-sm font-semibold text-base-900 hover:bg-snake-400"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BigFish match-end overlay ────────────────────────────────── */}
      {isBF && matchEnded && (
        <MatchEndOverlay
          leaderboard={engineRef.current?.getFinalLeaderboard() ?? bf?.leaderboard ?? []}
          onLobby={() => navigate('/lobby')}
        />
      )}

      {/* ── Debug panel (DEV only) ───────────────────────────────────── */}
      {IS_DEV && (
        <div className="pointer-events-auto absolute bottom-4 right-4">
          <button
            type="button"
            onClick={() => setDebugOpen(v => !v)}
            className="rounded-md bg-purple-900/60 px-3 py-1.5 font-mono text-[11px] text-purple-300 backdrop-blur-sm hover:bg-purple-800/70"
          >
            DEBUG [` ]
          </button>

          {debugOpen && (
            <div className="absolute bottom-10 right-0 w-64 rounded-xl border border-purple-500/30 bg-zinc-900/95 p-4 shadow-xl backdrop-blur-sm">
              <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-widest text-purple-400">
                Dev Panel
              </div>

              <div className="space-y-1 font-mono text-[11px] text-zinc-400">
                <div>FPS: <span className="text-white">{ui.fps}</span></div>
                <div>Entidades: <span className="text-white">{ui.entityCount}</span></div>
                <div>Tempo: <span className="text-white">{formatTime(ui.gameTime)}</span></div>
                <div>Massa: <span className="text-white">{ui.playerMass}</span></div>
              </div>

              <div className="mt-3 space-y-2">
                {isBF && (
                  <button
                    type="button"
                    onClick={() => engineRef.current?.debugForcePool()}
                    className="w-full rounded-md bg-amber-600/30 py-1.5 font-mono text-[11px] font-bold text-amber-300 hover:bg-amber-600/50"
                  >
                    ⚡ Forçar Pool Agora
                  </button>
                )}

                <div className="flex gap-2">
                  <input
                    type="number"
                    placeholder="segundos"
                    value={debugTime}
                    onChange={e => setDebugTime(e.target.value)}
                    className="w-full rounded-md bg-white/5 px-2 py-1 font-mono text-[11px] text-white outline-none placeholder:text-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const t = parseFloat(debugTime);
                      if (!isNaN(t)) engineRef.current?.debugSetGameTime(t);
                    }}
                    className="shrink-0 rounded-md bg-blue-600/30 px-3 font-mono text-[11px] text-blue-300 hover:bg-blue-600/50"
                  >
                    Set
                  </button>
                </div>

                {isBF && bf && (
                  <div className="font-mono text-[10px] text-zinc-500">
                    Próxima pool: {formatTime(bf.nextPoolIn)} | Drain: -{bf.drainRate}/s
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="rounded-xl border border-white/5 bg-black/50 p-3 backdrop-blur-sm">
      <div className="mb-2 font-mono text-[9px] font-bold uppercase tracking-widest text-zinc-500">
        Leaderboard
      </div>
      <div className="space-y-1">
        {entries.map((e) => {
          const isTop3 = e.rank <= 3;
          const rankColors = ['text-amber-300', 'text-zinc-300', 'text-amber-700'];
          const rankColor = isTop3 ? rankColors[e.rank - 1] : 'text-zinc-600';
          return (
            <div
              key={e.id}
              className={`flex items-center gap-2 rounded-md px-2 py-1 ${
                isTop3 ? 'bg-white/5' : ''
              }`}
            >
              <span className={`w-4 font-mono text-[10px] font-bold ${rankColor}`}>
                {e.rank}
              </span>
              <span className={`flex-1 truncate font-mono text-[11px] ${
                e.id === 'player' ? 'text-green-400' : 'text-zinc-300'
              }`}>
                {e.name}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-zinc-400">
                {e.mass}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MatchEndOverlay({
  leaderboard,
  onLobby,
}: {
  leaderboard: LeaderboardEntry[];
  onLobby: () => void;
}) {
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-8">
        <div className="text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-500/70">
            BIG FISH · FIM DE PARTIDA
          </div>
          <h2 className="mt-2 font-display text-4xl tracking-wide text-white">Resultado Final</h2>
        </div>

        {/* Podium top 3 — visual order: 2nd | 1st | 3rd */}
        <div className="mt-6 flex items-end justify-center gap-3">
          {([1, 0, 2] as const).map((entryIdx, pos) => {
            const e = top3[entryIdx];
            const heights = ['h-20', 'h-28', 'h-16'];   // left=2nd, center=1st, right=3rd
            const colors  = ['bg-zinc-400/20', 'bg-amber-500/20', 'bg-amber-700/20'];
            const medals  = ['🥈', '🥇', '🥉'];
            if (!e) return <div key={`pos-${pos}`} className="w-24" />;
            return (
              <div key={e.id} className="flex w-24 flex-col items-center">
                <div className="mb-1 font-mono text-xs font-bold text-white truncate w-full text-center">{e.name}</div>
                <div className="font-mono text-[10px] text-zinc-400">{e.mass} pts</div>
                <div className={`mt-2 w-full ${heights[pos]} ${colors[pos]} flex items-center justify-center rounded-t-lg text-2xl`}>
                  {medals[pos]}
                </div>
              </div>
            );
          })}
        </div>

        {/* Rest of leaderboard */}
        {rest.length > 0 && (
          <div className="mt-4 space-y-1">
            {rest.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-md px-3 py-1.5">
                <span className="w-6 font-mono text-xs text-zinc-600">{e.rank}</span>
                <span className={`flex-1 font-mono text-sm ${e.id === 'player' ? 'text-green-400' : 'text-zinc-400'}`}>
                  {e.name}
                </span>
                <span className="font-mono text-sm tabular-nums text-zinc-500">{e.mass}</span>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onLobby}
          className="mt-6 w-full rounded-xl bg-snake-500 py-3 font-semibold text-base-900 hover:bg-snake-400"
        >
          Voltar ao Lobby
        </button>
      </div>
    </div>
  );
}
