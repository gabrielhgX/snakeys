import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  ChevronDown,
  Crown,
  Fish,
  Gamepad2,
  Globe2,
  LogOut,
  Package,
  ShoppingBag,
  Target,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react';
import WalletModal from '../components/WalletModal';
import {
  ApiError,
  authApi,
  tokenStorage,
  usernameStorage,
  walletApi,
  type WalletDto,
} from '../lib/api';

// ─── Domain data ──────────────────────────────────────────────────────────────
const POT_VALUES = [100, 75, 50, 30, 20, 12, 5, 2] as const;
type PotValue = (typeof POT_VALUES)[number];

type Mode = 'online' | 'offline';

type TabId = 'play' | 'shop' | 'social' | 'inventory';

interface TabSpec {
  id: TabId;
  label: string;
  icon: ReactNode;
}

const TABS: TabSpec[] = [
  { id: 'play', label: 'Jogar', icon: <Gamepad2 className="h-4 w-4" /> },
  { id: 'shop', label: 'Loja', icon: <ShoppingBag className="h-4 w-4" /> },
  { id: 'social', label: 'Social', icon: <Users className="h-4 w-4" /> },
  { id: 'inventory', label: 'Inventário', icon: <Package className="h-4 w-4" /> },
];

type GameModeTone = 'red' | 'cyan' | 'violet';

interface GameMode {
  key: 'hunt-hunt' | 'big-fish' | 'private';
  title: string;
  tagline: string;
  description: string;
  icon: ReactNode;
  tone: GameModeTone;
  players: string;
  tag: string;
}

const GAME_MODES: GameMode[] = [
  {
    key: 'hunt-hunt',
    title: 'Hunt-Hunt',
    tagline: 'Caçador vs. Caçador',
    description:
      'Last snake standing. Quem elimina mais leva o pote inteiro.',
    icon: <Target className="h-7 w-7" />,
    tone: 'red',
    players: '8 jogadores',
    tag: 'CLÁSSICO',
  },
  {
    key: 'big-fish',
    title: 'Big Fish',
    tagline: 'Maior massa vence',
    description:
      'Cresça rápido, domine o mapa — o top 3 divide o prêmio.',
    icon: <Fish className="h-7 w-7" />,
    tone: 'cyan',
    players: '16 jogadores',
    tag: 'POPULAR',
  },
  {
    key: 'private',
    title: 'Partida Privada',
    tagline: 'Só com seus amigos',
    description:
      'Crie uma sala com código para jogar apenas com convidados.',
    icon: <Crown className="h-7 w-7" />,
    tone: 'violet',
    players: '2–12 jogadores',
    tag: 'FRIENDS',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatCurrency(value: number | string): string {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  if (Number.isNaN(n)) return 'R$ 0,00';
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Lobby() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('play');
  const [mode, setMode] = useState<Mode>('online');
  const [pot, setPot] = useState<PotValue>(20);
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [username] = useState<string>(
    () => usernameStorage.get() ?? 'Jogador',
  );
  const [queueStatus, setQueueStatus] = useState<string | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  const refreshWallet = useCallback(() => {
    const token = tokenStorage.get();
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }
    walletApi
      .get(token)
      .then((w) => {
        setWallet(w);
        setWalletError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          tokenStorage.clear();
          navigate('/login', { replace: true });
          return;
        }
        setWalletError('Não foi possível carregar o saldo.');
      });
  }, [navigate]);

  // Initial load + redirect guard.
  useEffect(() => {
    if (!tokenStorage.get()) {
      navigate('/login', { replace: true });
      return;
    }
    refreshWallet();
  }, [navigate, refreshWallet]);

  const balanceNumber = useMemo(
    () => (wallet ? Number(wallet.balanceAvailable) : 0),
    [wallet],
  );
  const balanceLabel = useMemo(
    () => (wallet ? formatCurrency(wallet.balanceAvailable) : '—'),
    [wallet],
  );

  function handlePlay(modeKey: GameMode['key']) {
    if (modeKey === 'private') {
      setQueueStatus('Partidas privadas em breve...');
      setTimeout(() => setQueueStatus(null), 3000);
      return;
    }
    // Online matchmaking: not yet implemented → fall back to offline bot mode
    if (mode === 'online') {
      setQueueStatus('Matchmaking online em breve — iniciando modo offline...');
      setTimeout(() => {
        setQueueStatus(null);
        navigate(`/game?mode=${modeKey}`);
      }, 1800);
      return;
    }
    navigate(`/game?mode=${modeKey}`);
  }

  async function handleLogout() {
    const token = tokenStorage.get();
    try {
      if (token) await authApi.logout(token);
    } catch {
      // Even if backend call fails, drop the local session.
    } finally {
      tokenStorage.clear();
      usernameStorage.clear();
      navigate('/login', { replace: true });
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-base text-zinc-100">
      <TopBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        username={username}
        balanceLabel={balanceLabel}
        balanceError={walletError}
        onBalanceClick={() => setWalletModalOpen(true)}
        onLogout={handleLogout}
      />

      <WalletModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        balance={balanceNumber}
        onBalanceChanged={refreshWallet}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          mode={mode}
          setMode={setMode}
          pot={pot}
          setPot={setPot}
        />

        <main className="relative flex-1 overflow-y-auto">
          {/* subtle ambient gradient */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(74,222,128,0.06),transparent_70%)]"
          />

          <div className="relative mx-auto w-full max-w-6xl px-8 py-10">
            {activeTab === 'play' ? (
              <PlayTab
                mode={mode}
                pot={pot}
                onPlay={handlePlay}
                queueStatus={queueStatus}
              />
            ) : (
              <ComingSoon tab={activeTab} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────────
function TopBar({
  activeTab,
  onTabChange,
  username,
  balanceLabel,
  balanceError,
  onBalanceClick,
  onLogout,
}: {
  activeTab: TabId;
  onTabChange: (t: TabId) => void;
  username: string;
  balanceLabel: string;
  balanceError: string | null;
  onBalanceClick: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/5 bg-base-900/95 px-6 backdrop-blur-md lg:px-10">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gradient-to-br from-snake-400 to-snake-600 shadow-[0_4px_14px_rgba(34,197,94,0.35)]">
          <Gamepad2 className="h-5 w-5 text-base-900" />
        </div>
        <div className="leading-none">
          <div className="font-display text-2xl tracking-wide text-snake-400">
            SNAKEYS
          </div>
          <div className="mt-0.5 font-mono text-[9px] tracking-[0.3em] text-zinc-600">
            BY PRIME ASSETS
          </div>
        </div>
      </div>

      {/* Tabs */}
      <nav className="hidden items-center gap-1 rounded-full border border-white/5 bg-base-700/50 p-1 md:flex">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold tracking-wider transition ${
              activeTab === t.id
                ? 'bg-snake-500 text-base-900 shadow-[0_4px_14px_rgba(34,197,94,0.35)]'
                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
            }`}
          >
            {t.icon}
            <span className="uppercase">{t.label}</span>
          </button>
        ))}
      </nav>

      {/* Wallet + user */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBalanceClick}
          title={balanceError ?? 'Abrir carteira (depositar / sacar)'}
          className="group flex items-center gap-2.5 rounded-full border border-amber-500/20 bg-amber-500/5 px-4 py-1.5 transition hover:border-amber-400/50 hover:bg-amber-500/10 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
        >
          <Wallet className="h-4 w-4 text-amber-300" />
          <span className="font-mono text-sm font-semibold tabular-nums text-amber-200">
            {balanceLabel}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-amber-300/70 transition group-hover:translate-y-0.5 group-hover:text-amber-200" />
        </button>
        <div className="hidden items-center gap-2.5 rounded-full border border-white/5 bg-base-700/60 py-1 pl-2 pr-3 sm:flex">
          <Avatar name={username} />
          <span className="max-w-[140px] truncate text-sm font-medium text-zinc-200">
            {username}
          </span>
        </div>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Sair"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-white/5 bg-base-700/60 text-zinc-400 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+|_/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-snake-400 to-snake-600 text-[11px] font-bold text-base-900">
      {initials || '?'}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({
  mode,
  setMode,
  pot,
  setPot,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  pot: PotValue;
  setPot: (p: PotValue) => void;
}) {
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-r border-white/5 bg-base-900/50 lg:flex">
      <div className="flex-1 overflow-y-auto px-5 py-8">
        {/* Mode section */}
        <SidebarSection label="Modo">
          <ModeRow
            active={mode === 'online'}
            icon={<Globe2 className="h-4 w-4" />}
            label="Online"
            sub="Matchmaking com outros jogadores"
            onClick={() => setMode('online')}
          />
          <ModeRow
            active={mode === 'offline'}
            icon={<Bot className="h-4 w-4" />}
            label="Offline (bots)"
            sub="Treino contra inteligência artificial"
            onClick={() => setMode('offline')}
          />
        </SidebarSection>

        {/* Pot values section */}
        <SidebarSection label="Valor do Pote" className="mt-8">
          <div className="space-y-1">
            {POT_VALUES.map((value) => (
              <PotRow
                key={value}
                value={value}
                active={pot === value}
                onClick={() => setPot(value)}
              />
            ))}
          </div>
        </SidebarSection>
      </div>

      <div className="border-t border-white/5 px-5 py-4">
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-600">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-snake-400" />
          Servidores online
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({
  label,
  className = '',
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={className}>
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-zinc-500">
        {label}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function ModeRow({
  active,
  icon,
  label,
  sub,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition ${
        active
          ? 'border-snake-400/40 bg-snake-500/10 shadow-[inset_0_1px_0_rgba(74,222,128,0.15)]'
          : 'border-white/5 bg-base-700/40 hover:border-white/10 hover:bg-base-700/60'
      }`}
    >
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
          active
            ? 'bg-snake-400/20 text-snake-300'
            : 'bg-base-600/70 text-zinc-400'
        }`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm font-semibold ${
            active ? 'text-snake-100' : 'text-zinc-200'
          }`}
        >
          {label}
        </div>
        <div className="mt-0.5 text-[11px] leading-tight text-zinc-500">
          {sub}
        </div>
      </div>
    </button>
  );
}

function PotRow({
  value,
  active,
  onClick,
}: {
  value: PotValue;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${
        active
          ? 'border-amber-400/40 bg-amber-500/10 text-amber-100'
          : 'border-transparent bg-base-700/30 text-zinc-300 hover:border-white/10 hover:bg-base-700/60'
      }`}
    >
      <span
        className={`font-mono tabular-nums ${active ? 'font-semibold' : ''}`}
      >
        {formatCurrency(value)}
      </span>
      <span
        className={`text-[10px] font-semibold uppercase tracking-wider ${
          active ? 'text-amber-300' : 'text-zinc-600'
        }`}
      >
        {active ? 'Selecionado' : 'Pote'}
      </span>
    </button>
  );
}

// ─── Play tab ─────────────────────────────────────────────────────────────────
function PlayTab({
  mode,
  pot,
  onPlay,
  queueStatus,
}: {
  mode: Mode;
  pot: PotValue;
  onPlay: (key: GameMode['key']) => void;
  queueStatus: string | null;
}) {
  return (
    <>
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-white/5 pb-8 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-snake-400/70">
            02 / HOME · LOBBY
          </div>
          <h1 className="mt-2 font-display text-5xl tracking-wide text-white">
            Escolha seu modo
          </h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Defina <span className="text-zinc-200">Modo</span> e{' '}
            <span className="text-amber-300">Valor do Pote</span> na barra
            lateral e selecione uma partida abaixo.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Pill
            tone="emerald"
            label={mode === 'online' ? 'ONLINE' : 'OFFLINE'}
          />
          <Pill tone="amber" label={formatCurrency(pot)} />
        </div>
      </div>

      {/* Queue status banner */}
      {queueStatus && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-snake-400/30 bg-snake-500/10 px-5 py-3 text-sm text-snake-100">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-snake-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-snake-400" />
          </span>
          <span className="font-mono text-[11px] tracking-wider">
            {queueStatus}
          </span>
        </div>
      )}

      {/* Mode cards */}
      <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
        {GAME_MODES.map((g) => (
          <ModeCard
            key={g.key}
            mode={g}
            pot={pot}
            onPlay={() => onPlay(g.key)}
          />
        ))}
      </div>

      {/* Secondary info strip */}
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        <InfoStat
          icon={<Trophy className="h-4 w-4" />}
          label="Partidas jogadas"
          value="—"
        />
        <InfoStat
          icon={<Target className="h-4 w-4" />}
          label="Taxa de vitória"
          value="—"
        />
        <InfoStat
          icon={<Crown className="h-4 w-4" />}
          label="Maior pote"
          value="—"
        />
      </div>
    </>
  );
}

function Pill({
  tone,
  label,
}: {
  tone: 'emerald' | 'amber';
  label: string;
}) {
  const toneCls =
    tone === 'emerald'
      ? 'border-snake-400/30 bg-snake-500/10 text-snake-200'
      : 'border-amber-400/30 bg-amber-500/10 text-amber-200';
  return (
    <span
      className={`rounded-full border px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${toneCls}`}
    >
      {label}
    </span>
  );
}

function InfoStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-base-700/40 p-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-base-600/70 text-zinc-400">
        {icon}
      </div>
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
          {label}
        </div>
        <div className="mt-0.5 font-mono text-lg text-zinc-200 tabular-nums">
          {value}
        </div>
      </div>
    </div>
  );
}

// ─── Mode card ────────────────────────────────────────────────────────────────
const TONE_STYLES: Record<
  GameModeTone,
  { gradient: string; border: string; glow: string; accent: string; tag: string }
> = {
  red: {
    gradient:
      'from-rose-600/20 via-rose-700/10 to-transparent',
    border: 'border-rose-500/20 hover:border-rose-400/40',
    glow: 'shadow-[0_12px_40px_rgba(244,63,94,0.15)] hover:shadow-[0_18px_50px_rgba(244,63,94,0.25)]',
    accent: 'text-rose-300 bg-rose-500/15 ring-rose-400/30',
    tag: 'border-rose-400/30 bg-rose-500/10 text-rose-200',
  },
  cyan: {
    gradient:
      'from-cyan-600/20 via-cyan-700/10 to-transparent',
    border: 'border-cyan-500/20 hover:border-cyan-400/40',
    glow: 'shadow-[0_12px_40px_rgba(34,211,238,0.15)] hover:shadow-[0_18px_50px_rgba(34,211,238,0.25)]',
    accent: 'text-cyan-300 bg-cyan-500/15 ring-cyan-400/30',
    tag: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-200',
  },
  violet: {
    gradient:
      'from-violet-600/20 via-violet-700/10 to-transparent',
    border: 'border-violet-500/20 hover:border-violet-400/40',
    glow: 'shadow-[0_12px_40px_rgba(167,139,250,0.15)] hover:shadow-[0_18px_50px_rgba(167,139,250,0.25)]',
    accent: 'text-violet-300 bg-violet-500/15 ring-violet-400/30',
    tag: 'border-violet-400/30 bg-violet-500/10 text-violet-200',
  },
};

function ModeCard({
  mode,
  pot,
  onPlay,
}: {
  mode: GameMode;
  pot: PotValue;
  onPlay: () => void;
}) {
  const t = TONE_STYLES[mode.tone];
  return (
    <button
      type="button"
      onClick={onPlay}
      className={`group relative flex flex-col items-stretch overflow-hidden rounded-2xl border bg-base-700/40 p-6 text-left transition ${t.border} ${t.glow} hover:-translate-y-1`}
    >
      {/* colored wash */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${t.gradient}`}
      />

      <div className="relative flex items-start justify-between">
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-xl ring-1 ${t.accent}`}
        >
          {mode.icon}
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.18em] ${t.tag}`}
        >
          {mode.tag}
        </span>
      </div>

      <div className="relative mt-6">
        <h3 className="font-display text-3xl tracking-wide text-white">
          {mode.title}
        </h3>
        <div className="mt-1 text-xs uppercase tracking-[0.2em] text-zinc-400">
          {mode.tagline}
        </div>
      </div>

      <p className="relative mt-3 text-sm leading-relaxed text-zinc-400">
        {mode.description}
      </p>

      <div className="relative mt-6 flex items-center justify-between border-t border-white/5 pt-4">
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Users className="h-3.5 w-3.5" />
          <span>{mode.players}</span>
        </div>
        <div className="font-mono text-sm font-semibold tabular-nums text-amber-200">
          {formatCurrency(pot)}
        </div>
      </div>

      <div className="relative mt-4 flex h-11 items-center justify-center gap-2 rounded-lg bg-white/5 text-sm font-semibold tracking-wide text-zinc-100 transition group-hover:bg-snake-500 group-hover:text-base-900">
        <span>JOGAR</span>
        <span aria-hidden className="transition group-hover:translate-x-1">
          →
        </span>
      </div>
    </button>
  );
}

// ─── Placeholder for other tabs ───────────────────────────────────────────────
function ComingSoon({ tab }: { tab: TabId }) {
  const titles: Record<Exclude<TabId, 'play'>, string> = {
    shop: 'Loja',
    social: 'Social',
    inventory: 'Inventário',
  };
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-base-700/60 text-zinc-500">
        <Package className="h-7 w-7" />
      </div>
      <h2 className="mt-5 font-display text-4xl tracking-wide text-white">
        {titles[tab as Exclude<TabId, 'play'>]}
      </h2>
      <p className="mt-2 max-w-md text-sm text-zinc-500">
        Em breve. Estamos finalizando esta aba do ecossistema Prime Assets.
      </p>
    </div>
  );
}
