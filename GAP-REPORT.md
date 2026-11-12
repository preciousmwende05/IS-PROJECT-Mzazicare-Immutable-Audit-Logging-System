# MzaziCare: gap report against the target feature list

Run on 2026-11-04 against the local Docker stack (MongoDB, Redis, RustFS, API on `:4000`)
on branch `ucs-78-audit`, including your uncommitted audit work.

- `pnpm typecheck`: passes. It misses real runtime crashes, though (see "Elder Records").
- API smoke test: 37 checks, 17 pass, 20 fail. **After the elder-wiring fix: 42 checks, 31 pass, 11 fail.**
- Automated tests in the repo: **none** (0 `*.test.ts` files). CI: none (no `.github/`). Frontend: **not created**.

Legend: ✅ works (verified live) · ⚠️ partly / buggy · ❌ missing

---

## 1. Accounts & Access

| Feature | Status | Notes |
|---|---|---|
| Log in | ✅ | |
| Log out | ✅ | The refresh token is revoked after logout. |
| Register | ⚠️ | Works through phone OTP over SMS (not tested live, to avoid sending a real SMS). |
| Account lock after 5 failed logins | ✅ | Returns `423 ACCOUNT_LOCKED` (15-minute lock). |
| Roles: family, caregiver, coordinator, admin | ✅ | The code also has an extra `elder` role. |
| Role: **auditor** | ❌ | Not in `USER_ROLES` (`auth-service/models/auth.model.ts:30`). The audit routes are `admin`-only. |
| Admin deactivates a user | ⚠️ | `PATCH /auth/users/:id/status` works and blocks new logins. **Bug:** the deactivated user's existing access token keeps working (`GET /auth/me` returned 200). The middleware never re-checks status. |
| Admin changes a user's role | ❌ | No endpoint (`PATCH /auth/users/:id/role` → 404). |
| Audit `user.logged_in` | ⚠️ | Published as an event, but the audit consumer only listens to `audit.recorded`, so it isn't sealed into the chain. The route-level `audit("auth.login")` is recorded. |
| Audit `auth.login.failed` | ❌ | Not emitted anywhere. The `audit()` middleware deliberately skips responses ≥ 400, so failed logins never reach the log. **This breaks credential-stuffing detection.** |
| Audit `user.role.changed` | ❌ | There is no role-change feature to emit it. |
| Audit `user.deactivated` | ⚠️ | Logged as the generic `auth.status_changed`, not `user.deactivated`. |

## 2. Elder Records

| Feature | Status | Notes |
|---|---|---|
| Create / edit an elder profile | ✅ | |
| Care plan: view, update, history | ✅ **fixed** | `ElderCareDataService` is now instantiated in `elder.service.ts`. The unsafe cast in the controller is gone. |
| Emergency contacts | ✅ **fixed** | `priority` is required. |
| Care circle: list, invite, update, remove | ✅ **fixed** | |
| Care-circle invite acceptance | ✅ **added** | `POST /elders/:id/care-circle/accept`. Invites were stored as pending with no way to accept them. |
| Care-circle caregiver can view the elder and care plan | ✅ | A viewer gets 403 on edit. A pending invite grants no access. |
| Outsider blocked | ✅ | 404 for the profile and the care plan. |
| Audit `elder.viewed` | ⚠️ | Not tagged on `GET /elders/:id`. It only appears in the seeded/simulated audit data. |
| Audit `careplan.viewed`, `careplan.updated`, `carecircle.member.added` | ⚠️ | The routes are tagged, but with different names (`elder.care_plan.viewed`, `elder.care_circle.invited`). The routes also crash, so nothing is written. |
| Audit `access.denied` | ❌ | Not emitted anywhere, for the same ≥ 400 skip as above. **This breaks snooping detection.** |

## 3. Visit Scheduling

Your spec flow: request → assign → completed / cancelled. In the code this lives in `booking-service`, which is the most complete module (~4.5k lines). It still can't run.

| Feature | Status | Notes |
|---|---|---|
| Family requests a visit (`POST /bookings`) | ✅ **fixed** | Returns 201 with status `requested`. The price is captured at booking time. Overlapping requests for the same elder are rejected (409). |
| Each user lists their visits (`GET /bookings`) | ✅ **fixed** | The elder service now provides `getById`, `isInCareCircle` and `listElderIdsForUser`. |
| Booking needs a published care service | ✅ **built** | `catalog-service` (U-CS 70) is implemented. Archived and draft services are not bookable. |
| Coordinator assigns a caregiver | ⚠️ | **Next blocker.** The automatic matching worker fails with `caregiver-service cannot answer "findAssignable"`. Force-assign needs an *approved* caregiver profile, and the test caregiver has none. |
| Cancel | ⚠️ | Exists and is now reachable. Not yet tested live. |
| Audit `visit.requested`, `visit.assigned`, `visit.cancelled` | ⚠️ | Emitted as `booking.created`, `booking.assigned` and `booking.cancelled`. |
| Simplicity | ⚠️ | The code has offers, matching, recurrence and pricing, which is far more than your spec. That's fine, but it's more to keep working. |

## 4. Care Logs

| Feature | Status | Notes |
|---|---|---|
| Caregiver check-in / check-out | ⚠️ | **Directories fixed:** both are registered in `server.ts`, and `caregiverService.getCaregiverIdForUser` was added, so `GET /visits` returns 200. No visit can exist until bookings work, because visits are created from `booking.confirmed`. |
| Optional location | ✅ in code | Location checks are built (more than you need). |
| Notes and vitals (blood pressure, mood, meals) | ❌ | No fields on the visit model and no endpoint. `report-service` (U-CS 74), where this belongs, is an empty scaffold. |
| Family reads the log | ❌ | `GET /reports` → 404. |
| Audit `visit.checked_in`, `visit.checked_out` | ✅ in code | Tagged on the routes. |
| Audit `carelog.created`, `carelog.viewed` | ❌ | |

## 5. Consent & Data Rights (Kenya Data Protection Act)

**Nothing exists.** There's no module, model or route.

| Feature | Status |
|---|---|
| Record consent (grant / withdraw) | ❌ |
| "Who accessed my data" (family-facing view of the audit log, filtered to their elder) | ❌ The audit list is admin-only, and it filters on actor/action, not the subject elder. |
| Data access request (export the elder's data) | ❌ |
| Deletion request workflow: requested → reviewed → done / refused, with a reason | ❌ |
| Audit `consent.granted`, `consent.withdrawn`, `datarequest.submitted`, `datarequest.completed` | ❌ |

## 6. In-App Notifications

| Feature | Status | Notes |
|---|---|---|
| Inbox, unread count, mark all read | ✅ | Also has preferences and a real-time stream. |
| Mark a single notification as read | ✅ in code | Not tested live, because the inbox was empty. |
| Notify on visit assigned / completed | ⚠️ | Templates exist, but they can't fire until bookings and visits work. |
| Alert admins **and auditors** when the anomaly model flags something | ❌ | The ML model isn't connected to the backend, and the auditor role doesn't exist. |
| Alert when the chain fails verification | ❌ | `verify()` exists but isn't scheduled. `audit.worker.ts` is still a TODO, and nothing notifies anyone. |

## Audit log (U-CS 78, your module)

| Item | Status |
|---|---|
| HMAC hash chain, checkpoints, `GET /audit/verify` | ✅ Verified intact over 15,014 entries. |
| Admin list / get by sequence; non-admin blocked | ✅ |
| Only `audit.recorded` is consumed | ⚠️ Domain events such as `user.logged_in` and `visit.missed` aren't recorded. |
| Failed or denied actions never logged | ❌ The middleware skips status ≥ 400. You need a separate path for `auth.login.failed` and `access.denied`. |
| Event names don't match your spec's names | ⚠️ Pick one naming scheme. The ML features depend on it. |
| Seeded / simulated data mixed into the dev DB | ⚠️ The ~15k seeded entries share the chain with real ones. Keep them out of production. |
| Module `README.md` still the empty template | ⚠️ |
| Work uncommitted on `ucs-78-audit` | ⚠️ |

## ML anomaly detection (`ml/audit-anomaly`)

- Offline only. The best run (role-relative Isolation Forest) gets F1 0.93 on **simulated** data.
- ❌ No scoring service.
- ❌ No connection from the audit log to the model.
- ❌ No alerts.

## Modules not in your spec but in the repo

- `billing-service`, `operations-service`, `report-service`: empty scaffolds.
- `catalog-service`: **built.** Categories, services, draft → published → archived lifecycle, price history, text/category/price search, Redis cache.
- `emergency-service`, `caregiver-service` (KYC): built.

Catalog was the only one blocking your spec, and it is now built.

## Production readiness (needed regardless of features)

- ✅ Frontend web app: built (Vite + React, 14 pages).
- ✅ Automated tests: 69 (`pnpm test`).
- ✅ CI pipeline: `.github/workflows/ci.yml`.
- ❌ Production deployment config: there's only a dev `docker-compose` and a `Dockerfile`. Still needed: hosting target, managed Mongo/Redis, secrets management, TLS, backups.
- ⚠️ `.env.example` is deleted in your working tree, so new developers won't know which variables to set.
- ⚠️ Booted with `tsx watch` in Docker. Production needs the compiled `pnpm build && pnpm start` image.

## Suggested order to fix

1. ~~**Wire the elder module.**~~ **Done.** Instantiate `ElderCareDataService`, add `isInCareCircle` and `listElderIdsForUser`, and register the visit directories. This unblocks Elder Records, Scheduling and Care Logs in one go.
2. ~~**Minimal catalog**~~ **Done.** A family can request a visit.
3. ~~**Audit coverage.**~~ **Done (2026-11-05).** `access.denied` (403s and hidden 404s), `auth.login.failed`, spec event names, `elder.viewed`, entries tagged with the record they concern, user status re-checked on every request.
4. ~~**Accounts.**~~ **Done (2026-11-05).** Auditor role, users list, role change, `user.deactivated`, immediate cut-off.
5. ~~**Care logs.**~~ **Done (2026-11-05).** Notes, blood pressure, mood and meals per visit, written once by the assigned caregiver after check-in, read by the care circle (`carelog.created` / `carelog.viewed`, family notified). Check-in/out location is now optional (`no_location` flag). Also fixed: visits were never created from confirmed bookings, bookings never learnt their visit before check-in, and care-circle notifications had no recipients.
6. ~~**Consent & Data Rights module**~~ **Done (2026-11-05).** New `consent-service` at `/v1/privacy`: care-plan sharing consent (enforced on caregivers), "who accessed my data" from the audit log, data download, deletion requests reviewed by an admin (refused while visits are booked; approval erases personal data, keeps visit/care/audit records). Privacy and Data requests pages are live.
7. ~~**Notifications.**~~ **Done (2026-11-05).** Chain verified automatically every 30 min (a break alerts admins + auditors, critical); policy rules (3+ refusals / 5+ failed sign-ins in 15 min) raise alerts every 2 min; `ml/audit-anomaly/src/live.py alert --run <run>` raises model alerts into the same store; admins and auditors are notified in-app and resolve alerts on the Audit log page. Also fixed: role-wide notifications (e.g. coordinators) had no recipients, and `GET /audit/:sequence` always returned 422.
8. **Frontend, tests, CI, production deployment.** Tests and CI **done (2026-11-05)**:
   - 69 unit tests in `Mzazicare-backend/tests/` (`pnpm test`): HMAC hash chain and checkpoints, append-only store, audit middleware, access control (auditor role, immediate cut-off), and the client address behind a proxy. They need no database.
   - `.github/workflows/ci.yml` runs on every push: backend typecheck, lint, tests and build; frontend typecheck and build; the seeded anomaly pipeline (simulate, features, train, evaluate) with a quality gate (hybrid F1 at least 0.85, PR-AUC at least 0.90, and better than the baseline). Test reports and ML run evidence are kept per commit as artifacts for 90 days.
   - `trust proxy` is set from `TRUST_PROXY` (1 in production, 0 otherwise), so the audit log and rate limits see the real client address behind Caddy.
   - Frontend: built (14 pages). Production deployment: kit ready in `deploy/` (Sprint III).

### Parked: come back to these after steps 5–7
- **Coordinator assignment.** A coordinator assigns a caregiver by hand (no auto-matching). It needs an approved caregiver profile to assign.
- **Retrain the anomaly model on live data.** The live audit log is mostly simulator output: 15,000 seeded entries from Aug 2–5 (`metadata.seed = true`), with only about 170 real events from about 14 accounts. That is too few to learn "normal" from. Done so far (2026-11-05): the simulator was aligned with what the backend emits (sim-v3), a live-data path was built (`ml/audit-anomaly/src/live.py`: `export`, `score`, `train`), and the pipeline bugs were fixed. Still to do: once there is real activity (`live.py train` asks for at least 14 days, 50 people and 2,000 windows), run `python src/live.py train`, compare it with the sim-v3 run, and pick which one goes live. Current best: `runs/20261105-025753_113141a_sim-v3-role-relative`, hybrid F1 0.92 on sim-v3 test weeks.

---

### How this was tested

- **Local accounts:** six local accounts were inserted straight into the dev DB (phones `+254700990001`–`6`, one per role) to avoid the OTP SMS: Wanjiru Kamau and Achieng Otieno (family), Mercy Chebet (caregiver), Brian Kiprotich (coordinator), Faith Mutua (admin), Joseph Ochieng (elder). Their elders are Mary Wambui, Esther Nyokabi and Ruth Akinyi.
- **Check scripts:** the API check scripts live in the session scratchpad, not the repo.
