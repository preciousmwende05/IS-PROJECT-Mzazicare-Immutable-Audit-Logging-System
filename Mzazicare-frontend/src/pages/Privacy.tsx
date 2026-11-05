import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Download, ShieldCheck, Trash2 } from "lucide-react";

import { Avatar, Badge, Banner, ErrorBox, Field, PageHead, Tabs, useAsync } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { fmtDate, fmtDateTime, shortId, titleCase } from "@/lib/format";
import type { AccessEntry, ConsentState, DataRequestRow, Elder } from "@/lib/types";

const STATUS_TONE: Record<string, string> = { requested: "gold", reviewed: "blue", completed: "green", refused: "red" };

/**
 * Page 11: Privacy & consent (elder record → Privacy tab). Kenya Data
 * Protection Act, 2019: consent, "who accessed my data", download a copy,
 * request deletion. The API decides who may do what; this page shows it.
 */
export default function Privacy() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const elders = useAsync(() => api.page<Elder>("/elders", { limit: 100 }));
  const elderId = params.get("elder") ?? elders.data?.items[0]?.id ?? "";
  const elder = elders.data?.items.find((e) => e.id === elderId) ?? null;
  const name = elder ? `${elder.firstName} ${elder.lastName}` : "your elder";
  const first = elder?.firstName ?? "your elder";

  return (
    <>
      <PageHead
        crumb="Consent & data rights"
        title="Elder record"
        sub={`Stay in control of ${first}'s information and see how it is used.`}
        actions={
          (elders.data?.items.length ?? 0) > 1 && (
            <select className="control" style={{ width: 240 }} value={elderId} onChange={(e) => setParams({ elder: e.target.value })}>
              {elders.data!.items.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
            </select>
          )
        }
      />
      <ErrorBox error={elders.error} />
      {elders.loading && !elders.data && <div className="loading">Loading…</div>}
      {elders.data && !elder && <div className="card empty">Add an elder first to manage their privacy.</div>}

      {elder && (
        <>
          <div className="card row" style={{ marginBottom: 22, padding: 24 }}>
            <Avatar name={name} size="xl" />
            <div style={{ marginLeft: 8 }}>
              <div className="row"><h2 style={{ fontSize: 24 }}>{name}</h2><Badge tone="green">{elder.status === "active" ? "Active care" : titleCase(elder.status)}</Badge></div>
              <div className="muted small" style={{ marginTop: 6 }}>{shortId(elder.id, "EL-")} · {fmtDate(elder.dateOfBirth)} ({elder.age} years) · {titleCase(elder.gender)}</div>
            </div>
          </div>
          <Tabs
            value="privacy"
            onChange={(t) => t !== "privacy" && navigate(`/elders/${elder.id}`)}
            items={[
              { id: "profile", label: "Profile" },
              { id: "care-plan", label: "Care plan" },
              { id: "contacts", label: "Emergency contacts" },
              { id: "circle", label: "Care circle" },
              { id: "privacy", label: "Privacy" },
            ]}
          />
          <div className="stack" key={elder.id}>
            <ConsentCard elderId={elder.id} first={first} />
            <AccessLogCard elderId={elder.id} first={first} />
            <div className="grid g2">
              <DownloadCard elderId={elder.id} name={name} first={first} />
              <DeletionCard elderId={elder.id} first={first} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ConsentCard({ elderId, first }: { elderId: string; first: string }) {
  const consent = useAsync(() => api.get<ConsentState>(`/privacy/elders/${elderId}/consent`), [elderId]);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const c = consent.data;

  const change = async (granted: boolean) => {
    if (!granted && !confirm(`Stop sharing ${first}'s care plan with caregivers? They will no longer see medications, conditions or allergies.`)) return;
    setBusy(true);
    setMsg(null);
    try {
      consent.setData(await api.put<ConsentState>(`/privacy/elders/${elderId}/consent`, { granted }));
      setMsg({ tone: "success", text: granted ? "Consent given. Recorded in the audit log." : "Consent withdrawn. Caregivers can no longer see the care plan." });
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Consent to share care information</h2>
      <div className="card-sub">Given by {first}, or by a family owner or editor on {first}'s behalf.</div>
      <ErrorBox error={consent.error} />
      {c && (
        <>
          <div className="row" style={{ marginTop: 18 }}>
            <div style={{ flex: 1 }}>
              <b>Share the care plan with caregivers</b>
              <p className="muted small" style={{ marginTop: 4 }}>Caregivers in {first}'s care circle can read the care plan (conditions, medications, allergies). Turning this off hides it from them straight away.</p>
            </div>
            <b className="small" style={{ color: c.granted ? "#b8862a" : "var(--muted)" }}>Consent {c.granted ? "on" : "off"}</b>
            <button className={`toggle ${c.granted ? "on" : ""}`} disabled={busy} onClick={() => change(!c.granted)} aria-label="Toggle consent" />
          </div>
          <div className="hr" />
          <div className="row">
            <span className="muted small">
              {c.status === "not_recorded"
                ? "Not recorded yet. Sharing continues until someone says no. Please confirm with your elder."
                : `Last ${c.granted ? "given" : "withdrawn"} ${fmtDateTime(c.lastChangedAt)} by ${c.lastChangedBy} (${c.recordedAs})`}
            </span>
            <span className="spacer" />
            <Badge tone="green">Recorded in audit log</Badge>
          </div>
          {msg && <div style={{ marginTop: 14 }}><Banner tone={msg.tone} title={msg.text} /></div>}
          {!c.granted && (
            <div style={{ marginTop: 14 }}>
              <Banner tone="warn" title="Consent is withdrawn">Caregivers see the visit and emergency contacts, but not the care plan. Safety and legal records may still be kept.</Banner>
            </div>
          )}
          {c.history.length > 1 && (
            <details style={{ marginTop: 14 }}>
              <summary className="link small">Consent history ({c.history.length})</summary>
              <div className="timeline" style={{ marginTop: 12 }}>
                {c.history.map((h, i) => (
                  <div className="item" key={i}><span className="dot" /><div><div className="muted small">{fmtDateTime(h.at)}</div><b className="small">{h.granted ? "Given" : "Withdrawn"} by {h.by} ({h.recordedAs})</b>{h.note && <div className="muted small">{h.note}</div>}</div></div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function AccessLogCard({ elderId, first }: { elderId: string; first: string }) {
  const [rows, setRows] = useState<AccessEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .page<AccessEntry>(`/privacy/elders/${elderId}/access-log`, { page, limit: 20 })
      .then((p) => {
        setRows((prev) => (page === 1 ? p.items : [...prev, ...p.items]));
        setTotalPages(p.totalPages);
      }, setError)
      .finally(() => setLoading(false));
  }, [elderId, page]);

  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Who accessed my data</h2><div className="card-sub">Every view, change and refused attempt on {first}'s records, from the tamper-evident audit log.</div></div>
      </div>
      <ErrorBox error={error} />
      {rows.length === 0 && !loading && !error && <div className="empty">No access recorded yet.</div>}
      {rows.length > 0 && (
        <table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>What happened</th><th>When</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.sequence}>
                <td><div className="who"><Avatar name={a.actorName} /><div><b>{a.actorName}</b><small>AUD-{a.sequence}</small></div></div></td>
                <td>{titleCase(a.actorRole)}</td>
                <td style={a.outcome === "refused" ? { color: "var(--red)", fontWeight: 700 } : undefined}>
                  {a.label}{a.reason && <div className="muted small" style={{ fontWeight: 400 }}>{a.reason}</div>}
                </td>
                <td>{fmtDateTime(a.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <p className="muted small row" style={{ gap: 6 }}><ShieldCheck size={14} /> Every access is recorded. Your data is never sold.</p>
        <span className="spacer" />
        {page < totalPages && <button className="btn btn-line" disabled={loading} onClick={() => setPage((p) => p + 1)}>{loading ? "Loading…" : "Show older"}</button>}
      </div>
    </div>
  );
}

function DownloadCard({ elderId, name, first }: { elderId: string; name: string; first: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const download = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const data = await api.post<unknown>(`/privacy/elders/${elderId}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `mzazicare-${name.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMsg({ tone: "success", text: "Your copy has downloaded. The request is recorded." });
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>Download data</h2>
      <div className="card-sub">A copy for you and {first}.</div>
      <p className="muted small" style={{ margin: "12px 0 16px" }}>The profile, care plans, emergency contacts, care circle, visits, care logs, consent and access history, as a file you can keep.</p>
      {msg && <div style={{ marginBottom: 12 }}><Banner tone={msg.tone} title={msg.text} /></div>}
      <div className="row"><button className="btn btn-line" onClick={download} disabled={busy}><Download size={16} /> {busy ? "Preparing…" : "Download data"}</button><span className="spacer" /><span className="muted small">Family owner or the elder</span></div>
    </div>
  );
}

function DeletionCard({ elderId, first }: { elderId: string; first: string }) {
  const requests = useAsync(() => api.get<DataRequestRow[]>(`/privacy/elders/${elderId}/data-requests`), [elderId]);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const deletions = (requests.data ?? []).filter((r) => r.type === "deletion");
  const pending = deletions.find((r) => r.status === "requested" || r.status === "reviewed");

  const submit = async () => {
    setErr(null);
    try {
      await api.post(`/privacy/elders/${elderId}/deletion-requests`, { reason: reason.trim() });
      setOpen(false);
      setReason("");
      void requests.reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };

  return (
    <div className="card">
      <h2>Request deletion</h2>
      <div className="card-sub">A considered, reviewable process.</div>
      <p className="muted small" style={{ margin: "12px 0 16px" }}>Ask us to delete {first}'s record. An administrator reviews it and explains any records the law requires us to keep (visits, care logs, the audit trail).</p>
      {pending ? (
        <Banner tone="info" title={`Request ${pending.reference} is ${pending.status === "reviewed" ? "being reviewed" : "waiting for review"}`}>Sent {fmtDate(pending.requestedAt)}. We will respond by {fmtDate(pending.respondBy)}.</Banner>
      ) : open ? (
        <>
          {err && <div style={{ marginBottom: 10 }}><Banner tone="error" title={err} /></div>}
          <Field label="Why do you want the record deleted?" hint="The reviewer reads this.">
            <textarea className="control" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder={`e.g. ${first} has moved to live with family in Eldoret and no longer uses MzaziCare.`} />
          </Field>
          <div className="row"><button className="btn btn-line" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-danger" disabled={reason.trim().length < 10} onClick={submit}><Trash2 size={16} /> Send deletion request</button></div>
        </>
      ) : (
        <div className="row"><button className="btn btn-danger" onClick={() => setOpen(true)}><Trash2 size={16} /> Request deletion</button><span className="spacer" /><span className="muted small">Reviewed within 30 days</span></div>
      )}
      {deletions.filter((r) => r !== pending).length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="eyebrow" style={{ fontSize: 10.5, marginBottom: 8 }}>Earlier requests</div>
          {deletions.filter((r) => r !== pending).map((r) => (
            <div key={r.id} style={{ padding: "8px 0", borderTop: "1px solid var(--line-2)" }}>
              <div className="row"><b className="small">{r.reference}</b><Badge tone={STATUS_TONE[r.status]}>{titleCase(r.status)}</Badge><span className="spacer" /><span className="muted small">{fmtDate(r.requestedAt)}</span></div>
              {r.decisionReason && <p className="muted small" style={{ marginTop: 4 }}>{r.decisionReason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
