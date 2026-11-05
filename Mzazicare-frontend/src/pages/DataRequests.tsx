import { useMemo, useState } from "react";
import { Check, CheckCircle2, ClipboardCheck, X, XCircle } from "lucide-react";

import { Avatar, Badge, Banner, ErrorBox, Field, PageHead, Stat, Tabs, useAsync } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { fmtDate, fmtDateTime, titleCase } from "@/lib/format";
import type { DataRequestDetail, DataRequestRow } from "@/lib/types";

type Filter = "all" | "pending" | "completed" | "refused";
const TONE: Record<string, string> = { requested: "gold", reviewed: "blue", completed: "green", refused: "red" };
const isPending = (r: DataRequestRow) => r.status === "requested" || r.status === "reviewed";

/** Page 12: Data requests (admin). Review deletion requests with an accountable decision. */
export default function DataRequests() {
  const [tab, setTab] = useState<Filter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useAsync(() => api.page<DataRequestRow>("/privacy/data-requests", { limit: 100 }));
  const rows = list.data?.items ?? [];

  const thisMonth = (iso: string | null) => !!iso && new Date(iso).getMonth() === new Date().getMonth() && new Date(iso).getFullYear() === new Date().getFullYear();
  const pending = rows.filter((r) => r.type === "deletion" && isPending(r));
  const oldest = pending.reduce<DataRequestRow | null>((o, r) => (!o || r.requestedAt < o.requestedAt ? r : o), null);
  const shown = useMemo(
    () =>
      rows.filter((r) =>
        tab === "all" ? true : tab === "pending" ? r.type === "deletion" && isPending(r) : r.status === tab,
      ),
    [rows, tab],
  );

  return (
    <>
      <PageHead crumb="Consent & data rights" title="Data requests" sub="Review data-rights requests with care, clarity and an accountable decision." actions={<Badge tone="blue">Admin only</Badge>} />
      <div className="grid g3" style={{ marginBottom: 20 }}>
        <Stat dark label="Awaiting review" value={pending.length} hint={oldest ? `Oldest: ${fmtDate(oldest.requestedAt)}` : "Nothing waiting"} />
        <Stat label="Completed this month" value={rows.filter((r) => r.status === "completed" && thisMonth(r.completedAt)).length} hint="Deletions erased and downloads provided" />
        <Stat label="Refused this month" value={rows.filter((r) => r.status === "refused" && thisMonth(r.decidedAt)).length} hint="Reason sent to the requester" />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 12 }}>Requests</h2>
        <Tabs<Filter>
          value={tab}
          onChange={setTab}
          items={[
            { id: "pending", label: `Pending ${pending.length}` },
            { id: "completed", label: `Completed ${rows.filter((r) => r.status === "completed").length}` },
            { id: "refused", label: `Refused ${rows.filter((r) => r.status === "refused").length}` },
            { id: "all", label: `All ${rows.length}` },
          ]}
        />
        <ErrorBox error={list.error} />
        {list.loading && !list.data ? (
          <div className="loading">Loading requests…</div>
        ) : shown.length === 0 ? (
          <div className="empty">Nothing here.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Request</th><th>Elder</th><th>Type</th><th>Requested by</th><th>Received</th><th>Status</th><th /></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} style={{ background: r.id === selectedId ? "var(--gold-soft)" : undefined }}>
                  <td><b>{r.reference}</b></td>
                  <td><div className="who"><Avatar name={r.elderLabel} /><div><b>{r.elderLabel.replace(/\s*\(EL-\w+\)$/, "")}</b><small>{r.elderLabel.match(/EL-\w+/)?.[0]}</small></div></div></td>
                  <td>{r.type === "deletion" ? "Deletion" : "Download"}</td>
                  <td>{r.requestedBy}</td>
                  <td>{fmtDate(r.requestedAt)}</td>
                  <td><Badge tone={TONE[r.status]}>{titleCase(r.status)}</Badge></td>
                  <td><button className="link" onClick={() => setSelectedId(r.id)}>{r.id === selectedId ? "Selected" : "View →"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedId && <ReviewPanel id={selectedId} onChanged={() => void list.reload()} />}
    </>
  );
}

function ReviewPanel({ id, onChanged }: { id: string; onChanged: () => void }) {
  const detail = useAsync(() => api.get<DataRequestDetail>(`/privacy/data-requests/${id}`), [id]);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const d = detail.data;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
      setReason("");
      await detail.reload();
      onChanged();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  if (detail.loading && !d) return <div className="loading">Loading request…</div>;
  if (!d) return <ErrorBox error={detail.error} />;
  const open = d.type === "deletion" && (d.status === "requested" || d.status === "reviewed");
  const checks = [
    { ok: d.checks.requesterVerified, title: "Identity verified", text: d.checks.requesterVerified ? "Requester's phone is verified and the account is active." : "Requester's phone is not verified, or the account is inactive." },
    { ok: d.checks.requesterStillInCircle, title: "Authority to ask", text: d.checks.requesterStillInCircle ? "Requester is still in the elder's care circle." : "Requester is no longer in the care circle." },
    { ok: d.checks.upcomingVisits === 0, title: d.checks.upcomingVisits === 0 ? "No upcoming visits" : `${d.checks.upcomingVisits} upcoming visit(s)`, text: d.checks.upcomingVisits === 0 ? "Nothing booked that would need this record." : "Cancel booked visits before approving deletion." },
  ];

  return (
    <div className="split">
      <div className="card">
        <div className="card-head">
          <div><h2>Review {d.reference}</h2><div className="card-sub">{d.elderLabel} · {d.type === "deletion" ? "Deletion" : "Download"} requested {fmtDate(d.requestedAt)}</div></div>
          <Badge tone={TONE[d.status]}>{open ? "Pending decision" : titleCase(d.status)}</Badge>
        </div>
        <div className="grid g2">
          <div className="kv"><span className="k">Requester</span><span className="v">{d.requestedBy}</span></div>
          <div className="kv"><span className="k">Response due</span><span className="v">{fmtDate(d.respondBy)}</span></div>
        </div>
        {d.reason && <div className="kv" style={{ marginTop: 14 }}><span className="k">Requester's reason</span><span className="v">{d.reason}</span></div>}
        {d.reviewedAt && <p className="muted small" style={{ marginTop: 10 }}>Reviewed by {d.reviewedBy} on {fmtDateTime(d.reviewedAt)}</p>}
        <div className="hr" />
        {msg && <div style={{ marginBottom: 12 }}><Banner tone={msg.tone} title={msg.text} /></div>}
        {open ? (
          <>
            <Field label="Decision reason *" hint="Required for approval or refusal. The requester reads this.">
              <textarea className="control" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="e.g. Identity and authority verified. No visits booked. Personal data erased; visit records and the audit trail are kept as the law requires." />
            </Field>
            <div className="row">
              {d.status === "requested" && (
                <button className="btn btn-line" disabled={busy} onClick={() => act(() => api.post(`/privacy/data-requests/${d.id}/review`), "Marked as reviewed.")}>
                  <ClipboardCheck size={16} /> Mark reviewed
                </button>
              )}
              <button className="btn btn-danger" disabled={busy || reason.trim().length < 10} onClick={() => act(() => api.post(`/privacy/data-requests/${d.id}/decision`, { decision: "refuse", reason: reason.trim() }), "Request refused. The reason is recorded.")}>
                <X size={16} /> Refuse request
              </button>
              <span className="spacer" />
              <button
                className="btn btn-gold"
                disabled={busy || reason.trim().length < 10}
                onClick={() =>
                  confirm(`Erase ${d.elderLabel}'s personal data now? This cannot be undone.`) &&
                  act(() => api.post(`/privacy/data-requests/${d.id}/decision`, { decision: "approve", reason: reason.trim() }), "Approved. The personal data has been erased.")
                }
              >
                <Check size={16} /> Approve deletion
              </button>
            </div>
            <p className="muted small" style={{ marginTop: 10 }}>Approval erases the elder's personal data at once. The request, decision and reason are recorded in the audit log.</p>
          </>
        ) : (
          <div className="kv"><span className="k">Decision</span><span className="v">{titleCase(d.decision) || "—"}{d.decidedBy ? ` by ${d.decidedBy}` : ""}{d.decidedAt ? `, ${fmtDateTime(d.decidedAt)}` : ""}</span>{d.decisionReason && <span className="muted small">{d.decisionReason}</span>}</div>
        )}
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 16 }}>Before you decide</h2>
        {checks.map((c) => (
          <div className="row" key={c.title} style={{ alignItems: "flex-start", marginBottom: 14 }}>
            {c.ok ? <CheckCircle2 size={18} color="#2f7a4b" /> : <XCircle size={18} color="#c0392b" />}
            <div><b className="small">{c.title}</b><div className="muted small">{c.text}</div></div>
          </div>
        ))}
        <p className="muted small">Care-plan sharing consent: <b>{titleCase(d.checks.careplanSharing)}</b>.</p>
        <p className="muted small" style={{ marginTop: 10 }}>Deletion removes the profile, care plans, emergency contacts and care circle. Visit records, care logs and the audit trail are kept under the Kenya Data Protection Act's retention rules.</p>
      </div>
    </div>
  );
}
