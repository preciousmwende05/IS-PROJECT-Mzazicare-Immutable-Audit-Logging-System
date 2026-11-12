import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/AppLayout";
import type { Role } from "@/lib/api";
import { homeFor, useAuth } from "@/lib/auth";
import Audit from "@/pages/Audit";
import CaregiverProfile from "@/pages/CaregiverProfile";
import CaregiverReview from "@/pages/CaregiverReview";
import Caregivers from "@/pages/Caregivers";
import DataRequests from "@/pages/DataRequests";
import ElderForm from "@/pages/ElderForm";
import ElderRecord from "@/pages/ElderRecord";
import Elders from "@/pages/Elders";
import Login from "@/pages/Login";
import Notifications from "@/pages/Notifications";
import Privacy from "@/pages/Privacy";
import Register from "@/pages/Register";
import RequestVisit from "@/pages/RequestVisit";
import Users from "@/pages/Users";
import Verify from "@/pages/Verify";
import VisitDetail, { LatestVisit } from "@/pages/VisitDetail";
import Visits from "@/pages/Visits";

const CARE: Role[] = ["family", "elder", "caregiver", "coordinator", "admin"];

/** Signed-in only; optionally limited to some roles. */
function Guard({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

/** Signed-out only: a signed-in user visiting /login goes home. */
function Public({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user ? <Navigate to={homeFor(user.role)} replace /> : <>{children}</>;
}

export default function App() {
  const { ready, user } = useAuth();
  if (!ready) return <div className="loading">Loading MzaziCare…</div>;

  return (
    <Routes>
      <Route path="/login" element={<Public><Login /></Public>} />
      <Route path="/register" element={<Public><Register /></Public>} />
      <Route path="/verify" element={<Public><Verify /></Public>} />

      <Route element={<Guard><AppLayout /></Guard>}>
        <Route path="/users" element={<Guard roles={["admin"]}><Users /></Guard>} />
        <Route path="/caregivers" element={<Guard roles={["coordinator", "admin"]}><Caregivers /></Guard>} />
        <Route path="/caregivers/:id" element={<Guard roles={["coordinator", "admin"]}><CaregiverReview /></Guard>} />
        <Route path="/caregiver-profile" element={<Guard roles={["caregiver"]}><CaregiverProfile /></Guard>} />
        <Route path="/elders" element={<Guard roles={CARE}><Elders /></Guard>} />
        <Route path="/elders/new" element={<Guard roles={["family"]}><ElderForm /></Guard>} />
        <Route path="/elders/:id" element={<Guard roles={CARE}><ElderRecord /></Guard>} />
        <Route path="/elders/:id/edit" element={<Guard roles={CARE}><ElderForm /></Guard>} />
        <Route path="/visits" element={<Guard roles={CARE}><Visits /></Guard>} />
        <Route path="/visits/new" element={<Guard roles={["family"]}><RequestVisit /></Guard>} />
        <Route path="/visit" element={<Guard roles={CARE}><LatestVisit /></Guard>} />
        <Route path="/visit/:id" element={<Guard roles={CARE}><VisitDetail /></Guard>} />
        <Route path="/privacy" element={<Guard roles={["family", "elder"]}><Privacy /></Guard>} />
        <Route path="/data-requests" element={<Guard roles={["admin"]}><DataRequests /></Guard>} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/audit" element={<Guard roles={["admin", "auditor"]}><Audit /></Guard>} />
      </Route>

      <Route path="*" element={<Navigate to={user ? homeFor(user.role) : "/login"} replace />} />
    </Routes>
  );
}
