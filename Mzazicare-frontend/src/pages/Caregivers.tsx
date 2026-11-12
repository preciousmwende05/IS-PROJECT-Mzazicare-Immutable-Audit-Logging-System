import { useState } from "react";
import { Link } from "react-router-dom";

import { Avatar, Badge, ErrorBox, PageHead, Stat, Tabs, useAsync } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CAREGIVER_STATUS } from "@/lib/caregivers";
import { fmtWhen, kes } from "@/lib/format";
import type { Caregiver, CaregiverStatus } from "@/lib/types";

type Tab = "submitted" | "under_review" | "more_info" | "approved" | "rejected" | "suspended";

const TABS: { id: Tab; label: string }[] = [
  { id: "submitted", label: "New" },
  { id: "under_review", label: "Under review" },
  { id: "more_info", label: "Waiting on caregiver" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "suspended", label: "Suspended" },
];

const countOf = (status: CaregiverStatus) =>
  api.page<Caregiver>("/caregivers", { status, limit: 1 }).then((p) => p.total);

/**
 * Caregiver applications (coordinator and admin).
 * GET /caregivers?status=... Each application opens the review page, where the
 * documents are checked and the caregiver is approved, rejected or asked for more.
 */
export default function Caregivers() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("submitted");
  const [page, setPage] = useState(1);

  const list = useAsync(() => api.page<Caregiver>("/caregivers", { status: tab, page, limit: 20 }), [tab, page]);
  const counts = useAsync(async () => {
    const [submitted, underReview, approved] = await Promise.all([countOf("submitted"), countOf("under_review"), countOf("approved")]);
    return { submitted, underReview, approved };
  });

  const rows = list.data?.items ?? [];

  return (
    <>
      <PageHead
        crumb="Accounts & access"
        title="Caregiver applications"
        sub="Check each caregiver's documents before they can be assigned to a family. Every decision is recorded in the audit log."
      />
      <div className="grid g3" style={{ marginBottom: 20 }}>
        <Stat dark label="Waiting for review" value={counts.data?.submitted ?? 0} hint="Submitted, nobody has started yet" />
        <Stat label="Under review" value={counts.data?.underReview ?? 0} hint="A reviewer is checking documents" />
        <Stat label="Approved caregivers" value={counts.data?.approved ?? 0} hint="Can be assigned to visits" />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Applications</h2>
            <div className="card-sub">Open an application to see its documents and decide.</div>
          </div>
          <Badge tone="blue">{user?.role === "admin" ? "Admin" : "Coordinator"}</Badge>
        </div>
        <Tabs value={tab} onChange={(t) => { setTab(t); setPage(1); }} items={TABS} />

        <ErrorBox error={list.error} />
        {list.loading && !list.data ? (
          <div className="loading">Loading applications…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No applications here.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Caregiver</th><th>Experience</th><th>Areas</th><th>Rate</th><th>Status</th><th>Updated</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="row">
                      <Avatar name={c.fullName} />
                      <div>
                        <b>{c.fullName ?? "Unnamed caregiver"}</b>
                        <div className="muted small">{c.skills.slice(0, 3).join(", ")}</div>
                      </div>
                    </div>
                  </td>
                  <td>{c.yearsExperience} {c.yearsExperience === 1 ? "year" : "years"}</td>
                  <td className="small">{c.serviceAreas.join(", ")}</td>
                  <td>{kes(c.hourlyRateCents)}</td>
                  <td>
                    <Badge tone={CAREGIVER_STATUS[c.status].tone}>{CAREGIVER_STATUS[c.status].label}</Badge>
                    {c.flaggedForReview && <div style={{ marginTop: 4 }}><Badge tone="red">Flagged</Badge></div>}
                  </td>
                  <td className="muted small">{fmtWhen(c.updatedAt)}</td>
                  <td><Link className="btn btn-line" to={`/caregivers/${c.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {list.data && list.data.totalPages > 1 && (
          <div className="row" style={{ marginTop: 14 }}>
            <span className="muted small">Page {list.data.page} of {list.data.totalPages}</span>
            <span className="spacer" />
            <button className="btn btn-line" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="btn btn-line" disabled={page >= list.data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}
