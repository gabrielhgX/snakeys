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
   * NOTE: backend `RegisterDto` only accepts { email, password } today.
   * The `username` field collected by the UI is held client-side until the
   * backend DTO is extended (see `backend/src/auth/dto/register.dto.ts`).
   */
  register: (email: string, password: string) =>
    request<AuthResponse>('POST', '/auth/register', { email, password }),

  login: (email: string, password: string) =>
    request<AuthResponse>('POST', '/auth/login', { email, password }),

  logout: (token: string) =>
    request<{ message: string }>('POST', '/auth/logout', undefined, token),

  verifyEmail: (token: string) =>
    request<{ message: string }>('POST', '/auth/verify-email', { token }),
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
