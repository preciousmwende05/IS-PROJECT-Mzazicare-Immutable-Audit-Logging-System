import type { OtpPurpose } from "@/modules/auth-service/models/auth.model";

/**
 * Where a one-time code goes. Kept free of I/O so it can be tested on its own.
 *
 *   email  whenever the account has an email address (free; works today)
 *   sms    when an SMS provider is configured, or as the fallback when the
 *          account has no email (in development the SMS stub writes the code
 *          to the log, so demo accounts without an email still work)
 *
 * Both can apply: a user with an email on a system with SMS gets both.
 */
export const otpChannels = (
  user: { email?: string | null },
  smsConfigured: boolean,
): Array<"email" | "sms"> => {
  const channels: Array<"email" | "sms"> = [];
  if (user.email) channels.push("email");
  if (smsConfigured || !user.email) channels.push("sms");
  return channels;
};

const TITLES: Record<OtpPurpose, string> = {
  phone_verification: "Your MzaziCare verification code",
  password_reset: "Your MzaziCare password reset code",
  login: "Your MzaziCare sign-in code",
};

/** The email for a code: plain text plus a simple HTML version. */
export const otpEmail = (purpose: OtpPurpose, code: string, ttlMinutes: number, name?: string) => {
  const greeting = name ? `Habari ${name.split(" ")[0]},` : "Habari,";
  const action =
    purpose === "phone_verification" ? "finish creating your account" : purpose === "password_reset" ? "reset your password" : "sign in";
  const text =
    `${greeting} your MzaziCare code is ${code}. Use it to ${action}. ` +
    `It expires in ${ttlMinutes} minutes. Never share it with anyone, including MzaziCare staff. ` +
    `If you did not ask for this code, ignore this email.`;
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1b2a3a">
  <h2 style="color:#12304f;margin-bottom:4px">MzaziCare</h2>
  <p>${greeting}</p>
  <p>Use this code to ${action}:</p>
  <p style="font-size:30px;letter-spacing:8px;font-weight:bold;background:#f4efe3;padding:14px 18px;border-radius:8px;text-align:center">${code}</p>
  <p>It expires in ${ttlMinutes} minutes. Never share it with anyone, including MzaziCare staff.</p>
  <p style="color:#6b7785;font-size:13px">If you did not ask for this code, you can ignore this email.</p>
</div>`.trim();
  return { subject: TITLES[purpose], text, html };
};
