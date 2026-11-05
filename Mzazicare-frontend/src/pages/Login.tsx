import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Lock, Phone } from "lucide-react";

import { AuthLayout } from "@/components/AuthLayout";
import { Banner, Field } from "@/components/ui";
import { ApiError, errorText } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";

/** Page 1 — Login. Shows the "Account locked" state after 5 failed attempts (backend returns 423). */
export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const justVerified = (location.state as { notice?: string } | null)?.notice;

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const locked = error instanceof ApiError && error.code === "ACCOUNT_LOCKED";
  const unverified = error instanceof ApiError && /not active|verify/i.test(error.message);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(phone.trim(), password);
      navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout step="Welcome to MzaziCare">
      <h2>Welcome back</h2>
      <p className="sub">Sign in to your care workspace.</p>

      {justVerified && <div style={{ marginBottom: 18 }}><Banner tone="success" title={justVerified} /></div>}

      {locked && (
        <div style={{ marginBottom: 18 }}>
          <Banner tone="error" title="Account locked">
            There have been 5 unsuccessful sign-in attempts. Try again in 15 minutes.
          </Banner>
        </div>
      )}
      {!!error && !locked && (
        <div style={{ marginBottom: 18 }}>
          <Banner tone="error" title={unverified ? "Phone not verified yet" : "Sign-in failed"}>
            {unverified ? (
              <>
                Finish verifying your phone first.{" "}
                <Link className="link" to="/verify" state={{ phone }}>
                  Enter your code →
                </Link>
              </>
            ) : (
              errorText(error)
            )}
          </Banner>
        </div>
      )}

      <form onSubmit={submit}>
        <Field label="Phone number" hint="Kenyan mobile, e.g. 0712 345 678 or +254 712 345 678">
          <div className="input">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="tel" required />
            <span className="icon"><Phone size={16} /></span>
          </div>
        </Field>
        <Field label="Password" error={locked ? "Sign-in is temporarily disabled to protect your account." : undefined}>
          <div className={`input ${locked ? "invalid" : ""}`}>
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
            <button type="button" className="icon" onClick={() => setShow((s) => !s)} aria-label="Show password">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        <button className="btn btn-gold" disabled={busy || locked}>
          {locked ? <Lock size={16} /> : <ArrowRight size={16} />}
          {locked ? "Sign in · temporarily locked" : busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="auth-alt">
        New to MzaziCare?
        <Link to="/register">Create an account →</Link>
      </div>
    </AuthLayout>
  );
}
