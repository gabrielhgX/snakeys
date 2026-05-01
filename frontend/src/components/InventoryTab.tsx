// Inventory tab — CS:GO-style skin inventory.
//
// Visual identity:
//   rarity   → snake body color + card glow color
//   float    → body opacity in-game (floatToBodyAlpha) + wear condition label
//   imageUrl → shown if present; otherwise a gradient color-swatch fallback

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
import { playEquipSound } from '../lib/sound';

// ─── Rarity palette ───────────────────────────────────────────────────────────
export const RARITY_SNAKE_COLOR: Record<string, string> = {
  COMMON:    '#6b7280',
  RARE:      '#3b82f6',
  EPIC:      '#a855f7',
  LEGENDARY: '#f59e0b',
};

export function rarityToSnakeColor(rarity: string): string {
  return RARITY_SNAKE_COLOR[rarity] ?? RARITY_SNAKE_COLOR.COMMON;
}

const RARITY_LABEL: Record<string, string> = {
  COMMON:    'COMUM',
  RARE:      'RARO',
  EPIC:      'ÉPICO',
  LEGENDARY: 'LENDÁRIO',
};

// ─── Float wear condition ─────────────────────────────────────────────────────
function wearOf(f: number): { name: string; color: string; abbr: string } {
  if (f < 0.07) return { name: 'Factory New',   color: '#22c55e', abbr: 'FN' };
  if (f < 0.15) return { name: 'Minimal Wear',  color: '#86efac', abbr: 'MW' };
  if (f < 0.38) return { name: 'Field-Tested',  color: '#e6b04a', abbr: 'FT' };
  if (f < 0.45) return { name: 'Well-Worn',     color: '#fb923c', abbr: 'WW' };
  return               { name: 'Battle-Scarred',color: '#ef4444', abbr: 'BS' };
}

// ─── Snake silhouette SVG (no filters, no white-box artifacts) ────────────────
function SnakeSilhouette({
  color,
  floatValue,
  size,
}: {
  color: string;
  floatValue: number;
  size: number;
}) {
  const alpha = floatToBodyAlpha(floatValue);
  // Stroke width scales with size so it looks consistent at any size.
  const sw = size * 0.14;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden
      style={{ opacity: alpha, display: 'block' }}
    >
      {/* S-curve body */}
      <path
        d="M 18 72 C 18 45, 50 55, 50 38 C 50 20, 82 30, 82 18"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Head disc */}
      <circle cx="82" cy="18" r={sw * 0.85} fill={color} />
      {/* Left eye */}
      <circle cx="88" cy="13" r={sw * 0.32} fill="#f2f4f7" />
      <circle cx="89" cy="12" r={sw * 0.17} fill="#0b0e12" />
      {/* Right eye */}
      <circle cx="79" cy="11" r={sw * 0.32} fill="#f2f4f7" />
      <circle cx="80" cy="10" r={sw * 0.17} fill="#0b0e12" />
    </svg>
  );
}

// ─── Full-width float bar ─────────────────────────────────────────────────────
function FloatBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value * 100));
  const wear = wearOf(value);
  return (
    <div className="w-full">
      <div
        className="relative h-[6px] w-full overflow-hidden rounded-full"
        style={{
          background:
            'linear-gradient(to right, #22c55e 0%, #86efac 13%, #e6b04a 40%, #fb923c 44%, #ef4444 60%, #991b1b 100%)',
        }}
      >
        {/* Dark mask over unused portion */}
        <div
          className="absolute inset-y-0 right-0 rounded-full bg-base-900/70"
          style={{ width: `${100 - pct}%` }}
        />
        {/* Needle */}
        <div
          className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-white/90 shadow-[0_0_4px_white]"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] tabular-nums" style={{ color: wear.color }}>
          {value.toFixed(4)}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.15em]" style={{ color: wear.color }}>
          {wear.abbr} · {wear.name}
        </span>
      </div>
    </div>
  );
}

// ─── Inventory card ───────────────────────────────────────────────────────────
// Layout: large preview fills top, info strip at bottom.
// Glow color = rarity hex. Intensity: faint at rest → medium hover → strong select.
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
  const color = rarityToSnakeColor(item.item.rarity);
  const wear  = wearOf(item.floatValue);
  const serial = `#${String(item.serialNumber).padStart(5, '0')}`;
  const pct = item.floatValue * 100;

  // Dynamic glow — can't be done with pure Tailwind since color is runtime.
  const cardStyle: React.CSSProperties = {
    boxShadow: isSelected
      ? `0 0 0 2px ${color}, 0 0 28px ${color}55`
      : 'none',
    transition: 'box-shadow 0.2s ease, transform 0.15s ease',
    transform: isSelected ? 'translateY(-2px)' : undefined,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-white/8 bg-base-800 text-left focus:outline-none"
      style={cardStyle}
      onMouseEnter={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 22px ${color}35`;
      }}
      onMouseLeave={(e) => {
        if (!isSelected)
          (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
    >
      {/* ── Preview area ─────────────────────────────── */}
      <div
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          background: `radial-gradient(ellipse 80% 70% at 50% 55%, ${color}30, ${color}0a 65%, #070910 100%)`,
          aspectRatio: '4 / 3',
        }}
      >
        {item.item.imageUrl ? (
          <img
            src={item.item.imageUrl}
            alt={item.item.name}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <SnakeSilhouette color={color} floatValue={item.floatValue} size={80} />
        )}

        {/* Equipped badge — top-right chip */}
        {isEquipped && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full border border-snake-400/40 bg-base-900/80 px-2 py-0.5 backdrop-blur-sm">
            <ShieldCheck className="h-3 w-3 text-snake-400" />
            <span className="font-mono text-[8px] font-bold uppercase tracking-wider text-snake-300">
              Eq
            </span>
          </div>
        )}

        {/* Thin color bar at top edge — acts as a rarity indicator stripe */}
        <div
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
        />
      </div>

      {/* ── Info strip ────────────────────────────────── */}
      <div className="flex flex-col gap-2 px-3 pb-3 pt-2.5">
        {/* Name + serial */}
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex-1 truncate text-[13px] font-semibold leading-tight text-zinc-100">
            {item.item.name}
          </span>
          <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
            {serial}
          </span>
        </div>

        {/* Rarity badge + float mini-bar */}
        <div className="flex items-center gap-2">
          <span
            className="flex-shrink-0 rounded-full px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.12em]"
            style={{
              border: `1px solid ${color}55`,
              background: `${color}15`,
              color,
            }}
          >
            {RARITY_LABEL[item.item.rarity] ?? item.item.rarity}
          </span>

          {/* Thin float indicator */}
          <div className="relative flex-1 overflow-hidden rounded-full" style={{ height: 3 }}>
            <div
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(to right, #22c55e, #e6b04a, #ef4444)',
                opacity: 0.45,
              }}
            />
            <div
              className="absolute inset-y-0 right-0 bg-base-900"
              style={{ width: `${100 - pct}%` }}
            />
          </div>

          <span
            className="flex-shrink-0 font-mono text-[9px] tabular-nums"
            style={{ color: wear.color }}
          >
            {wear.abbr}
          </span>
        </div>
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
  const color  = rarityToSnakeColor(item.item.rarity);
  const serial = `#${String(item.serialNumber).padStart(5, '0')}`;

  return (
    <div
      className="col-span-full overflow-hidden rounded-xl border bg-base-800/90 backdrop-blur-sm"
      style={{ borderColor: `${color}40` }}
    >
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:gap-7">

        {/* Left: large preview */}
        <div
          className="flex h-44 w-full flex-shrink-0 items-center justify-center overflow-hidden rounded-lg sm:w-44"
          style={{
            background: `radial-gradient(ellipse 90% 80% at 50% 55%, ${color}28, ${color}0a 65%, #070910 100%)`,
            border: `1px solid ${color}30`,
          }}
        >
          {item.item.imageUrl ? (
            <img
              src={item.item.imageUrl}
              alt={item.item.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <SnakeSilhouette color={color} floatValue={item.floatValue} size={110} />
          )}
        </div>

        {/* Right: details */}
        <div className="flex flex-1 flex-col gap-4 min-w-0">

          {/* Header row */}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em]"
                style={{ border: `1px solid ${color}55`, background: `${color}18`, color }}
              >
                {RARITY_LABEL[item.item.rarity] ?? item.item.rarity}
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

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Serial"   value={serial} mono />
            <Stat label="Obtido"   value={new Date(item.obtainedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })} mono />
            <Stat label="Tipo"     value={item.item.type} mono />
            {'usageCount' in item && typeof (item as any).usageCount === 'number' && (
              <Stat label="Partidas" value={String((item as any).usageCount)} mono />
            )}
          </div>

          {/* Float bar */}
          <div>
            <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-600">
              Float Value
            </div>
            <FloatBar value={item.floatValue} />
          </div>

          {/* Error */}
          {equipError && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-[11px] text-red-300">
              {equipError}
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3 border-t border-white/5 pt-3">
            {isEquipped ? (
              <button
                type="button"
                onClick={onUnequip}
                disabled={equipping}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
              >
                {equipping ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Desequipar
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onEquip(item.id)}
                disabled={equipping}
                className="flex items-center gap-2 rounded-lg border px-5 py-2 text-sm font-semibold transition disabled:opacity-50"
                style={{
                  borderColor: `${color}60`,
                  background: `${color}18`,
                  color: '#f1f5f9',
                  boxShadow: `0 4px 14px ${color}20`,
                }}
              >
                {equipping ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" style={{ color }} />}
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

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-white/5 bg-base-700/40 px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-zinc-600">{label}</div>
      <div className={`mt-0.5 truncate text-sm text-zinc-200 ${mono ? 'font-mono tabular-nums' : 'font-medium'}`}>
        {value}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface InventoryTabProps {
  onEquipChange: (item: CosmeticInstanceDto | null) => void;
}

export default function InventoryTab({ onEquipChange }: InventoryTabProps) {
  const [inventory,  setInventory]  = useState<InventoryDto | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [equipping,  setEquipping]  = useState(false);
  const [equipError, setEquipError] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const token = tokenStorage.get();

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    inventoryApi.list(token)
      .then((data) => { setInventory(data); setLoading(false); })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : 'Não foi possível carregar o inventário.');
        setLoading(false);
      });
  }, [token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (selectedId && detailRef.current) {
      detailRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedId]);

  const skins     = (inventory?.items ?? []).filter((i) => i.item.type === 'SKIN');
  const equippedId = inventory?.equippedSkinId ?? null;
  const selectedItem = skins.find((i) => i.id === selectedId) ?? null;

  async function handleEquip(userItemId: string) {
    if (!token || equipping) return;
    setEquipping(true);
    setEquipError(null);
    try {
      const result = await cosmeticsApi.equip(token, userItemId);
      setInventory((prev) => prev ? { ...prev, equippedSkinId: userItemId } : prev);
      onEquipChange(result);
      playEquipSound();
    } catch (err) {
      setEquipError(err instanceof ApiError ? err.message : 'Erro ao equipar. Tente novamente.');
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
      setInventory((prev) => prev ? { ...prev, equippedSkinId: null } : prev);
      onEquipChange(null);
    } catch (err) {
      setEquipError(err instanceof ApiError ? err.message : 'Erro ao desequipar. Tente novamente.');
    } finally {
      setEquipping(false);
    }
  }

  function handleCardClick(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
    setEquipError(null);
  }

  // ── Loading / error / empty states ───────────────────────────────────────────

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
        <p className="text-zinc-500">{error}</p>
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

  if (skins.length === 0) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-base-700/60 text-zinc-600">
          <Package className="h-7 w-7" />
        </div>
        <div>
          <h3 className="font-display text-3xl tracking-wide text-white">Inventário vazio</h3>
          <p className="mt-2 max-w-xs text-sm text-zinc-500">
            Suba de nível no Battle Pass ou conquiste partidas para ganhar skins exclusivas.
          </p>
        </div>
      </div>
    );
  }

  // ── Grid ─────────────────────────────────────────────────────────────────────
  // The detail panel is injected as a col-span-full row right after the row
  // that contains the selected card. We derive the row index from CSS grid
  // column count to keep the panel spatially near the selection.
  const COLS = 4; // matches xl:grid-cols-4; coarse fallback, panel still works at other sizes

  const selectedIdx = skins.findIndex((s) => s.id === selectedId);
  const selectedRow = selectedIdx >= 0 ? Math.floor(selectedIdx / COLS) : -1;

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-end justify-between border-b border-white/5 pb-6">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-snake-400/70">
            03 / PERFIL · INVENTÁRIO
          </div>
          <h1 className="mt-2 font-display text-5xl tracking-wide text-white">Inventário</h1>
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

      {/* Cards grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        {skins.map((item, idx) => {
          const thisRow   = Math.floor(idx / COLS);
          // Show detail panel after the last card in the selected card's row.
          const isLastInRow = (idx + 1) % COLS === 0 || idx === skins.length - 1;
          const showDetail  = isLastInRow && thisRow === selectedRow && selectedItem != null;

          return (
            <ItemRow
              key={item.id}
              item={item}
              isSelected={item.id === selectedId}
              isEquipped={item.id === equippedId}
              showDetail={showDetail}
              detailRef={detailRef}
              selectedItem={selectedItem}
              equippedId={equippedId}
              equipping={equipping}
              equipError={equipError}
              onCardClick={() => handleCardClick(item.id)}
              onEquip={handleEquip}
              onUnequip={handleUnequip}
              onClose={() => { setSelectedId(null); setEquipError(null); }}
            />
          );
        })}
      </div>
    </div>
  );
}

// ItemRow wraps a card + its optional injected detail panel so the fragment
// key is stable and React can diff correctly.
function ItemRow({
  item,
  isSelected,
  isEquipped,
  showDetail,
  detailRef,
  selectedItem,
  equippedId,
  equipping,
  equipError,
  onCardClick,
  onEquip,
  onUnequip,
  onClose,
}: {
  item: CosmeticInstanceDto;
  isSelected: boolean;
  isEquipped: boolean;
  showDetail: boolean;
  detailRef: React.RefObject<HTMLDivElement>;
  selectedItem: CosmeticInstanceDto | null;
  equippedId: string | null;
  equipping: boolean;
  equipError: string | null;
  onCardClick: () => void;
  onEquip: (id: string) => void;
  onUnequip: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <ItemCard
        item={item}
        isSelected={isSelected}
        isEquipped={isEquipped}
        onClick={onCardClick}
      />
      {showDetail && selectedItem && (
        <div ref={detailRef} className="col-span-full">
          <DetailPanel
            item={selectedItem}
            isEquipped={selectedItem.id === equippedId}
            equipping={equipping}
            equipError={equipError}
            onEquip={onEquip}
            onUnequip={onUnequip}
            onClose={onClose}
          />
        </div>
      )}
    </>
  );
}
