import {
  ArrowUpRight,
  Crown,
  DoorOpen,
  Ghost,
  Skull,
  Timer,
  TrendingDown,
  Trophy,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import type { WorldSnapshot } from '../game/types';

// Mirror of the engine's HUNT_HUNT_CASHOUT_FRACTION + CASHOUT_EARLY_PENALTY.
// Re-stated here so the HUD's preview labels match the simulation. Keep
// these in sync with `frontend/src/game/modes.ts`.
const HH_CASHOUT_FRACTION = 0.5;
const HH_EARLY_PENALTY = 0.3;
// Big Fish settlement split (top 1 / top 2 / top 3). Mirrors
// `BIG_FISH_PAYOUTS` in modes.ts.
const BF_PAYOUTS = [0.5, 0.3, 0.2] as const;

/**
 * Pure-presentational HUD. All state lives upstream in `GameCanvas`; this
 * layer renders the snapshot and fires callbacks when the user clicks.
 *
 * Design brief: flat matte fintech aesthetic. No glows, no gradients, no
 * drop shadows stacked for "glass" — single 1px matte borders and solid
 * panel fills against the canvas.
 */
export interface GameHUDProps {
  snapshot: WorldSnapshot;
  onCashOut: () => void;
  onQuit: () => void;
  onExit: () => void;
}

// Shared palette tokens (explicit Tailwind arbitrary values so the matte
// look is consistent with the rest of the app).
const PANEL = 'bg-[#10141a]/92 border border-[#1c2230]';
const TEXT_DIM = 'text-[#8b95a5]';
const TEXT = 'text-zinc-100';
const TEXT_SOFT = 'text-zinc-300';

export default function GameHUD({
  snapshot,
  onCashOut,
  onQuit,
  onExit,
}: GameHUDProps) {
  return (
    <>
      <TopLeft snapshot={snapshot} />
      <TopCenter snapshot={snapshot} />
      <TopRight snapshot={snapshot} onQuit={onQuit} />
      <Leaderboard snapshot={snapshot} />
      <BottomLeft snapshot={snapshot} onCashOut={onCashOut} />
      <PoolBanner snapshot={snapshot} />
      {snapshot.ended && <EndScreen snapshot={snapshot} onExit={onExit} />}
    </>
  );
}

// ─── Top-left: mass + ghost shield ────────────────────────────────────────────
function TopLeft({ snapshot }: { snapshot: WorldSnapshot }) {
  const ghosting = snapshot.selfGhostMsLeft > 0;
  return (
    <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
      <div
        className={`${PANEL} flex items-center gap-3 rounded-md px-4 py-2.5`}
      >
        <div className={`font-mono text-[10px] tracking-[0.25em] ${TEXT_DIM}`}>
          MASSA
        </div>
        <div className={`font-mono text-xl font-bold tabular-nums ${TEXT}`}>
          {Math.floor(snapshot.selfMass)}
        </div>
      </div>
      {ghosting && (
        <div
          className={`${PANEL} flex items-center gap-2 rounded-md px-3 py-1.5`}
        >
          <Ghost className="h-3.5 w-3.5 text-[#4e90c8]" />
          <div
            className={`font-mono text-[10px] tracking-[0.2em] ${TEXT_DIM}`}
          >
            INVULNERÁVEL
          </div>
          <div
            className={`font-mono text-xs font-semibold tabular-nums text-[#4e90c8]`}
          >
            {formatMS(snapshot.selfGhostMsLeft)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Top-center: Big Fish match timer + pool / rank ribbon ─────────────────
function TopCenter({ snapshot }: { snapshot: WorldSnapshot }) {
  if (snapshot.mode !== 'big-fish' || !snapshot.bigFish) return null;
  const { timeLeftMs, drainRate, poolValue, selfRank } = snapshot.bigFish;
  const urgency = timeLeftMs < 2 * 60_000;
  // Live projected payout for this rank, or 0 if outside top 3 / dead.
  const projectedPayout =
    selfRank !== null && selfRank >= 1 && selfRank <= BF_PAYOUTS.length
      ? poolValue * BF_PAYOUTS[selfRank - 1]
      : 0;
  return (
    <div className="pointer-events-none absolute left-1/2 top-4 flex -translate-x-1/2 gap-2">
      <div
        className={`${PANEL} flex items-center gap-3 rounded-md px-4 py-2.5`}
      >
        <Timer
          className={`h-4 w-4 ${urgency ? 'text-[#ef6a6a]' : 'text-[#8b95a5]'}`}
        />
        <div>
          <div
            className={`font-mono text-[10px] tracking-[0.25em] ${TEXT_DIM}`}
          >
            BIG FISH
          </div>
          <div
            className={`font-mono text-xl font-bold tabular-nums ${
              urgency ? 'text-[#ef6a6a]' : TEXT
            }`}
          >
            {formatMS(timeLeftMs)}
          </div>
        </div>
      </div>
      <div
        className={`${PANEL} flex items-center gap-2 rounded-md px-3 py-2.5`}
      >
        <TrendingDown className="h-3.5 w-3.5 text-[#e6b04a]" />
        <div>
          <div
            className={`font-mono text-[9px] tracking-[0.25em] ${TEXT_DIM}`}
          >
            DRAIN
          </div>
          <div
            className={`font-mono text-sm font-semibold tabular-nums ${TEXT_SOFT}`}
          >
            −{drainRate.toFixed(1)}/s
          </div>
        </div>
      </div>
      <div
        className={`${PANEL} flex items-center gap-2 rounded-md px-3 py-2.5`}
      >
        <Trophy className="h-3.5 w-3.5 text-[#4ea888]" />
        <div>
          <div
            className={`font-mono text-[9px] tracking-[0.25em] ${TEXT_DIM}`}
          >
            {selfRank !== null ? `RANK #${selfRank}` : 'ELIMINADO'} · POTE {formatBRL(poolValue)}
          </div>
          <div
            className={`font-mono text-sm font-semibold tabular-nums ${
              projectedPayout > 0 ? 'text-[#4ea888]' : TEXT_DIM
            }`}
          >
            {projectedPayout > 0
              ? `+${formatBRL(projectedPayout)}`
              : 'Sem prem.'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Top-right: quit button ──────────────────────────────────────────────────
function TopRight({
  snapshot,
  onQuit,
}: {
  snapshot: WorldSnapshot;
  onQuit: () => void;
}) {
  if (snapshot.ended) return null;
  return (
    <div className="absolute right-4 top-4 flex gap-2">
      <button
        type="button"
        onClick={onQuit}
        title="Sair da partida"
        className={`${PANEL} flex h-9 items-center gap-2 rounded-md px-3 text-xs font-semibold ${TEXT_SOFT} transition hover:border-[#ef6a6a]/50 hover:text-[#ef6a6a]`}
      >
        <DoorOpen className="h-3.5 w-3.5" />
        <span className="tracking-wider">SAIR</span>
      </button>
    </div>
  );
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────
function Leaderboard({ snapshot }: { snapshot: WorldSnapshot }) {
  if (snapshot.ended) return null;
  const rows = snapshot.leaderboard;
  if (rows.length === 0) return null;

  return (
    <div
      className={`pointer-events-none absolute right-4 top-16 ${PANEL} w-56 rounded-md px-3 py-2.5`}
    >
      <div
        className={`mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.25em] ${TEXT_DIM}`}
      >
        <Crown className="h-3 w-3" />
        LEADERBOARD
      </div>
      <ul className="space-y-1">
        {rows.map((row, i) => (
          <li
            key={row.id}
            className={`flex items-center gap-2 rounded-sm px-1.5 py-1 text-xs ${
              row.isSelf ? 'bg-[#1c2230]' : ''
            }`}
          >
            <span
              className={`w-4 text-right font-mono text-[10px] ${TEXT_DIM}`}
            >
              {i + 1}
            </span>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: row.color }}
            />
            <span
              className={`flex-1 truncate ${
                row.isSelf ? `font-semibold ${TEXT}` : TEXT_SOFT
              }`}
            >
              {row.name}
            </span>
            <span className={`font-mono tabular-nums ${TEXT_DIM}`}>
              {Math.floor(row.mass)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Bottom-LEFT: Hunt-Hunt accumulated value + cash-out CTA ────────────────
function BottomLeft({
  snapshot,
  onCashOut,
}: {
  snapshot: WorldSnapshot;
  onCashOut: () => void;
}) {
  if (snapshot.mode !== 'hunt-hunt' || !snapshot.huntHunt || snapshot.ended) {
    return null;
  }
  const hh = snapshot.huntHunt;
  const cashingOut = hh.cashoutStartedAt !== null;
  const inGhost = snapshot.selfGhostMsLeft > 0;
  // What the player would actually pocket if cash-out completes right
  // now (full 50%) or if they die / quit during drift (35%).
  const cashoutPayout = hh.accumulatedValue * HH_CASHOUT_FRACTION;
  const earlyPayout = cashoutPayout * (1 - HH_EARLY_PENALTY);

  return (
    <div className="absolute bottom-6 left-6 flex flex-col items-start gap-2">
      <div className={`${PANEL} rounded-md px-4 py-2.5`}>
        <div
          className={`flex items-center gap-1.5 font-mono text-[10px] tracking-[0.25em] ${TEXT_DIM}`}
        >
          <Wallet className="h-3 w-3" />
          VALOR ACUMULADO
        </div>
        <div
          className={`mt-0.5 font-mono text-2xl font-bold tabular-nums text-[#4ea888]`}
        >
          {formatBRL(hh.accumulatedValue)}
        </div>
        <div className={`mt-0.5 flex items-center gap-1.5 text-[10px] ${TEXT_DIM}`}>
          <Skull className="h-3 w-3" />
          <span>{hh.killCount} kills · cash-out paga 50%</span>
        </div>
      </div>
      {cashingOut ? (
        <div
          className={`${PANEL} rounded-md border-[#e6b04a]/40 px-4 py-2.5`}
        >
          <div
            className={`font-mono text-[10px] tracking-[0.25em] text-[#e6b04a]`}
          >
            SAINDO EM
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums text-[#e6b04a]">
            {formatMS(hh.cashoutMsLeft ?? 0)}
          </div>
          <div className={`mt-1 text-[10px] ${TEXT_DIM}`}>
            Bem sucedido: <span className="text-[#4ea888] font-semibold tabular-nums">{formatBRL(cashoutPayout)}</span>
            {' · '}
            morrer agora: <span className="text-[#ef6a6a] font-semibold tabular-nums">{formatBRL(earlyPayout)}</span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onCashOut}
          disabled={inGhost || hh.accumulatedValue <= 0}
          title={
            inGhost
              ? 'Disponível ao sair do modo invulnerável'
              : hh.accumulatedValue <= 0
                ? 'Mate uma cobra antes de fazer cash-out'
                : `Você recebe ${formatBRL(cashoutPayout)} (50%) após 2 min`
          }
          className={`flex h-11 items-center gap-2 rounded-md border px-4 text-sm font-semibold tracking-wider transition ${
            inGhost || hh.accumulatedValue <= 0
              ? 'border-[#1c2230] bg-[#10141a]/92 text-[#4b5563] cursor-not-allowed'
              : 'border-[#4ea888] bg-[#4ea888] text-[#0b0e12] hover:bg-[#5cb496]'
          }`}
        >
          <Zap className="h-4 w-4" />
          CASH-OUT · {formatBRL(cashoutPayout)}
        </button>
      )}
    </div>
  );
}

// ─── Pool warning banner (Big Fish) ──────────────────────────────────────────
function PoolBanner({ snapshot }: { snapshot: WorldSnapshot }) {
  const w = snapshot.bigFish?.poolWarning;
  if (!w) return null;
  const secs = Math.max(0, Math.ceil((w.spawnsAt - snapshot.elapsedMs) / 1000));
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2">
      <div
        className={`${PANEL} flex items-center gap-3 rounded-md border-[#e6b04a]/40 px-4 py-2.5`}
      >
        <ArrowUpRight className="h-4 w-4 text-[#e6b04a]" />
        <div>
          <div
            className={`font-mono text-[10px] tracking-[0.25em] text-[#e6b04a]`}
          >
            POÇA INCOMING
          </div>
          <div className={`text-xs ${TEXT_SOFT}`}>
            Massa densa aparece em{' '}
            <span className="font-mono font-semibold text-[#e6b04a]">
              {secs}s
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── End-of-match overlay ────────────────────────────────────────────────────
function EndScreen({
  snapshot,
  onExit,
}: {
  snapshot: WorldSnapshot;
  onExit: () => void;
}) {
  const reason = snapshot.endReason;
  const title =
    reason === 'cashed-out'
      ? 'Cash-out concluído'
      : reason === 'time-up'
        ? 'Tempo esgotado'
        : reason === 'died'
          ? 'Você foi eliminado'
          : 'Partida encerrada';

  const subtitle =
    reason === 'died'
      ? 'A massa se dissolveu no mapa.'
      : reason === 'quit'
        ? 'Você abandonou a partida.'
        : reason === 'time-up'
          ? 'O relógio zerou.'
          : 'Saldo transferido para a carteira.';

  // Pull the settled value off the right per-mode bucket. Both buckets
  // populate `settledValue` at end of match — we only show the panel if
  // the engine produced one.
  const settled =
    snapshot.mode === 'hunt-hunt'
      ? (snapshot.huntHunt?.settledValue ?? null)
      : snapshot.mode === 'big-fish'
        ? (snapshot.bigFish?.settledValue ?? null)
        : null;
  const showMoney = settled !== null;
  const settledLabel =
    snapshot.mode === 'hunt-hunt'
      ? snapshot.huntHunt?.cashedOut
        ? 'PAGO (50%)'
        : 'PAGO (35%)'
      : 'PAGO';

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        className={`${PANEL} w-full max-w-md rounded-lg px-8 py-8 text-center`}
      >
        <div
          className={`font-mono text-[11px] tracking-[0.35em] ${TEXT_DIM}`}
        >
          FIM DE PARTIDA
        </div>
        <h2
          className={`mt-2 font-display text-3xl tracking-wide ${
            reason === 'cashed-out' ? 'text-[#4ea888]' : TEXT
          }`}
        >
          {title}
        </h2>
        <p className={`mt-2 text-sm ${TEXT_DIM}`}>{subtitle}</p>

        <div className="mt-6 grid grid-cols-2 gap-3 text-left">
          <div
            className={`rounded-md border border-[#1c2230] bg-[#0b0e12] px-3 py-2.5`}
          >
            <div
              className={`font-mono text-[9px] tracking-[0.25em] ${TEXT_DIM}`}
            >
              MASSA FINAL
            </div>
            <div
              className={`mt-0.5 font-mono text-xl font-semibold tabular-nums ${TEXT}`}
            >
              {Math.floor(snapshot.selfMass)}
            </div>
          </div>
          {showMoney && (
            <div
              className={`rounded-md border border-[#1c2230] bg-[#0b0e12] px-3 py-2.5`}
            >
              <div
                className={`font-mono text-[9px] tracking-[0.25em] ${TEXT_DIM}`}
              >
                {settledLabel}
              </div>
              <div
                className={`mt-0.5 font-mono text-xl font-semibold tabular-nums ${
                  (settled ?? 0) > 0 ? 'text-[#4ea888]' : 'text-[#ef6a6a]'
                }`}
              >
                {formatBRL(settled ?? 0)}
              </div>
            </div>
          )}
          <div
            className={`rounded-md border border-[#1c2230] bg-[#0b0e12] px-3 py-2.5 ${
              showMoney ? '' : 'col-span-2'
            }`}
          >
            <div
              className={`font-mono text-[9px] tracking-[0.25em] ${TEXT_DIM}`}
            >
              TEMPO DECORRIDO
            </div>
            <div
              className={`mt-0.5 font-mono text-xl font-semibold tabular-nums ${TEXT}`}
            >
              {formatMS(snapshot.elapsedMs)}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onExit}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded-md border border-[#4ea888] bg-[#4ea888] px-4 py-2.5 font-semibold tracking-wider text-[#0b0e12] transition hover:bg-[#5cb496]"
        >
          <X className="h-4 w-4" />
          VOLTAR AO LOBBY
        </button>
      </div>
    </div>
  );
}

// ─── Formatters ──────────────────────────────────────────────────────────────
function formatMS(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}
