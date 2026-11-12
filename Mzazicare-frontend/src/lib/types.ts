/** Shapes returned by the MzaziCare API (the backend's views/*.view.ts). */

export type Elder = {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  age: number;
  gender: "male" | "female" | "other";
  homeLocation: { latitude: number; longitude: number };
  address: { estate?: string | null; street?: string | null; landmark?: string | null; county: string };
  status: "active" | "inactive" | "deceased";
  createdAt?: string;
};

export type Medication = { name: string; dosage?: string; schedule?: string };

export type CarePlan = {
  id: string;
  elderId: string;
  version: number;
  conditions: string[];
  medications: Medication[];
  allergies: string[];
  mobility: "independent" | "walker" | "wheelchair" | "bedbound";
  dietary: string[];
  careNotes: string;
  updatedBy?: string;
  createdAt: string;
};

export type EmergencyContact = { id: string; elderId: string; name: string; phone: string; relationship?: string | null; priority: number };

export type CircleMember = {
  id: string;
  elderId: string;
  userId: string;
  relationship: string | null;
  accessLevel: "owner" | "editor" | "viewer";
  invitedBy: string;
  acceptedAt: string | null;
};

export type CareService = {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  description: string;
  basePriceCents: number;
  pricingUnit: "per_hour" | "per_visit" | "per_day";
  minimumDurationMinutes: number;
  requiredSkills: string[];
};

export type Booking = {
  id: string;
  elderId: string;
  serviceId: string;
  caregiverId: string | null;
  requestedBy: string;
  status: string;
  scheduledFor: string;
  endsAt: string;
  durationMinutes: number;
  priceCentsAtBooking: number;
  notes: string | null;
  cancellation: { by: string | null; reason: string | null; at: string | null } | null;
  visitId: string | null;
  confirmedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type Visit = {
  id: string;
  bookingId: string;
  status: string;
  scheduledFor: string;
  checkedInAt: string | null;
  checkedOutAt?: string | null;
};

export type CaregiverStatus = "draft" | "submitted" | "under_review" | "more_info" | "approved" | "rejected" | "suspended" | "expired";
export type KycDocType = "national_id" | "certificate" | "good_conduct" | "reference";

export type KycDocument = {
  id: string;
  type: KycDocType;
  status: "pending" | "verified" | "rejected";
  originalName: string;
  issuedAt: string | null;
  expiresAt: string | null;
  reviewNote: string | null;
  uploadedAt: string | null;
};

/** The caregiver's own profile (GET /caregivers/me). */
export type CaregiverProfile = {
  id: string;
  bio: string;
  skills: string[];
  yearsExperience: number;
  serviceAreas: string[];
  hourlyRateCents: number;
  status: CaregiverStatus;
  baseLocation: { coordinates: number[] };
  rejectionReason: string | null;
  suspendedReason: string | null;
  infoRequest: string | null;
  canReapplyAt: string | null;
  documents: KycDocument[];
};

/** Coordinator / admin view of an application (GET /caregivers, /caregivers/:id). */
export type Caregiver = CaregiverProfile & {
  userId: string;
  fullName?: string | null;
  name?: string;
  reviewerId: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  noShowCount: number;
  flaggedForReview: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type UploadUrl = { key: string; url: string; method: "PUT"; headers: Record<string, string>; maxBytes: number; expiresInSeconds: number };

export type CareLog = {
  id: string;
  visitId: string;
  bookingId: string;
  elderId: string;
  caregiverId: string;
  notes: string;
  bloodPressure: { systolic: number; diastolic: number } | null;
  mood: string | null;
  meals: string | null;
  submittedAt: string;
  acknowledgedAt: string | null;
};

// ---------- Consent & Data Rights (/v1/privacy) ----------

export type ConsentState = {
  purpose: "careplan_sharing";
  status: "granted" | "withdrawn" | "not_recorded";
  granted: boolean;
  lastChangedAt: string | null;
  lastChangedBy: string | null;
  recordedAs: string | null;
  history: { granted: boolean; at: string; by: string | null; recordedAs: string; note: string | null }[];
};

export type AccessEntry = {
  sequence: number;
  at: string;
  actorName: string;
  actorRole: string;
  action: string;
  label: string;
  outcome: "success" | "refused";
  reason: string | null;
};

export type DataRequestRow = {
  id: string;
  reference: string;
  elderId: string;
  elderLabel: string;
  type: "export" | "deletion";
  status: "requested" | "reviewed" | "completed" | "refused";
  reason: string | null;
  requestedBy: string | null;
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decision: string | null;
  decisionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  completedAt: string | null;
  respondBy: string;
};

export type DataRequestDetail = DataRequestRow & {
  checks: { requesterVerified: boolean; requesterStillInCircle: boolean; upcomingVisits: number; careplanSharing: string };
};

export type Notification = {
  id: string;
  category: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  data: Record<string, unknown>;
};

export type AuditEntry = {
  id: string;
  sequence: number;
  action: string;
  actorId: string | null;
  actorRole: string | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  hash: string;
};

export type ChainCheck = {
  intact: boolean;
  checkedEntries: number;
  lastSequence?: number;
  lastHash?: string;
  brokenAtSequence?: number;
  reason?: string;
};

/** The automatic integrity check (every 30 minutes). */
export type ScheduledVerification = {
  at: string;
  intact: boolean;
  checkedEntries: number | null;
  brokenAtSequence: number | null;
  reason: string | null;
};

export type AnomalyAlert = {
  id: string;
  reference: string;
  source: "policy" | "iforest" | "chain";
  kind: string;
  actorId: string | null;
  actorName: string;
  actorRole: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  score: number | null;
  summary: string;
  reasons: string[];
  status: "open" | "resolved";
  createdAt: string | null;
  notifiedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
};
