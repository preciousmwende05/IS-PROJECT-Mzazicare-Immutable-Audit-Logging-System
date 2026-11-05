/**
 * Consent & Data Rights — the shapes the API returns.
 */

import type { ConsentRecord, DataRequest } from "@/modules/consent-service/models/consent.model";

type Names = Map<string, { name: string; role: string }>;

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const nameOf = (names: Names, id: unknown) => (id ? names.get(String(id))?.name ?? "Unknown user" : null);

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export type ConsentView = {
  purpose: "careplan_sharing";
  /** not_recorded: no answer yet. Sharing continues until someone says no. */
  status: "granted" | "withdrawn" | "not_recorded";
  granted: boolean;
  lastChangedAt: string | null;
  lastChangedBy: string | null;
  recordedAs: string | null;
  history: { granted: boolean; at: string; by: string | null; recordedAs: string; note: string | null }[];
};

export const serializeConsent = (history: ConsentRecord[], names: Names): ConsentView => {
  const latest = history[0];
  return {
    purpose: "careplan_sharing",
    status: !latest ? "not_recorded" : latest.granted ? "granted" : "withdrawn",
    granted: latest ? latest.granted : true,
    lastChangedAt: iso(latest?.createdAt),
    lastChangedBy: latest ? nameOf(names, latest.recordedBy) : null,
    recordedAs: latest?.recordedAs ?? null,
    history: history.map((r) => ({
      granted: r.granted,
      at: iso(r.createdAt)!,
      by: nameOf(names, r.recordedBy),
      recordedAs: r.recordedAs,
      note: r.note ?? null,
    })),
  };
};

// ---------------------------------------------------------------------------
// Access log ("who accessed my data")
// ---------------------------------------------------------------------------

/** Plain-language names for audit actions, as a family reads them. */
export const ACTION_LABELS: Record<string, string> = {
  "elder.created": "Created the elder record",
  "elder.updated": "Updated the profile",
  "elder.viewed": "Viewed the profile",
  "elder.brief.viewed": "Viewed the visit brief",
  "careplan.viewed": "Viewed the care plan",
  "careplan.updated": "Updated the care plan",
  "careplan.history.viewed": "Viewed care plan history",
  "emergencycontacts.viewed": "Viewed emergency contacts",
  "emergencycontact.added": "Added an emergency contact",
  "carecircle.viewed": "Viewed the care circle",
  "carecircle.member.invited": "Invited someone to the care circle",
  "carecircle.member.added": "Joined the care circle",
  "carecircle.member.updated": "Changed someone's care-circle access",
  "carecircle.member.removed": "Removed someone from the care circle",
  "visit.requested": "Requested a visit",
  "carelog.created": "Wrote a care log",
  "carelog.viewed": "Read the care log",
  "consent.granted": "Gave consent to share the care plan",
  "consent.withdrawn": "Withdrew consent to share the care plan",
  "privacy.accesslog.viewed": "Viewed this access history",
  "datarequest.submitted": "Requested a data download or deletion",
  "datarequest.completed": "A data request was completed",
  "datarequest.reviewed": "A deletion request was reviewed",
  "datarequest.refused": "A deletion request was refused",
  "access.denied": "Tried to access, and was refused",
};

export type AccessLogEntryView = {
  sequence: number;
  at: string;
  actorName: string;
  actorRole: string;
  action: string;
  label: string;
  outcome: "success" | "refused";
  reason: string | null;
};

type AuditLike = {
  sequence: number;
  occurredAt: Date | string;
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  metadata?: unknown;
};

export const serializeAccessEntry = (e: AuditLike, names: Names): AccessLogEntryView => {
  const meta = (e.metadata ?? {}) as { outcome?: string; subject?: { reason?: string } };
  const refused = e.action === "access.denied" || meta.outcome === "failure";
  return {
    sequence: e.sequence,
    at: iso(e.occurredAt)!,
    actorName: e.actorId ? names.get(String(e.actorId))?.name ?? "Unknown user" : "System",
    actorRole: e.actorRole ?? names.get(String(e.actorId))?.role ?? "unknown",
    action: e.action,
    label: ACTION_LABELS[e.action] ?? e.action,
    outcome: refused ? "refused" : "success",
    reason: meta.subject?.reason ?? null,
  };
};

// ---------------------------------------------------------------------------
// Data requests
// ---------------------------------------------------------------------------

export type DataRequestView = {
  id: string;
  reference: string;
  elderId: string;
  elderLabel: string;
  type: string;
  status: string;
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
  /** 30 days after the request, the response deadline. */
  respondBy: string;
};

export const serializeDataRequest = (r: DataRequest, names: Names): DataRequestView => ({
  id: String(r._id),
  reference: `DR-${String(r._id).slice(-5).toUpperCase()}`,
  elderId: String(r.elderId),
  elderLabel: r.elderLabel,
  type: r.type,
  status: r.status,
  reason: r.reason ?? null,
  requestedBy: nameOf(names, r.requestedBy),
  requestedAt: iso(r.createdAt)!,
  reviewedBy: nameOf(names, r.reviewedBy),
  reviewedAt: iso(r.reviewedAt),
  decision: r.decision ?? null,
  decisionReason: r.decisionReason ?? null,
  decidedBy: nameOf(names, r.decidedBy),
  decidedAt: iso(r.decidedAt),
  completedAt: iso(r.completedAt),
  respondBy: new Date(new Date(r.createdAt).getTime() + 30 * 864e5).toISOString(),
});

/** Every user id a set of requests mentions (to fetch display names once). */
export const requestUserIds = (rows: DataRequest[]): string[] =>
  rows.flatMap((r) => [r.requestedBy, r.reviewedBy, r.decidedBy].filter(Boolean).map(String));
