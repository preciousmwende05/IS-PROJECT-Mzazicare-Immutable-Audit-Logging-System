import { useEffect, useState } from "react";

import { Avatar, Badge, Banner, ErrorBox, PageHead, SearchBox, Stat, useAsync } from "@/components/ui";
import { api, errorText, type Role, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatPhone } from "@/lib/kenya";
import { fmtWhen, shortId, titleCase } from "@/lib/format";

const ROLES: Role[] = ["family", "caregiver", "coordinator", "admin", "auditor", "elder"];
type StatusFilter = "" | "active" | "deactivated" | "suspended" | "pending_verification";

/**
 * Page 4 — Users & access (admin).
 * GET /auth/users, PATCH /auth/users/:id/role, PATCH /auth/users/:id/status.
 * Every change is recorded in the audit log by the backend.
 */
export default function Users() {
  const { user: me } = useAuth();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Search after a short pause in typing, not on every key.
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(id);
  }, [q]);

  const list = useAsync(
    () => api.page<User>("/auth/users", { q: search || undefined, role: role || undefined, status: status || undefined, page, limit: 20 }),
    [search, role, status, page],
  );
  const counts = useAsync(async () => {
    const [all, active] = await Promise.all([
      api.page<User>("/auth/users", { limit: 1 }),
      api.page<User>("/auth/users", { status: "active", limit: 1 }),
    ]);
    return { total: all.total, active: active.total };
  });

  const refresh = () => {
    void list.reload();
    void counts.reload();
  };

  const changeRole = async (u: User, next: Role) => {
    if (next === u.role) return;
    if (!confirm(`Change ${u.name}'s role from ${titleCase(u.role)} to ${titleCase(next)}? They will be signed out.`)) return;
    setMsg(null);
    try {
      await api.patch(`/auth/users/${u.id}/role`, { role: next });
      setMsg({ tone: "success", text: `${u.name} is now ${titleCase(next)}. Recorded in the audit log.` });
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    }
    refresh();
  };

  const changeStatus = async (u: User, next: "active" | "deactivated") => {
    if (next === "deactivated" && !confirm(`Deactivate ${u.name}? Their access ends immediately; their records are kept.`)) return;
    setMsg(null);
    try {
      await api.patch(`/auth/users/${u.id}/status`, { status: next });
      setMsg({ tone: "success", text: `${u.name} ${next === "active" ? "reactivated" : "deactivated"}. Recorded in the audit log.` });
    } catch (e) {
      setMsg({ tone: "error", text: errorText(e) });
    }
    refresh();
  };

  const users = list.data?.items ?? [];
  const total = counts.data?.total ?? 0;
  const active = counts.data?.active ?? 0;

  return (
    <>
      <PageHead
        crumb="Accounts & access"
        title="Users & access"
        sub="The right people. The right access. Manage your care network securely."
      />
      <div className="grid g3" style={{ marginBottom: 20 }}>
        <Stat dark label="Total users" value={total} hint="Across the Nairobi network" />
        <Stat label="Active accounts" value={active} hint="6 roles with scoped permissions" />
        <Stat label="Not active" value={total - active} hint="Deactivated, suspended or unverified" />
      </div>

      {msg && <div style={{ marginBottom: 16 }}><Banner tone={msg.tone} title={msg.text} /></div>}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Care network directory</h2>
            <div className="card-sub">Role changes and account actions are recorded in the audit log.</div>
          </div>
          <Badge tone="blue">Admin only</Badge>
        </div>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder="Search name or phone number" />
          <span className="spacer" />
          <select className="control" style={{ width: 160 }} value={role} onChange={(e) => { setRole(e.target.value as Role | ""); setPage(1); }}>
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
          </select>
          <select className="control" style={{ width: 170 }} value={status} onChange={(e) => { setStatus(e.target.value as StatusFilter); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
            <option value="suspended">Suspended</option>
            <option value="pending_verification">Pending verification</option>
          </select>
        </div>

        <ErrorBox error={list.error} />
        {list.loading && !list.data ? (
          <div className="loading">Loading users…</div>
        ) : users.length === 0 ? (
          <div className="empty">No users match.</div>
        ) : (
          <table className="table">
            <thead><tr><th>User</th><th>Phone</th><th>Role</th><th>Status</th><th>Last active</th><th>Action</th></tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id}>
                    <td><div className="who"><Avatar name={u.name} /><div><b>{u.name}</b><small>{shortId(u.id, "USR-")}</small></div></div></td>
                    <td>{formatPhone(u.phone)}</td>
                    <td>
                      <select className="control" style={{ width: 150, padding: "8px 10px" }} value={u.role} disabled={self} onChange={(e) => changeRole(u, e.target.value as Role)}>
                        {ROLES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                      </select>
                    </td>
                    <td><Badge tone={u.status === "active" ? "green" : u.status === "pending_verification" ? "gold" : ""}>{titleCase(u.status)}</Badge></td>
                    <td>{u.lastLoginAt ? fmtWhen(u.lastLoginAt) : "Never"}</td>
                    <td>
                      {self ? (
                        <span className="muted small">Current user</span>
                      ) : u.status === "active" ? (
                        <button className="link link-red" onClick={() => changeStatus(u, "deactivated")}>Deactivate</button>
                      ) : u.status === "deactivated" || u.status === "suspended" ? (
                        <button className="link" onClick={() => changeStatus(u, "active")}>Reactivate</button>
                      ) : (
                        <span className="muted small">Awaiting phone check</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="row" style={{ marginTop: 16 }}>
          <span className="muted small">Page {list.data?.page ?? 1} of {list.data?.totalPages ?? 1} · {list.data?.total ?? 0} users</span>
          <span className="spacer" />
          <button className="btn btn-line" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <button className="btn btn-line" disabled={!list.data || page >= list.data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <Banner tone="info" title="Access follows responsibility">
          Changing a role or deactivating someone signs them out at once. Their care and audit records are kept. You cannot change your own account.
        </Banner>
      </div>
    </>
  );
}
