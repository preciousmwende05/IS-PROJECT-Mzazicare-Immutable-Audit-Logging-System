import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AlertTriangle, CalendarX, LogIn, LogOut } from "lucide-react";

import { Avatar, Badge, Banner, ErrorBox, Field, PageHead, useAsync } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { durationLabel, fmtDate, fmtDateTime, fmtTime, shortId, STAGE_BADGE, STAGE_LABEL, stageOf } from "@/lib/format";
import type { Booking, CareLog, CarePlan, CareService, Caregiver, Elder } from "@/lib/types";

/** /visit with no id: open the most recent visit. */
export function LatestVisit() {
  const { data, loading } = useAsync(() => api.page<Booking>("/bookings", { limit: 100 }));
  if (loading) return <div className="loading">Finding your latest visit…</div>;
  const latest = (data?.items ?? []).slice().sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor))[0];
  if (!latest) return <div className="card empty">No visits yet. Once a visit is requested, its details and care log appear here.</div>;
  return <Navigate to={`/visit/${latest.id}`} replace />;
}

/**
 * Location is optional for check-in/out. If the browser shares it, the visit is
 * verified against the elder's home; if not (denied, unavailable, too slow),
 * the check-in still goes through and is marked unverified.
 */
const hereIfShared = (): Promise<{ latitude: number; longitude: number; accuracyMeters?: number } | Record<string, never>> =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyMeters: Math.round(p.coords.accuracy) }),
      () => resolve({}),
      { enableHighAccuracy: true, timeout: 8_000 },
    );
  });

/** Page 10 — Visit details & care log. What each role can do is labelled on each panel. */
export default function VisitDetail() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    const booking = await api.get<Booking>(`/bookings/${id}`);
    const [elder, plan, services] = await Promise.all([
      api.get<Elder>(`/elders/${booking.elderId}`).catch(() => null),
      api.get<CarePlan | null>(`/elders/${booking.elderId}/care-plan`).catch(() => null),
      api.page<CareService>("/services", { limit: 100 }).catch(() => ({ items: [] as CareService[] })),
    ]);
    return { booking, elder, plan, service: services.items.find((s) => s.id === booking.serviceId) };
  }, [id]);

  if (loading && !data) return <div className="loading">Loading visit…</div>;
  if (error || !data) return <ErrorBox error={error} />;
  const { booking, elder, plan, service } = data;
  const stage = stageOf(booking.status);
  const elderName = elder ? `${elder.firstName} ${elder.lastName}` : `Elder ${shortId(booking.elderId, "EL-")}`;
  const role = user?.role;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
      reload();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    }
  };

  return (
    <>
      <PageHead
        crumb="Care logs"
        title={`Visit ${shortId(booking.id, "VIS-")}`}
        sub={`${service?.name ?? "Care visit"} for ${elderName} · ${fmtDate(booking.scheduledFor)}`}
        actions={<Badge tone={STAGE_BADGE[stage]}>{STAGE_LABEL[stage]}</Badge>}
      />
      <div style={{ marginBottom: 20 }}>
        <Banner tone="info" title="Role-aware workspace">
          Caregivers record care; coordinators manage assignments; families manage requests and read submitted logs.
        </Banner>
      </div>
      {msg && <div style={{ marginBottom: 20 }}><Banner tone={msg.tone} title={msg.text} /></div>}

      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <h2>Visit overview</h2>
              {elder && <Link className="link small" to={`/elders/${elder.id}`}>View elder record →</Link>}
            </div>
            <div className="who" style={{ marginBottom: 18 }}>
              <Avatar name={elderName} />
              <div><b>{elderName}</b><small>{elder ? `${shortId(elder.id, "EL-")} · ${elder.age} years · ${[elder.address.estate, elder.address.county].filter(Boolean).join(", ")}` : ""}</small></div>
            </div>
            <div className="grid g2">
              <div className="kv"><span className="k">Scheduled</span><span className="v">{fmtDate(booking.scheduledFor)} · {fmtTime(booking.scheduledFor)}–{fmtTime(booking.endsAt)}</span></div>
              <div className="kv"><span className="k">Type &amp; duration</span><span className="v">{service?.name ?? "Care visit"} · {durationLabel(booking.durationMinutes)}</span></div>
              <div className="kv" style={{ gridColumn: "1 / -1" }}><span className="k">Address</span><span className="v">{elder ? [elder.address.street, elder.address.estate, elder.address.county].filter(Boolean).join(", ") : "—"}</span></div>
            </div>
            {booking.notes && (<><div className="hr" /><div className="eyebrow" style={{ fontSize: 10.5 }}>Family's request</div><p style={{ marginTop: 6 }}>{booking.notes}</p></>)}
            {plan?.allergies?.length ? <p className="small row" style={{ color: "#b8862a", gap: 6, marginTop: 10 }}><AlertTriangle size={14} /> Allergy · {plan.allergies.join(", ")}</p> : null}
          </div>

          <Attendance booking={booking} isCaregiver={role === "caregiver"} act={act} />
          <CareLogPanel booking={booking} isCaregiver={role === "caregiver"} onSaved={reload} />
        </div>

        <div className="stack">
          <AssignPanel booking={booking} isCoordinator={role === "coordinator" || role === "admin"} act={act} />
          <ManageRequest booking={booking} isFamily={role === "family"} act={act} />
          <div className="card">
            <h2 style={{ marginBottom: 16 }}>Visit history</h2>
            <div className="timeline">
              {[
                booking.completedAt && ["Visit completed", booking.completedAt],
                booking.startedAt && ["Caregiver checked in", booking.startedAt],
                booking.confirmedAt && ["Caregiver assigned", booking.confirmedAt],
                booking.cancellation?.at && [`Cancelled${booking.cancellation.reason ? ` · ${booking.cancellation.reason}` : ""}`, booking.cancellation.at],
                ["Visit requested", booking.createdAt],
              ]
                .filter((x): x is [string, string] => !!x)
                .map(([label, at]) => (
                  <div className="item" key={label}><span className="dot" /><div><div className="muted small">{fmtDateTime(at)}</div><b className="small">{label}</b></div></div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

type Act = (fn: () => Promise<unknown>, ok: string) => Promise<void>;

function Attendance({ booking, isCaregiver, act }: { booking: Booking; isCaregiver: boolean; act: Act }) {
  const visitId = booking.visitId;
  const inProgress = booking.status === "in_progress";
  const done = booking.status === "completed";
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Attendance</h2><div className="card-sub">{done ? "Visit completed" : inProgress ? "Visit in progress" : "Not yet started"}</div></div>
        <Badge tone="blue">Assigned caregiver only</Badge>
      </div>
      <div className="grid g2">
        <div className="kv"><span className="k">Check in</span><span className="v">{booking.startedAt ? fmtTime(booking.startedAt) : "Not checked in"}</span></div>
        <div className="kv"><span className="k">Check out</span><span className="v">{booking.completedAt ? fmtTime(booking.completedAt) : inProgress ? "On site now" : "Awaiting check-in"}</span></div>
      </div>
      {isCaregiver && (
        <div className="row" style={{ marginTop: 18 }}>
          <button
            className="btn btn-gold"
            disabled={!visitId || inProgress || done}
            onClick={async () => {
              const loc = await hereIfShared();
              await act(
                () => api.post(`/visits/${visitId}/check-in`, loc),
                "latitude" in loc ? "Checked in. Your location was recorded." : "Checked in without location (marked unverified).",
              );
            }}
          >
            <LogIn size={16} /> Check in
          </button>
          <button
            className="btn btn-line"
            disabled={!visitId || !inProgress}
            onClick={async () => {
              const loc = await hereIfShared();
              await act(() => api.post(`/visits/${visitId}/check-out`, loc), "Checked out. Thank you for the visit.");
            }}
          >
            <LogOut size={16} /> Check out
          </button>
        </div>
      )}
      {!visitId && <p className="muted small" style={{ marginTop: 12 }}>Check-in opens once a caregiver is assigned.</p>}
    </div>
  );
}

const MOODS = ["cheerful", "calm", "withdrawn", "agitated", "distressed"] as const;

/** "128/76", "128 / 76" -> numbers; "" -> nothing; anything else -> error text. */
const parseBp = (raw: string): { systolic?: number; diastolic?: number; error?: string } => {
  const s = raw.trim();
  if (!s) return {};
  const m = s.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  if (!m) return { error: "Write it as two numbers, e.g. 128 / 76" };
  return { systolic: Number(m[1]), diastolic: Number(m[2]) };
};

/**
 * Care log: notes and simple vitals. The assigned caregiver writes it once,
 * after checking in; the family and staff read it. Submitted logs can't change.
 */
function CareLogPanel({ booking, isCaregiver, onSaved }: { booking: Booking; isCaregiver: boolean; onSaved: () => void }) {
  const visitId = booking.visitId;
  const log = useAsync(
    () => (visitId ? api.get<CareLog | null>(`/reports/visits/${visitId}/care-log`) : Promise.resolve(null)),
    [visitId],
  );
  const [notes, setNotes] = useState("");
  const [bp, setBp] = useState("");
  const [mood, setMood] = useState("");
  const [meals, setMeals] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const checkedIn = ["in_progress", "completed"].includes(booking.status);
  const parsed = parseBp(bp);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api.post(`/reports/visits/${visitId}/care-log`, {
        notes: notes.trim(),
        ...(parsed.systolic !== undefined && { bloodPressureSystolic: parsed.systolic, bloodPressureDiastolic: parsed.diastolic }),
        ...(mood && { mood }),
        ...(meals.trim() && { meals: meals.trim() }),
      });
      await log.reload();
      onSaved();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Submitted: everyone who can see the visit reads the same log.
  if (log.data) {
    const l = log.data;
    return (
      <div className="card">
        <div className="card-head">
          <div><h2>Care log</h2><div className="card-sub">Submitted {fmtDateTime(l.submittedAt)} by the assigned caregiver</div></div>
          <Badge tone="green">Family can read</Badge>
        </div>
        <div className="grid g3">
          <div className="kv"><span className="k">Blood pressure</span><span className="v">{l.bloodPressure ? `${l.bloodPressure.systolic} / ${l.bloodPressure.diastolic} mmHg` : "Not measured"}</span></div>
          <div className="kv"><span className="k">Mood</span><span className="v">{l.mood ? l.mood[0]!.toUpperCase() + l.mood.slice(1) : "—"}</span></div>
          <div className="kv"><span className="k">Meals</span><span className="v">{l.meals ?? "—"}</span></div>
        </div>
        <div className="hr" />
        <p style={{ whiteSpace: "pre-wrap" }}>{l.notes}</p>
        <p className="muted small" style={{ marginTop: 12 }}>
          {l.acknowledgedAt ? `Read by family ${fmtDateTime(l.acknowledgedAt)}` : "Not yet read by family"} · Care logs cannot be changed after submission.
        </p>
      </div>
    );
  }

  const canWrite = isCaregiver && !!visitId && checkedIn;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Care log · Current visit</h2>
          <div className="card-sub">{canWrite ? "Record what happened. Fields unlock once you check in." : "Notes and simple vitals from the visit."}</div>
        </div>
        <Badge tone="blue">Caregiver writes</Badge>
      </div>
      <ErrorBox error={log.error} />
      {!isCaregiver ? (
        <p className="muted">{visitId ? "The caregiver hasn't submitted a care log for this visit yet. It will appear here, and you'll be notified." : "The care log opens once a caregiver is assigned and checks in."}</p>
      ) : (
        <>
          {err && <div style={{ marginBottom: 12 }}><Banner tone="error" title={err} /></div>}
          <Field label="Care notes *">
            <textarea className="control" disabled={!canWrite} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="e.g. Mama took her morning walk to the gate, bathed and dressed well. Took Amlodipine at 8am with uji." />
          </Field>
          <div className="grid g2" style={{ gap: 16 }}>
            <Field label="Blood pressure (mmHg)" hint="Record only if measured." error={parsed.error}>
              <input className="control" disabled={!canWrite} value={bp} onChange={(e) => setBp(e.target.value)} placeholder="e.g. 128 / 76" />
            </Field>
            <Field label="Mood">
              <select className="control" disabled={!canWrite} value={mood} onChange={(e) => setMood(e.target.value)}>
                <option value="">Select mood</option>
                {MOODS.map((m) => <option key={m} value={m}>{m[0]!.toUpperCase() + m.slice(1)}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Meals &amp; hydration">
            <input className="control" disabled={!canWrite} value={meals} onChange={(e) => setMeals(e.target.value)} maxLength={500} placeholder="e.g. Ugali and sukuma at 1pm, 2 cups of chai" />
          </Field>
          <div className="row">
            <span className="muted small">{checkedIn ? "Visible to the family after you submit. It can't be changed afterwards." : "Check in first to write the care log."}</span>
            <span className="spacer" />
            <button className="btn btn-gold" disabled={!canWrite || busy || notes.trim().length < 3 || !!parsed.error} onClick={submit}>
              {busy ? "Submitting…" : "Submit care log"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AssignPanel({ booking, isCoordinator, act }: { booking: Booking; isCoordinator: boolean; act: Act }) {
  const [caregivers, setCaregivers] = useState<Caregiver[] | null>(null);
  const [choice, setChoice] = useState(booking.caregiverId ?? "");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  useEffect(() => {
    if (!isCoordinator) return;
    api.page<Caregiver>("/caregivers", { status: "approved", limit: 100 }).then((p) => setCaregivers(p.items), (e) => setLoadErr(errorText(e)));
  }, [isCoordinator]);
  const label = (c: Caregiver) => c.fullName ?? c.name ?? `Caregiver ${shortId(c.id)}`;
  const assignable = ["requested", "matching", "offered", "unassigned"].includes(booking.status);

  return (
    <div className="card">
      <div className="card-head"><h2>Caregiver assignment</h2><Badge tone="gold">Coordinator only</Badge></div>
      {booking.caregiverId ? (
        <div className="who" style={{ marginBottom: 14 }}><Avatar name="C G" /><div><b>Caregiver {shortId(booking.caregiverId)}</b><small>Assigned{booking.confirmedAt ? ` · ${fmtDateTime(booking.confirmedAt)}` : ""}</small></div></div>
      ) : (
        <p className="small" style={{ color: "#b8862a", marginBottom: 14 }}>Awaiting assignment</p>
      )}
      {isCoordinator && (
        <>
          {loadErr && <Banner tone="error" title={loadErr} />}
          <Field label="Assign or change caregiver">
            <select className="control" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={!assignable}>
              <option value="">{caregivers?.length === 0 ? "No approved caregivers yet" : "Select a caregiver"}</option>
              {caregivers?.map((c) => <option key={c.id} value={c.id}>{label(c)}{c.skills?.length ? ` · ${c.skills.join(", ")}` : ""}</option>)}
            </select>
          </Field>
          <p className="muted small" style={{ marginBottom: 12 }}>Only approved caregivers can be assigned. The family and caregiver will be notified.</p>
          <button className="btn btn-line" disabled={!choice || !assignable} onClick={() => act(() => api.post(`/bookings/${booking.id}/assign`, { caregiverId: choice }), "Caregiver assigned.")}>
            Save assignment
          </button>
        </>
      )}
    </div>
  );
}

function ManageRequest({ booking, isFamily, act }: { booking: Booking; isFamily: boolean; act: Act }) {
  const [reason, setReason] = useState("");
  const cancellable = !["in_progress", "completed", "cancelled", "no_show"].includes(booking.status);
  return (
    <div className="card">
      <div className="card-head"><h2>Manage request</h2><Badge tone="gold">Family only</Badge></div>
      <p className="muted small" style={{ marginBottom: 14 }}>Requested {fmtDateTime(booking.createdAt)}. Family members can cancel before the caregiver checks in.</p>
      {isFamily && cancellable && (
        <>
          <Field label="Reason (recorded in the audit log)"><input className="control" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Mama is travelling to shags" /></Field>
          <button className="btn btn-danger" disabled={!reason.trim()} onClick={() => act(() => api.post(`/bookings/${booking.id}/cancel`, { reason: reason.trim() }), "Visit cancelled.")}>
            <CalendarX size={16} /> Cancel visit
          </button>
        </>
      )}
      {!cancellable && <p className="muted small">This visit can no longer be cancelled.</p>}
    </div>
  );
}
