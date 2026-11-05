import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, CalendarPlus, Copy, MapPin, Pencil, Phone, UserPlus } from "lucide-react";

import { Avatar, Badge, Banner, ErrorBox, Field, PageHead, Tabs, useAsync } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EMERGENCY_NUMBERS, formatPhone } from "@/lib/kenya";
import { fmtDate, fmtDateTime, shortId, titleCase } from "@/lib/format";
import type { CarePlan, CircleMember, Elder, EmergencyContact, Medication } from "@/lib/types";

type Tab = "profile" | "care-plan" | "contacts" | "circle" | "privacy";

/** Page 7 — Elder record (tabs: profile, care plan, emergency contacts, care circle, privacy). */
export default function ElderRecord() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("care-plan");

  const { data, error, loading, reload } = useAsync(async () => {
    const elder = await api.get<Elder>(`/elders/${id}`);
    const [plan, contacts, circle] = await Promise.all([
      api.get<CarePlan | null>(`/elders/${id}/care-plan`).catch(() => null),
      api.get<EmergencyContact[]>(`/elders/${id}/emergency-contacts`).catch(() => []),
      api.get<CircleMember[]>(`/elders/${id}/care-circle`).catch(() => []),
    ]);
    return { elder, plan, contacts, circle };
  }, [id]);

  if (loading && !data) return <div className="loading">Loading elder record…</div>;
  if (error || !data) return <ErrorBox error={error ?? new Error("Elder not found")} />;

  const { elder, plan, contacts, circle } = data;
  const name = `${elder.firstName} ${elder.lastName}`;
  const me = circle.find((m) => m.userId === user?.id);
  const staff = user?.role === "admin" || user?.role === "coordinator";
  const canEdit = staff || me?.accessLevel === "owner" || me?.accessLevel === "editor";
  const isOwner = staff || me?.accessLevel === "owner";

  return (
    <>
      <PageHead
        crumb="Elder records"
        title="Elder record"
        sub={`A shared picture of ${elder.firstName}'s care, preferences and people.`}
        actions={
          user?.role === "family" && (
            <button className="btn btn-gold" onClick={() => navigate(`/visits/new?elder=${elder.id}`)}>
              <CalendarPlus size={16} /> Request a visit
            </button>
          )
        }
      />

      <div className="card row" style={{ marginBottom: 22, padding: 24 }}>
        <Avatar name={name} size="xl" />
        <div style={{ marginLeft: 8 }}>
          <div className="row">
            <h2 style={{ fontSize: 24 }}>{name}</h2>
            <Badge tone="green">{elder.status === "active" ? "Active care" : elder.status}</Badge>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            {shortId(elder.id, "EL-")} · {fmtDate(elder.dateOfBirth)} ({elder.age} years) · {titleCase(elder.gender)}
          </div>
          <div className="muted small row" style={{ gap: 6, marginTop: 4 }}>
            <MapPin size={13} /> {[elder.address.estate, elder.address.county].filter(Boolean).join(", ")} · Lives at home
          </div>
        </div>
        <span className="spacer" />
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow" style={{ fontSize: 10.5 }}>Elder ID (share to invite)</div>
          <button className="link row" style={{ gap: 6, marginTop: 6 }} onClick={() => navigator.clipboard.writeText(elder.id)}>
            <code style={{ fontSize: 12 }}>{elder.id}</code> <Copy size={13} />
          </button>
        </div>
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={(t) => (t === "privacy" ? navigate(`/privacy?elder=${elder.id}`) : setTab(t))}
        items={[
          { id: "profile", label: "Profile" },
          { id: "care-plan", label: "Care plan" },
          { id: "contacts", label: "Emergency contacts" },
          { id: "circle", label: "Care circle" },
          { id: "privacy", label: "Privacy" },
        ]}
      />

      <div className="split">
        <div className="stack">
          {(tab === "care-plan" || tab === "profile") && tab === "care-plan" && (
            <CarePlanCard elderId={elder.id} firstName={elder.firstName} plan={plan} canEdit={canEdit} onSaved={reload} />
          )}
          {(tab === "profile" || tab === "care-plan") && <ProfileCard elder={elder} canEdit={canEdit} />}
          {tab === "contacts" && <ContactsCard elderId={elder.id} contacts={contacts} canEdit={canEdit} onSaved={reload} wide />}
          {tab === "circle" && <CircleCard elderId={elder.id} circle={circle} isOwner={isOwner} myId={user?.id} onSaved={reload} wide />}
        </div>
        <div className="stack">
          {tab !== "contacts" && <ContactsCard elderId={elder.id} contacts={contacts} canEdit={canEdit} onSaved={reload} />}
          {tab !== "circle" && <CircleCard elderId={elder.id} circle={circle} isOwner={isOwner} myId={user?.id} onSaved={reload} />}
        </div>
      </div>
    </>
  );
}

function ProfileCard({ elder, canEdit }: { elder: Elder; canEdit: boolean }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Profile</h2>
        {canEdit && (
          <Link className="btn btn-line" to={`/elders/${elder.id}/edit`}>
            <Pencil size={15} /> Edit profile
          </Link>
        )}
      </div>
      <div className="grid g2">
        <div className="kv"><span className="k">Full name</span><span className="v">{elder.firstName} {elder.lastName}</span></div>
        <div className="kv"><span className="k">Date of birth</span><span className="v">{fmtDate(elder.dateOfBirth)} · {elder.age} years</span></div>
        <div className="kv"><span className="k">Gender</span><span className="v">{titleCase(elder.gender)}</span></div>
        <div className="kv"><span className="k">County</span><span className="v">{elder.address.county}</span></div>
        <div className="kv" style={{ gridColumn: "1 / -1" }}>
          <span className="k">Home address</span>
          <span className="v">{[elder.address.street, elder.address.estate, elder.address.county].filter(Boolean).join(", ")}</span>
          {elder.address.landmark && <span className="muted small">Landmark: {elder.address.landmark}</span>}
        </div>
      </div>
    </div>
  );
}

const lines = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

function CarePlanCard(props: { elderId: string; firstName: string; plan: CarePlan | null; canEdit: boolean; onSaved: () => void }) {
  const { plan } = props;
  const [editing, setEditing] = useState(false);
  const [conditions, setConditions] = useState("");
  const [allergies, setAllergies] = useState("");
  const [meds, setMeds] = useState<Medication[]>([]);
  const [mobility, setMobility] = useState<CarePlan["mobility"]>("independent");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<unknown>(null);

  const startEdit = () => {
    setConditions((plan?.conditions ?? []).join(", "));
    setAllergies((plan?.allergies ?? []).join(", "));
    setMeds(plan?.medications?.length ? plan.medications : [{ name: "", dosage: "", schedule: "" }]);
    setMobility(plan?.mobility ?? "independent");
    setNotes(plan?.careNotes ?? "");
    setEditing(true);
  };

  const save = async () => {
    setErr(null);
    try {
      await api.patch(`/elders/${props.elderId}/care-plan`, {
        conditions: lines(conditions),
        allergies: lines(allergies),
        medications: meds
          .filter((m) => m.name.trim())
          .map((m) => ({ name: m.name.trim(), ...(m.dosage?.trim() && { dosage: m.dosage.trim() }), ...(m.schedule?.trim() && { schedule: m.schedule.trim() }) })),
        mobility,
        careNotes: notes,
      });
      setEditing(false);
      props.onSaved();
    } catch (e) {
      setErr(e);
    }
  };

  if (editing)
    return (
      <div className="card">
        <div className="card-head"><h2>Edit care plan</h2><Badge tone="gold">Saves a new version</Badge></div>
        <ErrorBox error={err} />
        <Field label="Conditions" hint="Separate with commas, e.g. Hypertension, Diabetes type 2">
          <input className="control" value={conditions} onChange={(e) => setConditions(e.target.value)} />
        </Field>
        <Field label="Allergies" hint="Separate with commas">
          <input className="control" value={allergies} onChange={(e) => setAllergies(e.target.value)} />
        </Field>
        <div className="field">
          <label>Medications</label>
          {meds.map((m, i) => (
            <div className="grid g3" style={{ gap: 10 }} key={i}>
              <input className="control" placeholder="Name, e.g. Amlodipine" value={m.name} onChange={(e) => setMeds(meds.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="control" placeholder="Dose, e.g. 5 mg" value={m.dosage ?? ""} onChange={(e) => setMeds(meds.map((x, j) => (j === i ? { ...x, dosage: e.target.value } : x)))} />
              <input className="control" placeholder="Schedule, e.g. Daily 08:00" value={m.schedule ?? ""} onChange={(e) => setMeds(meds.map((x, j) => (j === i ? { ...x, schedule: e.target.value } : x)))} />
            </div>
          ))}
          <button type="button" className="link" style={{ justifySelf: "start" }} onClick={() => setMeds([...meds, { name: "", dosage: "", schedule: "" }])}>+ Add medication</button>
        </div>
        <Field label="Mobility">
          <select className="control" value={mobility} onChange={(e) => setMobility(e.target.value as CarePlan["mobility"])}>
            <option value="independent">Independent</option>
            <option value="walker">Uses a walking aid</option>
            <option value="wheelchair">Wheelchair</option>
            <option value="bedbound">Bed-bound</option>
          </select>
        </Field>
        <Field label="What matters to them">
          <textarea className="control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Enjoys chai with milk in the afternoon and listening to Kiss FM." />
        </Field>
        <div className="row"><span className="spacer" /><button className="btn btn-line" onClick={() => setEditing(false)}>Cancel</button><button className="btn btn-gold" onClick={save}>Save care plan</button></div>
      </div>
    );

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Care plan</h2>
          <div className="card-sub">{plan ? `Version ${plan.version} · Updated ${fmtDateTime(plan.createdAt)}` : "No care plan yet"}</div>
        </div>
        {props.canEdit && <button className="btn btn-line" onClick={startEdit}><Pencil size={15} /> {plan ? "Edit care plan" : "Create care plan"}</button>}
      </div>
      {!plan ? (
        <div className="muted">Add conditions, medications and allergies so every caregiver arrives prepared.</div>
      ) : (
        <>
          <div className="eyebrow" style={{ fontSize: 10.5, marginBottom: 8 }}>Conditions</div>
          <div className="pill-list">{plan.conditions.length ? plan.conditions.map((c) => <Badge key={c} tone="blue">{c}</Badge>) : <span className="muted small">None recorded</span>}</div>
          <div className="muted small" style={{ marginTop: 8 }}>Mobility: {titleCase(plan.mobility)}</div>
          <div className="hr" />
          <div className="eyebrow" style={{ fontSize: 10.5, marginBottom: 8 }}>Medications</div>
          <table className="table">
            <thead><tr><th>Medication</th><th>Dose</th><th>Schedule</th></tr></thead>
            <tbody>
              {plan.medications.length ? plan.medications.map((m, i) => (
                <tr key={i}><td><b>{m.name}</b></td><td>{m.dosage ?? "—"}</td><td>{m.schedule ?? "—"}</td></tr>
              )) : <tr><td colSpan={3} className="muted">None recorded</td></tr>}
            </tbody>
          </table>
          {plan.allergies.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Banner tone="warn" title={`Allergy · ${plan.allergies.join(", ")}`}>Confirm allergies with a clinician before giving any medication.</Banner>
            </div>
          )}
          {plan.careNotes && (
            <>
              <div className="eyebrow" style={{ fontSize: 10.5, margin: "18px 0 6px" }}>What matters to {props.firstName}</div>
              <p>{plan.careNotes}</p>
            </>
          )}
          <p className="muted small" style={{ marginTop: 14 }}>Care-circle view · Medication information is not a substitute for clinical advice.</p>
        </>
      )}
    </div>
  );
}

function ContactsCard(props: { elderId: string; contacts: EmergencyContact[]; canEdit: boolean; onSaved: () => void; wide?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", relationship: "" });
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setErr(null);
    try {
      await api.post(`/elders/${props.elderId}/emergency-contacts`, {
        name: form.name.trim(),
        phone: form.phone.trim().replace(/^0/, "+254").replace(/\s/g, ""),
        ...(form.relationship && { relationship: form.relationship }),
        priority: props.contacts.length + 1,
      });
      setAdding(false);
      setForm({ name: "", phone: "", relationship: "" });
      props.onSaved();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Emergency contacts</h2><div className="card-sub">In a medical emergency call {EMERGENCY_NUMBERS}.</div></div>
        <Phone size={18} color="#b8862a" />
      </div>
      {props.contacts.length === 0 && <div className="muted small">No emergency contacts yet.</div>}
      {props.contacts.map((c, i) => (
        <div key={c.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--line-2)" }}>
          <div className="who">
            <div className="avatar">{c.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</div>
            <div><b>{c.name}</b><small>{titleCase(c.relationship) || "Contact"} · {i === 0 ? "Primary contact" : "Secondary contact"}</small></div>
          </div>
          <div style={{ fontWeight: 800, marginTop: 8 }}>{formatPhone(c.phone)}</div>
        </div>
      ))}
      {props.canEdit && !adding && <button className="btn btn-line" style={{ marginTop: 14 }} onClick={() => setAdding(true)}>Add emergency contact</button>}
      {adding && (
        <div style={{ marginTop: 14 }}>
          {err && <div style={{ marginBottom: 10 }}><Banner tone="error" title={err} /></div>}
          <Field label="Name"><input className="control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kamau Njoroge" /></Field>
          <Field label="Phone"><input className="control" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+254 712 345 678" /></Field>
          <Field label="Relationship"><input className="control" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} placeholder="e.g. Son" /></Field>
          <div className="row"><button className="btn btn-line" onClick={() => setAdding(false)}>Cancel</button><button className="btn btn-gold" onClick={save}>Save contact</button></div>
        </div>
      )}
    </div>
  );
}

function CircleCard(props: { elderId: string; circle: CircleMember[]; isOwner: boolean; myId?: string; onSaved: () => void; wide?: boolean }) {
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ userId: "", relationship: "", accessLevel: "viewer" as "viewer" | "editor" });
  const [err, setErr] = useState<string | null>(null);
  const invite = async () => {
    setErr(null);
    try {
      await api.post(`/elders/${props.elderId}/care-circle`, {
        userId: form.userId.trim(),
        accessLevel: form.accessLevel,
        ...(form.relationship && { relationship: form.relationship }),
      });
      setInviting(false);
      setForm({ userId: "", relationship: "", accessLevel: "viewer" });
      props.onSaved();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  const remove = async (userId: string) => {
    try {
      await api.del(`/elders/${props.elderId}/care-circle/${userId}`);
      props.onSaved();
    } catch (e) {
      setErr(errorText(e));
    }
  };
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Care circle</h2><div className="card-sub">{props.circle.length} members · Access is permission-based.</div></div>
        <Badge tone="blue">Family manages</Badge>
      </div>
      {err && <div style={{ marginBottom: 10 }}><Banner tone="error" title={err} /></div>}
      {props.circle.map((m) => (
        <div key={m.id} className="row" style={{ padding: "10px 0" }}>
          <div className="who">
            <div className="avatar">{m.userId === props.myId ? "ME" : m.userId.slice(-2).toUpperCase()}</div>
            <div>
              <b>{m.userId === props.myId ? "You" : `User ${shortId(m.userId)}`}</b>
              <small>{titleCase(m.relationship) || "Member"} · {titleCase(m.accessLevel)} access{m.acceptedAt ? "" : " · Invite pending"}</small>
            </div>
          </div>
          <span className="spacer" />
          {props.isOwner && m.accessLevel !== "owner" && <button className="link link-red small" onClick={() => remove(m.userId)}>Remove</button>}
        </div>
      ))}
      {props.isOwner && !inviting && (
        <button className="btn btn-gold" style={{ marginTop: 12 }} onClick={() => setInviting(true)}><UserPlus size={16} /> Invite member</button>
      )}
      {inviting && (
        <div style={{ marginTop: 14 }}>
          <Field label="Their user ID" hint="They find it under their name (top right) after signing in."><input className="control" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} /></Field>
          <Field label="Relationship"><input className="control" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} placeholder="e.g. Daughter, Caregiver" /></Field>
          <Field label="Access">
            <select className="control" value={form.accessLevel} onChange={(e) => setForm({ ...form, accessLevel: e.target.value as "viewer" | "editor" })}>
              <option value="viewer">View only</option>
              <option value="editor">Can edit</option>
            </select>
          </Field>
          <div className="row"><button className="btn btn-line" onClick={() => setInviting(false)}>Cancel</button><button className="btn btn-gold" onClick={invite} disabled={form.userId.trim().length !== 24}>Send invite</button></div>
        </div>
      )}
      <p className="muted small row" style={{ marginTop: 14, gap: 6 }}><AlertCircle size={13} /> The invited person accepts on their My elders page using this elder's ID.</p>
    </div>
  );
}
