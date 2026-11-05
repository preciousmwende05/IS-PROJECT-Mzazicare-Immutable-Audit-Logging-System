import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, MapPin, Plus, ShieldCheck } from "lucide-react";

import { Avatar, Badge, Banner, ErrorBox, PageHead, SearchBox, useAsync } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { durationLabel, fmtWhen, shortId, STAGE_BADGE, STAGE_LABEL, stageOf } from "@/lib/format";
import type { Booking, CareService, Elder } from "@/lib/types";

/**
 * Page 5 — My elders. Families and caregivers see their care circles; admins
 * and coordinators see every elder. Search runs on the server (name, estate
 * or county), so it covers every elder, not just the ones loaded.
 */
export default function Elders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");

  // Search after a short pause in typing, not on every key.
  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const eldersQuery = useAsync(() => api.page<Elder>("/elders", { limit: 100, q: search || undefined }), [search]);
  const visits = useAsync(async () => {
    const [bookings, services] = await Promise.all([
      api.page<Booking>("/bookings", { limit: 100 }).catch(() => ({ items: [] as Booking[] })),
      api.page<CareService>("/services", { limit: 100 }).catch(() => ({ items: [] as CareService[] })),
    ]);
    return { bookings: bookings.items, services: services.items };
  });
  const reload = () => {
    void eldersQuery.reload();
    void visits.reload();
  };
  const { error, loading } = eldersQuery;
  const elders = eldersQuery.data?.items ?? [];
  const data = { elders, bookings: visits.data?.bookings ?? [], services: visits.data?.services ?? [] };

  const svcName = (id: string) => data.services.find((s) => s.id === id)?.name ?? "Visit";
  const upcoming = useMemo(
    () =>
      (visits.data?.bookings ?? [])
        .filter((b) => new Date(b.scheduledFor) > new Date() && !["cancelled", "no_show", "completed"].includes(b.status))
        .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor)),
    [visits.data],
  );
  const nextFor = (elderId: string) => upcoming.find((b) => b.elderId === elderId);
  const staff = user?.role === "admin" || user?.role === "coordinator";

  return (
    <>
      <PageHead
        crumb="Elder records"
        title="My elders"
        sub="A little closer to the people who matter. Your connected care circles, in one place."
        actions={
          user?.role === "family" && (
            <button className="btn btn-gold" onClick={() => navigate("/elders/new")}>
              <Plus size={16} /> Add elder
            </button>
          )
        }
      />

      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name, estate or county" />
        <span className="spacer" />
        <span className="muted small">
          {eldersQuery.data?.total ?? 0} elders · {staff ? "All elders in the network" : "Only records shared with you"}
        </span>
      </div>

      <ErrorBox error={error} />
      {loading && !eldersQuery.data && <div className="loading">Loading elders…</div>}

      {!loading && !error && elders.length === 0 && (
        <div className="card empty">
          {search
            ? `No elders match "${search}".`
            : staff
              ? "No elders have been added to the network yet."
              : user?.role === "family"
                ? "No elders yet. Add the first person you care for."
                : "You're not in any care circle yet. Ask the family to invite you, then accept below."}
        </div>
      )}

      <div className="grid g3">
        {elders.map((e) => {
          const next = nextFor(e.id);
          const name = `${e.firstName} ${e.lastName}`;
          return (
            <div className="card elder-card" key={e.id}>
              <div className="top-row">
                <Avatar name={name} size="lg" />
                <Badge tone={e.status === "active" ? "green" : ""}>{e.status === "active" ? "Active care" : e.status}</Badge>
              </div>
              <h3>{name}</h3>
              <div className="muted small" style={{ marginTop: 4 }}>
                {shortId(e.id, "EL-")} · {e.age} years · {e.gender[0]!.toUpperCase() + e.gender.slice(1)}
              </div>
              <div className="muted small row" style={{ gap: 6, marginTop: 4 }}>
                <MapPin size={13} /> {[e.address.estate, e.address.county].filter(Boolean).join(", ")}
              </div>
              <div className="hr" />
              <div className="eyebrow" style={{ fontSize: 10.5 }}>Next visit</div>
              {next ? (
                <>
                  <div style={{ fontSize: 18, fontWeight: 800, margin: "6px 0 2px" }}>{fmtWhen(next.scheduledFor)}</div>
                  <div className="muted small">
                    {svcName(next.serviceId)} · {durationLabel(next.durationMinutes)}
                  </div>
                </>
              ) : (
                <div className="muted small" style={{ margin: "6px 0" }}>No visit booked</div>
              )}
              <button className="btn btn-line" style={{ marginTop: 18 }} onClick={() => navigate(`/elders/${e.id}`)}>
                <ArrowRight size={16} /> View elder record
              </button>
            </div>
          );
        })}
      </div>

      {upcoming.length > 0 && (
        <div className="card" style={{ marginTop: 22 }}>
          <div className="card-head">
            <div>
              <h2>Coming up in your care circles</h2>
              <div className="card-sub">Upcoming visits for the elders you can see.</div>
            </div>
            <Link className="link" to="/visits">View all visits →</Link>
          </div>
          <table className="table">
            <thead>
              <tr><th>Elder</th><th>Visit</th><th>When</th><th>Status</th></tr>
            </thead>
            <tbody>
              {upcoming.slice(0, 5).map((b) => {
                const e = data?.elders.find((x) => x.id === b.elderId);
                const stage = stageOf(b.status);
                return (
                  <tr key={b.id} style={{ cursor: "pointer" }} onClick={() => navigate(`/visit/${b.id}`)}>
                    <td>
                      <div className="who">
                        <Avatar name={e ? `${e.firstName} ${e.lastName}` : "?"} />
                        <div><b>{e ? `${e.firstName} ${e.lastName}` : shortId(b.elderId, "EL-")}</b><small>{shortId(b.elderId, "EL-")}</small></div>
                      </div>
                    </td>
                    <td>{svcName(b.serviceId)} · {durationLabel(b.durationMinutes)}</td>
                    <td>{fmtWhen(b.scheduledFor)}</td>
                    <td><Badge tone={STAGE_BADGE[stage]}>{STAGE_LABEL[stage]}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AcceptInvitation onAccepted={reload} />
    </>
  );
}

/** A care-circle invite stays pending until the invited person accepts it here. */
function AcceptInvitation({ onAccepted }: { onAccepted: () => void }) {
  const [elderId, setElderId] = useState("");
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const accept = async () => {
    setMsg(null);
    try {
      await api.post(`/elders/${elderId.trim()}/care-circle/accept`);
      setMsg({ tone: "success", text: "Invitation accepted. The elder now appears above." });
      setElderId("");
      onAccepted();
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    }
  };
  return (
    <div className="card" style={{ marginTop: 22 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <ShieldCheck size={18} color="#6b7a90" style={{ marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <b>Invited to a care circle?</b>
          <div className="muted small">Paste the elder ID the family shared with you to accept the invitation.</div>
          <div className="row" style={{ marginTop: 12 }}>
            <input className="control" style={{ maxWidth: 340 }} value={elderId} onChange={(e) => setElderId(e.target.value)} placeholder="Elder ID" />
            <button className="btn btn-line" disabled={elderId.trim().length !== 24} onClick={accept}>Accept invitation</button>
          </div>
          {msg && <div style={{ marginTop: 12 }}><Banner tone={msg.tone} title={msg.text} /></div>}
        </div>
      </div>
    </div>
  );
}
