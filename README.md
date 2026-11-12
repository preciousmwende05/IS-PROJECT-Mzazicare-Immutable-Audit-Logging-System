# MzaziCare

**MzaziCare** (Swahili: *mzazi* — "parent") is a care coordination platform that
connects families with vetted caregivers and care services. It is being built as
a **monorepo** containing a backend API and a (planned) frontend application.

- **Backend:** [`Mzazicare-backend/`](Mzazicare-backend/) — an Express +
  TypeScript + MongoDB + Redis **modular monolith** with twelve independently
  owned modules.
- **Frontend:** [`Mzazicare-frontend/`](Mzazicare-frontend/) — not yet scaffolded.

The folder conventions follow the RingR backend, so patterns learned there carry
straight over.

---

## What this project will entail

MzaziCare lets families find, book and monitor in-home care for their loved ones.
The whole platform covers the complete care lifecycle:

1. **Onboarding & identity** — secure registration, authentication and role-based
   access for families, caregivers and operations staff.
2. **Elder care profiles** — a digital record for each care recipient: health
   data, preferences, contact details and documents.
3. **Caregiver network** — vetted caregivers apply, submit KYC documents and go
   through an approval workflow before they appear in the catalog.
4. **Service discovery & booking** — families browse a catalog of care services
   and book visits, with scheduling rules and conflict handling.
5. **Visit execution** — geo-verified visit tracking so families know a caregiver
   arrived, worked and left as planned.
6. **Reporting & feedback** — post-visit reports, ratings and feedback that feed
   back into caregiver quality.
7. **Emergency handling** — a priority lane for emergencies with escalation to
   the right responder as fast as possible.
8. **Payments & billing** — pay for services (M-Pesa in the Kenyan context) with
   billing records per booking.
9. **Notifications** — SMS, email and push coordination across the whole flow.
10. **Operations & compliance** — a control plane to monitor the platform, plus
    an immutable audit log for compliance.

## Repository layout

```
MzaziCare/
├── README.md                  ← this file
├── Mzazicare-backend/         Express API — modular monolith (12 modules)
│   ├── src/
│   │   ├── app.ts             express app, middleware chain, mounts the routers
│   │   ├── server.ts          boot: db → event worker → queue workers → listen
│   │   ├── seed.ts            development data
│   │   ├── db/                mongoose connection
│   │   ├── shared/            config, errors, events, middleware, queues,
│   │   │                      services, utils (shared by every module)
│   │   └── modules/           one folder per feature (see below)
│   ├── docs/                  ARCHITECTURE.md, MODULE_GUIDE.md
│   ├── docker-compose.yml     MongoDB + Redis + RustFS + the API
│   └── package.json           pnpm workspace root for the backend
└── Mzazicare-frontend/        (planned) client application
```

## The twelve backend modules

Every module owns its feature end to end: `routes/`, `controllers/`, `services/`,
`repository/`, `models/`, `views/`, `validation/`, plus `consumers/` and
`workers/` where the module reacts to events or does background work.

| Code | Module | What it does |
| ---- | ------ | ------------ |
| U-CS 67 | `auth-service` | Secure user registration & authentication |
| U-CS 68 | `elder-service` | Digital elder profile & care data |
| U-CS 69 | `caregiver-service` | Caregiver KYC & approval workflow |
| U-CS 70 | `catalog-service` | Care services discovery & catalog |
| U-CS 71 | `booking-service` | Care service booking & scheduling |
| U-CS 72 | `emergency-service` | Priority emergency handling & escalation |
| U-CS 73 | `visit-service` | Geo-verified visit tracking |
| U-CS 74 | `report-service` | Care visit reporting & feedback |
| U-CS 75 | `billing-service` | Care services payment & billing |
| U-CS 76 | `notification-service` | Care coordination notifications |
| U-CS 77 | `operations-service` | Care operations monitoring & control |
| U-CS 78 | `audit-service` | Immutable audit logging & compliance |

Two rules keep the teams out of each other's way:

1. **Stay in your folder** — shared code lives in `src/shared/`; changing it
   affects everyone, so flag it first.
2. **Never import another module's `repository/` or `models/`** — call its
   service, or react to its event. ESLint enforces this.

## Tech stack

| Layer | Choice |
| ----- | ------ |
| Runtime | Node.js (≥ 20) |
| Language | TypeScript |
| Web framework | Express |
| Database | MongoDB (Mongoose) |
| Queue / background | BullMQ + Redis |
| Object storage | RustFS (S3-compatible) |
| Validation | Zod |
| Logging | Winston |
| Auth | JWT (access + refresh), bcrypt |
| Payments | M-Pesa (Daraja) via `shared/services/mpesa` stub |
| Notifications | SMS (Africa's Talking stub), email (Nodemailer SMTP), push |

## Getting started

```bash
# Backend
cd Mzazicare-backend
corepack enable        # use the pinned pnpm — not npm/yarn
pnpm install
cp .env.example .env   # fill in the two JWT secrets
pnpm infra:up          # full stack: MongoDB + Redis + RustFS + the API
pnpm dev               # http://localhost:4000/v1/health
pnpm test              # unit tests, no database needed
```

Every push runs `.github/workflows/ci.yml`: backend typecheck, lint, tests and
build, the frontend build, and a seeded run of the anomaly model with a quality
gate. Results for each commit are kept under the Actions tab.

The frontend is not scaffolded yet; when it lands it will live in
`Mzazicare-frontend/` and talk to the API through the `/v1` prefix.

## Where to read next

- [`Mzazicare-backend/README.md`](Mzazicare-backend/README.md) — backend setup,
  scripts, Docker and module details.
- [`Mzazicare-backend/docs/ARCHITECTURE.md`](Mzazicare-backend/docs/ARCHITECTURE.md)
  — the layers, the module map, events vs queues, and the module-interaction rules.
- [`Mzazicare-backend/docs/MODULE_GUIDE.md`](Mzazicare-backend/docs/MODULE_GUIDE.md)
  — a complete worked module, file by file, plus the PR checklist.