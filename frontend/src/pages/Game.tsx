import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import GameCanvas from '../components/game/GameCanvas';
import { tokenStorage, usernameStorage } from '../lib/api';
import type { GameModeKey } from '../components/game/types';

const VALID_MODES: GameModeKey[] = ['hunt-hunt', 'big-fish'];

export default function Game() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const rawMode = searchParams.get('mode') ?? '';
  const mode: GameModeKey = VALID_MODES.includes(rawMode as GameModeKey)
    ? (rawMode as GameModeKey)
    : 'hunt-hunt';

  const playerName = usernameStorage.get() ?? 'Você';

  useEffect(() => {
    if (!tokenStorage.get()) navigate('/login', { replace: true });
  }, [navigate]);

  return (
    <div className="flex h-screen w-screen flex-col bg-[#0d0d14]">
      {/* Thin header bar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/5 bg-zinc-900/80 px-4">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm tracking-wide text-snake-400">SNAKEYS</span>
          <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-zinc-500">
            {mode === 'hunt-hunt' ? 'Hunt-Hunt' : 'Big Fish'} · Offline
          </span>
        </div>
        <span className="font-mono text-[11px] text-zinc-600">{playerName}</span>
      </div>

      {/* Canvas fills the rest */}
      <div className="flex-1">
        <GameCanvas mode={mode} playerName={playerName} />
      </div>
    </div>
  );
}
