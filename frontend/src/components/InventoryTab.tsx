// Inventory tab — shows the player's UserItems with float + serial,
// lets them equip a skin which changes snake.color in the next match.
//
// Skin colour is derived from rarity (Item has no color field in the DB).
// This mirrors how CS:GO wear conditions interact with float values:
//   floatValue → body alpha  (renderer.ts: floatToBodyAlpha)
//   rarity     → body color  (this file: RARITY_SNAKE_COLOR)

import { useCallback, useEffect, useRef, useState } from 'react';
import { Package, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import {
  ApiError,
  cosmeticsApi,
  inventoryApi,
  tokenStorage,
  type CosmeticInstanceDto,
  type InventoryDto,
} from '../lib/api';
import { floatToBodyAlpha } from '../game/renderer';

// ─── Skin colour palette (rarity → snake body hex) ────────────────────────────
// `Item` has no `color` column; rarity is the visual tier signal (like CS:GO
// quality tiers). The renderer applies floatToBodyAlpha on top of this color.
export const RARITY_SNAKE_COLOR: Record<string, string> = {
  COMMON: '#6b7280',
  RARE: '#3b82f6',
  EPIC: '#a855f7',
  LEGENDARY: '#f59e0b',
};

export function rarityToSnakeColor(rarity: string): string {
  return RARITY_SNAKE_COLOR[rarity] ?? RARITY_SNAKE_COLOR.COMMON;
}

// ─── Rarity badge styles ──────────────────────────────────────────────────────
const RARITY_UI: Record<
  string,
  { badge: string; border: string; shadow: string; label: string }
> = {
  COMMON: {
    badge: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
    border: 'border-zinc-500/20 hover:border-zinc-400/40',
    shadow: 'rgba(107,114,128,0)',
    label: 'COMUM',
  },
  RARE: {
    badge: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
    border: 'border-blue-500/25 hover:border-blue-400/50',
    shadow: 'rgba(59,130,246,0.18)',
    label: 'RARO',
  },
  EPIC: {
    badge: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
    border: 'border-purple-500/25 hover:border-purple-400/50',
    shadow: 'rgba(168,85,247,0.18)',
    label: 'ÉPICO',
  },
  LEGENDARY: {
    badge: 'border-amber-400/40 bg-amber-500/10 text-amber-300',
    border: 'border-amber-400/30 hover:border-amber-300/60',
    shadow: 'rgba(245,158,11,0.22)',
    label: 'LENDÁRIO',
  },
};

function rarityUi(rarity: string) {
  return RARITY_UI[rarity] ?? RARITY_UI.COMMON;
}

// ─── Float condition (CS:GO convention) ───────────────────────────────────────
function wearOf(f: number): { name: string; color: string; abbr: string } {
  if (f < 0.07) return { name: 'Factory New',     color: '#22c55e', abbr: 'FN' };
  if (f < 0.15) return { name: 'Minimal Wear',    color: '#86efac', abbr: 'MW' };
  if (f < 0.38) return { name: 'Field-Tested',    color: '#e6b04a', abbr: 'FT' };
  if (f < 0.45) return { name: 'Well-Worn',       color: '#fb923c', abbr: 'WW' };
  return           { name: 'Battle-Scarred',   color: '#ef4444', abbr: 'BS' };
}

// ─── Snake preview (mini inline SVG) ──────────────────────────────────────────
// Draws a curving snake body segment to give the card a game-native feel.
function SnakePreview({
  color,
  floatValue,
  size = 56,
}: {
  color: string;
  floatValue: number;
  size?: number;
}) {
  const alpha = floatToBodyAlpha(floatValue);
  const r = size * 0.14;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      aria-hidden
      style={{ opacity: alpha }}
    >
      <defs>
        <filter id={`shadow-${color.replace('#', '')}`}>
          <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={color} floodOpacity="0.4" />
        </filter>
      </defs>
      {/* Body path */}
      <path
        d="M 8 36 Q 14 24 28 28 Q 42 32 48 20"
        fill="none"
        stroke={color}
        strokeWidth={r * 2 + 4}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 3px ${color}66)` }}
      />
      {/* Head circle */}
      <circle cx="48" cy="20" r={r + 2} fill={color} />
      {/* Eyes */}
      <circle cx="51" cy="17" r="2.2" fill="#f2f4f7" />
      <circle cx="51.6" cy="16.6" r="1.1" fill="#0b0e12" />
      <circle cx="46" cy="17" r="2.2" fill="#f2f4f7" />
      <circle cx="46.6" cy="16.6" r="1.1" fill="#0b0e12" />
    </svg>
  );
}

// ─── Float bar ────────────────────────────────────────────────────────────────
function FloatBar({ value }: { value: number }) {
  const pct = Math.min(1, Math.max(0, value)) * 100;
  const wear = wearOf(value);
  return (
    <div className="w-full">
      {/* Gradient track */}
      <div className="relative h-2 w-full overflow-hidden rounded-full"
        style={{
          background:
            'linear-gradient(to right, #22c55e 0%, #86efac 13%, #e6b04a 40%, #fb923c 44%, #ef4444 60%, #991b1b 100%)',
        }}
      >
        {/* Dark overlay covering everything to the right of the needle */}
        <div
          className="absolute inset-y-0 right-0 rounded-full bg-base-800/70"
          style={{ width: `${100 - pct}%` }}
        />
        {/* Needle */}
        <div
          className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="font-mono text-[10px] tabular-nums" style={{ color: wear.color }}>
          {value.toFixed(4)}
        </span>
        <span className="font-mono text-[9px] tracking-[0.15em] uppercase" style={{ color: wear.color }}>
          {wear.abbr} · {wear.name}
        </span>
      </div>
    </div>
  );
}

// ─── Item card ────────────────────────────────────────────────────────────────
function ItemCard({
  item,
  isSelected,
  isEquipped,
  onClick,
}: {
  item: CosmeticInstanceDto;
  isSelected: boolean;
  isEquipped: boolean;
  onClick: () => void;
}) {
  const ui = rarityUi(item.item.rarity);
  const color = rarityToSnakeColor(item.item.rarity);
  const wear = wearOf(item.floatValue);
  const serial = `#${String(item.serialNumber).padStart(5, '0')}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex flex-col items-start overflow-hidden rounded-xl border bg-base-700/40 p-4 text-left transition-all duration-200 ${
        isSelected
          ? 'border-snake-400/60 bg-base-600/50 shadow-[0_0_20px_rgba(34,197,94,0.12)]'
          : ui.border
      } hover:-translate-y-0.5`}
      style={{
        boxShadow: isSelected
          ? `0 0 20px rgba(34,197,94,0.1)`
          : `0 4px 20px ${ui.shadow}`,
      }}
    >
      {/* Equipped badge */}
      {isEquipped && (
        <div className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full border border-snake-400/40 bg-snake-500/15 px-2 py-0.5">
          <ShieldCheck className="h-3 w-3 text-snake-400" />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-snake-300">
            Equipado
          </span>
        </div>
      )}

      {/* Snake preview */}
      <div className="mb-3 flex h-14 w-full items-center justify-center rounded-lg bg-base-800/60">
        <SnakePreview color={color} floatValue={item.floatValue} size={56} />
      </div>

      {/* Name */}
      <span className="mb-1.5 line-clamp-1 text-sm font-semibold text-zinc-100">
        {item.item.name}
      </span>

      {/* Rarity badge + serial */}
      <div className="flex w-full items-center justify-between gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] ${ui.badge}`}
        >
          {ui.label}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-zinc-500">
          {serial}
        </span>
      </div>

      {/* Float */}
      <div className="mt-2.5 flex w-full items-center gap-2">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full"
          style={{
            background:
              'linear-gradient(to right, #22c55e, #e6b04a, #ef4444)',
            opacity: 0.6,
          }}
        >
          <div
            className="h-full rounded-full bg-white/0"
            style={{ width: `${item.floatValue * 100}%` }}
          />
        </div>
        <span
          className="font-mono text-[9px] tabular-nums"
          style={{ color: wear.color }}
        >
          {wear.abbr}
        </span>
      </div>
    </button>
  );
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
function DetailPanel({
  item,
  isEquipped,
  equipping,
  equipError,
  onEquip,
  onUnequip,
  onClose,
}: {
  item: CosmeticInstanceDto;
  isEquipped: boolean;
  equipping: boolean;
  equipError: string | null;
  onEquip: (id: string) => void;
  onUnequip: () => void;
  onClose: () => void;
}) {
  const ui = rarityUi(item.item.rarity);
  const color = rarityToSnakeColor(item.item.rarity);
  const serial = `#${String(item.serialNumber).padStart(5, '0')}`;

  return (
    <div className="col-span-full mt-1 overflow-hidden rounded-xl border border-white/8 bg-base-800/80 backdrop-blur-sm">
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-start sm:gap-8">
        {/* Left: preview */}
        <div className="flex flex-col items-center gap-3">
          <div
            className="flex h-28 w-28 items-center justify-center rounded-xl border"
            style={{
              borderColor: `${color}33`,
              background: `radial-gradient(circle at 50% 50%, ${color}14, transparent 70%)`,
            }}
          >
            <SnakePreview color={color} floatValue={item.floatValue} size={88} />
          </div>
          {isEquipped && (
            <div className="flex items-center gap-1.5 rounded-full border border-snake-400/30 bg-snake-500/10 px-3 py-1">
              <ShieldCheck className="h-3.5 w-3.5 text-snake-400" />
              <span className="font-mono text-[10px] font-semibold tracking-wider text-snake-300">
                EQUIPADO
              </span>
            </div>
          )}
        </div>

        {/* Right: details */}
        <div className="flex flex-1 flex-col gap-4">
          {/* Name + meta */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] ${ui.badge}`}
              >
                {ui.label}
              </span>
              {item.item.gameId && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                  {item.item.gameId}
                </span>
              )}
            </div>
            <h3 className="mt-2 font-display text-2xl tracking-wide text-zinc-100">
              {item.item.name}
            </h3>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Serial" value={serial} mono />
            <Stat
              label="Obtido em"
              value={new Date(item.obtainedAt).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: '2-digit',
              })}
              mono
            />
            <Stat label="Tipo" value={item.item.type} mono />
          </div>

          {/* Float bar */}
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Float Value
            </div>
            <FloatBar value={item.floatValue} />
          </div>

          {/* Equip error */}
          {equipError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[11px] text-red-300">
              {equipError}
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3 border-t border-white/5 pt-4">
            {isEquipped ? (
              <button
                type="button"
                onClick={onUnequip}
                disabled={equipping}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
              >
                {equipping ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
                Desequipar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onEquip(item.id)}
                disabled={equipping}
                className="flex items-center gap-2 rounded-lg border border-snake-400/40 bg-snake-500/15 px-5 py-2 text-sm font-semibold text-snake-100 transition hover:border-snake-400/60 hover:bg-snake-500/25 disabled:opacity-50"
                style={{
                  boxShadow: '0 4px 14px rgba(34,197,94,0.15)',
                }}
              >
                {equipping ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 text-snake-400" />
                )}
                Equipar
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/8 bg-white/5 px-4 py-2 text-sm text-zinc-500 transition hover:bg-white/8 hover:text-zinc-300"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/5 bg-base-700/40 px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-600">
        {label}
      </div>
      <div
        className={`mt-0.5 text-sm text-zinc-200 ${mono ? 'font-mono tabular-nums' : 'font-medium'}`}
      >
        {value}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface InventoryTabProps {
  /** Called whenever the equipped skin changes so Lobby can update playerColor. */
  onEquipChange: (item: CosmeticInstanceDto | null) => void;
}

export default function InventoryTab({ onEquipChange }: InventoryTabProps) {
  const [inventory, setInventory] = useState<InventoryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [equipping, setEquipping] = useState(false);
  const [equipError, setEquipError] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement | null>(null);

  const token = tokenStorage.get();

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    inventoryApi
      .list(token)
      .then((data) => {
        setInventory(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof ApiError
            ? err.message
            : 'Não foi possível carregar o inventário.';
        setError(msg);
        setLoading(false);
      });
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Scroll detail panel into view when it appears.
  useEffect(() => {
    if (selectedId && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedId]);

  const selectedItem =
    inventory?.items.find((i) => i.id === selectedId) ?? null;
  const equippedId = inventory?.equippedSkinId ?? null;

  async function handleEquip(userItemId: string) {
    if (!token || equipping) return;
    setEquipping(true);
    setEquipError(null);
    try {
      const result = await cosmeticsApi.equip(token, userItemId);
      setInventory((prev) =>
        prev ? { ...prev, equippedSkinId: userItemId } : prev,
      );
      onEquipChange(result);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Erro ao equipar. Tente novamente.';
      setEquipError(msg);
    } finally {
      setEquipping(false);
    }
  }

  async function handleUnequip() {
    if (!token || equipping) return;
    setEquipping(true);
    setEquipError(null);
    try {
      await cosmeticsApi.unequip(token);
      setInventory((prev) =>
        prev ? { ...prev, equippedSkinId: null } : prev,
      );
      onEquipChange(null);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Erro ao desequipar. Tente novamente.';
      setEquipError(msg);
    } finally {
      setEquipping(false);
    }
  }

  function handleCardClick(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  // ── Render states ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-zinc-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <div className="text-zinc-500">{error}</div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/8"
        >
          <RefreshCw className="h-4 w-4" />
          Tentar novamente
        </button>
      </div>
    );
  }

  const items = inventory?.items ?? [];
  const skins = items.filter((i) => i.item.type === 'SKIN');

  if (skins.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-base-700/60 text-zinc-600">
          <Package className="h-7 w-7" />
        </div>
        <div>
          <h3 className="font-display text-3xl tracking-wide text-white">
            Inventário vazio
          </h3>
          <p className="mt-2 max-w-xs text-sm text-zinc-500">
            Suba de nível no Battle Pass ou conquiste partidas para ganhar skins
            exclusivas.
          </p>
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-end justify-between border-b border-white/5 pb-6">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-snake-400/70">
            03 / PERFIL · INVENTÁRIO
          </div>
          <h1 className="mt-2 font-display text-5xl tracking-wide text-white">
            Inventário
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            {skins.length} {skins.length === 1 ? 'skin' : 'skins'} · clique para ver detalhes e equipar
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          aria-label="Recarregar inventário"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/8 bg-white/5 text-zinc-400 transition hover:bg-white/8 hover:text-zinc-100"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Grid — the detail panel is inserted as a `col-span-full` row after
          the selected card's row, keeping scroll position stable. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {skins.map((item, idx) => {
          // Determine if this is the last card in the row so we can inject
          // the detail panel after the correct row (not just after the card).
          const cols = window.innerWidth >= 1280 ? 4 : window.innerWidth >= 768 ? 3 : 2;
          const isSelected = item.id === selectedId;
          const isLastInRow = (idx + 1) % cols === 0 || idx === skins.length - 1;
          const selectedIdx = skins.findIndex((s) => s.id === selectedId);
          const selectedRow = selectedIdx >= 0 ? Math.floor(selectedIdx / cols) : -1;
          const thisRow = Math.floor(idx / cols);
          const showDetail = isLastInRow && thisRow === selectedRow && selectedItem;

          return (
            <>
              <ItemCard
                key={item.id}
                item={item}
                isSelected={isSelected}
                isEquipped={item.id === equippedId}
                onClick={() => handleCardClick(item.id)}
              />
              {showDetail && (
                <div key={`detail-${selectedId}`} ref={detailRef} className="col-span-full">
                  <DetailPanel
                    item={selectedItem}
                    isEquipped={selectedItem.id === equippedId}
                    equipping={equipping}
                    equipError={equipError}
                    onEquip={handleEquip}
                    onUnequip={handleUnequip}
                    onClose={() => { setSelectedId(null); setEquipError(null); }}
                  />
                </div>
              )}
            </>
          );
        })}
      </div>
    </div>
  );
}
