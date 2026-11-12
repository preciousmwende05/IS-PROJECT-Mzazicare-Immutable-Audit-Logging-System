import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, FileUp, Pencil, RotateCcw, Send, Trash2 } from "lucide-react";

import { Badge, Banner, ErrorBox, Field, PageHead, useAsync } from "@/components/ui";
import { ApiError, api, errorText } from "@/lib/api";
import {
  CAREGIVER_STATUS,
  DOC_TONE,
  DOC_TYPES,
  KYC_ACCEPT,
  KYC_MAX_BYTES,
  docLabel,
  splitTags,
} from "@/lib/caregivers";
import { fmtDate, kes } from "@/lib/format";
import { COUNTIES } from "@/lib/kenya";
import type { CaregiverProfile as Profile, CaregiverStatus, KycDocType, UploadUrl } from "@/lib/types";

// Mirrors caregiver-service: the API enforces these too, the UI only hides what would be refused.
const EDIT_ALLOWED: CaregiverStatus[] = ["draft", "approved"];
const UPLOAD_ALLOWED: CaregiverStatus[] = ["draft", "more_info", "expired", "approved"];
const SUBMIT_FROM: CaregiverStatus[] = ["draft", "more_info", "expired"];

/**
 * Caregiver onboarding: build a profile, upload KYC documents, submit for
 * review, and follow the decision. A coordinator or admin approves it on the
 * Caregivers page; only then can the caregiver be assigned to visits.
 */
export default function CaregiverProfile() {
  const mine = useAsync(async () => {
    try {
      return await api.get<Profile>("/caregivers/me");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null; // no profile yet
      throw e;
    }
  });
  const [editing, setEditing] = useState(false);
  const p = mine.data;

  if (mine.loading && p === null && !mine.error) return <div className="loading">Loading your profile…</div>;

  return (
    <>
      <PageHead
        crumb="Accounts & access"
        title="My caregiver profile"
        sub="Families only see approved caregivers. Complete your profile, upload your documents and submit them for review."
        actions={p && <Badge tone={CAREGIVER_STATUS[p.status].tone}>{CAREGIVER_STATUS[p.status].label}</Badge>}
      />
      <ErrorBox error={mine.error} />

      {!mine.error && !p && (
        <ProfileForm
          onSaved={(saved) => mine.setData(saved)}
          intro="Step 1 of 3. Tell families about your experience. You can add documents next."
        />
      )}

      {p && (
        <div className="stack">
          <StatusBanner p={p} onChanged={(next) => mine.setData(next)} />
          {editing ? (
            <ProfileForm existing={p} onSaved={(saved) => { mine.setData(saved); setEditing(false); }} onCancel={() => setEditing(false)} />
          ) : (
            <ProfileSummary p={p} onEdit={EDIT_ALLOWED.includes(p.status) ? () => setEditing(true) : undefined} />
          )}
          <Documents p={p} onChanged={() => void mine.reload()} />
          {SUBMIT_FROM.includes(p.status) && <SubmitCard p={p} onSubmitted={(next) => mine.setData(next)} />}
        </div>
      )}
    </>
  );
}

/* ------------------------------ status ------------------------------ */

function StatusBanner({ p, onChanged }: { p: Profile; onChanged: (p: Profile) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canReapply = p.status === "rejected" && p.canReapplyAt && new Date(p.canReapplyAt) <= new Date();

  const reapply = async () => {
    setBusy(true);
    setErr(null);
    try {
      onChanged(await api.post<Profile>("/caregivers/me/re-apply"));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  switch (p.status) {
    case "draft":
      return <Banner tone="info" title="Your application is a draft">Upload your national ID and certificate of good conduct, then submit for review.</Banner>;
    case "submitted":
      return <Banner tone="info" title="Submitted for review">A coordinator will check your documents. You'll get a notification when there is a decision.</Banner>;
    case "under_review":
      return <Banner tone="info" title="Under review">A coordinator is checking your documents now.</Banner>;
    case "more_info":
      return <Banner tone="warn" title="The reviewer needs more information">{p.infoRequest ?? "Please update your documents."} Upload what was asked for, then submit again below.</Banner>;
    case "approved":
      return (
        <Banner tone="success" title="Approved: you can be assigned to visits">
          See your assignments in <Link className="link" to="/visits">My visits</Link>. Keep your good conduct certificate up to date; when it expires your approval lapses.
        </Banner>
      );
    case "rejected":
      return (
        <div>
          <Banner tone="error" title="Your application was not approved">
            {p.rejectionReason ?? "No reason was given."}{" "}
            {p.canReapplyAt && !canReapply && `You can apply again from ${fmtDate(p.canReapplyAt)}.`}
          </Banner>
          {canReapply && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-gold" disabled={busy} onClick={reapply}><RotateCcw size={16} /> Start a new application</button>
              <span className="muted small">Your old documents will be removed.</span>
            </div>
          )}
          {err && <div style={{ marginTop: 12 }}><Banner tone="error" title={err} /></div>}
        </div>
      );
    case "suspended":
      return <Banner tone="error" title="Your account is suspended">{p.suspendedReason ?? "Contact MzaziCare support."} You won't receive new visits until an admin reinstates you.</Banner>;
    case "expired":
      return <Banner tone="warn" title="A required document has expired">Upload a current certificate of good conduct, then submit again.</Banner>;
  }
}

/* ------------------------------ profile ------------------------------ */

function ProfileSummary({ p, onEdit }: { p: Profile; onEdit?: () => void }) {
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Profile</h2><div className="card-sub">What families and coordinators see about you</div></div>
        {onEdit && <button className="btn btn-line" onClick={onEdit}><Pencil size={16} /> Edit</button>}
      </div>
      <p style={{ marginBottom: 16 }}>{p.bio}</p>
      <div className="grid g3">
        <div className="kv"><span className="k">Experience</span><span className="v">{p.yearsExperience} {p.yearsExperience === 1 ? "year" : "years"}</span></div>
        <div className="kv"><span className="k">Hourly rate</span><span className="v">{kes(p.hourlyRateCents)}</span></div>
        <div className="kv"><span className="k">Service areas</span><span className="v">{p.serviceAreas.join(", ")}</span></div>
      </div>
      <div className="pill-list" style={{ marginTop: 14 }}>
        {p.skills.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}
      </div>
      {!onEdit && <p className="muted small" style={{ marginTop: 12 }}>The profile is locked while your application is being reviewed.</p>}
    </div>
  );
}

const countyFor = (coords?: number[]) =>
  COUNTIES.find((c) => coords && c.longitude === coords[0] && c.latitude === coords[1])?.name ?? COUNTIES[0]!.name;

function ProfileForm({ existing, onSaved, onCancel, intro }: { existing?: Profile; onSaved: (p: Profile) => void; onCancel?: () => void; intro?: string }) {
  const [bio, setBio] = useState(existing?.bio ?? "");
  const [skills, setSkills] = useState(existing?.skills.join(", ") ?? "");
  const [years, setYears] = useState(String(existing?.yearsExperience ?? ""));
  const [county, setCounty] = useState(countyFor(existing?.baseLocation.coordinates));
  const [areas, setAreas] = useState(existing?.serviceAreas.join(", ") ?? COUNTIES[0]!.name.toLowerCase());
  const [rate, setRate] = useState(existing ? String(existing.hourlyRateCents / 100) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickCounty = (name: string) => {
    // Keep the service areas in step with the county until the caregiver types their own.
    if (splitTags(areas).join(",") === county.toLowerCase()) setAreas(name.toLowerCase());
    setCounty(name);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = COUNTIES.find((x) => x.name === county)!;
    const body = {
      bio: bio.trim(),
      skills: splitTags(skills),
      yearsExperience: Number(years),
      serviceAreas: splitTags(areas),
      baseLocation: { coordinates: [c.longitude, c.latitude] },
      hourlyRateCents: Math.round(Number(rate) * 100),
    };
    if (!body.skills.length) return setErr("Add at least one skill.");
    if (!body.serviceAreas.length) return setErr("Add at least one service area.");
    setBusy(true);
    setErr(null);
    try {
      onSaved(existing ? await api.patch<Profile>("/caregivers/me", body) : await api.post<Profile>("/caregivers", body));
    } catch (e2) {
      setErr(errorText(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-head">
        <div><h2>{existing ? "Edit profile" : "Create your profile"}</h2><div className="card-sub">{intro ?? "Fields marked * are required."}</div></div>
      </div>
      {err && <div style={{ marginBottom: 14 }}><Banner tone="error" title={err} /></div>}
      <Field label="About you *" hint="At least 10 characters. Your experience and how you care for elders.">
        <textarea className="control" value={bio} onChange={(e) => setBio(e.target.value)} minLength={10} maxLength={1000} required placeholder="e.g. Registered nurse with six years of home-based elder care in Nairobi." />
      </Field>
      <Field label="Skills *" hint="Separate with commas, e.g. elder care, medication reminders, mobility support">
        <input className="control" value={skills} onChange={(e) => setSkills(e.target.value)} required />
      </Field>
      <div className="grid g3" style={{ gap: 16 }}>
        <Field label="Years of experience *">
          <input className="control" type="number" min={0} max={60} value={years} onChange={(e) => setYears(e.target.value)} required />
        </Field>
        <Field label="Hourly rate (KES) *">
          <input className="control" type="number" min={0} step={50} value={rate} onChange={(e) => setRate(e.target.value)} required />
        </Field>
        <Field label="Home county *" hint="Used to plan travel to visits">
          <select className="control" value={county} onChange={(e) => pickCounty(e.target.value)}>
            {COUNTIES.map((c) => <option key={c.name}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Areas you serve *" hint="Separate with commas, e.g. nairobi, kiambu">
        <input className="control" value={areas} onChange={(e) => setAreas(e.target.value)} required />
      </Field>
      <div className="row">
        {onCancel && <button type="button" className="btn btn-line" onClick={onCancel}>Cancel</button>}
        <span className="spacer" />
        <button className="btn btn-gold" disabled={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Create profile"}</button>
      </div>
    </form>
  );
}

/* ------------------------------ documents ------------------------------ */

/**
 * Files go straight to storage (RustFS), never through the API:
 *   1. ask the API for a presigned upload URL,
 *   2. PUT the file to that URL,
 *   3. register the document with the API, which checks its size and type.
 */
async function uploadKyc(file: File, type: KycDocType, issuedAt: string, expiresAt: string) {
  const up = await api.post<UploadUrl>("/caregivers/me/documents/upload-url", { filename: file.name, contentType: file.type });
  let put: Response;
  try {
    put = await fetch(up.url, { method: up.method, headers: up.headers, body: file });
  } catch {
    throw new Error("Could not reach file storage. Check that the storage service (RustFS, port 9000) is running.");
  }
  if (!put.ok) throw new Error(`File storage refused the upload (${put.status}). Try again.`);
  await api.post("/caregivers/me/documents", {
    type,
    key: up.key,
    ...(issuedAt ? { issuedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  });
}

function Documents({ p, onChanged }: { p: Profile; onChanged: () => void }) {
  const canUpload = UPLOAD_ALLOWED.includes(p.status);
  const [type, setType] = useState<KycDocType>(() => DOC_TYPES.find((d) => d.required && !p.documents.some((x) => x.type === d.id))?.id ?? "national_id");
  const [file, setFile] = useState<File | null>(null);
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [inputKey, setInputKey] = useState(0); // remounts the file input to clear it
  const today = new Date().toISOString().slice(0, 10);

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    if (file.size > KYC_MAX_BYTES) return setMsg({ tone: "error", text: "That file is larger than 5 MB." });
    if (type === "good_conduct" && !expiresAt) return setMsg({ tone: "error", text: "Enter the certificate's expiry date." });
    setBusy(true);
    setMsg(null);
    try {
      await uploadKyc(file, type, issuedAt, expiresAt);
      setMsg({ tone: "success", text: `${docLabel(type)} uploaded.` });
      setFile(null);
      setIssuedAt("");
      setExpiresAt("");
      setInputKey((k) => k + 1);
      onChanged();
    } catch (e2) {
      setMsg({ tone: "error", text: errorText(e2) });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, label: string) => {
    if (!confirm(`Remove ${label}?`)) return;
    try {
      await api.del(`/caregivers/me/documents/${id}`);
      onChanged();
    } catch (e2) {
      setMsg({ tone: "error", text: errorText(e2) });
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Documents</h2><div className="card-sub">PDF, JPEG or PNG, up to 5 MB each. Only coordinators and admins can open them, and every view is audited.</div></div>
      </div>

      {p.documents.length === 0 ? (
        <div className="empty">No documents yet.</div>
      ) : (
        <table className="table" style={{ marginBottom: 18 }}>
          <thead><tr><th>Document</th><th>File</th><th>Expires</th><th>Status</th><th /></tr></thead>
          <tbody>
            {p.documents.map((d) => (
              <tr key={d.id}>
                <td><b>{docLabel(d.type)}</b></td>
                <td className="muted small">{d.originalName}</td>
                <td>{d.expiresAt ? fmtDate(d.expiresAt) : "—"}</td>
                <td>
                  <Badge tone={DOC_TONE[d.status]}>{d.status === "pending" ? "Awaiting check" : d.status === "verified" ? "Verified" : "Rejected"}</Badge>
                  {d.reviewNote && <div className="muted small" style={{ marginTop: 4 }}>{d.reviewNote}</div>}
                </td>
                <td>{p.status === "draft" && <button className="link link-red" onClick={() => remove(d.id, docLabel(d.type))}><Trash2 size={14} /> Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canUpload ? (
        <form onSubmit={upload}>
          <div className="hr" />
          <h3 style={{ marginBottom: 12 }}>Add a document</h3>
          {msg && <div style={{ marginBottom: 12 }}><Banner tone={msg.tone} title={msg.text} /></div>}
          <div className="grid g2" style={{ gap: 16 }}>
            <Field label="Type *" hint={DOC_TYPES.find((d) => d.id === type)?.hint}>
              <select className="control" value={type} onChange={(e) => setType(e.target.value as KycDocType)}>
                {DOC_TYPES.map((d) => <option key={d.id} value={d.id}>{d.label}{d.required ? " (required)" : ""}</option>)}
              </select>
            </Field>
            <Field label="File *">
              <input key={inputKey} className="control" type="file" accept={KYC_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
            </Field>
            <Field label="Issued on">
              <input className="control" type="date" max={today} value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </Field>
            <Field label={type === "good_conduct" ? "Expires on *" : "Expires on"}>
              <input className="control" type="date" min={today} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} required={type === "good_conduct"} />
            </Field>
          </div>
          <div className="row">
            <span className="spacer" />
            <button className="btn btn-navy" disabled={busy || !file}><FileUp size={16} /> {busy ? "Uploading…" : "Upload"}</button>
          </div>
        </form>
      ) : (
        <p className="muted small">Documents can't be changed while your application is {CAREGIVER_STATUS[p.status].label.toLowerCase()}.</p>
      )}
    </div>
  );
}

/* ------------------------------ submit ------------------------------ */

function SubmitCard({ p, onSubmitted }: { p: Profile; onSubmitted: (p: Profile) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const now = new Date();
  const has = (type: KycDocType) =>
    p.documents.some((d) => d.type === type && d.status !== "rejected" && (!d.expiresAt || new Date(d.expiresAt) > now));
  const required = DOC_TYPES.filter((d) => d.required);
  const ready = required.every((d) => has(d.id));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      onSubmitted(await api.post<Profile>("/caregivers/me/submit"));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div><h2>{p.status === "draft" ? "Submit for review" : "Submit again"}</h2><div className="card-sub">A coordinator checks every document before you can be assigned to a family.</div></div>
      </div>
      {required.map((d) => (
        <div className="row" key={d.id} style={{ marginBottom: 10 }}>
          {has(d.id) ? <CheckCircle2 size={18} color="#2f7a4b" /> : <Circle size={18} color="#9aa3ad" />}
          <span className="small">{d.label}</span>
        </div>
      ))}
      {err && <div style={{ margin: "12px 0" }}><Banner tone="error" title={err} /></div>}
      <div className="row" style={{ marginTop: 6 }}>
        <span className="muted small">{ready ? "Everything required is uploaded." : "Upload the required documents first."}</span>
        <span className="spacer" />
        <button className="btn btn-gold" disabled={busy || !ready} onClick={submit}><Send size={16} /> {busy ? "Submitting…" : "Submit for review"}</button>
      </div>
    </div>
  );
}
