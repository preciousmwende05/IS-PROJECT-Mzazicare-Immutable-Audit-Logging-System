import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ClipboardList,
  FileLock2,
  Heart,
  HelpCircle,
  IdCard,
  ListChecks,
  Lock,
  ShieldCheck,
  UserCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import { api, type Role } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SUPPORT_LINE } from "@/lib/kenya";
import { Avatar } from "./ui";
import { BrandMark } from "./AuthLayout";

type NavItem = { to: string; label: string; icon: LucideIcon; roles: Role[]; count?: boolean };
type NavGroup = { label: string; crumb: string; items: NavItem[] };

const ALL: Role[] = ["family", "elder", "caregiver", "coordinator", "admin", "auditor"];

/** Who may open what. A locked item is shown greyed with a padlock, as in the design. */
export const NAV: NavGroup[] = [
  {
    label: "Accounts & access",
    crumb: "Accounts & access",
    items: [
      { to: "/users", label: "Users", icon: Users, roles: ["admin"] },
      { to: "/caregivers", label: "Caregiver applications", icon: UserCheck, roles: ["coordinator", "admin"] },
      { to: "/caregiver-profile", label: "My caregiver profile", icon: IdCard, roles: ["caregiver"] },
    ],
  },
  {
    label: "Elder records",
    crumb: "Elder records",
    items: [
      { to: "/elders", label: "My elders", icon: Heart, roles: ["family", "elder", "caregiver", "coordinator", "admin"] },
      { to: "/elders/new", label: "Add elder", icon: UserPlus, roles: ["family"] },
    ],
  },
  {
    label: "Visit scheduling",
    crumb: "Visit scheduling",
    items: [
      { to: "/visits", label: "My visits", icon: CalendarDays, roles: ["family", "elder", "caregiver", "coordinator", "admin"] },
      { to: "/visits/new", label: "Request a visit", icon: CalendarPlus, roles: ["family"] },
    ],
  },
  {
    label: "Care logs",
    crumb: "Care logs",
    items: [{ to: "/visit", label: "Visit details & logs", icon: ClipboardList, roles: ["family", "elder", "caregiver", "coordinator", "admin"] }],
  },
  {
    label: "Consent & data rights",
    crumb: "Consent & data rights",
    items: [
      { to: "/privacy", label: "Privacy & consent", icon: ShieldCheck, roles: ["family", "elder"] },
      { to: "/data-requests", label: "Data requests", icon: FileLock2, roles: ["admin"] },
    ],
  },
  {
    label: "Notifications & audit",
    crumb: "Notifications & audit",
    items: [
      { to: "/notifications", label: "Notifications", icon: Bell, roles: ALL, count: true },
      { to: "/audit", label: "Audit log", icon: ListChecks, roles: ["admin", "auditor"] },
    ],
  },
];

const crumbFor = (path: string): string => {
  let best: { len: number; crumb: string } = { len: 0, crumb: "" };
  for (const g of NAV)
    for (const i of g.items)
      if ((path === i.to || path.startsWith(i.to + "/")) && i.to.length > best.len) best = { len: i.to.length, crumb: g.crumb };
  return best.crumb;
};

/** Unread notifications, refreshed every 20 s so new activity shows up live. */
function useUnread(): number {
  const [count, setCount] = useState(0);
  const location = useLocation();
  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .get<{ count: number }>("/notifications/unread-count")
        .then((r) => alive && setCount(r.count))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 20_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [location.pathname]);
  return count;
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const unread = useUnread();
  const [menu, setMenu] = useState(false);
  if (!user) return null;

  return (
    <div className="app">
      <aside className="side">
        <BrandMark />
        <div className="network">
          <b>Nairobi care network</b>
          <span>Secure care workspace</span>
        </div>

        {NAV.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-label">{group.label}</div>
            {group.items.map((item) => {
              const allowed = item.roles.includes(user.role);
              const Icon = item.icon;
              if (!allowed)
                return (
                  <div key={item.to} className="nav-item locked" title="Not available for your role">
                    <Icon size={17} /> {item.label} <Lock className="lock" size={12} />
                  </div>
                );
              return (
                <NavLink key={item.to} to={item.to} end className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
                  <Icon size={17} /> {item.label}
                  {item.count && unread > 0 && <span className="count">{unread}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}

        <div className="side-foot">
          <b>
            <HelpCircle size={16} /> Help &amp; support
          </b>
          {SUPPORT_LINE} · MzaziCare v0.1, built for dignity and trust.
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <div className="crumb">
            <ShieldCheck size={17} color="#b8862a" /> Care operations <span>/ {crumbFor(location.pathname) || "Workspace"}</span>
          </div>
          <div className="top-right">
            <button className="bell" onClick={() => navigate("/notifications")} aria-label="Notifications">
              <Bell size={19} />
              {unread > 0 && <i>{unread}</i>}
            </button>
            <div className="me" style={{ position: "relative" }}>
              <Avatar name={user.name} />
              <div>
                <b>{user.name}</b>
                <small>{user.role}</small>
              </div>
              <button className="link" onClick={() => setMenu((m) => !m)} aria-label="Account menu">
                <ChevronDown size={16} />
              </button>
              {menu && (
                <div className="card" style={{ position: "absolute", top: 52, right: 0, width: 300, zIndex: 10, padding: 16 }}>
                  <div className="small muted">Your user ID (share it to be invited to a care circle)</div>
                  <code style={{ fontSize: 12.5, fontWeight: 700, userSelect: "all" }}>{user.id}</code>
                  <div className="hr" style={{ margin: "12px 0" }} />
                  <div className="small muted">Phone</div>
                  <b>{user.phone}</b>
                </div>
              )}
            </div>
            <button
              className="logout"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Log out
            </button>
          </div>
        </header>

        <div className="content">
          <Outlet />
        </div>

        <footer className="footer">
          <span>© 2026 MzaziCare · Confidential care information</span>
          <nav>
            <Link to="/privacy">Privacy notice</Link>
            <span>Help centre {SUPPORT_LINE}</span>
            <span>All times EAT</span>
          </nav>
        </footer>
      </div>
    </div>
  );
}
