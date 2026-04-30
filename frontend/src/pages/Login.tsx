import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Play,
  ShieldAlert,
  User,
} from 'lucide-react';
import { ApiError, authApi, tokenStorage, usernameStorage } from '../lib/api';

type Mode = 'login' | 'register';

interface LoginProps {
  initialMode?: Mode;
}

// Backend `IsStrongPassword`: minLength 8, 1 lowercase, 1 uppercase, 1 number.
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$/;
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login({ initialMode = 'register' }: LoginProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isRegister = mode === 'register';

  const usernameError = useMemo(() => {
    if (!isRegister || username === '') return null;
    if (username.length < 3) return 'Mínimo de 3 caracteres';
    if (username.length > 20) return 'Máximo de 20 caracteres';
    if (!USERNAME_RE.test(username)) return 'Use letras, números, _ ou -';
    return null;
  }, [username, isRegister]);

  const emailError = useMemo(() => {
    if (email === '') return null;
    return EMAIL_RE.test(email) ? null : 'E-mail inválido';
  }, [email]);

  const passwordError = useMemo(() => {
    if (password === '') return null;
    if (!isRegister) return password.length < 6 ? 'Mínimo de 6 caracteres' : null;
    return STRONG_PASSWORD.test(password)
      ? null
      : 'Mín. 8 caracteres com maiúscula, minúscula e número';
  }, [password, isRegister]);

  const canSubmit =
    !loading &&
    email.length > 0 &&
    password.length > 0 &&
    !emailError &&
    !passwordError &&
    (!isRegister || (username.length > 0 && !usernameError));

  function switchMode() {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setInfo(null);
    setLoading(true);

    try {
      const res = isRegister
        ? await authApi.register(email, password)
        : await authApi.login(email, password);

      tokenStorage.set(res.token);
      if (isRegister && username) usernameStorage.set(username);

      setInfo(
        isRegister
          ? `Conta criada! Bem-vindo, ${username || res.user.email}.`
          : `Login efetuado, ${res.user.email}.`,
      );
      // TODO: redirect to /play once that route exists.
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Erro inesperado.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-base text-zinc-100">
      {/* ── Top status bar ───────────────────────────────────────────────────── */}
      <header className="absolute inset-x-0 top-0 z-40 flex h-12 items-center justify-between border-b border-white/5 bg-base-900/60 px-6 backdrop-blur-sm lg:px-10">
        <div className="font-mono text-[11px] tracking-[0.3em] text-zinc-500">
          01 / <span className="text-snake-400">LOGIN</span>
          <span className="text-zinc-700"> · </span>
          CRIAR CONTA
        </div>
        <div className="hidden font-mono text-[10px] tracking-[0.3em] text-zinc-600 sm:block">
          PRIME ASSETS · ECOSYSTEM
        </div>
      </header>

      {/* ── Desktop: 3-column with diagonal slice ────────────────────────────── */}
      <div className="relative hidden h-screen w-full pt-12 lg:block">
        {/* LEFT — gameplay clips, clipped diagonally on the right edge */}
        <section
          className="absolute inset-0 clip-diagonal-r"
          aria-label="Clipes do jogo"
        >
          <GameplayClipsBackground />
        </section>

        {/* Diagonal accent strip (gradient line along the cut) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 clip-diagonal-strip"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 via-purple-500 to-snake-400 opacity-90" />
          <div className="absolute inset-0 animate-pulse-glow bg-gradient-to-br from-indigo-300/40 via-purple-300/30 to-snake-300/40 mix-blend-screen" />
        </div>

        {/* CENTER — Branding (sits in the triangular gap) */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-12 left-[38%] right-[32%] flex items-center justify-center"
        >
          <BrandingTitle />
        </div>

        {/* RIGHT — Form panel */}
        <aside className="absolute inset-y-12 right-0 z-30 flex w-[32%] min-w-[420px] max-w-[560px]">
          <AuthFormPanel
            mode={mode}
            switchMode={switchMode}
            username={username}
            email={email}
            password={password}
            setUsername={setUsername}
            setEmail={setEmail}
            setPassword={setPassword}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            usernameError={usernameError}
            emailError={emailError}
            passwordError={passwordError}
            loading={loading}
            canSubmit={canSubmit}
            error={error}
            info={info}
            onSubmit={handleSubmit}
          />
        </aside>
      </div>

      {/* ── Mobile / tablet: stacked layout ──────────────────────────────────── */}
      <div className="relative flex min-h-screen flex-col pt-12 lg:hidden">
        <div className="relative h-44 w-full overflow-hidden border-b border-white/5">
          <GameplayClipsBackground compact />
        </div>
        <div className="flex flex-col items-center justify-center px-6 py-8 text-center">
          <BrandingTitle compact />
        </div>
        <div className="flex w-full flex-1">
          <AuthFormPanel
            mode={mode}
            switchMode={switchMode}
            username={username}
            email={email}
            password={password}
            setUsername={setUsername}
            setEmail={setEmail}
            setPassword={setPassword}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            usernameError={usernameError}
            emailError={emailError}
            passwordError={passwordError}
            loading={loading}
            canSubmit={canSubmit}
            error={error}
            info={info}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Branding ─────────────────────────────────────────────────────────────────
function BrandingTitle({ compact = false }: { compact?: boolean }) {
  return (
    <div className="select-none text-center">
      <div
        className={`font-mono tracking-[0.4em] text-snake-400/80 ${
          compact ? 'text-[10px] mb-2' : 'text-xs mb-4'
        }`}
      >
        BATTLE · ROYALE · SNAKES
      </div>
      <h1
        className={`font-display tracking-[0.02em] leading-none text-snake-400 text-glow-snake animate-pulse-glow ${
          compact
            ? 'text-6xl'
            : 'text-[clamp(72px,8vw,150px)]'
        }`}
      >
        SNAKEYS
      </h1>
      <p
        className={`uppercase text-zinc-400 ${
          compact
            ? 'mt-2 text-[10px] tracking-[0.4em]'
            : 'mt-4 text-sm tracking-[0.5em]'
        }`}
      >
        by{' '}
        <span className="font-semibold text-snake-300">Prime Assets</span>
      </p>
      <div
        className={`inline-flex items-center gap-2 rounded-full border border-snake-400/20 bg-snake-500/5 ${
          compact ? 'mt-3 px-2.5 py-0.5' : 'mt-6 px-3 py-1'
        }`}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-snake-400" />
        <span
          className={`font-mono text-snake-300 ${
            compact ? 'text-[9px] tracking-[0.25em]' : 'text-[10px] tracking-[0.3em]'
          }`}
        >
          SERVERS · ONLINE
        </span>
      </div>
    </div>
  );
}

// ─── Gameplay clips left column ───────────────────────────────────────────────
function GameplayClipsBackground({ compact = false }: { compact?: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-base-900 via-base-800 to-base-700" />
      {/* Drifting grid */}
      <div className="absolute inset-0 animate-grid-drift bg-grid opacity-60" />
      {/* Soft color blobs */}
      <div className="absolute -top-32 -left-20 h-[420px] w-[420px] rounded-full bg-snake-500/15 blur-3xl" />
      <div className="absolute bottom-10 left-1/3 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="absolute top-1/2 left-1/4 h-72 w-72 rounded-full bg-indigo-500/10 blur-3xl" />
      {/* Noise overlay */}
      <div className="absolute inset-0 bg-noise opacity-40 mix-blend-overlay" />

      {/* Faux clip thumbnails */}
      {!compact && (
        <div className="relative flex h-full w-full items-center px-12">
          <div className="ml-2 grid w-[55%] grid-cols-2 gap-5">
            <FakeClipCard tone="emerald" label="KILL · 1.2K" duration="00:42" />
            <FakeClipCard tone="purple" label="CHOMP · 480" duration="00:18" />
            <FakeClipCard tone="indigo" label="EVADE · 2.4K" duration="01:05" />
            <FakeClipCard tone="amber" label="COMBO · 700" duration="00:33" />
          </div>
        </div>
      )}

      {compact && (
        <div className="relative flex h-full w-full items-center justify-center gap-3 px-6">
          <FakeClipCard tone="emerald" label="KILL · 1.2K" duration="00:42" />
          <FakeClipCard tone="purple" label="CHOMP · 480" duration="00:18" />
          <FakeClipCard tone="indigo" label="EVADE · 2.4K" duration="01:05" />
        </div>
      )}

      {/* Scan line */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute h-px w-full animate-scan-line bg-gradient-to-r from-transparent via-snake-400/50 to-transparent" />
      </div>

      {/* Top-left LIVE badge */}
      <div className="absolute left-6 top-6 flex items-center gap-2 font-mono text-xs tracking-[0.25em] text-snake-300">
        <span className="h-2 w-2 animate-pulse rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
        <span>LIVE · CLIPES DO JOGO</span>
      </div>

      {/* Bottom-left build tag */}
      <div className="absolute bottom-6 left-6 font-mono text-[10px] tracking-[0.2em] text-zinc-500">
        BUILD 0.1.0 · BR-SP-01
      </div>
    </div>
  );
}

type Tone = 'emerald' | 'purple' | 'indigo' | 'amber';
const TONE_GRADIENT: Record<Tone, string> = {
  emerald: 'from-emerald-600/40 via-emerald-700/20 to-base-700',
  purple: 'from-purple-600/40 via-purple-700/20 to-base-700',
  indigo: 'from-indigo-600/40 via-indigo-700/20 to-base-700',
  amber: 'from-amber-600/40 via-amber-700/20 to-base-700',
};

function FakeClipCard({
  tone,
  label,
  duration,
}: {
  tone: Tone;
  label: string;
  duration: string;
}) {
  return (
    <div className="group relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-base-700/60 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-sm">
      <div className={`absolute inset-0 bg-gradient-to-br ${TONE_GRADIENT[tone]}`} />
      <div className="absolute inset-0 bg-grid opacity-30" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-snake-400/30 bg-black/40 backdrop-blur-sm transition group-hover:scale-110 group-hover:border-snake-300 group-hover:bg-snake-500/30">
          <Play className="h-5 w-5 fill-snake-300 text-snake-300" />
        </div>
      </div>
      {/* Shimmer */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -inset-x-1 top-0 h-full w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2.5">
        <span className="font-mono text-[10px] tracking-wider text-snake-300">
          {label}
        </span>
        <span className="font-mono text-[10px] text-zinc-300">{duration}</span>
      </div>
    </div>
  );
}

// ─── Auth form panel ──────────────────────────────────────────────────────────
interface AuthFormPanelProps {
  mode: Mode;
  switchMode: () => void;
  username: string;
  email: string;
  password: string;
  setUsername: (v: string) => void;
  setEmail: (v: string) => void;
  setPassword: (v: string) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  usernameError: string | null;
  emailError: string | null;
  passwordError: string | null;
  loading: boolean;
  canSubmit: boolean;
  error: string | null;
  info: string | null;
  onSubmit: (e: FormEvent) => void;
}

function AuthFormPanel(props: AuthFormPanelProps) {
  const {
    mode,
    switchMode,
    username,
    email,
    password,
    setUsername,
    setEmail,
    setPassword,
    showPassword,
    setShowPassword,
    usernameError,
    emailError,
    passwordError,
    loading,
    canSubmit,
    error,
    info,
    onSubmit,
  } = props;

  const isRegister = mode === 'register';

  return (
    <div className="relative flex w-full flex-col border-l border-white/10 bg-base-800/95 shadow-[-30px_0_80px_rgba(0,0,0,0.55)] backdrop-blur-xl">
      {/* Top accent line */}
      <div className="h-0.5 w-full bg-gradient-to-r from-transparent via-snake-400/70 to-transparent" />

      <div className="flex-1 overflow-y-auto px-8 pt-10 pb-6 lg:px-10">
        <h2 className="font-display text-5xl leading-none tracking-wide text-white">
          Bem-Vindo
          <span className="text-snake-400">!</span>
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          {isRegister
            ? 'Crie sua conta para entrar na arena.'
            : 'Entre na sua conta para jogar.'}
        </p>

        {/* Mode toggle */}
        <div className="mt-6 inline-flex rounded-lg border border-white/5 bg-base-600/60 p-1">
          <ModeButton
            active={isRegister}
            onClick={() => isRegister || switchMode()}
          >
            CRIAR CONTA
          </ModeButton>
          <ModeButton
            active={!isRegister}
            onClick={() => !isRegister || switchMode()}
          >
            LOGIN
          </ModeButton>
        </div>

        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          {isRegister && (
            <Field
              icon={<User className="h-4 w-4" />}
              label="Usuário"
              value={username}
              onChange={setUsername}
              placeholder="seu_nick"
              autoComplete="username"
              error={usernameError}
            />
          )}
          <Field
            icon={<Mail className="h-4 w-4" />}
            label="E-mail"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="voce@email.com"
            autoComplete="email"
            error={emailError}
          />
          <PasswordField
            icon={<Lock className="h-4 w-4" />}
            label="Senha"
            value={password}
            onChange={setPassword}
            show={showPassword}
            setShow={setShowPassword}
            error={passwordError}
            hint={
              isRegister
                ? 'Mín. 8 char · maiúscula, minúscula e número'
                : undefined
            }
            autoComplete={isRegister ? 'new-password' : 'current-password'}
          />

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </div>
          )}
          {info && (
            <div
              role="status"
              className="rounded-lg border border-snake-400/30 bg-snake-500/10 px-3 py-2 text-sm text-snake-300"
            >
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="group relative mt-2 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-lg bg-gradient-to-r from-snake-500 to-snake-400 font-bold tracking-wide text-base-900 shadow-[0_8px_24px_rgba(34,197,94,0.35)] transition hover:from-snake-400 hover:to-snake-300 hover:shadow-[0_12px_30px_rgba(74,222,128,0.45)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>PROCESSANDO...</span>
              </>
            ) : (
              <>
                <span>{isRegister ? 'CRIAR CONTA' : 'ENTRAR'}</span>
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </>
            )}
            {/* Shine */}
            <span className="pointer-events-none absolute inset-0 overflow-hidden">
              <span className="absolute -inset-y-2 -left-1/2 w-1/2 -skew-x-12 bg-white/30 opacity-0 transition group-hover:left-full group-hover:opacity-100 group-hover:duration-700" />
            </span>
          </button>
        </form>

        {/* Switch link */}
        <div className="mt-6 text-center text-sm text-zinc-400">
          {isRegister ? (
            <>
              Já tenho conta —{' '}
              <button
                type="button"
                onClick={switchMode}
                className="font-medium text-snake-300 underline underline-offset-4 transition hover:text-snake-200"
              >
                login
              </button>
            </>
          ) : (
            <>
              Não tem conta? —{' '}
              <button
                type="button"
                onClick={switchMode}
                className="font-medium text-snake-300 underline underline-offset-4 transition hover:text-snake-200"
              >
                criar conta
              </button>
            </>
          )}
        </div>
      </div>

      <AdultBadge />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 text-[11px] font-semibold tracking-[0.15em] transition ${
        active
          ? 'bg-snake-500 text-base-900 shadow-[0_4px_12px_rgba(34,197,94,0.4)]'
          : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}

// ─── Form fields ──────────────────────────────────────────────────────────────
interface FieldProps {
  icon: ReactNode;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  error?: string | null;
}

function Field({
  icon,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoComplete,
  error,
}: FieldProps) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500"
      >
        {label}
      </label>
      <div
        className={`group relative flex items-center rounded-lg border bg-base-700/60 transition focus-within:bg-base-700/80 ${
          error
            ? 'border-red-500/40 focus-within:border-red-400/60'
            : 'border-white/5 focus-within:border-snake-400/60'
        }`}
      >
        <span className="pl-3 text-zinc-500 transition group-focus-within:text-snake-400">
          {icon}
        </span>
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full bg-transparent px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
      </div>
      {error && (
        <div className="mt-1 text-[11px] text-red-400">{error}</div>
      )}
    </div>
  );
}

interface PasswordFieldProps {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  setShow: (v: boolean) => void;
  error?: string | null;
  hint?: string;
  autoComplete?: string;
}

function PasswordField({
  icon,
  label,
  value,
  onChange,
  show,
  setShow,
  error,
  hint,
  autoComplete,
}: PasswordFieldProps) {
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label
          htmlFor={id}
          className="block text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500"
        >
          {label}
        </label>
        {hint && (
          <span className="text-[10px] text-zinc-600">{hint}</span>
        )}
      </div>
      <div
        className={`group relative flex items-center rounded-lg border bg-base-700/60 transition focus-within:bg-base-700/80 ${
          error
            ? 'border-red-500/40 focus-within:border-red-400/60'
            : 'border-white/5 focus-within:border-snake-400/60'
        }`}
      >
        <span className="pl-3 text-zinc-500 transition group-focus-within:text-snake-400">
          {icon}
        </span>
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          autoComplete={autoComplete}
          className="w-full bg-transparent px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
          className="pr-3 text-zinc-500 transition hover:text-zinc-200"
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && (
        <div className="mt-1 text-[11px] text-red-400">{error}</div>
      )}
    </div>
  );
}

// ─── +18 badge ────────────────────────────────────────────────────────────────
function AdultBadge() {
  return (
    <div className="flex items-center gap-3 border-t border-white/5 bg-base-900/70 px-8 py-4 lg:px-10">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-red-500 bg-red-500/10 shadow-[0_0_18px_rgba(239,68,68,0.25)]">
        <span className="font-mono text-[12px] font-bold tracking-tight text-red-400">
          +18
        </span>
      </div>
      <div className="leading-tight">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-red-400">
          <ShieldAlert className="h-3 w-3" />
          Conteúdo adulto
        </div>
        <div className="mt-0.5 text-[11px] text-zinc-500">
          Proibido para menores. Jogo com apostas em dinheiro real.
        </div>
      </div>
    </div>
  );
}
