# MzaziCare — Backend API

Elder care coordination platform. Express + TypeScript + MongoDB + Redis,
built as a **modular monolith**: twelve independently-owned modules in one
deployable app.

The folder convention matches RingR, so what you learn here carries over.

## Getting started

```bash
corepack enable               # ships with Node 20+, gives you the pinned pnpm
pnpm install
cp .env.example .env          # then fill in the two JWT secrets
pnpm infra:up                 # the whole stack: Mongo + Redis + RustFS + the API
pnpm app:logs                 # follow the API logs — http://localhost:4000/v1/health
```

**This project uses pnpm**, pinned in `packageManager`. `corepack enable`
gives you the exact version — do not use npm or yarn, they will produce a
second lockfile and a different dependency tree.

Prefer hot-reloading the API on your host instead of inside the container?
Bring the API container down and run tsx directly:

```bash
pnpm app:down                 # stop the containerised API (frees port 4000)
pnpm dev                      # http://localhost:4000/v1/health
```

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If something already owns port 27017, 6379, 9000 or 9001 on your machine,
change `MONGO_PORT`, `REDIS_PORT`, `RUSTFS_PORT` or `RUSTFS_CONSOLE_PORT` in
`.env` — compose follows them.

The RustFS console is at <http://localhost:9001> (`rustfsadmin` / `rustfsadmin`
by default) if you want to see the uploaded files.

## Object storage

Files live in **RustFS**, an S3-compatible server (a MinIO alternative written
in Rust) — KYC documents, visit photos and elder profile pictures. The bucket
is created at boot and is **private**: the only way a client reads a file is a
short-lived presigned URL. We talk to it through the standard S3 SDK (the
`minio` npm package is just the client library).

```ts
import { storageService } from "@/shared/services/storage.service";

// Upload through the API
const { key } = await storageService.put("kyc", file.name, buffer, file.mimetype);

// Hand the client a link that expires
const url = await storageService.signedUrl(key, KYC_SIGNED_URL_TTL_SECONDS);

// Or let a large file skip the API entirely
const { key, url } = await storageService.signedUploadUrl("visit-photos", "p.jpg");
```

Store the **key** in your model, never a URL — URLs expire, keys do not.
Prefixes (`kyc/`, `visit-photos/`, `elder-photos/`) segregate content by
sensitivity. Moving to real S3 later is a change of environment variables,
not of code.

## Scripts

| Command | What it does |
| ------- | ------------ |
| `pnpm dev` | Start with hot reload |
| `pnpm build` | Compile to `dist/` |
| `npm start` | Run the compiled build |
| `pnpm typecheck` | Type errors only |
| `pnpm lint` | ESLint, including the cross-module import rule |
| `pnpm check` | Typecheck + lint — run this before every PR |
| `pnpm format` | Prettier |
| `pnpm db:seed` | Load development data |
| `pnpm infra:up` / `infra:down` | Start / stop the whole stack: Mongo, Redis, RustFS and the API |
| `pnpm app:up` / `app:down` | Same as `infra:up`, but rebuilds the API image first |
| `pnpm app:logs` | Follow the containerised API's logs |
| `pnpm docker:build` | Build the production image |

## Docker

| File | Purpose |
| ---- | ------- |
| `Dockerfile` | Production. Multi-stage — ships compiled `dist/` and prod deps only, runs as the non-root `node` user. |
| `Dockerfile.dev` | Development. `tsx` hot reload, source bind-mounted. |
| `docker-compose.yml` | The full stack; the API runs by default (tsx hot reload, source bind-mounted). |

```bash
pnpm docker:build                                   # build the prod image
docker run --env-file .env -p 4000:4000 mzazicare-api
```

Inside the compose network, services are reachable by **name** — `mongo`,
`redis`, `rustfs` — not on `localhost`. The `api` service sets those already.
The one that catches people out is `RUSTFS_PUBLIC_URL`: a presigned URL is
signed against a specific host, and `rustfs:9000` does not resolve in your
browser, so it must be signed for the host port instead.

## Layout

```
src/
├── app.ts                    express app, middleware chain, mounts the 12 routers
├── server.ts                 boot: db → event worker → queue workers → listen
├── seed.ts                   development data
├── db/index.ts               mongoose connection
├── shared/
│   ├── config/               env (validated), logger, redis, storage
│   ├── errors/               AppError and its subclasses
│   ├── events/               bus.ts + types.ts — the cross-module contract
│   ├── helpers/              cache helper
│   ├── middleware/           auth, role, validate, audit, logger,
│   │                         rate-limit, error, not-found
│   ├── queues/               BullMQ queue definitions
│   ├── services/             sms, email, push, mpesa (stubs) + storage (RustFS)
│   ├── types/                shared types, express request augmentation
│   └── utils/                response, async, pagination, phone, geo, money, date
└── modules/
    ├── auth-service/          U-CS 67  Secure User Registration & Authentication
    ├── elder-service/         U-CS 68  Digital Elder Profile & Care Data
    ├── caregiver-service/     U-CS 69  Caregiver KYC & Approval Workflow
    ├── catalog-service/       U-CS 70  Care Services Discovery & Catalog
    ├── booking-service/       U-CS 71  Care Service Booking & Scheduling
    ├── emergency-service/     U-CS 72  Priority Emergency Handling & Escalation
    ├── visit-service/         U-CS 73  Geo-Verified Visit Tracking
    ├── report-service/        U-CS 74  Care Visit Reporting & Feedback
    ├── billing-service/       U-CS 75  Care Services Payment & Billing
    ├── notification-service/  U-CS 76  Care Coordination Notification
    ├── operations-service/    U-CS 77  Care Operations Monitoring & Control
    └── audit-service/         U-CS 78  Immutable Audit Logging & Compliance
```

Every module has the same folders:

```
<name>-service/
├── routes/         endpoints + middleware order
├── controllers/    HTTP in, HTTP out
├── services/       business rules
├── repository/     the only database access
├── models/         mongoose schema
├── views/          what the client is allowed to see
├── validation/     zod request schemas
├── consumers/      event subscribers          (modules that react)
├── workers/        queue drains               (modules with background work)
└── README.md       owners, endpoints, events
```

## Team assignments

| Code | Module | Owner(s) |
| ---- | ------ | -------- |
| U-CS 67 | `auth-service` | Stephen Nyariki, Cyril John Tike Sinari |
| U-CS 68 | `elder-service` | Ian Omwenga, Mepani Bhavin Ramesh |
| U-CS 69 | `caregiver-service` | Sharlet Kirui |
| U-CS 70 | `catalog-service` | Leonard Kipkoech, Ilhan Hamud |
| U-CS 71 | `booking-service` | Lavin Larry Seme, Arop Mary Abiong |
| U-CS 72 | `emergency-service` | Wyclef Wasike Tavasi |
| U-CS 73 | `visit-service` | Alvin Kimani, Hezekiah Muiruri Munene |
| U-CS 74 | `report-service` | Marsa Fatuma Omar |
| U-CS 75 | `billing-service` | Mukabwa Gloria Joy, Getenga Jarvis Mokaya |
| U-CS 76 | `notification-service` | *unassigned* |
| U-CS 77 | `operations-service` | Samuel Kahiga, Wachira Peter Githinji |
| U-CS 78 | `audit-service` | Precious Mwende Waweru, Anthony Atenya |

## Read these before writing code

1. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the layers, the module
   map, events vs queues, and the rules on how modules may talk to each other.
2. **[docs/MODULE_GUIDE.md](docs/MODULE_GUIDE.md)** — a complete worked module,
   file by file, plus the pull-request checklist and the common mistakes.

## The two rules that keep twelve teams out of each other's way

1. **Stay in your folder.** Shared code lives in `src/shared/` — changing it
   affects everyone, so give the other teams a heads-up first.
2. **Never import another module's `repository/` or `models/`.** Call its
   service, or react to its event. ESLint will stop you.
