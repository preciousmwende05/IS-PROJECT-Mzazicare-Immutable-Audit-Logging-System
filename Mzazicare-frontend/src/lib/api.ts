/**
 * The one place the frontend talks to the MzaziCare API.
 *
 * - Every response is the backend envelope: { success, data, meta? } or
 *   { success: false, error: { code, message, details } }.
 * - The access token lives 15 minutes. On a 401 we try the refresh token once,
 *   then retry the request. If that fails too, the session is over.
 */

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000/v1";

const ACCESS = "mzazicare.access";
const REFRESH = "mzazicare.refresh";

export type Role = "family" | "elder" | "caregiver" | "coordinator" | "admin" | "auditor";

export type User = {
  id: string;
  phone: string;
  email: string | null;
  name: string;
  role: Role;
  status: string;
  phoneVerifiedAt: string | null;
  lastLoginAt?: string | null;
  createdAt?: string;
};

export type Page<T> = { items: T[]; page: number; limit: number; total: number; totalPages: number };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Field-level validation messages, flattened for display. */
  get fieldMessages(): string[] {
    const d = this.details as { body?: string[]; query?: string[]; params?: string[] } | undefined;
    if (!d || typeof d !== "object") return [];
    return [...(d.body ?? []), ...(d.query ?? []), ...(d.params ?? [])];
  }
}

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS);
  },
  get refresh() {
    return localStorage.getItem(REFRESH);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS, access);
    localStorage.setItem(REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  },
};

let onSessionEnded: () => void = () => {};
export const setSessionEndedHandler = (fn: () => void) => {
  onSessionEnded = fn;
};

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const refreshToken = tokens.refresh;
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const body = await res.json();
      const data = body?.data ?? body;
      if (!data?.accessToken) return false;
      tokens.set(data.accessToken, data.refreshToken ?? refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

type Options = { body?: unknown; query?: Record<string, string | number | undefined | null>; auth?: boolean };

async function raw(method: string, path: string, opts: Options = {}, retried = false): Promise<{ data: unknown; meta?: unknown }> {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.auth !== false && tokens.access) headers.authorization = `Bearer ${tokens.access}`;

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, "NETWORK", "Cannot reach the MzaziCare API. Is the backend running on port 4000?");
  }

  if (res.status === 401 && opts.auth !== false && !retried && tokens.refresh) {
    if (await refreshTokens()) return raw(method, path, opts, true);
    tokens.clear();
    onSessionEnded();
  }

  if (res.status === 204) return { data: null };
  let body: { data?: unknown; meta?: unknown; error?: { code: string; message: string; details?: unknown } } | null = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  // `data: null` is a real answer (e.g. "no care plan yet"), not a missing field.
  return { data: body && "data" in body ? body.data : body, meta: body?.meta };
}

export const api = {
  get: async <T>(path: string, query?: Options["query"]) => (await raw("GET", path, { query })).data as T,
  page: async <T>(path: string, query?: Options["query"]) => {
    const { data, meta } = await raw("GET", path, { query });
    return { items: (data as T[]) ?? [], ...(meta as Omit<Page<T>, "items">) } as Page<T>;
  },
  post: async <T>(path: string, body?: unknown, auth = true) => (await raw("POST", path, { body: body ?? {}, auth })).data as T,
  patch: async <T>(path: string, body: unknown) => (await raw("PATCH", path, { body })).data as T,
  put: async <T>(path: string, body: unknown) => (await raw("PUT", path, { body })).data as T,
  del: async <T>(path: string) => (await raw("DELETE", path)).data as T,
};

/** A readable sentence for any error thrown by `api`. */
export const errorText = (err: unknown): string => {
  if (err instanceof ApiError) {
    const fields = err.fieldMessages;
    return fields.length ? `${err.message}: ${fields.join("; ")}` : err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
};
