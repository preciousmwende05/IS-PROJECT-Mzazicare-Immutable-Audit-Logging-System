/** Display helpers. All times are shown in East Africa Time (Africa/Nairobi). */

const TZ = "Africa/Nairobi";

export const initials = (name?: string | null): string =>
  (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

export const shortId = (id?: string | null, prefix = ""): string => (id ? `${prefix}${id.slice(-5).toUpperCase()}` : "—");

export const fmtDate = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) : "—";

export const fmtTime = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }) : "—";

export const fmtDateTime = (iso?: string | null): string => (iso ? `${fmtDate(iso)}, ${fmtTime(iso)}` : "—");

/** "Today, 14:00" / "Tomorrow, 09:30" / "Fri 6 Nov, 11:00". */
export const fmtWhen = (iso?: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: TZ });
  const today = new Date();
  const tomorrow = new Date(Date.now() + 864e5);
  if (day(d) === day(today)) return `Today, ${fmtTime(iso)}`;
  if (day(d) === day(tomorrow)) return `Tomorrow, ${fmtTime(iso)}`;
  return `${d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short", timeZone: TZ })}, ${fmtTime(iso)}`;
};

export const ageFrom = (dob?: string | null): number | null => {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age -= 1;
  return age;
};

export const kes = (cents?: number | null): string =>
  cents == null ? "—" : `KES ${(cents / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export const durationLabel = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} hour${h > 1 ? "s" : ""}` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
};

/**
 * The backend booking lifecycle has more states than the design shows.
 * The design's four: requested → assigned → completed / cancelled.
 */
export type VisitStage = "requested" | "assigned" | "in_progress" | "completed" | "cancelled";

export const stageOf = (status: string): VisitStage => {
  if (["requested", "matching", "offered", "unassigned"].includes(status)) return "requested";
  if (status === "confirmed") return "assigned";
  if (status === "in_progress") return "in_progress";
  if (status === "completed") return "completed";
  return "cancelled"; // cancelled, no_show
};

export const STAGE_LABEL: Record<VisitStage, string> = {
  requested: "Requested",
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STAGE_BADGE: Record<VisitStage, string> = {
  requested: "gold",
  assigned: "blue",
  in_progress: "blue",
  completed: "green",
  cancelled: "",
};

export const titleCase = (s?: string | null): string =>
  (s ?? "").replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
