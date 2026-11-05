import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { Avatar, Badge, Banner, ErrorBox, Field, PageHead, useAsync } from "@/components/ui";
import { api } from "@/lib/api";
import { EMERGENCY_NUMBERS, SUPPORT_LINE } from "@/lib/kenya";
import { durationLabel, kes } from "@/lib/format";
import type { CareService, Elder } from "@/lib/types";

const DURATIONS = [60, 90, 120, 180, 240, 360, 480];

/** Page 8 — Request a visit (family). Creates a booking with status "requested". */
export default function RequestVisit() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data, error: loadError } = useAsync(async () => {
    const [elders, services] = await Promise.all([api.page<Elder>("/elders", { limit: 100 }), api.page<CareService>("/services", { limit: 100 })]);
    return { elders: elders.items, services: services.items.filter((s) => !/companion/i.test(s.name)) };
  });

  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const [elderId, setElderId] = useState(params.get("elder") ?? "");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(120);
  const [notes, setNotes] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (data && !elderId && data.elders[0]) setElderId(data.elders[0].id);
    if (data && !serviceId && data.services[0]) setServiceId(data.services[0].id);
  }, [data, elderId, serviceId]);

  const elder = data?.elders.find((e) => e.id === elderId);
  const service = data?.services.find((s) => s.id === serviceId);
  const start = useMemo(() => new Date(`${date}T${time}:00+03:00`), [date, time]); // EAT
  const end = new Date(start.getTime() + duration * 60_000);
  const hhmm = (d: Date) => d.toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" });
  const estimate = service ? (service.pricingUnit === "per_hour" ? (service.basePriceCents * duration) / 60 : service.basePriceCents) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const booking = await api.post<{ id: string }>("/bookings", {
        elderId,
        serviceId,
        scheduledFor: start.toISOString(),
        durationMinutes: duration,
        ...(notes.trim() && { notes: notes.trim() }),
      });
      navigate(`/visit/${booking.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead crumb="Visit scheduling" title="Request a visit" sub="Tell us what would help. Your coordinator will find the right caregiver." actions={<Badge tone="blue">Family request</Badge>} />
      <div className="split">
        <form className="card" onSubmit={submit}>
          <h2>Visit information</h2>
          <div className="card-sub" style={{ marginBottom: 18 }}>Fields marked * are required.</div>
          <ErrorBox error={loadError ?? error} />
          {data && data.elders.length === 0 && <Banner tone="warn" title="Add an elder first">You need an elder record before requesting a visit.</Banner>}
          {data && data.services.length === 0 && <Banner tone="warn" title="No care services are published yet">An admin needs to publish the types of help first.</Banner>}

          <Field label="Elder *">
            <select className="control" value={elderId} onChange={(e) => setElderId(e.target.value)} required>
              {data?.elders.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
            </select>
          </Field>
          <Field label="Type of help *" hint={service?.description}>
            <select className="control" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
              {data?.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <div className="grid g2" style={{ gap: 16 }}>
            <Field label="Date *"><input className="control" type="date" min={tomorrow} value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
            <Field label="Start time * (EAT)"><input className="control" type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></Field>
            <Field label="Duration *">
              <select className="control" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATIONS.filter((d) => !service || d >= service.minimumDurationMinutes).map((d) => <option key={d} value={d}>{durationLabel(d)}</option>)}
              </select>
            </Field>
            <Field label="End time"><input className="control" disabled value={`${hhmm(end)} · calculated automatically`} /></Field>
          </div>
          <Field label="Anything the caregiver should know?" hint="Caregivers will also be able to read the current care plan.">
            <textarea className="control" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="e.g. Mama prefers her bath before 11am. Please bring her walking stick to the veranda." />
          </Field>
          <div className="hr" />
          <label className="check" style={{ marginBottom: 18 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            I confirm {elder?.firstName ?? "the elder"} is aware of this request and agrees to the visit.
          </label>
          <div className="row">
            <button type="button" className="btn btn-line" onClick={() => navigate(-1)}>Cancel</button>
            <span className="spacer" />
            <button className="btn btn-gold" disabled={busy || !agreed || !elderId || !serviceId}><ArrowRight size={16} /> {busy ? "Submitting…" : "Submit visit request"}</button>
          </div>
        </form>

        <div className="stack">
          <div className="card">
            <div className="card-head"><h2>Your request at a glance</h2><Badge>Draft</Badge></div>
            {elder && (
              <div className="who" style={{ marginBottom: 14 }}>
                <Avatar name={`${elder.firstName} ${elder.lastName}`} />
                <div><b>{elder.firstName} {elder.lastName}</b><small>{elder.age} years · {[elder.address.estate, elder.address.county].filter(Boolean).join(", ")}</small></div>
              </div>
            )}
            <div className="stack" style={{ gap: 14 }}>
              <div className="kv"><span className="k">Support</span><span className="v">{service?.name ?? "—"}</span></div>
              <div className="kv"><span className="k">When</span><span className="v">{start.toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Nairobi" })} · {hhmm(start)}–{hhmm(end)}</span></div>
              <div className="kv"><span className="k">Duration</span><span className="v">{durationLabel(duration)}</span></div>
              <div className="kv"><span className="k">Estimated cost</span><span className="v">{kes(estimate)}</span></div>
              <div className="kv"><span className="k">Visit address</span><span className="v">{elder ? [elder.address.street, elder.address.estate, elder.address.county].filter(Boolean).join(", ") : "—"}</span></div>
            </div>
          </div>
          <Banner tone="warn" title="What happens next?">A coordinator will review your request and assign a caregiver. You'll be notified when the visit is confirmed. A request is not a confirmed booking.</Banner>
          <div className="card">
            <h2>Need urgent help?</h2>
            <p className="muted small" style={{ margin: "8px 0" }}>For same-day changes, call your coordinator on {SUPPORT_LINE}. This service is not for medical emergencies.</p>
            <b className="small">In an emergency, call {EMERGENCY_NUMBERS}.</b>
          </div>
        </div>
      </div>
    </>
  );
}
