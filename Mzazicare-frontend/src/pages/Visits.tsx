import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardCheck } from "lucide-react";

import { Avatar, Badge, Banner, ErrorBox, PageHead, SearchBox, Stat, Tabs, useAsync } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtTime, shortId, STAGE_BADGE, STAGE_LABEL, stageOf, type VisitStage } from "@/lib/format";
import type { Booking, CareService, Elder } from "@/lib/types";

type Filter = "all" | VisitStage;

/** Page 9 — My visits. Families see their elders' visits, caregivers theirs, coordinators all. */
export default function Visits() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const { data, error, loading } = useAsync(async () => {
    const [bookings, elders, services] = await Promise.all([
      api.page<Booking>("/bookings", { limit: 100 }),
      api.page<Elder>("/elders", { limit: 100 }).catch(() => ({ items: [] as Elder[] })),
      api.page<CareService>("/services", { limit: 100 }).catch(() => ({ items: [] as CareService[] })),
    ]);
    return { bookings: bookings.items, elders: elders.items, services: services.items };
  });

  const elderName = (id: string) => {
    const e = data?.elders.find((x) => x.id === id);
    return e ? `${e.firstName} ${e.lastName}` : `Elder ${shortId(id, "EL-")}`;
  };
  const svc = (id: string) => data?.services.find((s) => s.id === id)?.name ?? "Care visit";

  const rows = useMemo(() => (data?.bookings ?? []).slice().sort((a, b) => b.scheduledFor.localeCompare(a.scheduledFor)), [data]);
  const count = (s: VisitStage) => rows.filter((b) => stageOf(b.status) === s).length;
  const visible = rows.filter(
    (b) => (tab === "all" || stageOf(b.status) === tab) && `${elderName(b.elderId)} ${b.id}`.toLowerCase().includes(q.toLowerCase()),
  );
  const coordinator = user?.role === "coordinator" || user?.role === "admin";

  return (
    <>
      <PageHead
        crumb="Visit scheduling"
        title="My visits"
        sub="From the first request to the last care note. Keep every visit on track."
        actions={coordinator && <button className="btn btn-gold" onClick={() => setTab("requested")}><ClipboardCheck size={16} /> Review requests</button>}
      />
      <div className="grid g4" style={{ marginBottom: 20 }}>
        <Stat dark label="Requested" value={count("requested")} hint={coordinator ? "Ready for coordinator review" : "Waiting for a caregiver"} />
        <Stat label="Assigned" value={count("assigned") + count("in_progress")} hint="Caregiver confirmed" />
        <Stat label="Completed" value={count("completed")} hint="Care logs available to families" />
        <Stat label="Cancelled" value={count("cancelled")} hint="Including no-shows" />
      </div>
      {coordinator && (
        <div style={{ marginBottom: 20 }}>
          <Banner tone="info" title="Coordinator view · All network requests">
            You can review and assign every visit. Families see visits for their elders; caregivers see only their assigned visits.
          </Banner>
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <div><h2>Visit register</h2><div className="card-sub">Nairobi care network · times in EAT</div></div>
        </div>
        <Tabs<Filter>
          value={tab}
          onChange={setTab}
          items={[
            { id: "all", label: `All visits ${rows.length}` },
            { id: "requested", label: `Requested ${count("requested")}` },
            { id: "assigned", label: `Assigned ${count("assigned")}` },
            { id: "completed", label: `Completed ${count("completed")}` },
            { id: "cancelled", label: `Cancelled ${count("cancelled")}` },
          ]}
        />
        <div className="toolbar"><SearchBox value={q} onChange={setQ} placeholder="Search elder or visit ID" /></div>
        <ErrorBox error={error} />
        {loading ? (
          <div className="loading">Loading visits…</div>
        ) : visible.length === 0 ? (
          <div className="empty">No visits here yet.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Elder / visit</th><th>Type of help</th><th>Date &amp; time</th><th>Caregiver</th><th>Status</th><th /></tr></thead>
            <tbody>
              {visible.map((b) => {
                const stage = stageOf(b.status);
                return (
                  <tr key={b.id}>
                    <td><div className="who"><Avatar name={elderName(b.elderId)} /><div><b>{elderName(b.elderId)}</b><small>{shortId(b.id, "VIS-")}</small></div></div></td>
                    <td>{svc(b.serviceId)}</td>
                    <td>{fmtDate(b.scheduledFor)} · {fmtTime(b.scheduledFor)}–{fmtTime(b.endsAt)}</td>
                    <td>{b.caregiverId ? `Caregiver ${shortId(b.caregiverId)}` : <span style={{ color: "#b8862a" }}>Awaiting assignment</span>}</td>
                    <td><Badge tone={STAGE_BADGE[stage]}>{STAGE_LABEL[stage]}</Badge></td>
                    <td><button className="link" onClick={() => navigate(`/visit/${b.id}`)}>Open →</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
