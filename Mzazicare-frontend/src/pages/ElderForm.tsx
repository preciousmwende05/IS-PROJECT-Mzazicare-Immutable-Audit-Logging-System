import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Crosshair, HelpCircle, Plus } from "lucide-react";

import { Avatar, Badge, Banner, ErrorBox, Field, PageHead } from "@/components/ui";
import { api } from "@/lib/api";
import { COUNTIES, countyByName } from "@/lib/kenya";
import { ageFrom, fmtDate, shortId } from "@/lib/format";
import type { Elder } from "@/lib/types";

type Form = {
  fullName: string;
  dateOfBirth: string;
  gender: "female" | "male" | "other";
  county: string;
  estate: string;
  street: string;
  landmark: string;
  latitude: number;
  longitude: number;
  locationFromDevice: boolean;
};

const EMPTY: Form = {
  fullName: "",
  dateOfBirth: "",
  gender: "female",
  county: "Nairobi",
  estate: "",
  street: "",
  landmark: "",
  latitude: COUNTIES[0]!.latitude,
  longitude: COUNTIES[0]!.longitude,
  locationFromDevice: false,
};

const splitName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return { firstName: parts.slice(0, -1).join(" ") || parts[0] || "", lastName: parts.length > 1 ? parts[parts.length - 1]! : "" };
};

/** Page 6 — Add / edit elder. */
export default function ElderForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const [form, setForm] = useState<Form>(EMPTY);
  const [original, setOriginal] = useState<Elder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<Elder>(`/elders/${id}`).then((e) => {
      setOriginal(e);
      setForm({
        fullName: `${e.firstName} ${e.lastName}`,
        dateOfBirth: e.dateOfBirth.slice(0, 10),
        gender: e.gender,
        county: e.address.county,
        estate: e.address.estate ?? "",
        street: e.address.street ?? "",
        landmark: e.address.landmark ?? "",
        latitude: e.homeLocation.latitude,
        longitude: e.homeLocation.longitude,
        locationFromDevice: true,
      });
    }, setError);
  }, [id]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const pickCounty = (name: string) => {
    const c = countyByName(name);
    setForm((f) => ({ ...f, county: name, ...(c && !f.locationFromDevice ? { latitude: c.latitude, longitude: c.longitude } : {}) }));
  };

  const useMyLocation = () => {
    setGeoMsg("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({ ...f, latitude: p.coords.latitude, longitude: p.coords.longitude, locationFromDevice: true }));
        setGeoMsg("Home location set from this device. Use this only when you're at the elder's home.");
      },
      () => setGeoMsg("Location not shared. We'll use the county town until you set it."),
    );
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { firstName, lastName } = splitName(form.fullName);
    const body = {
      firstName,
      lastName: lastName || firstName,
      dateOfBirth: form.dateOfBirth,
      gender: form.gender,
      homeLocation: { latitude: form.latitude, longitude: form.longitude },
      address: {
        county: form.county,
        ...(form.estate && { estate: form.estate }),
        ...(form.street && { street: form.street }),
        ...(form.landmark && { landmark: form.landmark }),
      },
    };
    try {
      const saved = editing ? await api.patch<Elder>(`/elders/${id}`, body) : await api.post<Elder>("/elders", body);
      navigate(`/elders/${saved.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const age = ageFrom(form.dateOfBirth);
  const previewName = form.fullName.trim() || "New elder";

  return (
    <>
      <PageHead
        crumb="Elder records"
        title={editing ? "Edit elder" : "Add elder"}
        sub="Keep the essentials accurate so every visit starts with the right information."
        actions={
          <button className="btn btn-line" onClick={() => navigate(editing ? `/elders/${id}` : "/elders")}>
            <ArrowLeft size={16} /> Back
          </button>
        }
      />

      <div className="split">
        <form className="card" onSubmit={submit}>
          <div className="card-head">
            <div>
              <h2>Personal information</h2>
              <div className="card-sub">Fields marked * are required.</div>
            </div>
            <Badge tone="blue">Family only</Badge>
          </div>
          <ErrorBox error={error} />

          <Field label="Full name *">
            <input className="control" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="e.g. Wanjiku Njoroge" required />
          </Field>
          <div className="grid g2" style={{ gap: 16 }}>
            <Field label="Date of birth *" hint={age != null ? `${age} years old` : undefined}>
              <input className="control" type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} max={new Date().toISOString().slice(0, 10)} required />
            </Field>
            <Field label="Gender *">
              <select className="control" value={form.gender} onChange={(e) => set("gender", e.target.value as Form["gender"])}>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </Field>
          </div>

          <div className="hr" />
          <h2 style={{ fontSize: 16, marginBottom: 16 }}>Home &amp; visit location</h2>
          <div className="grid g2" style={{ gap: 16 }}>
            <Field label="County *">
              <select className="control" value={form.county} onChange={(e) => pickCounty(e.target.value)}>
                {COUNTIES.map((c) => <option key={c.name}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Estate / area">
              <input className="control" value={form.estate} onChange={(e) => set("estate", e.target.value)} placeholder="e.g. Kilimani" />
            </Field>
          </div>
          <Field label="Street / house" hint="Where care visits will take place.">
            <input className="control" value={form.street} onChange={(e) => set("street", e.target.value)} placeholder="e.g. Argwings Kodhek Road, Hse No. 14" />
          </Field>
          <Field label="Landmark / directions">
            <input className="control" value={form.landmark} onChange={(e) => set("landmark", e.target.value)} placeholder="e.g. Opposite Yaya Centre, blue gate" maxLength={120} />
          </Field>
          <div className="row" style={{ marginBottom: 18 }}>
            <button type="button" className="btn btn-line" onClick={useMyLocation}><Crosshair size={16} /> Use my current location</button>
            <span className="muted small">{geoMsg ?? `Map point: ${form.latitude.toFixed(4)}, ${form.longitude.toFixed(4)} (${form.locationFromDevice ? "device" : `${form.county} town`})`}</span>
          </div>

          <div className="row">
            <span className="muted small">{original ? `Created ${fmtDate(original.createdAt)}` : ""}</span>
            <span className="spacer" />
            <button type="button" className="btn btn-line" onClick={() => navigate(-1)}>Cancel</button>
            <button className="btn btn-gold" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create elder record"}</button>
          </div>
        </form>

        <div className="stack">
          <div className="card">
            <h2 style={{ marginBottom: 16 }}>Record preview</h2>
            <div className="row">
              <Avatar name={previewName} size="lg" />
              <div>
                <b style={{ fontSize: 16 }}>{previewName}</b>
                <div className="muted small">{original ? `${shortId(original.id, "EL-")} · Active care` : "Not saved yet"}</div>
              </div>
            </div>
            <div className="hr" />
            <div className="kv"><span className="k">Your relationship</span><span className="v">Family administrator</span></div>
            <div className="kv" style={{ marginTop: 14 }}><span className="k">Location</span><span className="v">{[form.estate, form.county].filter(Boolean).join(", ")}</span></div>
          </div>
          <Banner tone="warn" title="A record built on consent">
            Before you add someone, confirm they agree to their information being shared. Manage consent from the Privacy tab after saving.
          </Banner>
          {editing && (
            <div className="card">
              <h2>Adding someone new?</h2>
              <p className="muted small" style={{ margin: "8px 0 14px" }}>Start a new record. You'll be its family administrator.</p>
              <button className="btn btn-line" onClick={() => navigate("/elders/new")}><Plus size={16} /> Start new elder record</button>
              <div className="muted small row" style={{ marginTop: 14, gap: 6 }}><HelpCircle size={14} /> Help with elder records</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
