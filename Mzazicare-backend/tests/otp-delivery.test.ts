/**
 * Where verification codes are sent, and the SMTP email sender. No network:
 * nodemailer is mocked, so these run in CI without any email account.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { otpChannels, otpEmail } from "@/modules/auth-service/services/otp.delivery";
import { createSmtpEmail, senderAddress } from "@/shared/services/email.service";

describe("otpChannels", () => {
  it("emails the code when the account has an email and there is no SMS provider", () => {
    expect(otpChannels({ email: "a@b.co" }, false)).toEqual(["email"]);
  });

  it("uses both when the account has an email and SMS is configured", () => {
    expect(otpChannels({ email: "a@b.co" }, true)).toEqual(["email", "sms"]);
  });

  it("falls back to SMS (the log in development) when there is no email", () => {
    expect(otpChannels({ email: null }, false)).toEqual(["sms"]);
    expect(otpChannels({}, true)).toEqual(["sms"]);
  });
});

describe("otpEmail", () => {
  it("puts the code, the expiry and the first name in both versions", () => {
    const m = otpEmail("phone_verification", "482913", 10, "Evelyn Njeri");
    expect(m.subject).toBe("Your MzaziCare verification code");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("482913");
      expect(body).toContain("10 minutes");
      expect(body).toContain("Habari Evelyn");
    }
  });

  it("words a password reset differently", () => {
    const m = otpEmail("password_reset", "000042", 10);
    expect(m.subject).toBe("Your MzaziCare password reset code");
    expect(m.text).toContain("reset your password");
  });
});

describe("SMTP email sender", () => {
  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({ messageId: "<abc@smtp>" });
    createTransport.mockClear();
  });

  it("sends from the SMTP login by default and returns the message id", async () => {
    const url = "smtps://mzazicare.app%40gmail.com:secretsecret@smtp.gmail.com:465";
    const email = createSmtpEmail(url);
    const res = await email.send({ to: "evelyn@example.com", subject: "Code", html: "<p>1</p>", text: "1" });

    expect(createTransport).toHaveBeenCalledWith(url);
    expect(sendMail).toHaveBeenCalledWith({
      from: "MzaziCare <mzazicare.app@gmail.com>",
      to: "evelyn@example.com",
      subject: "Code",
      html: "<p>1</p>",
      text: "1",
    });
    expect(res.id).toBe("<abc@smtp>");
  });

  it("creates the connection once and reuses it", async () => {
    const email = createSmtpEmail("smtp://u:p@smtp-relay.brevo.com:587", "MzaziCare <no-reply@mzazicare.co.ke>");
    await email.send({ to: "a@b.co", subject: "1", html: "1" });
    await email.send({ to: "c@d.co", subject: "2", html: "2" });
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]?.[0].from).toBe("MzaziCare <no-reply@mzazicare.co.ke>");
  });

  it("passes a provider failure up, so the queue retries the job", async () => {
    sendMail.mockRejectedValueOnce(new Error("535 Username and Password not accepted"));
    const email = createSmtpEmail("smtps://u:p@smtp.gmail.com:465");
    await expect(email.send({ to: "a@b.co", subject: "x", html: "x" })).rejects.toThrow("535");
  });

  it("works out a sender name even from an odd URL", () => {
    expect(senderAddress("not a url")).toBe("MzaziCare");
    expect(senderAddress("smtp://smtp.example.com:25")).toBe("MzaziCare");
  });
});
