import type { CaregiverStatus, KycDocType } from "@/lib/types";

/** How each application status reads in the UI, and its badge colour. */
export const CAREGIVER_STATUS: Record<CaregiverStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "" },
  submitted: { label: "Submitted", tone: "gold" },
  under_review: { label: "Under review", tone: "blue" },
  more_info: { label: "More info needed", tone: "gold" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
  suspended: { label: "Suspended", tone: "red" },
  expired: { label: "Documents expired", tone: "red" },
};

export const DOC_TYPES: { id: KycDocType; label: string; hint: string; required: boolean }[] = [
  { id: "national_id", label: "National ID", hint: "Both sides, or your passport", required: true },
  { id: "good_conduct", label: "Certificate of good conduct", hint: "From the DCI. Needs its expiry date", required: true },
  { id: "certificate", label: "Professional certificate", hint: "Nursing, caregiving or first aid", required: false },
  { id: "reference", label: "Reference letter", hint: "From a previous employer", required: false },
];

export const docLabel = (type: string) => DOC_TYPES.find((d) => d.id === type)?.label ?? type;

export const DOC_TONE: Record<string, string> = { pending: "gold", verified: "green", rejected: "red" };

/** Files the API accepts (it checks again after upload). */
export const KYC_ACCEPT = "application/pdf,image/jpeg,image/png";
export const KYC_MAX_BYTES = 5 * 1024 * 1024;

/** "elder care, first aid" -> ["elder care", "first aid"] */
export const splitTags = (text: string) =>
  [...new Set(text.split(",").map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 2))];
