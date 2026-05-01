/**
 * Snakeys API client — wraps the NestJS backend at $VITE_API_URL.
 * Endpoints used here match `backend/src/auth/auth.controller.ts`.
 */

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001/api';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    throw new ApiError(0, 'Não foi possível contactar o servidor. Verifique sua conexão.');
  }

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = data?.message;
    const message = Array.isArray(raw) ? raw.join(', ') : (raw ?? 'Falha na requisição');
    throw new ApiError(res.status, String(message));
  }
  return data as T;
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
  /** Only returned in non-production env (dev convenience). */
  emailVerificationToken?: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  /**
   * NOTE: `username` is UI-only; the backend `RegisterDto` accepts
   * { email, password, cpf }. The CPF is sent digits-only (11 chars).
   */
  register: (email: string, password: string, cpf: string) =>
    request<AuthResponse>('POST', '/auth/register', {
      email,
      password,
      cpf: cpf.replace(/\D/g, ''),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('POST', '/auth/login', { email, password }),

  logout: (token: string) =>
    request<{ message: string }>('POST', '/auth/logout', undefined, token),

  verifyEmail: (token: string) =>
    request<{ message: string }>('POST', '/auth/verify-email', { token }),
};

// ── Wallet ────────────────────────────────────────────────────────────────────
export interface WalletDto {
  balanceAvailable: string;
  balanceLocked: string;
  createdAt: string;
}

export interface BalanceDto {
  balance: number;
  locked: number;
}

export interface DepositIntent {
  transactionId: string;
  amount: number;
  status: 'PENDING';
  message: string;
  pixCode: string;
  expiresAt: string;
}

export interface WithdrawIntent {
  transactionId: string;
  amount: number;
  status: 'PENDING';
  message: string;
}

/**
 * Server response for `POST /wallet/match/entry`. The server allocates
 * the `matchId` so clients can't replay an old id to settle for free.
 *
 * The lobby must persist this `matchId` and forward it to the game page
 * so settlement at the end of the round references the same record.
 */
export interface MatchEntryDto {
  matchId: string;
  balance: number;
  locked: number;
}

export interface MatchSettleDto {
  balance: number;
  locked: number;
  payout: number;
}

export const walletApi = {
  get: (token: string) => request<WalletDto>('GET', '/wallet', undefined, token),

  balance: (token: string) =>
    request<BalanceDto>('GET', '/wallet/balance', undefined, token),

  deposit: (token: string, amount: number, idempotencyKey: string) =>
    request<DepositIntent>(
      'POST',
      '/wallet/deposit',
      { amount, idempotencyKey },
      token,
    ),

  withdraw: (
    token: string,
    amount: number,
    cpf: string,
    idempotencyKey: string,
  ) =>
    request<WithdrawIntent>(
      'POST',
      '/wallet/withdraw',
      { amount, cpf: cpf.replace(/\D/g, ''), idempotencyKey },
      token,
    ),

  /**
   * **Dev-only** — settles a PENDING deposit without a real payment
   * gateway. Returns the refreshed balance so the header can update
   * instantly. Returns 404 in production.
   */
  simulatePayment: (token: string, transactionId: string) =>
    request<BalanceDto>(
      'POST',
      '/wallet/deposit/simulate',
      { transactionId },
      token,
    ),

  /**
   * Debits the entry fee for a match and returns a server-issued
   * `matchId` that must be passed back to `matchSettle` when the round
   * ends. The amount moves from `balanceAvailable` → `balanceLocked` so
   * the user can't double-spend the same funds in another room.
   *
   * Throws 4xx if the user has insufficient balance — caller should
   * surface a "deposit needed" prompt in that case.
   */
  matchEntry: (token: string, mode: string, amount: number) =>
    request<MatchEntryDto>(
      'POST',
      '/wallet/match/entry',
      { mode, amount },
      token,
    ),

  /**
   * Settles a match by consuming the locked entry and crediting the
   * computed `payout` (which may be 0 for a full loss). Idempotent on
   * `matchId` — calling twice returns the same final balance.
   *
   * In production, settlement is the responsibility of an authoritative
   * game server; this client-driven path is acceptable only because the
   * current build runs single-player vs bots locally.
   */
  matchSettle: (token: string, matchId: string, payout: number) =>
    request<MatchSettleDto>(
      'POST',
      '/wallet/match/settle',
      { matchId, payout },
      token,
    ),
};

// ── User ──────────────────────────────────────────────────────────────────────
export const userApi = {
  me: (token: string) =>
    request<AuthUser>('GET', '/users/me', undefined, token),
};

// ── Token storage ─────────────────────────────────────────────────────────────
const TOKEN_KEY = 'snakeys_token';
const USERNAME_KEY = 'snakeys_username';

export const tokenStorage = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string): void => localStorage.setItem(TOKEN_KEY, token),
  clear: (): void => localStorage.removeItem(TOKEN_KEY),
};

export const usernameStorage = {
  get: (): string | null => localStorage.getItem(USERNAME_KEY),
  set: (username: string): void => localStorage.setItem(USERNAME_KEY, username),
  clear: (): void => localStorage.removeItem(USERNAME_KEY),
};
