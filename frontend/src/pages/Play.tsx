import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import GameCanvas from '../components/GameCanvas';
import type { GameModeKey, WorldSnapshot } from '../game/types';
import { ApiError, tokenStorage, usernameStorage, walletApi } from '../lib/api';

const VALID_MODES: GameModeKey[] = ['hunt-hunt', 'big-fish', 'private'];

/**
 * Full-screen route that boots a match for the chosen mode.
 *
 * Boot contract:
 *   - `:mode` from the URL must be one of the public mode keys.
 *   - `pot` and `matchId` are expected on `location.state` (set by the
 *     Lobby's `walletApi.matchEntry` call). Without a `matchId` we send
 *     the user back to the lobby — they'd be playing for free, and
 *     settlement at the end would have nothing to credit against.
 *
 * Settlement: when the engine reports the match ended, we POST the
 * computed payout to `walletApi.matchSettle` *before* navigating back
 * so the lobby sees the updated balance immediately. The backend is
 * idempotent on `matchId`, so a retry / page-refresh won't double-pay.
 */
interface PlayLocationState {
  pot?: number;
  matchId?: string;
  matchMode?: 'online' | 'offline';
}

/** Reads the per-mode payout off the engine's final snapshot. */
function computePayout(snap: WorldSnapshot): number {
  if (snap.mode === 'hunt-hunt') {
    return Math.max(0, snap.huntHunt?.settledValue ?? 0);
  }
  if (snap.mode === 'big-fish') {
    return Math.max(0, snap.bigFish?.settledValue ?? 0);
  }
  return 0;
}

export default function Play() {
  const { mode } = useParams<{ mode: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as PlayLocationState;

  const normalizedMode = useMemo<GameModeKey | null>(() => {
    if (!mode) return null;
    return (VALID_MODES as string[]).includes(mode)
      ? (mode as GameModeKey)
      : null;
  }, [mode]);

  const [auth] = useState(() => ({
    token: tokenStorage.get(),
    username: usernameStorage.get() ?? 'Jogador',
  }));

  // Pot + matchId are immutable for the life of the page. Capture once
  // so a stray location-state mutation can't change them mid-match.
  const matchInfo = useMemo(
    () => ({
      pot: typeof state.pot === 'number' ? state.pot : null,
      matchId: typeof state.matchId === 'string' ? state.matchId : null,
    }),
    // location.state is captured once at mount; subsequent changes are
    // ignored on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Latch so we don't post settlement twice if the engine emits two
  // "ended" snapshots back-to-back.
  const settledRef = useRef(false);

  // Auth gate.
  useEffect(() => {
    if (!auth.token) {
      navigate('/login', { replace: true });
    }
  }, [auth.token, navigate]);

  const handleExit = useCallback(
    async (final: WorldSnapshot) => {
      if (settledRef.current) {
        navigate('/lobby', { replace: true });
        return;
      }
      settledRef.current = true;

      const token = tokenStorage.get();
      const matchId = matchInfo.matchId;
      if (!token || !matchId) {
        // Nothing to settle (private rooms / dev bypass). Just leave.
        navigate('/lobby', { replace: true });
        return;
      }

      const payout = computePayout(final);
      try {
        await walletApi.matchSettle(token, matchId, payout);
      } catch (err) {
        // Settlement failure shouldn't trap the user on the game page.
        // The backend lock can be reclaimed later (the matchId record
        // exists with status COMPLETED bet but no FEE row — a janitor
        // job can sweep at any time since processMatchResult is idempotent).
        if (err instanceof ApiError && err.status === 401) {
          tokenStorage.clear();
          navigate('/login', { replace: true });
          return;
        }
        // eslint-disable-next-line no-console
        console.warn('matchSettle failed', err);
      }
      navigate('/lobby', { replace: true });
    },
    [matchInfo.matchId, navigate],
  );

  if (!auth.token) return null;
  if (!normalizedMode) return <Navigate to="/lobby" replace />;
  // No matchId / pot → the user reached this page out-of-band (refresh,
  // direct nav). Bounce them to the lobby where the entry flow will
  // re-debit and re-issue a fresh matchId.
  if (matchInfo.matchId === null || matchInfo.pot === null) {
    return <Navigate to="/lobby" replace />;
  }

  return (
    <GameCanvas
      mode={normalizedMode}
      playerName={auth.username}
      pot={matchInfo.pot}
      matchId={matchInfo.matchId}
      onExit={handleExit}
    />
  );
}
