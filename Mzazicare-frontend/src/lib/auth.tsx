import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, setSessionEndedHandler, tokens, type User } from "./api";

type AuthResult = { user: User; accessToken: string; refreshToken: string };

type AuthState = {
  user: User | null;
  ready: boolean;
  login: (phone: string, password: string) => Promise<User>;
  register: (input: { name: string; phone: string; password: string; role: "family" | "caregiver" }) => Promise<User>;
  verifyPhone: (phone: string, code: string) => Promise<User>;
  resendCode: (phone: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    if (!tokens.access) {
      setUser(null);
      return;
    }
    try {
      setUser(await api.get<User>("/auth/me"));
    } catch {
      tokens.clear();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setSessionEndedHandler(() => setUser(null));
    reload().finally(() => setReady(true));
  }, [reload]);

  const start = (auth: AuthResult) => {
    tokens.set(auth.accessToken, auth.refreshToken);
    setUser(auth.user);
    return auth.user;
  };

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      reload,
      login: async (phone, password) => start(await api.post<AuthResult>("/auth/login", { phone, password }, false)),
      register: async (input) => api.post<User>("/auth/register", input, false),
      verifyPhone: async (phone, code) => start(await api.post<AuthResult>("/auth/verify-phone", { phone, code }, false)),
      resendCode: async (phone) => {
        await api.post("/auth/resend-otp", { phone, purpose: "phone_verification" }, false);
      },
      logout: async () => {
        const refreshToken = tokens.refresh;
        try {
          if (refreshToken) await api.post("/auth/logout", { refreshToken });
        } finally {
          tokens.clear();
          setUser(null);
        }
      },
    }),
    [user, ready, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
};

/** Where each role lands after signing in. */
export const homeFor = (role: string): string =>
  ({ admin: "/users", coordinator: "/visits", auditor: "/audit" })[role] ?? "/elders";
