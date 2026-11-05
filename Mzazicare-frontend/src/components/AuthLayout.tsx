import type { ReactNode } from "react";
import { HeartHandshake, Lock, ShieldCheck, UsersRound, Activity } from "lucide-react";

import { EMERGENCY_NUMBERS, SUPPORT_LINE } from "@/lib/kenya";

export function BrandMark() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <HeartHandshake size={22} />
      </div>
      <div>
        <b>MzaziCare</b>
        <small>Care, connected.</small>
      </div>
    </div>
  );
}

/** Left: brand story (no photo). Right: the form. */
export function AuthLayout({ step, children, footer }: { step: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <BrandMark />
        <div className="eyebrow">Care with confidence</div>
        <h1>
          Closer to care.
          <br />
          Clearer on trust.
        </h1>
        <p className="lead">
          One secure place for Kenyan families and care teams to coordinate everyday support for the wazee we love.
        </p>
        <div className="auth-points">
          <div className="auth-point">
            <ShieldCheck className="ico" size={20} />
            <div>
              <b>Dignity at every step.</b>
              <span>Permission-based records. Transparent access. Care that keeps people at its heart.</span>
            </div>
          </div>
          <div className="auth-point">
            <UsersRound className="ico" size={20} />
            <div>
              <b>Your care circle, together.</b>
              <span>Family, caregivers and coordinators see the same plan, from Nairobi to Kisumu.</span>
            </div>
          </div>
          <div className="auth-point">
            <Activity className="ico" size={20} />
            <div>
              <b>Every access recorded.</b>
              <span>Built for the Kenya Data Protection Act, 2019. You can always see who viewed your data.</span>
            </div>
          </div>
        </div>
        <div className="auth-foot">About MzaziCare · Help &amp; support · {SUPPORT_LINE}</div>
      </aside>

      <main className="auth-main">
        <div className="auth-top">
          <span>{step}</span>
          <span className="row" style={{ gap: 6 }}>
            <Lock size={12} /> Secure access
          </span>
        </div>
        <div className="auth-form">{children}</div>
        {footer ?? (
          <div className="auth-help">
            Need a hand? Call support on {SUPPORT_LINE}. In a medical emergency, call {EMERGENCY_NUMBERS}.
          </div>
        )}
      </main>
    </div>
  );
}
