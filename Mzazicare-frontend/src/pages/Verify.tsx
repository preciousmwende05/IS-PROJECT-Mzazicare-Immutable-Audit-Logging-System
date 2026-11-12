import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";

import { AuthLayout } from "@/components/AuthLayout";
import { Banner, Field } from "@/components/ui";
import { errorText } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";
import { formatPhone } from "@/lib/kenya";

const CODE_TTL_SECONDS = 10 * 60; // backend OTP_TTL_MINUTES

/** Page 3 — Verify (step 2 of 2). Redeems the emailed code; the backend then signs you in. */
export default function Verify() {
  const { verifyPhone, resendCode } = useAuth();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as { phone?: string; name?: string; email?: string };

  const [phone, setPhone] = useState(state.phone ?? "");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [left, setLeft] = useState(CODE_TTL_SECONDS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * Typing fast, pasting or SMS autofill can put several digits into one box.
   * Spread them across this box and the ones after it.
   */
  const setDigit = (i: number, v: string) => {
    const typed = v.replace(/\D/g, "");
    if (!typed) {
      setDigits((prev) => prev.map((x, j) => (j === i ? "" : x)));
      return;
    }
    // When a box already held a digit, the new one is the last character.
    const incoming = typed.length > 1 && digits[i] && typed.startsWith(digits[i]!) ? typed.slice(1) : typed;
    setDigits((prev) => {
      const next = [...prev];
      incoming.split("").forEach((d, k) => {
        if (i + k < 6) next[i + k] = d;
      });
      return next;
    });
    boxes.current[Math.min(i + incoming.length, 5)]?.focus();
  };
  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
  };
  const onPaste = (e: ClipboardEvent) => {
    const code = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (code.length) {
      e.preventDefault();
      setDigits(code.padEnd(6, " ").split("").map((c) => c.trim()));
      boxes.current[Math.min(code.length, 5)]?.focus();
    }
  };

  const code = digits.join("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await verifyPhone(phone, code);
      navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(null);
    try {
      await resendCode(phone);
      setLeft(CODE_TTL_SECONDS);
      setDigits(Array(6).fill(""));
      setNotice("A new code is on its way.");
    } catch (err) {
      setError(err);
    }
  };

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  return (
    <AuthLayout
      step="Create account / Step 2 of 2"
      footer={
        <div className="auth-help">
          <Link to="/login" className="row" style={{ gap: 6 }}>
            <ArrowLeft size={14} /> Back to sign in
          </Link>
        </div>
      }
    >
      <div className="icon-tile">
        <Mail size={24} />
      </div>
      <h2>Verify your account</h2>
      <p className="sub">
        {state.name ? `Habari ${state.name.split(" ")[0]}, enter` : "Enter"} the 6-digit code we sent to{" "}
        <b>{state.email || "your email"}</b>. It can take a minute; check your spam folder too.
        {phone && <> Your account: <b>{formatPhone(phone)}</b>.</>}
      </p>

      {!state.phone && (
        <Field label="Phone number" hint="The number you registered with.">
          <div className="input">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
          </div>
        </Field>
      )}

      {!!error && <div style={{ marginBottom: 16 }}><Banner tone="error" title="Code not accepted">{errorText(error)}</Banner></div>}
      {notice && !error && <div style={{ marginBottom: 16 }}><Banner tone="success" title={notice} /></div>}

      <form onSubmit={submit}>
        <div className="field">
          <label>Verification code</label>
          <div className="otp" onPaste={onPaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => (boxes.current[i] = el)}
                value={d}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                onChange={(e) => setDigit(i, e.target.value)}
                onKeyDown={(e) => onKey(i, e)}
                autoFocus={i === 0}
              />
            ))}
          </div>
          <div className="hint">{left > 0 ? `Your code expires in ${mm}:${ss}.` : "This code has expired. Request a new one."}</div>
        </div>

        <button className="btn btn-gold" disabled={busy || code.length !== 6 || !phone}>
          <ArrowRight size={16} /> {busy ? "Verifying…" : "Verify & continue"}
        </button>
      </form>

      <p className="auth-alt">
        Didn't receive a text?
        <button className="link" style={{ marginLeft: 6 }} onClick={resend} disabled={!phone}>
          Resend code
        </button>
      </p>

      <div style={{ marginTop: 22 }}>
        <Banner tone="info" title="Keep your code private">
          MzaziCare will never call you to ask for this code. Only enter it here in your secure workspace.
        </Banner>
      </div>
    </AuthLayout>
  );
}
