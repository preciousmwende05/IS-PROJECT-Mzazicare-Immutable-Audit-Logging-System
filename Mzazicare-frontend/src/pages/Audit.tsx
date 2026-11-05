import { useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

import { Badge, Banner, ErrorBox, Field, PageHead, SearchBox, Stat, useAsync } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { fmtDateTime, fmtTime, shortId, titleCase } from "@/lib/format";
import type { AnomalyAlert, AuditEntry, ChainCheck, ScheduledVerification } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = { policy: "Policy rule", iforest: "Anomaly model", chain: "Integrity check" };

/**
 * Page 14 — Audit log: the hash-chained trail, the automatic integrity check
 * (every 30 minutes), and anomaly alerts (policy rules, the Isolation Forest,
 * a broken chain) for admins and auditors to resolve.
 */
export default function Audit() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const { data, error, loading } = useAsync(() => api.page<AuditEntry>("/audit", { page, limit: 20 }), [page]);
  const scheduled = useAsync(() => api.get<ScheduledVerification | null>("/audit/verification/latest"));
  const alerts = useAsync(() => api.page<AnomalyAlert>("/audit/anomalies", { status: "open", limit: 50 }));
  const [check, setCheck] = useState<{ at: Date; result: ChainCheck } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState<string | null>(null);

  const verify = async () => {
    setChecking(true);
    setCheckErr(null);
    try {
      setCheck({ at: new Date(), result: await api.get<ChainCheck>("/audit/verify") });
    } catch (e) {
      setCheckErr(errorText(e));
    } finally {
      setChecking(false);
    }
  };

  const items = (data?.items ?? []).filter((e) => `${e.action} ${e.actorRole} ${e.targetId}`.toLowerCase().includes(q.toLowerCase()));
  const denied = items.filter((e) => /denied|failed/.test(e.action)).length;

  // A manual check (button) wins; otherwise show the latest automatic one.
  const auto = scheduled.data;
  const intact = check ? check.result.intact : auto?.intact;
  const lastAt = check ? check.at.toISOString() : auto?.at ?? null;
  const checked = check ? check.result.checkedEntries : auto?.checkedEntries ?? null;
  const brokenAt = check ? check.result.brokenAtSequence : auto?.brokenAtSequence;
  const openAlerts = alerts.data?.items ?? [];

  return (
    <>
      <PageHead
        crumb="Notifications & audit"
        title="Audit log"
        sub="A traceable record of every action. Integrity you can verify, access you can explain."
        actions={<button className="btn btn-gold" onClick={verify} disabled={checking}><ShieldCheck size={16} /> {checking ? "Verifying…" : "Verify chain now"}</button>}
      />
      <div className="grid g3" style={{ marginBottom: 20 }}>
        <Stat
          dark
          label="Chain integrity"
          value={intact === undefined ? "Not checked" : intact ? "Verified" : "Broken"}
          hint={checked != null ? `${checked.toLocaleString()} entries · no broken links` : "Checked automatically every 30 minutes"}
        />
        <Stat label="Last verification" value={lastAt ? fmtTime(lastAt) : "—"} hint={check ? "Manual check, just now" : "Automatic, every 30 minutes"} />
        <Stat label="Open alerts" value={openAlerts.length} hint={openAlerts.length ? "Unusual activity to review" : "Nothing needs attention"} />
      </div>
      {checkErr && <div style={{ marginBottom: 20 }}><Banner tone="error" title="Verification failed to run">{checkErr}</Banner></div>}
      {intact !== undefined && (
        <div style={{ marginBottom: 20 }}>
          {intact ? (
            <Banner tone="success" title="Chain verification passed">All entry hashes and previous-hash links match{lastAt ? ` (${fmtDateTime(lastAt)})` : ""}.</Banner>
          ) : (
            <Banner tone="error" title="Chain verification FAILED">The audit chain is broken{brokenAt ? ` at entry ${brokenAt}` : ""}. Admins and auditors have been alerted. Investigate immediately.</Banner>
          )}
        </div>
      )}
      <AlertsPanel alerts={openAlerts} error={alerts.error} onResolved={() => void alerts.reload()} />
      <div className="card">
        <div className="card-head">
          <div><h2>Audit entries</h2><div className="card-sub">Read-only · Available to administrators and auditors</div></div>
          <Badge tone="blue">Append-only record</Badge>
        </div>
        <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder="Search event, role or record ID" />{denied > 0 && <Badge tone="red">{denied} denied/failed on this page</Badge>}</div>
        <ErrorBox error={error} />
        {loading && !data ? (
          <div className="loading">Loading audit entries…</div>
        ) : (
          <table className="table">
            <thead><tr><th>Entry / time</th><th>Actor</th><th>Event</th><th>Record</th><th>Chain / hash</th></tr></thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td><b>AUD-{e.sequence}</b><div className="muted small">{fmtDateTime(e.occurredAt)}</div></td>
                  <td><b className="small">{e.actorId ? `User ${shortId(e.actorId)}` : "System"}</b><div className="muted small">{titleCase(e.actorRole) || "—"}</div></td>
                  <td style={{ color: /denied|failed/.test(e.action) ? "var(--red)" : undefined, fontWeight: /denied|failed/.test(e.action) ? 700 : 400 }}>{e.action}</td>
                  <td>{e.targetId ? shortId(e.targetId) : "—"}</td>
                  <td><span className="small" style={{ color: "var(--green)", fontWeight: 700 }}>✓ Sealed</span><div className="muted small">{e.hash.slice(0, 5)}…{e.hash.slice(-4)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="row" style={{ marginTop: 16 }}>
          <span className="muted small">Page {data?.page ?? 1} of {data?.totalPages ?? 1}</span>
          <span className="spacer" />
          <button className="btn btn-line" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <button className="btn btn-line" disabled={!data || page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>
    </>
  );
}

/** Open anomaly alerts: who, what, why, and a note when resolved. */
function AlertsPanel({ alerts, error, onResolved }: { alerts: AnomalyAlert[]; error: unknown; onResolved: () => void }) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const resolve = async (id: string) => {
    setMsg(null);
    try {
      await api.post(`/audit/anomalies/${id}/resolve`, { note: note.trim() });
      setResolving(null);
      setNote("");
      setMsg({ tone: "success", text: "Alert resolved. Your note is kept with it, and the action is in the audit log." });
      onResolved();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    }
  };

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div className="card-head">
        <div><h2>Anomaly alerts</h2><div className="card-sub">Policy rules (in real time), the anomaly model, and the integrity check. Admins and auditors are notified of each.</div></div>
        <Badge tone={alerts.length ? "red" : "green"}>{alerts.length ? `${alerts.length} open` : "All clear"}</Badge>
      </div>
      <ErrorBox error={error} />
      {msg && <div style={{ marginBottom: 12 }}><Banner tone={msg.tone} title={msg.text} /></div>}
      {alerts.length === 0 ? (
        <p className="muted row" style={{ gap: 8 }}><CheckCircle2 size={16} color="#2f7a4b" /> No open alerts.</p>
      ) : (
        alerts.map((a) => (
          <div key={a.id} style={{ padding: "14px 0", borderTop: "1px solid var(--line-2)" }}>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <AlertTriangle size={18} color={a.source === "chain" ? "#c0392b" : "#b8862a"} style={{ marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b>{a.reference}</b>
                  <Badge tone={a.source === "chain" ? "red" : a.source === "iforest" ? "blue" : "gold"}>{SOURCE_LABEL[a.source] ?? a.source}</Badge>
                  <span className="muted small">{a.actorName}{a.actorRole ? ` · ${titleCase(a.actorRole)}` : ""}</span>
                </div>
                <p style={{ marginTop: 4 }}>{a.summary}</p>
                <div className="muted small">
                  {a.windowStart ? `${fmtDateTime(a.windowStart)}–${fmtTime(a.windowEnd)}` : fmtDateTime(a.createdAt)}
                  {a.notifiedAt ? " · admins and auditors notified" : " · notifying…"}
                </div>
              </div>
              {resolving !== a.id && <button className="btn btn-line" onClick={() => { setResolving(a.id); setNote(""); }}>Review alert</button>}
            </div>
            {resolving === a.id && (
              <div style={{ marginTop: 12, marginLeft: 30 }}>
                <Field label="What did you find? *" hint="Kept with the alert for the record.">
                  <textarea className="control" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Spoke to the account holder; she was testing links shared in the family WhatsApp group. No data was disclosed." />
                </Field>
                <div className="row"><button className="btn btn-line" onClick={() => setResolving(null)}>Cancel</button><button className="btn btn-gold" disabled={note.trim().length < 5} onClick={() => resolve(a.id)}>Resolve alert</button></div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
