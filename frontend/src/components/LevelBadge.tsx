// LevelBadge — renders a hexagonal level icon + XP progress bar.
// Self-contained: XP math mirrors backend/src/progression/progression.constants.ts
// so no extra network hop is needed.

import { useMemo } from 'react';

// ─── XP curve (same formula as progression.constants.ts) ─────────────────────

const MAX_LEVEL = 100;

function levelFromXp(xp: number): number {
  if (xp <= 0) return 0;
  const disc = 475 * 475 + 100 * xp;
  return Math.min(MAX_LEVEL, Math.max(0, Math.floor((-475 + Math.sqrt(disc)) / 50)));
}

function cumulativeXpForLevel(n: number): number {
  const level = Math.max(0, Math.min(n, MAX_LEVEL));
  return 25 * level * level + 475 * level;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LevelBadgeProps {
  /**
   * Lifetime account XP. Level, progress, and tooltip are all computed
   * from this single value — the caller doesn't need to pre-compute them.
   */
  accountXp: number;
  /**
   * `sm`  — hex + thin bar side-by-side; fits inside the TopBar user pill.
   * `md`  — hex + bar with XP labels; for Sidebar / profile cards.
   */
  size?: 'sm' | 'md';
  className?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Flat-top hexagon clip-path.
const HEX = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

// ─── Component ────────────────────────────────────────────────────────────────

export default function LevelBadge({
  accountXp,
  size = 'md',
  className = '',
}: LevelBadgeProps) {
  const info = useMemo(() => {
    const xp = Math.max(0, Math.floor(accountXp));
    const level = levelFromXp(xp);
    const xpStart = cumulativeXpForLevel(level);
    const isMaxLevel = level >= MAX_LEVEL;
    const xpEnd = isMaxLevel ? xpStart : cumulativeXpForLevel(level + 1);
    const span = xpEnd - xpStart;
    const into = xp - xpStart;
    return {
      level,
      xpIntoLevel: into,
      xpToNextLevel: isMaxLevel ? 0 : xpEnd - xp,
      isMaxLevel,
      // Clamped so floating-point overshoot never exceeds 100 %.
      progress: Math.min(1, isMaxLevel ? 1 : span > 0 ? into / span : 0),
    };
  }, [accountXp]);

  const isSm = size === 'sm';

  const tooltip = info.isMaxLevel
    ? 'Nível máximo alcançado!'
    : `Faltam ${info.xpToNextLevel.toLocaleString('pt-BR')} XP para o próximo nível`;

  return (
    <div
      className={`group/lvl relative flex items-center ${isSm ? 'gap-2' : 'gap-3'} ${className}`}
    >
      {/* ── Hexagon ──────────────────────────────────────────────────────── */}
      <div
        className={`relative flex-shrink-0 ${isSm ? 'h-6 w-6' : 'h-9 w-9'}`}
        aria-label={`Nível ${info.level}`}
      >
        {/* Border layer — gradient fills the whole hex, creating the frame */}
        <div
          className="absolute inset-0"
          style={{
            clipPath: HEX,
            background: info.isMaxLevel
              ? 'linear-gradient(160deg, #f59e0b 0%, #d97706 100%)'
              : 'linear-gradient(160deg, rgba(74,222,128,0.7) 0%, rgba(22,163,74,0.5) 100%)',
          }}
        />
        {/* Body — inset hex in the panel dark color */}
        <div
          className="absolute"
          style={{
            clipPath: HEX,
            inset: isSm ? '1.5px' : '2px',
            background: '#0b0e14',
          }}
        />
        {/* Level number */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ clipPath: HEX }}
        >
          <span
            className={`font-display font-bold leading-none ${
              isSm ? 'text-[10px]' : 'text-[13px]'
            } ${info.isMaxLevel ? 'text-amber-400' : 'text-snake-400'}`}
          >
            {info.level}
          </span>
        </div>
        {/* Top-edge highlight — simulates a light source above */}
        <div
          className="absolute"
          style={{
            clipPath: HEX,
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 45%)',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* ── Bar section ──────────────────────────────────────────────────── */}
      <div className={`flex flex-col ${isSm ? 'gap-0.5' : 'gap-1'}`}>
        {/* XP labels — only visible in md */}
        {!isSm && (
          <div className="flex items-center justify-between gap-6">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.25em] text-zinc-600">
              XP
            </span>
            <span className="font-mono text-[9px] tabular-nums text-snake-500/80">
              {info.isMaxLevel
                ? 'MAX'
                : `${info.xpIntoLevel.toLocaleString('pt-BR')}`}
            </span>
          </div>
        )}

        {/* Progress track */}
        <div
          className={`relative overflow-hidden rounded-full bg-base-600 ${
            isSm ? 'h-[2.5px] w-14' : 'h-[3px] w-24'
          }`}
        >
          {/* Filled portion */}
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
            style={{
              width: `${(info.progress * 100).toFixed(2)}%`,
              background: info.isMaxLevel
                ? 'linear-gradient(90deg, #d97706, #f59e0b)'
                : 'linear-gradient(90deg, #16a34a, #4ade80)',
              boxShadow: info.isMaxLevel
                ? '0 0 5px rgba(245,158,11,0.7), 0 0 10px rgba(245,158,11,0.3)'
                : '0 0 5px rgba(34,197,94,0.7), 0 0 10px rgba(34,197,94,0.3)',
            }}
          />
          {/* Shimmer sweep */}
          <div
            className="animate-shimmer absolute inset-y-0 w-6 -translate-x-full"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)',
            }}
          />
        </div>
      </div>

      {/* ── Tooltip ───────────────────────────────────────────────────────── */}
      <div
        role="tooltip"
        className="pointer-events-none absolute -top-9 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded border border-snake-500/20 bg-base-800/95 px-2.5 py-1.5 font-mono text-[10px] tracking-wide text-zinc-300 opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-150 group-hover/lvl:opacity-100"
      >
        {tooltip}
        {/* Caret */}
        <div className="absolute -bottom-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-snake-500/20 bg-base-800" />
      </div>
    </div>
  );
}
