/**
 * Demo accounts for presentations and local testing: one sign-in per role.
 *
 *   pnpm demo:accounts
 *
 * Safe to run more than once. For each phone number below it either creates
 * the account or, if it already exists, resets it to a known state: the demo
 * password, the listed role, status active, phone verified, no lockout. The
 * account's _id never changes, so elders, care circles, visits and audit
 * entries that already point at it keep working.
 *
 * It also makes sure the caregiver account has an APPROVED caregiver profile,
 * because a coordinator can only assign approved caregivers to a visit.
 *
 * Development only. It refuses to run when NODE_ENV is production: real
 * accounts must be created through registration and phone verification.
 */
import bcrypt from "bcryptjs";

import { connectDatabase, disconnectDatabase } from "@/db/index";
import { env } from "@/shared/config/env";
import { UserModel, type UserRole } from "@/modules/auth-service/models/auth.model";
import { CaregiverModel } from "@/modules/caregiver-service/models/caregiver.model";

/** Shared by every demo account. Change it here if you want another one. */
export const DEMO_PASSWORD = "MzaziDemo2026!";

/** Same cost as auth.service.ts, so a demo login takes as long as a real one. */
const BCRYPT_COST = 12;

export const DEMO_ACCOUNTS: ReadonlyArray<{ phone: string; name: string; role: UserRole }> = [
  { phone: "+254700990001", name: "Wanjiru Kamau", role: "family" },
  { phone: "+254700990002", name: "Achieng Otieno", role: "family" },
  { phone: "+254700990003", name: "Mercy Chebet", role: "caregiver" },
  { phone: "+254700990004", name: "Brian Kiprotich", role: "coordinator" },
  { phone: "+254700990005", name: "Faith Mutua", role: "admin" },
  { phone: "+254700990006", name: "Joseph Ochieng", role: "elder" },
  { phone: "+254700990007", name: "Daniel Mwangi", role: "auditor" },
];

async function upsertUser(account: (typeof DEMO_ACCOUNTS)[number], passwordHash: string) {
  const existing = await UserModel.findOne({ phone: account.phone });
  const reset = {
    passwordHash,
    role: account.role,
    status: "active" as const,
    phoneVerifiedAt: existing?.phoneVerifiedAt ?? new Date(),
    failedLoginAttempts: 0,
    lockedUntil: null,
  };

  if (existing) {
    await UserModel.updateOne({ _id: existing._id }, { $set: reset });
    return { id: existing._id, name: existing.name, created: false };
  }

  const user = await UserModel.create({ phone: account.phone, name: account.name, ...reset });
  return { id: user._id, name: user.name, created: true };
}

async function ensureApprovedCaregiver(userId: unknown, approverId: unknown) {
  const profile = await CaregiverModel.findOne({ userId });
  if (profile) {
    if (profile.status !== "approved") {
      await CaregiverModel.updateOne(
        { _id: profile._id },
        { $set: { status: "approved", approvedAt: new Date(), approvedBy: approverId } },
      );
    }
    return profile.status === "approved" ? "already approved" : `approved (was ${profile.status})`;
  }

  await CaregiverModel.create({
    userId,
    bio: "Registered nurse with home-based elder care experience in Nairobi.",
    skills: ["elder care", "medication reminders", "mobility support"],
    yearsExperience: 6,
    serviceAreas: ["Nairobi"],
    baseLocation: { type: "Point", coordinates: [36.8219, -1.2921] },
    hourlyRateCents: 80_000,
    status: "approved",
    approvedAt: new Date(),
    approvedBy: approverId,
  });
  return "created and approved";
}

async function main() {
  if (env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console -- a CLI script talks to the terminal
    console.error("Refusing to create demo accounts in production.");
    process.exit(1);
  }

  await connectDatabase();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_COST);

  const rows: Array<Record<string, string>> = [];
  const ids = new Map<UserRole, unknown>();
  for (const account of DEMO_ACCOUNTS) {
    const result = await upsertUser(account, passwordHash);
    if (!ids.has(account.role)) ids.set(account.role, result.id);
    rows.push({
      role: account.role,
      name: result.name,
      phone: account.phone,
      account: result.created ? "created" : "reset",
    });
  }

  const caregiver = await ensureApprovedCaregiver(ids.get("caregiver"), ids.get("admin"));

  /* eslint-disable no-console -- a CLI script talks to the terminal */
  console.table(rows);
  console.log(`Caregiver profile for Mercy Chebet: ${caregiver}`);
  console.log(`Password for every account above: ${DEMO_PASSWORD}`);
  /* eslint-enable no-console */

  await disconnectDatabase();
  process.exit(0);
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console -- a CLI script talks to the terminal
  console.error("demo-accounts failed:", err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
