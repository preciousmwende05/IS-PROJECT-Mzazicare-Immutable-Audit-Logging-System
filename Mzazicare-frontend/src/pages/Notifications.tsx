import { useEffect, useState } from "react";
import { Bell, CalendarCheck, CheckCheck, ClipboardList, Heart, UsersRound } from "lucide-react";

import { Badge, ErrorBox, PageHead, Tabs, useAsync } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtWhen, titleCase } from "@/lib/format";
import type { Notification } from "@/lib/types";

const ICON: Record<string, typeof Bell> = { booking: CalendarCheck, visit: CalendarCheck, care: Heart, account: UsersRound, report: ClipboardList };

/** Page 13 — Notifications inbox. Refreshes every 20 seconds. */
export default function Notifications() {
  const [tab, setTab] = useState<"all" | "unread">("all");
  const { data, error, loading, reload } = useAsync(() => api.page<Notification>("/notifications", { limit: 50 }));
  useEffect(() => {
    const id = setInterval(reload, 20_000);
    return () => clearInterval(id);
  }, [reload]);

  const items = data?.items ?? [];
  const unread = items.filter((n) => !n.read);
  const shown = tab === "unread" ? unread : items;

  const markRead = async (id: string) => {
    await api.post(`/notifications/${id}/read`);
    reload();
  };
  const markAll = async () => {
    await api.post("/notifications/read-all");
    reload();
  };

  return (
    <>
      <PageHead
        crumb="Notifications & audit"
        title="Notifications"
        sub="The updates that keep your care circle connected."
        actions={<button className="btn btn-line" onClick={markAll} disabled={!unread.length}><CheckCheck size={16} /> Mark all as read</button>}
      />
      <div className="split">
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: "22px 24px 0" }}>
            <div className="card-head" style={{ marginBottom: 10 }}>
              <div><h2>Your inbox</h2><div className="card-sub">{unread.length} unread notifications</div></div>
              {unread.length > 0 && <Badge tone="gold">{unread.length} unread</Badge>}
            </div>
            <Tabs value={tab} onChange={setTab} items={[{ id: "all", label: `All ${items.length}` }, { id: "unread", label: `Unread ${unread.length}` }]} />
          </div>
          <ErrorBox error={error} />
          {loading && !data && <div className="loading">Loading…</div>}
          {data && shown.length === 0 && <div className="empty">You're all caught up.</div>}
          {shown.map((n) => {
            const Icon = ICON[n.category] ?? Bell;
            return (
              <div className={`notif ${n.read ? "" : "unread"}`} key={n.id}>
                <div className="ico"><Icon size={16} /></div>
                <div style={{ flex: 1 }}>
                  <b>{n.title}</b>
                  <p>{n.body}</p>
                  <small>{titleCase(n.category)} · {fmtWhen(n.createdAt)}</small>
                </div>
                {n.read ? <span className="muted small">Read</span> : <button className="link small" onClick={() => markRead(n.id)}>Mark as read</button>}
              </div>
            );
          })}
        </div>
        <div className="card">
          <h2>You're in control</h2>
          <p className="muted small" style={{ margin: "10px 0 16px" }}>Your inbox includes updates for the elders and visits you're permitted to see.</p>
          <div className="kv"><span className="k">In-app notifications</span><span className="v">On · Care &amp; account updates</span></div>
          <div className="kv" style={{ marginTop: 14 }}><span className="k">SMS reminders</span><span className="v">On · Upcoming visits only</span></div>
        </div>
      </div>
    </>
  );
}
