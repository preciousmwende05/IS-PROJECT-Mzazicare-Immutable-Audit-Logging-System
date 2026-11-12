import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, BadgeCheck, ExternalLink, MessageCircleQuestion, Play, ShieldCheck, ShieldOff, XCircle } from "lucide-react";

import { Avatar, Badge, Banner, ErrorBox, Field, PageHead, useAsync } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CAREGIVER_STATUS, DOC_TONE, DOC_TYPES, docLabel } from "@/lib/caregivers";
import { fmtDate, fmtDateTime, kes } from "@/lib/format";
import type { Caregiver, KycDocument } from "@/lib/types";

type Msg = { tone: "success" | "error"; text: string } | null;
type Decision = "reject" | "more_info" | "suspend" | null;

/**
 * One caregiver application (coordinator and admin).
 *
 *   submitted     -> Start review
 *   under_review  -> open each document, mark it verified or rejected, then
 *                    Approve, Ask for more information, or Reject
 *   approved      -> Suspend (admin)
 *   suspended     -> Reinstate (admin)
 *
 * The API enforces every rule shown here (for example: approval needs a
 * verified, unexpired national ID and good conduct certificate). Opening a
 * document and every decision are written to the audit log.
 */
export default function CaregiverReview() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const app = useAsync(() => api.get<Caregiver>(`/caregivers/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const c = app.data;
  const isAdmin = user?.role === "admin";

  /** Runs an action that returns the updated application, then shows a message. */
  const act = async (fn: () => Promise<Caregiver>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      app.setData(await fn());
      setMsg({ tone: "success", text: done });
      return true;
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (app.loading && !c) return <div className="loading">Loading application…</div>;
  if (!c) return <ErrorBox error={app.error} />;

  const status = CAREGIVER_STATUS[c.status];

  return (
    <>
      <PageHead
        crumb="Accounts & access"
        title={c.fullName ?? "Caregiver application"}
        sub="Check the documents against the original, then record a decision."
        actions={<Link className="btn btn-line" to="/caregivers"><ArrowLeft size={16} /> All applications</Link>}
      />
      {msg && <div style={{ marginBottom: 16 }}><Banner tone={msg.tone} title={msg.text} /></div>}

      <div className="stack">
        <div className="card">
          <div className="card-head">
            <div className="row">
              <Avatar name={c.fullName} size="lg" />
              <div>
                <h2>{c.fullName ?? "Unnamed caregiver"}</h2>
                <div className="card-sub">Applied {fmtDate(c.createdAt)} · last change {fmtDateTime(c.updatedAt)}</div>
              </div>
            </div>
            <div className="row">
              {c.flaggedForReview && <Badge tone="red">Flagged: {c.noShowCount} no-shows</Badge>}
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
          </div>
          <p style={{ marginBottom: 16 }}>{c.bio}</p>
          <div className="grid g3">
            <div className="kv"><span className="k">Experience</span><span className="v">{c.yearsExperience} {c.yearsExperience === 1 ? "year" : "years"}</span></div>
            <div className="kv"><span className="k">Hourly rate</span><span className="v">{kes(c.hourlyRateCents)}</span></div>
            <div className="kv"><span className="k">Service areas</span><span className="v">{c.serviceAreas.join(", ")}</span></div>
          </div>
          <div className="pill-list" style={{ marginTop: 14 }}>
            {c.skills.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}
          </div>
          <StatusNote c={c} />
        </div>

        <DocumentsReview c={c} busy={busy} act={act} />

        <DecisionCard c={c} busy={busy} act={act} isAdmin={isAdmin} />
      </div>
    </>
  );
}

function StatusNote({ c }: { c: Caregiver }) {
  if (c.status === "rejected" && c.rejectionReason)
    return <div style={{ marginTop: 14 }}><Banner tone="error" title="Rejected">{c.rejectionReason}</Banner></div>;
  if (c.status === "more_info" && c.infoRequest)
    return <div style={{ marginTop: 14 }}><Banner tone="warn" title="Waiting on the caregiver">{c.infoRequest}</Banner></div>;
  if (c.status === "suspended" && c.suspendedReason)
    return <div style={{ marginTop: 14 }}><Banner tone="error" title="Suspended">{c.suspendedReason}</Banner></div>;
  if (c.status === "approved" && c.approvedAt)
    return <div style={{ marginTop: 14 }}><Banner tone="success" title={`Approved on ${fmtDate(c.approvedAt)}`}>This caregiver can be assigned to visits.</Banner></div>;
  return null;
}

/* ------------------------------ documents ------------------------------ */

type Act = (fn: () => Promise<Caregiver>, done: string) => Promise<boolean>;

function DocumentsReview({ c, busy, act }: { c: Caregiver; busy: boolean; act: Act }) {
  const reviewing = c.status === "under_review";
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [openErr, setOpenErr] = useState<string | null>(null);

  // Open a blank tab first (inside the click, so it isn't blocked as a pop-up),
  // then point it at the short-lived signed URL. The API audits each open.
  const open = async (d: KycDocument) => {
    setOpenErr(null);
    const tab = window.open("", "_blank");
    try {
      const { url } = await api.get<{ url: string }>(`/caregivers/${c.id}/documents/${d.id}/url`);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      tab?.close();
      setOpenErr(errorText(e));
    }
  };

  const verify = (d: KycDocument) =>
    act(() => api.patch<Caregiver>(`/caregivers/${c.id}/documents/${d.id}`, { status: "verified" }), `${docLabel(d.type)} marked as verified.`);

  const reject = async (d: KycDocument) => {
    const ok = await act(
      () => api.patch<Caregiver>(`/caregivers/${c.id}/documents/${d.id}`, { status: "rejected", note: note.trim() }),
      `${docLabel(d.type)} rejected. The caregiver will see your note.`,
    );
    if (ok) {
      setRejecting(null);
      setNote("");
    }
  };

  const missing = DOC_TYPES.filter((t) => t.required && !c.documents.some((d) => d.type === t.id));

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Documents</h2>
          <div className="card-sub">{reviewing ? "Open each file, compare it with the profile, then verify or reject it." : "Start the review to verify or reject documents."}</div>
        </div>
      </div>
      {openErr && <div style={{ marginBottom: 12 }}><Banner tone="error" title={openErr} /></div>}
      {missing.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Banner tone="warn" title={`Missing: ${missing.map((m) => m.label).join(", ")}`}>This application cannot be approved without it.</Banner>
        </div>
      )}
      {c.documents.length === 0 ? (
        <div className="empty">No documents uploaded.</div>
      ) : (
        <table className="table">
          <thead><tr><th>Document</th><th>Issued</th><th>Expires</th><th>Status</th><th /></tr></thead>
          <tbody>
            {c.documents.map((d) => (
              <tr key={d.id}>
                <td>
                  <b>{docLabel(d.type)}</b>
                  <div className="muted small">{d.originalName} · uploaded {fmtDate(d.uploadedAt)}</div>
                </td>
                <td>{d.issuedAt ? fmtDate(d.issuedAt) : "—"}</td>
                <td>{d.expiresAt ? fmtDate(d.expiresAt) : "—"}</td>
                <td>
                  <Badge tone={DOC_TONE[d.status]}>{d.status === "pending" ? "Not checked" : d.status === "verified" ? "Verified" : "Rejected"}</Badge>
                  {d.reviewNote && <div className="muted small" style={{ marginTop: 4 }}>{d.reviewNote}</div>}
                </td>
                <td>
                  <div className="row" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button className="btn btn-line" onClick={() => void open(d)}><ExternalLink size={15} /> Open</button>
                    {reviewing && d.status !== "verified" && (
                      <button className="btn btn-line" disabled={busy} onClick={() => void verify(d)}><BadgeCheck size={15} /> Verify</button>
                    )}
                    {reviewing && d.status !== "rejected" && (
                      <button className="btn btn-line" disabled={busy} onClick={() => { setRejecting(d.id); setNote(""); }}><XCircle size={15} /> Reject</button>
                    )}
                  </div>
                  {rejecting === d.id && (
                    <div style={{ marginTop: 10 }}>
                      <Field label="Why is it rejected?" hint="At least 5 characters. The caregiver sees this.">
                        <input className="control" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The photo is blurred; the ID number can't be read." />
                      </Field>
                      <div className="row">
                        <button className="btn btn-line" onClick={() => setRejecting(null)}>Cancel</button>
                        <button className="btn btn-navy" disabled={busy || note.trim().length < 5} onClick={() => void reject(d)}>Reject document</button>
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ------------------------------ decision ------------------------------ */

function DecisionCard({ c, busy, act, isAdmin }: { c: Caregiver; busy: boolean; act: Act; isAdmin: boolean }) {
  const [decision, setDecision] = useState<Decision>(null);
  const [text, setText] = useState("");

  const now = new Date();
  const verifiedRequired = DOC_TYPES.filter((t) => t.required).every((t) =>
    c.documents.some((d) => d.type === t.id && d.status === "verified" && (!d.expiresAt || new Date(d.expiresAt) > now)),
  );
  const allChecked = c.documents.every((d) => d.status !== "pending");
  const canApprove = verifiedRequired && allChecked;

  const confirmDecision = async () => {
    const body = text.trim();
    const ok =
      decision === "reject"
        ? await act(() => api.post<Caregiver>(`/caregivers/${c.id}/reject`, { reason: body }), "Application rejected. The caregiver has been told why.")
        : decision === "more_info"
          ? await act(() => api.post<Caregiver>(`/caregivers/${c.id}/request-info`, { note: body }), "Sent back to the caregiver with your request.")
          : await act(() => api.post<Caregiver>(`/caregivers/${c.id}/suspend`, { reason: body }), "Caregiver suspended. They won't receive new visits.");
    if (ok) {
      setDecision(null);
      setText("");
    }
  };

  const prompt =
    decision === "reject"
      ? { label: "Reason for rejecting", placeholder: "e.g. The good conduct certificate does not match the ID.", button: "Reject application" }
      : decision === "more_info"
        ? { label: "What do you need from the caregiver?", placeholder: "e.g. Please upload a clearer photo of the back of your ID.", button: "Send request" }
        : { label: "Reason for suspending", placeholder: "e.g. Repeated missed visits reported by families.", button: "Suspend caregiver" };

  let body: ReactNode = null;
  if (c.status === "submitted") {
    body = (
      <div className="row">
        <span className="muted small">Starting the review records you as the reviewer and locks the caregiver's documents while you check them.</span>
        <span className="spacer" />
        <button className="btn btn-gold" disabled={busy} onClick={() => void act(() => api.post<Caregiver>(`/caregivers/${c.id}/review`), "Review started. Check each document below.")}>
          <Play size={16} /> Start review
        </button>
      </div>
    );
  } else if (c.status === "under_review") {
    body = (
      <>
        <div className="small" style={{ marginBottom: 12 }}>
          {canApprove
            ? "All documents are checked and the required ones are verified."
            : !allChecked
              ? "Verify or reject every document before approving."
              : "Approval needs a verified, unexpired national ID and certificate of good conduct."}
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn btn-line" disabled={busy} onClick={() => { setDecision("more_info"); setText(""); }}><MessageCircleQuestion size={16} /> Ask for more information</button>
          <button className="btn btn-line" disabled={busy} onClick={() => { setDecision("reject"); setText(""); }}><XCircle size={16} /> Reject</button>
          <span className="spacer" />
          <button className="btn btn-gold" disabled={busy || !canApprove} onClick={() => void act(() => api.post<Caregiver>(`/caregivers/${c.id}/approve`), "Approved. This caregiver can now be assigned to visits.")}>
            <BadgeCheck size={16} /> Approve caregiver
          </button>
        </div>
      </>
    );
  } else if (c.status === "approved" && isAdmin) {
    body = (
      <div className="row">
        <span className="muted small">Suspending stops new assignments straight away. Existing records are kept.</span>
        <span className="spacer" />
        <button className="btn btn-line" disabled={busy} onClick={() => { setDecision("suspend"); setText(""); }}><ShieldOff size={16} /> Suspend</button>
      </div>
    );
  } else if (c.status === "suspended" && isAdmin) {
    body = (
      <div className="row">
        <span className="muted small">Reinstating needs the required documents to be verified and unexpired.</span>
        <span className="spacer" />
        <button className="btn btn-gold" disabled={busy} onClick={() => void act(() => api.post<Caregiver>(`/caregivers/${c.id}/reinstate`), "Caregiver reinstated.")}>
          <ShieldCheck size={16} /> Reinstate
        </button>
      </div>
    );
  }

  if (!body) {
    const waiting = c.status === "more_info" ? "Waiting for the caregiver to update their documents and submit again." : null;
    return waiting ? <div className="card"><p className="muted small">{waiting}</p></div> : null;
  }

  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Decision</h2><div className="card-sub">Recorded in the audit log with your name.</div></div>
      </div>
      {body}
      {decision && (
        <div style={{ marginTop: 16 }}>
          <div className="hr" />
          <Field label={prompt.label} hint="At least 5 characters. The caregiver sees this.">
            <textarea className="control" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={prompt.placeholder} />
          </Field>
          <div className="row">
            <button className="btn btn-line" onClick={() => setDecision(null)}>Cancel</button>
            <span className="spacer" />
            <button className="btn btn-navy" disabled={busy || text.trim().length < 5} onClick={() => void confirmDecision()}>{prompt.button}</button>
          </div>
        </div>
      )}
    </div>
  );
}
