/**
 * Seed a realistic population: elders with filled-in profiles, family care circles,
 * approved caregivers, admins, an auditor, and weeks of activity between them
 * (bookings, assignment offers, geo-verified visits, care logs, in-app notifications
 * and sealed audit-trail entries).
 *
 *   pnpm tsx src/scripts/seed-population.ts                       # first batch (20 people)
 *   pnpm tsx src/scripts/seed-population.ts --elders 20 --family 40 --caregivers 11
 *   pnpm tsx src/scripts/seed-population.ts --cleanup             # remove everything it made
 *
 * In the production image (compiled):
 *   node dist/scripts/seed-population.js --yes-production --email you@gmail.com
 *
 * HOW SCALING WORKS
 * Counts are TOTALS, not increments. Every record the script creates is listed in the
 * `seed_registry` collection, so a second run with bigger numbers only adds the missing
 * people (and activity for the new elders). Running the same command twice changes nothing.
 *
 * SAFETY
 *  - Never publishes domain events, so no SMS, email or push goes out while seeding.
 *  - Every seeded user gets notification preferences with SMS and push switched off, so
 *    the app's own sweeps (missed visits, reminders) cannot text the made-up numbers later.
 *    (Critical emergency alerts always go out by design; the script raises no emergencies.)
 *  - Phone numbers are in the +254700981xxx–+254700984xxx block. Real accounts are never
 *    touched: a phone that exists but is not in the registry is skipped.
 *  - Emails (optional, --email) use Gmail plus-addressing, so every seeded account's
 *    password-reset code lands in ONE inbox: you+fam001@gmail.com, you+cg003@gmail.com, …
 *  - In production the shared password must come from SEED_PASSWORD (12+ characters).
 *  - Audit entries are sealed through auditService.record(), so /v1/audit/verify still
 *    passes. They are marked seed: true. The audit log is append-only by design, so
 *    --cleanup leaves them in place; everything else is removed.
 */

/* eslint-disable no-console -- CLI script: printing progress is its job */
/* eslint-disable no-restricted-imports -- a seed script writes every module's data on purpose */
import bcrypt from "bcryptjs";
import type { Model, Types } from "mongoose";

import { connectDatabase, disconnectDatabase, mongoose } from "@/db/index";
import { env } from "@/shared/config/env";
import { UserModel, type UserRole } from "@/modules/auth-service/models/auth.model";
import {
  CareCircleMemberModel,
  CarePlanModel,
  ElderModel,
  EmergencyContactModel,
} from "@/modules/elder-service/models/elder.model";
import { AvailabilityModel, CaregiverModel } from "@/modules/caregiver-service/models/caregiver.model";
import {
  CareServiceModel,
  ServiceCategoryModel,
} from "@/modules/catalog-service/models/catalog.model";
import { AssignmentOfferModel, BookingModel } from "@/modules/booking-service/models/booking.model";
import { LocationPingModel, VisitModel } from "@/modules/visit-service/models/visit.model";
import { VisitReportModel } from "@/modules/report-service/models/report.model";
import {
  NotificationModel,
  NotificationPreferenceModel,
} from "@/modules/notification-service/models/notification.model";
import { auditService } from "@/modules/audit-service/services/audit.service";

type Id = Types.ObjectId;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
};
const num = (name: string, fallback: number) => {
  const value = Number(opt(name, String(fallback)));
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a whole number`);
  return value;
};

// First batch: 6 elders + 8 family + 3 caregivers + 2 admins + 1 auditor = 20 people.
const COUNTS = {
  elders: num("elders", 6),
  family: num("family", 8),
  caregivers: num("caregivers", 3),
  admins: num("admins", 2),
  auditors: num("auditors", 1),
};
const BOOKINGS_PER_ELDER = num("bookings-per-elder", 5);
const PAST_DAYS = num("past-days", 30);
const FUTURE_DAYS = num("future-days", 14);
const EMAIL = opt("email", "");
const WITH_AUDIT = !flag("no-audit");

// ---------------------------------------------------------------------------
// Deterministic randomness: the same index always produces the same person.
// ---------------------------------------------------------------------------
const hashString = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const rngFor = (key: string) => {
  let a = hashString(key);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
type Rng = () => number;
const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
const pick = <T>(r: Rng, list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
const pickSome = <T>(r: Rng, list: readonly T[], n: number): T[] =>
  [...list].sort(() => r() - 0.5).slice(0, Math.min(n, list.length));
const pad = (n: number) => String(n).padStart(3, "0");

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const FEMALE = ["Wanjiku", "Njeri", "Akinyi", "Atieno", "Chepkoech", "Mumbua", "Nyokabi", "Wambui", "Kerubo", "Moraa", "Nafula", "Jepchirchir", "Wairimu", "Adhiambo", "Kanini", "Muthoni", "Nekesa", "Achieng", "Naliaka", "Wangari"];
const MALE = ["Kamau", "Otieno", "Kiprono", "Mwangi", "Ochieng", "Mutua", "Njoroge", "Omondi", "Kipchumba", "Wekesa", "Kariuki", "Odhiambo", "Kimani", "Barasa", "Maina", "Onyango", "Kibet", "Mutiso", "Gitau", "Ouma"];
const YOUNG_F = ["Faith", "Mercy", "Grace", "Joy", "Esther", "Purity", "Sharon", "Lilian", "Ann", "Caroline", "Diana", "Ivy", "Winnie", "Brenda", "Cynthia", "Naomi", "Ruth", "Tabitha", "Valerie", "Stacy"];
const YOUNG_M = ["Brian", "Kevin", "Dennis", "Collins", "Victor", "Allan", "Eric", "Felix", "George", "Ian", "James", "Kelvin", "Mark", "Moses", "Patrick", "Samuel", "Tony", "Wycliffe", "Edwin", "Ken"];
const SURNAMES = ["Kamau", "Otieno", "Mwangi", "Wanjala", "Kiptoo", "Mutua", "Njoroge", "Omondi", "Chebet", "Wekesa", "Kariuki", "Achieng", "Kimani", "Barasa", "Maina", "Onyango", "Kibet", "Mutiso", "Gitau", "Ouma", "Ndungu", "Korir", "Nyaga", "Okoth"];
const RELATIONSHIPS = ["daughter", "son", "granddaughter", "grandson", "niece", "nephew", "daughter-in-law", "son-in-law"];

const PLACES: ReadonlyArray<{ estate: string; county: string; at: [number, number]; streets: string[]; landmarks: string[] }> = [
  { estate: "Kilimani", county: "Nairobi", at: [36.7856, -1.2921], streets: ["Argwings Kodhek Rd", "Lenana Rd", "Ring Rd Kilimani"], landmarks: ["near Yaya Centre", "opposite Kilimani Primary"] },
  { estate: "Westlands", county: "Nairobi", at: [36.8065, -1.2676], streets: ["Waiyaki Way", "Mpaka Rd", "Woodvale Grove"], landmarks: ["behind Sarit Centre", "near Westgate"] },
  { estate: "Karen", county: "Nairobi", at: [36.7073, -1.3194], streets: ["Karen Rd", "Bogani Rd", "Langata South Rd"], landmarks: ["near Karen Hospital", "past The Hub"] },
  { estate: "Lavington", county: "Nairobi", at: [36.7686, -1.2781], streets: ["James Gichuru Rd", "Muthangari Dr"], landmarks: ["near Lavington Mall", "next to the church"] },
  { estate: "Kasarani", county: "Nairobi", at: [36.8983, -1.221], streets: ["Mwiki Rd", "Kasarani-Mwiki Rd"], landmarks: ["near the stadium", "opposite Naivas"] },
  { estate: "Embakasi", county: "Nairobi", at: [36.895, -1.319], streets: ["Outer Ring Rd", "Mombasa Rd service lane"], landmarks: ["near Pipeline stage", "behind the market"] },
  { estate: "South B", county: "Nairobi", at: [36.8366, -1.309], streets: ["Mchumbi Rd", "Kapiti Rd"], landmarks: ["near Capital Centre", "by South B shopping centre"] },
  { estate: "Ruaka", county: "Kiambu", at: [36.7781, -1.2087], streets: ["Limuru Rd", "Ruaka-Banana Rd"], landmarks: ["near Two Rivers", "behind Quickmart"] },
  { estate: "Kileleshwa", county: "Nairobi", at: [36.782, -1.283], streets: ["Othaya Rd", "Laikipia Rd"], landmarks: ["near Kileleshwa police station"] },
  { estate: "Lang'ata", county: "Nairobi", at: [36.764, -1.348], streets: ["Lang'ata Rd", "Otiende Rd"], landmarks: ["near Galleria Mall", "opposite the barracks"] },
  { estate: "Kahawa West", county: "Nairobi", at: [36.896, -1.183], streets: ["Kahawa West Rd"], landmarks: ["near the chief's office"] },
  { estate: "Syokimau", county: "Machakos", at: [36.935, -1.364], streets: ["Syokimau Rd", "Katani Rd"], landmarks: ["near the SGR station"] },
  { estate: "Donholm", county: "Nairobi", at: [36.889, -1.296], streets: ["Manyanja Rd", "Savannah Rd"], landmarks: ["near Donholm Phase 8"] },
  { estate: "Thika Town", county: "Kiambu", at: [37.069, -1.033], streets: ["Kenyatta Hwy", "Haile Selassie Ave"], landmarks: ["near Thika Level 5 Hospital"] },
  { estate: "Kitengela", county: "Kajiado", at: [36.958, -1.476], streets: ["Namanga Rd", "EPZ Rd"], landmarks: ["near Kitengela mall"] },
  { estate: "Runda", county: "Nairobi", at: [36.808, -1.219], streets: ["Runda Grove", "Kiambu Rd"], landmarks: ["near Village Market"] },
];

const CONDITIONS: Record<string, { meds: Array<[string, string, string]>; diet?: string }> = {
  Hypertension: { meds: [["Amlodipine", "5 mg", "Once daily, morning"], ["Losartan", "50 mg", "Once daily"]], diet: "low salt" },
  "Type 2 diabetes": { meds: [["Metformin", "500 mg", "Twice daily with meals"]], diet: "diabetic (low sugar)" },
  Osteoarthritis: { meds: [["Paracetamol", "1 g", "Up to three times daily as needed"]] },
  "Early-stage dementia": { meds: [["Donepezil", "5 mg", "Once daily at bedtime"]] },
  "Parkinson's disease": { meds: [["Levodopa/Carbidopa", "100/25 mg", "Three times daily"]] },
  COPD: { meds: [["Salbutamol inhaler", "2 puffs", "As needed"], ["Tiotropium", "18 mcg", "Once daily"]] },
  Osteoporosis: { meds: [["Alendronate", "70 mg", "Once weekly, Monday morning"]], diet: "calcium rich" },
  Glaucoma: { meds: [["Timolol eye drops", "1 drop each eye", "Twice daily"]] },
  "Chronic kidney disease (stage 3)": { meds: [["Furosemide", "40 mg", "Once daily"]], diet: "low potassium" },
  "Post-stroke weakness (left side)": { meds: [["Aspirin", "75 mg", "Once daily"], ["Atorvastatin", "20 mg", "Once daily at night"]], diet: "soft foods" },
};
const ALLERGIES = ["Penicillin", "Sulfa drugs", "Peanuts", "Aspirin", "Shellfish"];
const DOCTORS = ["Dr. Wairimu (Aga Khan)", "Dr. Otieno (Nairobi Hospital)", "Dr. Kiptoo (MP Shah)", "Dr. Mwangi (Kenyatta NH)", "Dr. Achieng (Karen Hospital)"];
const MOBILITY = ["independent", "walker", "wheelchair", "bedbound"] as const;

const CAREGIVER_BIOS = [
  "Registered nurse with home-based elder care experience across Nairobi.",
  "Certified caregiver trained in dementia care and safe patient handling.",
  "Community health volunteer turned full-time caregiver. Patient and calm with elders.",
  "Physiotherapy assistant focused on mobility, fall prevention and gentle exercise.",
  "Experienced in palliative and post-stroke care; fluent in Kiswahili, English and Dholuo.",
  "Former hospital nursing aide; strong on medication routines and record keeping.",
];
const CANCEL_REASONS = ["Elder travelling upcountry", "Family member will be home that day", "Elder admitted to hospital", "Rescheduling to next week"];
const DECLINE_REASONS = ["Already committed elsewhere", "Too far from my base location", "Unwell today"];
const MOODS_BY_TONE = {
  good: ["cheerful", "calm"],
  low: ["withdrawn", "agitated"],
} as const;
const REPORT_NOTES = {
  good: [
    "Assisted with bathing and dressing. Took all morning medication on time. Walked around the compound twice with support.",
    "Prepared lunch (githeri and greens) and she ate well. Blood pressure checked and recorded. Chatted about her grandchildren.",
    "Helped with physiotherapy exercises as per plan. No pain reported. House tidied and laundry folded.",
    "Medication reminders done; evening dose set out in the pill box. Enjoyed listening to the radio together.",
  ],
  low: [
    "Was quieter than usual and ate only half of lunch. Took medication after encouragement. Family may want to check in this evening.",
    "Complained of knee pain in the morning; rested most of the visit. Applied warm compress. Recommend a review with the doctor.",
    "Slept poorly last night according to the house help. Mildly confused in the afternoon, settled after tea.",
  ],
};
const MEALS = ["Uji for breakfast, ugali and sukuma for lunch", "Tea and bread, rice and beans for lunch", "Porridge, then mashed potatoes and fish", "Chapati and lentils; plenty of water"];

// ---------------------------------------------------------------------------
// Time helpers (East Africa Time, UTC+3, no daylight saving)
// ---------------------------------------------------------------------------
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date();
const eatMidnight = (() => {
  const local = new Date(NOW.getTime() + 3 * HOUR);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 3 * HOUR;
})();
/** A moment `dayOffset` days from today at hour:minute EAT. */
const eatAt = (dayOffset: number, hour: number, minute = 0) =>
  new Date(eatMidnight + dayOffset * DAY + hour * HOUR + minute * MIN);
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * MIN);

/** Metres between two [lng, lat] points. */
const distanceMeters = ([lng1, lat1]: [number, number], [lng2, lat2]: [number, number]) => {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};
/** Move a point by up to `meters` in a random direction. */
const jitter = (r: Rng, [lng, lat]: [number, number], meters: number): [number, number] => {
  const d = (r() * meters) / 111_320;
  const angle = r() * 2 * Math.PI;
  return [Number((lng + d * Math.cos(angle)).toFixed(6)), Number((lat + d * Math.sin(angle)).toFixed(6))];
};

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------
const registry = () => mongoose.connection.collection<{ _id: string; collection: string; refId: Id; createdAt: Date }>("seed_registry");

const lookup = async (key: string) => (await registry().findOne({ _id: key }))?.refId ?? null;

const register = async (key: string, collection: string, refId: Id) => {
  await registry().updateOne({ _id: key }, { $setOnInsert: { collection, refId, createdAt: new Date() } }, { upsert: true });
};

/**
 * Validate against the real schema, keep the backdated createdAt/updatedAt we pass in,
 * and list the record in the registry so --cleanup can remove it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- one helper for every model
async function insert(M: Model<any>, doc: Record<string, unknown>, key?: string): Promise<Id> {
  const created = new M(doc);
  await created.save({ timestamps: false });
  const id = created._id as Id;
  await register(key ?? `${M.collection.collectionName}:${String(id)}`, M.collection.collectionName, id);
  return id;
}

type AuditDraft = {
  occurredAt: Date;
  action: string;
  actorId: string | null;
  actorRole: string;
  subject: Record<string, unknown>;
  statusCode?: number;
};
const auditDrafts: AuditDraft[] = [];
const audit = (draft: AuditDraft) => auditDrafts.push(draft);

type NotificationDraft = {
  userId: Id;
  templateKey: string;
  category: "booking" | "visit" | "account" | "kyc";
  title: string;
  body: string;
  at: Date;
  data: Record<string, unknown>;
};
const notificationDrafts: NotificationDraft[] = [];
const notify = (n: NotificationDraft) => notificationDrafts.push(n);

const TARGET_KEYS: Array<[string, string]> = [["elderId", "elder"], ["visitId", "visit"], ["bookingId", "booking"], ["serviceId", "service"], ["userId", "user"]];
const targetOf = (subject: Record<string, unknown>) => {
  for (const [key, type] of TARGET_KEYS) {
    const value = subject[key];
    if (typeof value === "string" && value) return { targetType: type, targetId: value };
  }
  return {};
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------
type SeededUser = { id: Id; name: string; phone: string; email: string | null; role: UserRole; created: boolean };

const ROLE_CODE: Record<string, { digit: number; tag: string }> = {
  family: { digit: 1, tag: "fam" },
  caregiver: { digit: 2, tag: "cg" },
  admin: { digit: 3, tag: "admin" },
  auditor: { digit: 4, tag: "audit" },
};

const emailFor = (tag: string, i: number) => {
  if (!EMAIL) return null;
  const [local, domain] = EMAIL.split("@");
  return `${local}+${tag}${pad(i)}@${domain}`.toLowerCase();
};

function personName(key: string) {
  const r = rngFor(key);
  const female = r() < 0.55;
  return { first: pick(r, female ? YOUNG_F : YOUNG_M), last: pick(r, SURNAMES), female };
}

async function ensureUser(role: UserRole, i: number, passwordHash: string): Promise<SeededUser | null> {
  const code = ROLE_CODE[role]!;
  const key = `user:${role}:${pad(i)}`;
  const phone = `+25470098${code.digit}${pad(i)}`;
  const email = emailFor(code.tag, i);
  const existingId = await lookup(key);
  if (existingId) {
    const u = await UserModel.findById(existingId);
    if (u) return { id: u._id, name: u.name, phone: u.phone, email: u.email ?? null, role, created: false };
  }

  const clash = await UserModel.findOne({ $or: [{ phone }, ...(email ? [{ email }] : [])] });
  if (clash) {
    console.warn(`  ! skipped ${key}: ${phone}${email ? ` / ${email}` : ""} already belongs to a real account`);
    return null;
  }

  const r = rngFor(key);
  const { first, last } = personName(key);
  const name = `${first} ${last}`;
  const createdAt = addMin(eatAt(-PAST_DAYS - int(r, 3, 20), int(r, 7, 20)), int(r, 0, 59));
  const lastLoginAt = addMin(eatAt(-int(r, 0, 4), int(r, 7, 21)), int(r, 0, 59));
  const id = await insert(
    UserModel,
    {
      phone,
      ...(email ? { email } : {}),
      passwordHash,
      name,
      role,
      status: "active",
      phoneVerifiedAt: addMin(createdAt, 2),
      lastLoginAt,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt,
      updatedAt: lastLoginAt,
    },
    key,
  );

  // SMS and push off: nothing the app does later can text a made-up number.
  await insert(NotificationPreferenceModel, { userId: id, push: false, sms: false, mutedCategories: [], createdAt, updatedAt: createdAt });

  audit({ occurredAt: lastLoginAt, action: "user.logged_in", actorId: String(id), actorRole: role, subject: { userId: String(id) }, statusCode: 200 });
  notify({ userId: id, templateKey: "user.registered", category: "account", title: "Welcome to MzaziCare", body: `Hi ${first}, your account is verified and ready.`, at: addMin(createdAt, 3), data: {} });
  return { id, name, phone, email, role, created: true };
}

// ---------------------------------------------------------------------------
// Catalog: use what is published; create the standard catalog only if there is none.
// ---------------------------------------------------------------------------
const STANDARD_CATEGORIES = [
  { name: "Personal Care", slug: "personal-care", description: "Bathing, dressing, grooming and toileting support.", sortOrder: 1 },
  { name: "Household Support", slug: "household-support", description: "Meals, light cleaning and errands at home.", sortOrder: 2 },
  { name: "Health Support", slug: "health-support", description: "Medication reminders, mobility and nursing care.", sortOrder: 3 },
];
const STANDARD_SERVICES: Array<[string, string, string, number, "per_hour" | "per_visit" | "per_day", number, string[]]> = [
  ["Personal care", "personal-care", "Help with bathing, dressing, grooming and toileting, with dignity.", 50000, "per_hour", 60, ["personal_care"]],
  ["Meal preparation", "household-support", "Cooking nutritious Kenyan meals (ugali, githeri, uji) and help with feeding.", 40000, "per_hour", 60, ["meal_preparation"]],
  ["Light housekeeping", "household-support", "Tidying, laundry and keeping the home safe and clean.", 35000, "per_hour", 60, ["housekeeping"]],
  ["Mobility support", "health-support", "Safe transfers, walking assistance and gentle exercises.", 50000, "per_hour", 60, ["mobility_support"]],
  ["Medication reminders", "health-support", "Prompting and recording medication as per the care plan.", 60000, "per_visit", 30, ["medication_support"]],
  ["Nursing care", "health-support", "Wound care, vitals and clinical observation by a registered nurse.", 120000, "per_hour", 60, ["nursing"]],
  ["Respite care", "personal-care", "A full day of care so family caregivers can rest.", 350000, "per_day", 480, ["personal_care"]],
];

type Service = { id: Id; name: string; basePriceCents: number; pricingUnit: string; minimumDurationMinutes: number; requiredSkills: string[] };

async function ensureCatalog(adminId: Id): Promise<Service[]> {
  let services = await CareServiceModel.find({ status: "published" }).lean();
  if (services.length === 0) {
    console.log("  No published services found: creating the standard catalog.");
    const catIds: Record<string, Id> = {};
    for (const c of STANDARD_CATEGORIES) {
      const existing = await ServiceCategoryModel.findOne({ slug: c.slug });
      catIds[c.slug] = existing?._id ?? (await insert(ServiceCategoryModel, { ...c, active: true, createdAt: NOW, updatedAt: NOW }));
    }
    let order = 0;
    for (const [name, cat, description, basePriceCents, pricingUnit, minimumDurationMinutes, requiredSkills] of STANDARD_SERVICES) {
      order += 1;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (await CareServiceModel.exists({ slug })) continue;
      await insert(CareServiceModel, { name, slug, categoryId: catIds[cat], description, basePriceCents, pricingUnit, minimumDurationMinutes, requiredSkills, status: "published", sortOrder: order, publishedAt: NOW, createdBy: adminId, createdAt: NOW, updatedAt: NOW });
    }
    services = await CareServiceModel.find({ status: "published" }).lean();
  }
  return services.map((s) => ({
    id: s._id,
    name: s.name,
    basePriceCents: s.basePriceCents,
    pricingUnit: s.pricingUnit,
    minimumDurationMinutes: s.minimumDurationMinutes,
    requiredSkills: [...(s.requiredSkills ?? [])],
  }));
}

// ---------------------------------------------------------------------------
// Caregivers
// ---------------------------------------------------------------------------
type SeededCaregiver = { user: SeededUser; profileId: Id; skills: string[]; base: [number, number] };

async function ensureCaregiverProfile(user: SeededUser, i: number, allSkills: string[], approverId: Id): Promise<SeededCaregiver> {
  const existing = await CaregiverModel.findOne({ userId: user.id }).lean();
  if (existing) {
    return { user, profileId: existing._id, skills: [...(existing.skills ?? [])], base: existing.baseLocation!.coordinates as [number, number] };
  }
  const r = rngFor(`caregiver:${pad(i)}`);
  // Round-robin one skill so every service has someone who can do it, then add a few more.
  const skills = [...new Set([allSkills[(i - 1) % allSkills.length]!, ...pickSome(r, allSkills, int(r, 1, 3))])];
  const place = pick(r, PLACES);
  const base = jitter(r, place.at, 1500);
  const submitted = addMin(eatAt(-PAST_DAYS - int(r, 2, 10), int(r, 8, 17)), int(r, 0, 59));
  const approvedAt = addMin(submitted, int(r, 60 * 6, 60 * 48));

  const profileId = await insert(CaregiverModel, {
    userId: user.id,
    bio: pick(r, CAREGIVER_BIOS),
    skills,
    yearsExperience: int(r, 1, 18),
    serviceAreas: [...new Set([place.estate, pick(r, PLACES).estate, "Nairobi"])],
    baseLocation: { type: "Point", coordinates: base },
    hourlyRateCents: int(r, 50, 120) * 1000,
    status: "approved",
    reviewerId: approverId,
    approvedAt,
    approvedBy: approverId,
    createdAt: submitted,
    updatedAt: approvedAt,
  });

  // Mon–Sat, mostly 08:00–17:00; some work a shorter day.
  for (let day = 1; day <= 6; day += 1) {
    if (day === 6 && r() < 0.4) continue;
    const start = pick(r, [7, 8, 8, 9]) * 60;
    const end = pick(r, [15, 17, 17, 18]) * 60;
    await insert(AvailabilityModel, { caregiverId: profileId, dayOfWeek: day, startMinute: start, endMinute: end, createdAt: submitted, updatedAt: submitted });
  }

  const uid = String(user.id);
  audit({ occurredAt: addMin(submitted, -30), action: "caregiver.profile.created", actorId: uid, actorRole: "caregiver", subject: { userId: uid, caregiverId: String(profileId) }, statusCode: 201 });
  audit({ occurredAt: submitted, action: "caregiver.application.submitted", actorId: uid, actorRole: "caregiver", subject: { userId: uid, caregiverId: String(profileId) }, statusCode: 200 });
  audit({ occurredAt: addMin(approvedAt, -45), action: "caregiver.review.started", actorId: String(approverId), actorRole: "admin", subject: { userId: uid, caregiverId: String(profileId) }, statusCode: 200 });
  audit({ occurredAt: approvedAt, action: "caregiver.approved", actorId: String(approverId), actorRole: "admin", subject: { userId: uid, caregiverId: String(profileId) }, statusCode: 200 });
  notify({ userId: user.id, templateKey: "caregiver.approved", category: "kyc", title: "Application approved", body: "You can now receive visit offers on MzaziCare.", at: approvedAt, data: { caregiverId: String(profileId) } });
  return { user, profileId, skills, base };
}

// ---------------------------------------------------------------------------
// Elders, care circles and care plans
// ---------------------------------------------------------------------------
type SeededElder = { id: Id; name: string; home: [number, number]; circle: SeededUser[]; ownerId: Id; createdAt: Date };

async function createElder(i: number, circle: Array<{ user: SeededUser; relationship: string }>): Promise<SeededElder> {
  const key = `elder:${pad(i)}`;
  const r = rngFor(key);
  const female = r() < 0.6;
  const firstName = pick(r, female ? FEMALE : MALE);
  const owner = circle[0]!;
  // The primary contact is usually a child, so the elder often shares their surname.
  const lastName = r() < 0.7 ? owner.user.name.split(" ").slice(-1)[0]! : pick(r, SURNAMES);
  const place = pick(r, PLACES);
  const home = jitter(r, place.at, 1200);
  const age = int(r, 66, 94);
  const dob = new Date(Date.UTC(NOW.getUTCFullYear() - age, int(r, 0, 11), int(r, 1, 28)));
  const createdAt = addMin(eatAt(-PAST_DAYS - int(r, 1, 5), int(r, 8, 20)), int(r, 0, 59));

  const elderId = await insert(
    ElderModel,
    {
      firstName,
      lastName,
      dateOfBirth: dob,
      gender: female ? "female" : "male",
      homeLocation: { type: "Point", coordinates: home },
      address: { estate: place.estate, street: `${pick(r, place.streets)}, House ${int(r, 2, 120)}`, landmark: pick(r, place.landmarks), county: place.county },
      primaryContactUserId: owner.user.id,
      status: "active",
      createdAt,
      updatedAt: createdAt,
    },
    key,
  );
  const eid = String(elderId);
  audit({ occurredAt: createdAt, action: "elder.created", actorId: String(owner.user.id), actorRole: "family", subject: { elderId: eid }, statusCode: 201 });

  // Care circle: owner first, then editors/viewers who were invited and accepted.
  for (const [idx, member] of circle.entries()) {
    const invitedAt = idx === 0 ? createdAt : addMin(createdAt, int(r, 30, 60 * 48));
    const acceptedAt = idx === 0 ? createdAt : addMin(invitedAt, int(r, 10, 600));
    await insert(CareCircleMemberModel, {
      elderId,
      userId: member.user.id,
      relationship: member.relationship,
      accessLevel: idx === 0 ? "owner" : r() < 0.6 ? "editor" : "viewer",
      invitedBy: idx === 0 ? null : owner.user.id,
      acceptedAt,
      createdAt: invitedAt,
      updatedAt: acceptedAt,
    });
    if (idx > 0) {
      audit({ occurredAt: invitedAt, action: "carecircle.member.invited", actorId: String(owner.user.id), actorRole: "family", subject: { elderId: eid, userId: String(member.user.id) }, statusCode: 201 });
      audit({ occurredAt: acceptedAt, action: "carecircle.member.added", actorId: String(member.user.id), actorRole: "family", subject: { elderId: eid, userId: String(member.user.id) }, statusCode: 200 });
    }
  }

  // Care plan v1 at creation, sometimes a v2 a few weeks later (medication change).
  const conditionNames = pickSome(r, Object.keys(CONDITIONS), int(r, 1, 3));
  const medications = conditionNames.flatMap((c) => CONDITIONS[c]!.meds.map(([name, dosage, schedule]) => ({ name, dosage, schedule, prescribedBy: pick(r, DOCTORS) })));
  const dietary = [...new Set(conditionNames.map((c) => CONDITIONS[c]!.diet).filter((d): d is string => Boolean(d)))];
  const mobility = pick(r, MOBILITY);
  const allergies = r() < 0.55 ? [] : pickSome(r, ALLERGIES, int(r, 1, 2));
  const careNotes = `${firstName} prefers to be addressed as ${female ? "Cucu" : "Guka"} ${firstName}. ${mobility === "independent" ? "Walks without support but tires quickly." : `Uses a ${mobility === "walker" ? "walking frame" : mobility === "wheelchair" ? "wheelchair" : "hospital bed"}; needs help with transfers.`} Likes Kiswahili radio in the afternoon.`;
  const planAt = addMin(createdAt, int(r, 15, 120));
  await insert(CarePlanModel, { elderId, version: 1, conditions: conditionNames, medications, allergies, mobility, dietary, careNotes, updatedBy: owner.user.id, createdAt: planAt, updatedAt: planAt });
  audit({ occurredAt: planAt, action: "careplan.updated", actorId: String(owner.user.id), actorRole: "family", subject: { elderId: eid, version: 1 }, statusCode: 201 });
  if (r() < 0.5) {
    const v2At = addMin(eatAt(-int(r, 3, Math.max(4, PAST_DAYS - 5)), int(r, 9, 19)), int(r, 0, 59));
    const changed = medications.map((m, idx) => (idx === 0 ? { ...m, dosage: m.dosage === "5 mg" ? "10 mg" : m.dosage, schedule: `${m.schedule} (reviewed)` } : m));
    await insert(CarePlanModel, { elderId, version: 2, conditions: conditionNames, medications: changed, allergies, mobility, dietary, careNotes: `${careNotes} Medication reviewed by doctor on ${v2At.toISOString().slice(0, 10)}.`, updatedBy: owner.user.id, createdAt: v2At, updatedAt: v2At });
    audit({ occurredAt: v2At, action: "careplan.updated", actorId: String(owner.user.id), actorRole: "family", subject: { elderId: eid, version: 2 }, statusCode: 201 });
  }

  // Emergency contacts: the circle, in order. (Made-up numbers; nothing is ever sent to them.)
  for (const [idx, member] of circle.slice(0, 2).entries()) {
    const at = addMin(planAt, 5 + idx);
    await insert(EmergencyContactModel, { elderId, name: member.user.name, phone: member.user.phone, relationship: member.relationship, priority: idx + 1, createdAt: at, updatedAt: at });
    audit({ occurredAt: at, action: "emergencycontact.added", actorId: String(owner.user.id), actorRole: "family", subject: { elderId: eid }, statusCode: 201 });
  }

  return { id: elderId, name: `${firstName} ${lastName}`, home, circle: circle.map((c) => c.user), ownerId: owner.user.id, createdAt };
}

// ---------------------------------------------------------------------------
// Bookings → offers → visits → care logs
// ---------------------------------------------------------------------------
const busyCaregiver = new Set<string>(); // `${caregiverId}|${hourStartMs}`
const busyElder = new Set<string>(); // `${elderId}|${dayStartMs}`

async function loadBusySlots(caregivers: SeededCaregiver[]) {
  const ids = caregivers.map((c) => c.profileId);
  const rows = await BookingModel.find({ caregiverId: { $in: ids }, status: { $in: ["confirmed", "in_progress", "completed"] } }, { caregiverId: 1, scheduledFor: 1, endsAt: 1 }).lean();
  for (const b of rows) markCaregiver(String(b.caregiverId), b.scheduledFor, b.endsAt);
}
function markCaregiver(cgId: string, start: Date, end: Date) {
  for (let t = Math.floor(start.getTime() / HOUR) * HOUR; t < end.getTime() + HOUR; t += HOUR) busyCaregiver.add(`${cgId}|${t}`);
}
function caregiverFree(cgId: string, start: Date, end: Date) {
  for (let t = Math.floor(start.getTime() / HOUR) * HOUR; t < end.getTime() + HOUR; t += HOUR) if (busyCaregiver.has(`${cgId}|${t}`)) return false;
  return true;
}

const durationFor = (r: Rng, s: Service) => {
  if (s.pricingUnit === "per_day") return Math.max(480, s.minimumDurationMinutes);
  if (s.pricingUnit === "per_visit") return Math.max(30, s.minimumDurationMinutes);
  return Math.max(s.minimumDurationMinutes, pick(r, [60, 90, 120, 120, 180]));
};
const priceFor = (s: Service, minutes: number) =>
  s.pricingUnit === "per_hour" ? Math.round((s.basePriceCents * minutes) / 60) : s.basePriceCents;

const stats = { bookings: 0, completed: 0, upcoming: 0, cancelled: 0, noShow: 0, unassigned: 0, visits: 0, reports: 0 };

async function createActivity(elder: SeededElder, i: number, services: Service[], caregivers: SeededCaregiver[], admins: SeededUser[]) {
  const r = rngFor(`activity:elder:${pad(i)}`);
  const eid = String(elder.id);
  const days = new Set<number>();
  const pastCount = Math.max(1, Math.round(BOOKINGS_PER_ELDER * 0.65));

  for (let n = 0; n < BOOKINGS_PER_ELDER; n += 1) {
    const isPast = n < pastCount;
    let day = 0;
    for (let tries = 0; tries < 30; tries += 1) {
      day = isPast ? -int(r, 1, PAST_DAYS) : int(r, 1, FUTURE_DAYS);
      if (!days.has(day) && !busyElder.has(`${eid}|${day}`)) break;
    }
    if (days.has(day)) continue;
    days.add(day);
    busyElder.add(`${eid}|${day}`);

    const service = pick(r, services);
    const minutes = durationFor(r, service);
    const startHour = minutes >= 480 ? 8 : int(r, 8, Math.max(8, 17 - Math.ceil(minutes / 60)));
    const scheduledFor = eatAt(day, startHour, pick(r, [0, 0, 30]));
    const endsAt = addMin(scheduledFor, minutes);
    const requester = pick(r, elder.circle);
    const requestedAt = addMin(scheduledFor, -int(r, 60 * 24, 60 * 24 * 6));
    if (requestedAt < elder.createdAt) continue;

    const roll = r();
    let status: "completed" | "cancelled" | "no_show" | "confirmed" | "unassigned";
    if (isPast) status = roll < 0.76 ? "completed" : roll < 0.9 ? "cancelled" : "no_show";
    else status = roll < 0.8 ? "confirmed" : roll < 0.9 ? "unassigned" : "cancelled";

    // A caregiver with the right skill who is free; fall back to anyone free.
    const skilled = caregivers.filter((c) => service.requiredSkills.every((s) => c.skills.includes(s)));
    const pool = (skilled.length ? skilled : caregivers).filter((c) => caregiverFree(String(c.profileId), scheduledFor, endsAt));
    const caregiver = status === "unassigned" ? null : pool.length ? pick(r, pool) : null;
    if (!caregiver && status !== "unassigned" && status !== "cancelled") status = "unassigned";
    if (status === "unassigned" && isPast) continue; // past unassigned bookings would be stale noise

    const cancelled = status === "cancelled";
    const confirmedAt = caregiver ? addMin(requestedAt, int(r, 3, 40)) : null;
    const cancelledAt = cancelled ? addMin(requestedAt, int(r, 60, 60 * 20)) : null;

    const bookingId = await insert(BookingModel, {
      elderId: elder.id,
      serviceId: service.id,
      caregiverId: caregiver && !cancelled ? caregiver.profileId : null,
      requestedBy: requester.id,
      status,
      scheduledFor,
      durationMinutes: minutes,
      endsAt,
      location: { type: "Point", coordinates: elder.home },
      priceCentsAtBooking: priceFor(service, minutes),
      requiredSkillsAtBooking: service.requiredSkills,
      notes: r() < 0.5 ? pick(r, ["Please call the gate when you arrive.", "She prefers tea without sugar.", "Gate code is with the watchman.", "Bring the BP machine, ours is broken.", null]) : null,
      cancelledBy: cancelled ? "family" : null,
      cancelledByUserId: cancelled ? requester.id : null,
      cancellationReason: cancelled ? pick(r, CANCEL_REASONS) : null,
      cancellationFeeCents: cancelled ? 0 : null,
      cancelledAt,
      matchAttempts: status === "unassigned" ? 3 : 1,
      confirmedAt: cancelled ? null : confirmedAt,
      createdAt: requestedAt,
      updatedAt: cancelledAt ?? confirmedAt ?? requestedAt,
    });
    stats.bookings += 1;
    const bid = String(bookingId);
    const sid = String(service.id);
    const when = scheduledFor.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

    audit({ occurredAt: requestedAt, action: "visit.requested", actorId: String(requester.id), actorRole: "family", subject: { bookingId: bid, elderId: eid, serviceId: sid }, statusCode: 201 });
    notify({ userId: requester.id, templateKey: "booking.requested", category: "booking", title: "Visit requested", body: `${service.name} for ${elder.name} on ${when}. We're finding a caregiver.`, at: addMin(requestedAt, 1), data: { bookingId: bid, elderId: eid } });

    if (status === "unassigned") {
      stats.unassigned += 1;
      notify({ userId: requester.id, templateKey: "booking.unassigned", category: "booking", title: "Still looking for a caregiver", body: `No caregiver has accepted ${service.name} on ${when} yet. Our team is on it.`, at: addMin(requestedAt, 50), data: { bookingId: bid } });
      continue;
    }

    // Offers: sometimes a decline first, then the accept.
    if (caregiver && confirmedAt) {
      const others = caregivers.filter((c) => c !== caregiver);
      if (others.length && r() < 0.35) {
        const decliner = pick(r, others);
        await insert(AssignmentOfferModel, { bookingId, caregiverId: decliner.profileId, status: "declined", offeredAt: addMin(requestedAt, 1), expiresAt: addMin(requestedAt, 16), respondedAt: addMin(requestedAt, int(r, 2, 10)), declineReason: pick(r, DECLINE_REASONS), createdAt: addMin(requestedAt, 1), updatedAt: addMin(requestedAt, 10) });
      }
      await insert(AssignmentOfferModel, { bookingId, caregiverId: caregiver.profileId, status: "accepted", offeredAt: addMin(confirmedAt, -2), expiresAt: addMin(confirmedAt, 13), respondedAt: confirmedAt, createdAt: addMin(confirmedAt, -2), updatedAt: confirmedAt });
    }

    if (cancelled) {
      stats.cancelled += 1;
      audit({ occurredAt: cancelledAt!, action: "visit.cancelled", actorId: String(requester.id), actorRole: "family", subject: { bookingId: bid, elderId: eid }, statusCode: 200 });
      for (const member of elder.circle) {
        notify({ userId: member.id, templateKey: "booking.cancelled", category: "booking", title: "Visit cancelled", body: `${service.name} for ${elder.name} on ${when} was cancelled. No fee was charged.`, at: addMin(cancelledAt!, 1), data: { bookingId: bid } });
      }
      continue;
    }

    // From here the booking has a caregiver.
    const cg = caregiver!;
    const cgUid = String(cg.user.id);
    markCaregiver(String(cg.profileId), scheduledFor, endsAt);
    const assigner = pick(r, admins);
    audit({ occurredAt: confirmedAt!, action: "visit.assigned", actorId: cgUid, actorRole: "caregiver", subject: { bookingId: bid, elderId: eid, caregiverId: String(cg.profileId), assistedBy: String(assigner.id) }, statusCode: 200 });
    notify({ userId: cg.user.id, templateKey: "booking.confirmed.caregiver", category: "booking", title: "Visit confirmed", body: `${service.name} with ${elder.name}, ${when}.`, at: confirmedAt!, data: { bookingId: bid, elderId: eid } });
    for (const member of elder.circle) {
      notify({ userId: member.id, templateKey: "booking.confirmed.family", category: "booking", title: "Caregiver confirmed", body: `${cg.user.name} will visit ${elder.name} on ${when}.`, at: addMin(confirmedAt!, 1), data: { bookingId: bid, elderId: eid } });
    }

    // Every confirmed booking has a visit.
    const visitBase = { bookingId, caregiverId: cg.profileId, elderId: elder.id, expectedLocation: { type: "Point", coordinates: elder.home }, geofenceRadiusMeters: 150, scheduledFor, expectedDurationMinutes: minutes };

    if (status === "confirmed") {
      stats.upcoming += 1;
      const visitId = await insert(VisitModel, { ...visitBase, status: "scheduled", createdAt: confirmedAt, updatedAt: confirmedAt });
      await BookingModel.updateOne({ _id: bookingId }, { $set: { visitId } }, { timestamps: false });
      stats.visits += 1;
      continue;
    }

    if (status === "no_show") {
      stats.noShow += 1;
      const missedAt = addMin(scheduledFor, 45);
      const visitId = await insert(VisitModel, { ...visitBase, status: "missed", createdAt: confirmedAt, updatedAt: missedAt });
      await BookingModel.updateOne({ _id: bookingId }, { $set: { visitId } }, { timestamps: false });
      await CaregiverModel.updateOne({ _id: cg.profileId }, { $inc: { noShowCount: 1 } }, { timestamps: false });
      stats.visits += 1;
      for (const member of elder.circle) {
        notify({ userId: member.id, templateKey: "visit.missed", category: "visit", title: "Visit missed", body: `${cg.user.name} did not check in for ${elder.name}'s visit on ${when}. Our team has been alerted.`, at: missedAt, data: { bookingId: bid, visitId: String(visitId) } });
      }
      continue;
    }

    // Completed: check in near the house, check out, care log.
    stats.completed += 1;
    const lateBy = r() < 0.15 ? int(r, 16, 35) : int(r, -8, 12);
    const checkInAt = addMin(scheduledFor, lateBy);
    const checkInLocation = jitter(r, elder.home, r() < 0.08 ? 260 : 60);
    const checkInDistance = distanceMeters(elder.home, checkInLocation);
    const actual = Math.max(15, minutes + int(r, -15, 10));
    const checkOutAt = addMin(checkInAt, actual);
    const checkOutLocation = jitter(r, elder.home, 50);
    const checkOutDistance = distanceMeters(elder.home, checkOutLocation);
    const flags: string[] = [];
    if (lateBy > 15) flags.push("late_checkin");
    if (checkInDistance > 150) flags.push("outside_geofence");
    if (actual < minutes * 0.75) flags.push("short_visit");

    const visitId = await insert(VisitModel, {
      ...visitBase,
      status: "completed",
      checkInAt,
      checkInLocation: { type: "Point", coordinates: checkInLocation },
      checkInDistanceMeters: checkInDistance,
      checkInVerified: checkInDistance <= 150,
      checkOutAt,
      checkOutLocation: { type: "Point", coordinates: checkOutLocation },
      checkOutDistanceMeters: checkOutDistance,
      checkOutVerified: checkOutDistance <= 150,
      actualDurationMinutes: actual,
      verificationFlags: flags,
      createdAt: confirmedAt,
      updatedAt: checkOutAt,
    });
    stats.visits += 1;
    const vid = String(visitId);
    await BookingModel.updateOne({ _id: bookingId }, { $set: { visitId, startedAt: checkInAt, completedAt: checkOutAt, updatedAt: checkOutAt } }, { timestamps: false });

    // A few location pings during the visit.
    for (let p = 1; p <= 3; p += 1) {
      const recordedAt = addMin(checkInAt, Math.round((actual * p) / 4));
      await insert(LocationPingModel, { visitId, location: { type: "Point", coordinates: jitter(r, elder.home, 40) }, recordedAt, receivedAt: addMin(recordedAt, 0.1), accuracyMeters: int(r, 5, 25), isMockLocation: false });
    }

    audit({ occurredAt: checkInAt, action: "visit.checked_in", actorId: cgUid, actorRole: "caregiver", subject: { visitId: vid, bookingId: bid, elderId: eid, distanceMeters: checkInDistance, flags }, statusCode: 200 });
    audit({ occurredAt: checkOutAt, action: "visit.checked_out", actorId: cgUid, actorRole: "caregiver", subject: { visitId: vid, bookingId: bid, elderId: eid, actualDurationMinutes: actual }, statusCode: 200 });
    for (const member of elder.circle) {
      notify({ userId: member.id, templateKey: "visit.checked_in", category: "visit", title: "Caregiver arrived", body: `${cg.user.name} checked in at ${elder.name}'s home.`, at: checkInAt, data: { visitId: vid, bookingId: bid } });
      notify({ userId: member.id, templateKey: "visit.checked_out", category: "visit", title: "Visit finished", body: `${cg.user.name} finished a ${actual}-minute visit with ${elder.name}.`, at: checkOutAt, data: { visitId: vid, bookingId: bid } });
    }

    // Care log, written by the caregiver shortly after checkout.
    if (r() < 0.9) {
      const tone = r() < 0.8 ? "good" : "low";
      const submittedAt = addMin(checkOutAt, int(r, 3, 40));
      const reader = pick(r, elder.circle);
      const acknowledged = submittedAt.getTime() < NOW.getTime() - DAY && r() < 0.8;
      await insert(VisitReportModel, {
        visitId,
        bookingId,
        elderId: elder.id,
        caregiverId: cg.profileId,
        authorUserId: cg.user.id,
        notes: pick(r, REPORT_NOTES[tone]),
        vitals: r() < 0.7 ? { bloodPressureSystolic: int(r, 112, 158), bloodPressureDiastolic: int(r, 68, 96) } : null,
        mood: pick(r, MOODS_BY_TONE[tone]),
        meals: pick(r, MEALS),
        submittedAt,
        acknowledgedAt: acknowledged ? addMin(submittedAt, int(r, 20, 600)) : null,
        acknowledgedBy: acknowledged ? reader.id : null,
        createdAt: submittedAt,
        updatedAt: submittedAt,
      });
      stats.reports += 1;
      audit({ occurredAt: submittedAt, action: "carelog.created", actorId: cgUid, actorRole: "caregiver", subject: { visitId: vid, bookingId: bid, elderId: eid }, statusCode: 201 });
      for (const member of elder.circle) {
        notify({ userId: member.id, templateKey: "visit_report.submitted", category: "visit", title: "Care log ready", body: `${cg.user.name} shared notes from today's visit with ${elder.name}.`, at: submittedAt, data: { visitId: vid, bookingId: bid } });
      }
      if (acknowledged) {
        audit({ occurredAt: addMin(submittedAt, 25), action: "carelog.viewed", actorId: String(reader.id), actorRole: "family", subject: { visitId: vid, elderId: eid }, statusCode: 200 });
      }
    }
  }

  // Family members look at the profile now and then; admins review it once.
  for (const member of elder.circle) {
    for (let v = 0; v < int(r, 1, 3); v += 1) {
      audit({ occurredAt: addMin(eatAt(-int(r, 0, PAST_DAYS - 1), int(r, 7, 21)), int(r, 0, 59)), action: pick(r, ["elder.viewed", "careplan.viewed", "carecircle.viewed"]), actorId: String(member.id), actorRole: "family", subject: { elderId: eid }, statusCode: 200 });
    }
  }
  audit({ occurredAt: addMin(eatAt(-int(r, 0, 10), int(r, 9, 17)), int(r, 0, 59)), action: "elder.viewed", actorId: String(pick(r, admins).id), actorRole: "admin", subject: { elderId: eid }, statusCode: 200 });
}

// ---------------------------------------------------------------------------
// Family → elder assignment (1–3 per elder), stable across scale-ups
// ---------------------------------------------------------------------------
async function planCircles(newElderIdx: number[], family: SeededUser[], existingElders: Id[]) {
  const assigned = new Set((await CareCircleMemberModel.find({ elderId: { $in: existingElders } }, { userId: 1 }).lean()).map((m) => String(m.userId)));
  const pool = family.filter((f) => !assigned.has(String(f.id)));
  const r = rngFor(`circles:${newElderIdx.join(",")}`);
  const circles = new Map<number, SeededUser[]>(newElderIdx.map((i) => [i, []]));
  const targets = new Map<number, number>(newElderIdx.map((i) => [i, pick(rngFor(`circle-size:${i}`), [1, 1, 2, 2, 3, 3])]));

  for (const i of newElderIdx) circles.get(i)!.push(pool.shift()!);
  // Fill towards each target, then spread anything left so nobody is left without an elder.
  for (const i of newElderIdx) while (pool.length && circles.get(i)!.length < targets.get(i)!) circles.get(i)!.push(pool.shift()!);
  const roomy = () => newElderIdx.filter((i) => circles.get(i)!.length < 3);
  while (pool.length && roomy().length) circles.get(pick(r, roomy()))!.push(pool.shift()!);
  return { circles, leftover: pool };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function seed() {
  const production = env.NODE_ENV === "production";
  if (production && !flag("yes-production")) {
    console.error("This is the production database. Re-run with --yes-production to seed it.");
    process.exit(1);
  }
  const password = process.env.SEED_PASSWORD ?? (production ? "" : "MzaziSeed2026!");
  if (password.length < 12) {
    console.error("Set SEED_PASSWORD (12+ characters): it becomes the password of every seeded account.");
    process.exit(1);
  }
  if (COUNTS.family < COUNTS.elders || COUNTS.family > COUNTS.elders * 3) {
    console.error(`Each elder needs 1–3 family members: --family must be between ${COUNTS.elders} and ${COUNTS.elders * 3}.`);
    process.exit(1);
  }
  if (COUNTS.caregivers < 1 || COUNTS.admins < 1) {
    console.error("Need at least one caregiver and one admin.");
    process.exit(1);
  }
  if (WITH_AUDIT && !process.env.AUDIT_HMAC_SECRET) {
    console.error("AUDIT_HMAC_SECRET is not set, so audit entries cannot be sealed. Set it or pass --no-audit.");
    process.exit(1);
  }

  await connectDatabase();
  console.log(`Seeding ${COUNTS.elders} elders, ${COUNTS.family} family, ${COUNTS.caregivers} caregivers, ${COUNTS.admins} admins, ${COUNTS.auditors} auditor(s)…`);
  const passwordHash = await bcrypt.hash(password, 12);

  const ensureMany = async (role: UserRole, n: number) => {
    const out: SeededUser[] = [];
    for (let i = 1; i <= n; i += 1) {
      const u = await ensureUser(role, i, passwordHash);
      if (u) out.push(u);
    }
    return out;
  };
  const admins = await ensureMany("admin", COUNTS.admins);
  const auditors = await ensureMany("auditor", COUNTS.auditors);
  const family = await ensureMany("family", COUNTS.family);
  const caregiverUsers = await ensureMany("caregiver", COUNTS.caregivers);
  if (!admins.length) throw new Error("No admin could be created (all phones taken).");
  console.log(`  users ready: ${admins.length + auditors.length + family.length + caregiverUsers.length}`);

  const services = await ensureCatalog(admins[0]!.id);
  const allSkills = [...new Set(services.flatMap((s) => s.requiredSkills))];
  if (!allSkills.length) allSkills.push("personal_care");

  const caregivers: SeededCaregiver[] = [];
  for (const [idx, u] of caregiverUsers.entries()) caregivers.push(await ensureCaregiverProfile(u, idx + 1, allSkills, admins[idx % admins.length]!.id));
  await loadBusySlots(caregivers);
  console.log(`  caregivers approved: ${caregivers.length}`);

  // Elders not yet in the registry are new this run.
  const existingElderIds: Id[] = [];
  const newElderIdx: number[] = [];
  for (let i = 1; i <= COUNTS.elders; i += 1) {
    const id = await lookup(`elder:${pad(i)}`);
    if (id) existingElderIds.push(id);
    else newElderIdx.push(i);
  }
  const { circles, leftover } = await planCircles(newElderIdx, family, existingElderIds);
  if (newElderIdx.some((i) => circles.get(i)!.some((u) => !u))) throw new Error("Not enough free family members for the new elders.");

  for (const i of newElderIdx) {
    const r = rngFor(`relationships:${i}`);
    const members = circles.get(i)!.map((user) => ({ user, relationship: pick(r, RELATIONSHIPS) }));
    const elder = await createElder(i, members);
    await createActivity(elder, i, services, caregivers, admins);
    console.log(`  elder ${pad(i)} ${elder.name}: circle of ${members.length}`);
  }

  // Family members added in a scale-up with no new elder for them join an existing circle.
  for (const user of leftover) {
    const counts = await CareCircleMemberModel.aggregate<{ _id: Id; n: number }>([{ $match: { elderId: { $in: existingElderIds } } }, { $group: { _id: "$elderId", n: { $sum: 1 } } }, { $match: { n: { $lt: 3 } } }]);
    const target = counts[0];
    if (!target) break;
    const at = addMin(NOW, -int(rngFor(String(user.id)), 60, 60 * 24 * 5));
    await insert(CareCircleMemberModel, { elderId: target._id, userId: user.id, relationship: pick(rngFor(`rel:${String(user.id)}`), RELATIONSHIPS), accessLevel: "viewer", invitedBy: null, acceptedAt: at, createdAt: at, updatedAt: at });
  }

  // In-app notifications (stored only; nothing is sent).
  for (const n of notificationDrafts) {
    const read = n.at.getTime() < NOW.getTime() - 2 * DAY;
    await insert(NotificationModel, { userId: n.userId, templateKey: n.templateKey, category: n.category, title: n.title, body: n.body, smsBody: n.body.slice(0, 150), data: { ...n.data, seed: true }, priority: "normal", channels: ["in_app"], readAt: read ? addMin(n.at, 30) : null, dedupeKey: `seed:${n.templateKey}:${String(n.userId)}:${n.at.getTime()}`, createdAt: n.at, updatedAt: n.at });
  }

  // Auditor and admins reviewing the trail.
  const reviewR = rngFor("audit-reviews");
  for (const a of [...auditors, ...admins].filter((u) => u.created)) {
    for (let k = 0; k < 3; k += 1) {
      audit({ occurredAt: addMin(eatAt(-int(reviewR, 0, 14), int(reviewR, 9, 17)), int(reviewR, 0, 59)), action: "privacy.accesslog.viewed", actorId: String(a.id), actorRole: a.role, subject: { userId: String(pick(reviewR, family).id) }, statusCode: 200 });
    }
  }

  // Seal the audit trail in time order so it reads like it happened.
  let sealed = 0;
  if (WITH_AUDIT && auditDrafts.length) {
    auditDrafts.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    for (const d of auditDrafts) {
      // Progress for big runs: each entry is sealed one after another.
      if (sealed > 0 && sealed % 200 === 0) console.log(`  audit entries sealed: ${sealed}/${auditDrafts.length}`);
      await auditService.record({ type: "audit.recorded", action: d.action, actorId: d.actorId, actorRole: d.actorRole, subject: d.subject, ...targetOf(d.subject), outcome: "success", statusCode: d.statusCode ?? 200, occurredAt: d.occurredAt.toISOString(), seed: true });
      sealed += 1;
    }
  }

  const all = [...admins, ...auditors, ...family, ...caregiverUsers];
  console.table(all.map((u) => ({ role: u.role, name: u.name, phone: u.phone, email: u.email ?? "-", new: u.created ? "yes" : "" })));
  console.table([{ ...stats, notifications: notificationDrafts.length, auditEntries: sealed }]);
  console.log(production ? "Password: the SEED_PASSWORD you set." : `Password for every seeded account: ${password}`);
  await disconnectDatabase();
}

// ---------------------------------------------------------------------------
// Cleanup: remove everything the registry lists, plus what the app built on top of it.
// ---------------------------------------------------------------------------
async function cleanup() {
  if (env.NODE_ENV === "production" && !flag("yes-production")) {
    console.error("This is the production database. Re-run with --yes-production to clean it.");
    process.exit(1);
  }
  await connectDatabase();
  const db = mongoose.connection;
  const rows = await registry().find({}).toArray();
  const ids = (collection: string) => rows.filter((r) => r.collection === collection).map((r) => r.refId);
  const users = ids("users");
  const elders = ids("elders");
  const bookings = ids("bookings");
  const caregivers = ids("caregivers");
  const visitIds = (await db.collection("visits").find({ $or: [{ elderId: { $in: elders } }, { caregiverId: { $in: caregivers } }] }, { projection: { _id: 1 } }).toArray()).map((v) => v._id);
  const emergencies = (await db.collection("emergencies").find({ elderId: { $in: elders } }, { projection: { _id: 1 } }).toArray()).map((e) => e._id);

  const sweeps: Array<[string, Record<string, unknown>]> = [
    ["notifications", { userId: { $in: users } }],
    ["delivery_attempts", { userId: { $in: users } }],
    ["notification_preferences", { userId: { $in: users } }],
    ["device_tokens", { userId: { $in: users } }],
    ["otp_codes", { userId: { $in: users } }],
    ["care_circle_members", { $or: [{ elderId: { $in: elders } }, { userId: { $in: users } }] }],
    ["care_plans", { elderId: { $in: elders } }],
    ["emergency_contacts", { elderId: { $in: elders } }],
    ["escalation_steps", { emergencyId: { $in: emergencies } }],
    ["emergencies", { _id: { $in: emergencies } }],
    ["assignment_offers", { $or: [{ bookingId: { $in: bookings } }, { caregiverId: { $in: caregivers } }] }],
    ["location_pings", { visitId: { $in: visitIds } }],
    ["visit_reports", { visitId: { $in: visitIds } }],
    ["visits", { _id: { $in: visitIds } }],
    ["recurrence_rules", { elderId: { $in: elders } }],
    ["bookings", { $or: [{ elderId: { $in: elders } }, { caregiverId: { $in: caregivers } }] }],
    ["caregiver_availability", { caregiverId: { $in: caregivers } }],
    ["kyc_documents", { caregiverId: { $in: caregivers } }],
    ["caregiver_visits", { caregiverId: { $in: caregivers } }],
  ];
  const removed: Record<string, number> = {};
  for (const [name, filter] of sweeps) removed[name] = (await db.collection(name).deleteMany(filter)).deletedCount;
  // Whatever else the registry lists (users, elders, caregivers, catalog it had to create).
  for (const collection of [...new Set(rows.map((r) => r.collection))]) {
    const res = await db.collection(collection).deleteMany({ _id: { $in: ids(collection) } });
    removed[collection] = (removed[collection] ?? 0) + res.deletedCount;
  }
  await registry().deleteMany({});
  console.table(Object.entries(removed).filter(([, n]) => n > 0).map(([collection, n]) => ({ collection, removed: n })));
  console.log("Audit-trail entries are append-only by design and were left in place (marked seed: true).");
  await disconnectDatabase();
}

(flag("cleanup") ? cleanup() : seed()).then(
  () => process.exit(0),
  async (err) => {
    console.error("seed-population failed:", err);
    await disconnectDatabase().catch(() => undefined);
    process.exit(1);
  },
);
