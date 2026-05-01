import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  IdCard,
  Loader2,
  Wallet,
  X,
} from 'lucide-react';
import {
  ApiError,
  tokenStorage,
  walletApi,
  type DepositIntent,
  type WithdrawIntent,
} from '../lib/api';
import { formatCPF, isValidCPF, stripCPF } from '../lib/cpf';

type Tab = 'deposit' | 'withdraw';

interface WalletModalProps {
  open: boolean;
  onClose: () => void;
  /** Current available balance in BRL (for display + client-side withdraw guard). */
  balance: number;
  /** Called after a successful deposit/withdraw so the parent can refresh state. */
  onBalanceChanged?: () => void;
  initialTab?: Tab;
}

const QUICK_DEPOSITS = [20, 50, 100, 200] as const;

// ─── Amount input helpers ─────────────────────────────────────────────────────
/**
 * Parses raw digits as "centavos" and formats as `R$ 0,00`. Typing `1234`
 * becomes `R$ 12,34`, `12345` becomes `R$ 123,45`. Cap at 10 digits
 * (R$ 99.999.999,99) which is well above any realistic bet.
 */
function parseCurrencyInput(raw: string): { masked: string; value: number } {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  const centavos = parseInt(digits || '0', 10);
  const value = centavos / 100;
  const masked = value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
  return { masked, value };
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback for very old browsers.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Root modal ───────────────────────────────────────────────────────────────
export default function WalletModal({
  open,
  onClose,
  balance,
  onBalanceChanged,
  initialTab = 'deposit',
}: WalletModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab);

  // Reset to the initial tab whenever the modal is reopened.
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  // Close on Escape + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-base-800 shadow-[0_30px_80px_rgba(0,0,0,0.65)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/5 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-amber-400/30 bg-amber-500/10">
              <Wallet className="h-4 w-4 text-amber-300" />
            </div>
            <div>
              <h2
                id="wallet-modal-title"
                className="font-display text-xl tracking-wide text-white"
              >
                Carteira
              </h2>
              <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">
                SALDO ·{' '}
                <span className="text-amber-300">{formatCurrency(balance)}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-white/5 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex gap-2 px-6 py-4">
          <TabButton
            active={tab === 'deposit'}
            onClick={() => setTab('deposit')}
            icon={<ArrowDownToLine className="h-4 w-4" />}
            label="Depositar"
          />
          <TabButton
            active={tab === 'withdraw'}
            onClick={() => setTab('withdraw')}
            icon={<ArrowUpToLine className="h-4 w-4" />}
            label="Sacar"
          />
        </div>

        {/* Body */}
        <div className="px-6 pb-6">
          {tab === 'deposit' ? (
            <DepositTab onSuccess={onBalanceChanged} />
          ) : (
            <WithdrawTab
              balance={balance}
              onSuccess={onBalanceChanged}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold tracking-wide transition ${
        active
          ? 'bg-snake-500 text-base-900 shadow-[0_4px_14px_rgba(34,197,94,0.35)]'
          : 'bg-base-700/60 text-zinc-400 hover:bg-base-700/90 hover:text-zinc-200'
      }`}
    >
      {icon}
      <span className="uppercase">{label}</span>
    </button>
  );
}

// ─── Deposit tab ──────────────────────────────────────────────────────────────
function DepositTab({ onSuccess }: { onSuccess?: () => void }) {
  const [input, setInput] = useState('R$ 0,00');
  const [amount, setAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<DepositIntent | null>(null);
  const [copied, setCopied] = useState(false);

  const canSubmit = amount >= 1 && !loading;

  function setAmountFromDigits(raw: string) {
    const { masked, value } = parseCurrencyInput(raw);
    setInput(masked);
    setAmount(value);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const token = tokenStorage.get();
    if (!token) {
      setError('Sessão expirada. Faça login novamente.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await walletApi.deposit(token, amount, newIdempotencyKey());
      setIntent(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!intent) return;
    try {
      await navigator.clipboard.writeText(intent.pixCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Não foi possível copiar. Selecione e copie manualmente.');
    }
  }

  function reset() {
    setIntent(null);
    setInput('R$ 0,00');
    setAmount(0);
    setError(null);
    onSuccess?.();
  }

  // ── Success view ──
  if (intent) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-snake-400/30 bg-snake-500/10 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-snake-300" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-snake-100">
              Pix gerado com sucesso
            </div>
            <div className="mt-1 text-xs text-snake-200/80">
              Pague{' '}
              <span className="font-mono font-semibold text-amber-200">
                {formatCurrency(intent.amount)}
              </span>{' '}
              no seu banco. O saldo será creditado após a confirmação.
            </div>
          </div>
        </div>

        <FieldLabel>Código Pix (Copia e Cola)</FieldLabel>
        <div className="group relative">
          <textarea
            readOnly
            value={intent.pixCode}
            rows={4}
            className="w-full resize-none rounded-lg border border-white/10 bg-base-700/60 px-3 py-3 font-mono text-xs leading-relaxed text-zinc-200 focus:border-snake-400/60 focus:outline-none"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={handleCopy}
            className={`absolute right-2 top-2 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
              copied
                ? 'bg-snake-500/90 text-base-900'
                : 'bg-base-900/70 text-zinc-300 hover:bg-base-900'
            }`}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>
            Expira em{' '}
            <span className="font-mono">
              {new Date(intent.expiresAt).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>{' '}
            · Sandbox (não settla de verdade até o gateway real ser ligado).
          </span>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={reset}
            className="flex-1 rounded-lg border border-white/10 bg-base-700/60 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-base-700"
          >
            Novo depósito
          </button>
        </div>
      </div>
    );
  }

  // ── Form view ──
  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <FieldLabel>Valor</FieldLabel>
        <input
          type="text"
          inputMode="numeric"
          value={input}
          onChange={(e) => setAmountFromDigits(e.target.value)}
          placeholder="R$ 0,00"
          className="w-full rounded-lg border border-white/10 bg-base-700/60 px-4 py-3 font-mono text-2xl font-bold tabular-nums text-amber-200 placeholder-zinc-600 focus:border-amber-400/60 focus:outline-none"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {QUICK_DEPOSITS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setAmountFromDigits(String(v * 100))}
            className="rounded-full border border-white/5 bg-base-700/40 px-3 py-1 text-xs font-semibold tracking-wide text-zinc-300 transition hover:border-amber-400/30 hover:bg-amber-500/10 hover:text-amber-200"
          >
            +{formatCurrency(v)}
          </button>
        ))}
      </div>

      {error && <ErrorBanner message={error} />}

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-snake-500 to-snake-400 font-bold tracking-wide text-base-900 transition hover:from-snake-400 hover:to-snake-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>GERANDO PIX...</span>
          </>
        ) : (
          <>
            <ArrowDownToLine className="h-4 w-4" />
            <span>GERAR CÓDIGO PIX</span>
          </>
        )}
      </button>

      <p className="text-center text-[11px] text-zinc-500">
        Processamento instantâneo via Pix (sandbox). O saldo é creditado assim
        que o banco confirma o pagamento.
      </p>
    </form>
  );
}

// ─── Withdraw tab ─────────────────────────────────────────────────────────────
function WithdrawTab({
  balance,
  onSuccess,
}: {
  balance: number;
  onSuccess?: () => void;
}) {
  const [input, setInput] = useState('R$ 0,00');
  const [amount, setAmount] = useState(0);
  const [cpf, setCpf] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<WithdrawIntent | null>(null);

  const amountError = useMemo(() => {
    if (amount === 0) return null;
    if (amount < 1) return 'Valor mínimo é R$ 1,00';
    if (amount > balance) return 'Saldo insuficiente';
    return null;
  }, [amount, balance]);

  const cpfErr = useMemo(() => {
    if (cpf === '') return null;
    if (stripCPF(cpf).length < 11) return 'CPF incompleto';
    return isValidCPF(cpf) ? null : 'CPF inválido';
  }, [cpf]);

  const canSubmit =
    amount >= 1 && !amountError && cpf.length > 0 && !cpfErr && !loading;

  function setAmountFromDigits(raw: string) {
    const { masked, value } = parseCurrencyInput(raw);
    setInput(masked);
    setAmount(value);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const token = tokenStorage.get();
    if (!token) {
      setError('Sessão expirada. Faça login novamente.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await walletApi.withdraw(
        token,
        amount,
        cpf,
        newIdempotencyKey(),
      );
      setIntent(res);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro inesperado.');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setIntent(null);
    setInput('R$ 0,00');
    setAmount(0);
    setCpf('');
    setError(null);
  }

  // ── Success view ──
  if (intent) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-snake-400/30 bg-snake-500/10 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-snake-300" />
          <div className="flex-1 text-sm">
            <div className="font-semibold text-snake-100">
              Saque solicitado
            </div>
            <div className="mt-1 text-xs text-snake-200/80">
              {formatCurrency(intent.amount)} foram reservados do seu saldo e
              serão enviados ao Pix cadastrado em até 1 dia útil.
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-base-700/40 p-4 text-xs">
          <div className="text-zinc-500">ID da solicitação</div>
          <div className="mt-1 break-all font-mono text-zinc-200">
            {intent.transactionId}
          </div>
        </div>

        <button
          type="button"
          onClick={reset}
          className="w-full rounded-lg border border-white/10 bg-base-700/60 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-base-700"
        >
          Nova solicitação
        </button>
      </div>
    );
  }

  // ── Form view ──
  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <FieldLabel>Valor do saque</FieldLabel>
          <button
            type="button"
            onClick={() => setAmountFromDigits(String(Math.floor(balance * 100)))}
            className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 transition hover:text-amber-300"
          >
            Usar tudo · {formatCurrency(balance)}
          </button>
        </div>
        <input
          type="text"
          inputMode="numeric"
          value={input}
          onChange={(e) => setAmountFromDigits(e.target.value)}
          placeholder="R$ 0,00"
          className={`w-full rounded-lg border bg-base-700/60 px-4 py-3 font-mono text-2xl font-bold tabular-nums placeholder-zinc-600 focus:outline-none ${
            amountError
              ? 'border-red-500/40 text-red-200 focus:border-red-400/60'
              : 'border-white/10 text-amber-200 focus:border-amber-400/60'
          }`}
        />
        {amountError && (
          <div className="mt-1 text-[11px] text-red-400">{amountError}</div>
        )}
      </div>

      <div>
        <FieldLabel>CPF da conta</FieldLabel>
        <div
          className={`flex items-center rounded-lg border bg-base-700/60 ${
            cpfErr
              ? 'border-red-500/40 focus-within:border-red-400/60'
              : 'border-white/10 focus-within:border-snake-400/60'
          }`}
        >
          <span className="pl-3 text-zinc-500">
            <IdCard className="h-4 w-4" />
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={cpf}
            onChange={(e) => setCpf(formatCPF(e.target.value))}
            maxLength={14}
            placeholder="000.000.000-00"
            className="w-full bg-transparent px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
        </div>
        {cpfErr && (
          <div className="mt-1 text-[11px] text-red-400">{cpfErr}</div>
        )}
        <div className="mt-1.5 text-[11px] text-zinc-500">
          Precisa ser o mesmo CPF usado no cadastro (verificação de identidade).
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <button
        type="submit"
        disabled={!canSubmit}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-400 font-bold tracking-wide text-base-900 transition hover:from-amber-400 hover:to-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>SOLICITANDO...</span>
          </>
        ) : (
          <>
            <ArrowUpToLine className="h-4 w-4" />
            <span>SOLICITAR SAQUE</span>
          </>
        )}
      </button>

      <p className="text-center text-[11px] text-zinc-500">
        O valor fica reservado até a confirmação pelo time de pagamentos
        (até 1 dia útil).
      </p>
    </form>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────────
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
      {children}
    </label>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
    </div>
  );
}
