import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, HandHeart, Heart, Phone } from "lucide-react";

import { AuthLayout } from "@/components/AuthLayout";
import { Banner, Field } from "@/components/ui";
import { errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type JoinAs = "family" | "caregiver";

/** Page 2 — Register (step 1 of 2). The backend then sends a 6-digit code by SMS. */
export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [role, setRole] = useState<JoinAs>("family");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await register({ name: name.trim(), phone: phone.trim(), password, role });
      navigate("/verify", { state: { phone: user.phone, name: user.name } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout step="Create account / Step 1 of 2">
      <h2>A little about you</h2>
      <p className="sub">Join the circle of people making care better.</p>

      {!!error && (
        <div style={{ marginBottom: 18 }}>
          <Banner tone="error" title="Could not create the account">{errorText(error)}</Banner>
        </div>
      )}

      <form onSubmit={submit}>
        <Field label="Full name">
          <div className="input">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wanjiru Kamau" autoComplete="name" required />
          </div>
        </Field>
        <Field label="Phone number" hint="We'll send a verification code to this number.">
          <div className="input">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" autoComplete="tel" required />
            <span className="icon"><Phone size={16} /></span>
          </div>
        </Field>
        <Field label="Password" hint="At least 8 characters. Use a mix of letters, numbers and a symbol.">
          <div className="input">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
            <button type="button" className="icon" onClick={() => setShow((s) => !s)} aria-label="Show password">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        <div className="field">
          <label>I'm joining as</label>
          <div className="choice-row">
            <button type="button" className={`choice ${role === "family" ? "on" : ""}`} onClick={() => setRole("family")}>
              <Heart size={18} color="#b8862a" />
              <b>Family</b>
              <span>Support a loved one</span>
              <i className="radio" />
            </button>
            <button type="button" className={`choice ${role === "caregiver" ? "on" : ""}`} onClick={() => setRole("caregiver")}>
              <HandHeart size={18} color="#b8862a" />
              <b>Caregiver</b>
              <span>Provide trusted care</span>
              <i className="radio" />
            </button>
          </div>
        </div>

        <label className="check" style={{ margin: "4px 0 22px" }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          I agree to the Terms of use and have read the Privacy notice (Kenya Data Protection Act, 2019).
        </label>

        <button className="btn btn-gold" disabled={busy || !agree}>
          <ArrowRight size={16} /> {busy ? "Creating account…" : "Create account & verify phone"}
        </button>
      </form>

      <div className="auth-alt">
        Already have an account?
        <Link to="/login">Sign in</Link>
      </div>
    </AuthLayout>
  );
}
