# MzaziCare Backend — Architecture

## Shape

A **modular monolith**: one Express application, one database, twelve
independently-owned module folders. Each team works inside its own
`<name>-service/` and meets the other teams at exactly two places — the
**event bus** and another module's **service**.

The layout follows the same house convention as RingR, so what you learn here
transfers directly to the other backends.

```
HTTP request
   ↓
src/app.ts                     helmet → cors → json → logger → rate limit
   ↓
routes/<x>.routes.ts           authMiddleware → requirePermission → validate → audit
   ↓
controllers/<x>.controller.ts  read the request, call the service, shape the reply
   ↓
services/<x>.service.ts        ALL business rules
   ↓
repository/<x>.repository.ts   the ONLY layer that touches the database
   ↓
models/<x>.model.ts            Mongoose schema
   ↓
views/<x>.view.ts              what the client is actually allowed to see
   ↓
publish(...)                   other modules react; the publisher does not wait
   ↓
error.middleware               the only place an error becomes an HTTP status
```

## The layers, and what belongs in each

| Layer | Knows about | Must never |
| ----- | ----------- | ---------- |
| `routes` | HTTP verbs, paths, middleware order | contain logic |
| `controllers` | `req` / `res` | query the database |
| `services` | domain rules, events, other modules' services | import `express` |
| `repository` | Mongoose queries | decide anything |
| `models` | the schema | contain business rules |
| `views` | the public shape of a record | fetch data |
| `consumers` | events published by other modules | be non-idempotent |
| `workers` | slow or external work off the request path | hold request state |

If you cannot exercise a rule without starting an HTTP server, it is in the
wrong layer.

## Module map

| Code | Module | Mounted at | System |
| ---- | ------ | ---------- | ------ |
| U-CS 67 | `auth-service` | `/v1/auth` | Secure User Registration & Authentication |
| U-CS 68 | `elder-service` | `/v1/elders` | Digital Elder Profile & Care Data |
| U-CS 69 | `caregiver-service` | `/v1/caregivers` | Caregiver KYC & Approval Workflow |
| U-CS 70 | `catalog-service` | `/v1/services` | Care Services Discovery & Catalog |
| U-CS 71 | `booking-service` | `/v1/bookings` | Care Service Booking & Scheduling |
| U-CS 72 | `emergency-service` | `/v1/emergencies` | Priority Emergency Handling & Escalation |
| U-CS 73 | `visit-service` | `/v1/visits` | Geo-Verified Visit Tracking |
| U-CS 74 | `report-service` | `/v1/reports` | Care Visit Reporting & Feedback |
| U-CS 75 | `billing-service` | `/v1/billing` | Care Services Payment & Billing |
| U-CS 76 | `notification-service` | `/v1/notifications` | Care Coordination Notification |
| U-CS 77 | `operations-service` | `/v1/operations` | Care Operations Monitoring & Control |
| U-CS 78 | `audit-service` | `/v1/audit` | Immutable Audit Logging & Compliance |

## How modules talk to each other

**Rule 1 — never import another module's `repository/` or `models/`.**
ESLint enforces this. Reaching into another team's data layer is how a modular
monolith turns into a mud ball, and it means two teams now own one collection.

**Rule 2 — prefer an event over a call.** If your module only needs to *react*
to something, subscribe in your own `consumers/` folder:

```ts
// notification-service/consumers/notification.handlers.ts   (U-CS 76)
import { on } from "@/shared/events/bus";
import { notificationService } from "@/modules/notification-service/services/notification.service";

on("booking.confirmed", async ({ bookingId, caregiverId }) => {
  await notificationService.notifyBookingConfirmed(bookingId, caregiverId);
});
```

The publisher does not know you exist, does not wait for you, and does not
fail if you throw. That is the whole point.

To notify people (SMS, push, in-app) from your module, call `notify()` from
`@/shared/notifications`. See
[`notification-service/docs/INTEGRATION.md`](../src/modules/notification-service/docs/INTEGRATION.md).

**Rule 3 — when you genuinely need data right now, call the other service.**

```ts
import { elderService } from "@/modules/elder-service/services/elder.service";   // ✅
import { elderRepository } from "@/modules/elder-service/repository/...";        // ❌ blocked
```

Ask the owning team to add the method you need. That conversation *is* the API
review.

## Events vs queues

Both are asynchronous; they answer different questions.

- **Event bus** (`shared/events/bus.ts`) — "this happened." Many subscribers,
  none of them known to the publisher. Use it to announce a fact.
- **Queue** (`shared/queues/index.ts`) — "do this." One owner drains it. Use it
  for slow or external work: sending an SMS, calling Daraja, sweeping records.

The event bus itself runs on a BullMQ queue, so a subscriber that throws is
retried rather than lost. **Every handler must therefore be idempotent** — the
same event can arrive twice.

## Dependency direction

```
auth-service (67)
  └─ everything depends on it for identity

elder-service (68) ── caregiver-service (69) ── catalog-service (70)
        └───────────── booking-service (71) ─────────────┐
                              │                           │
                       visit-service (73)         billing-service (75)
                              │
                       report-service (74)

emergency-service     (72) ─ reads elders, publishes to notifications
notification-service  (76) ─ subscribes to events, drains the notifications queue, reads users/caregivers/bookings via their services
operations-service    (77) ─ reads across modules, writes nothing
audit-service         (78) ─ subscribes to everything, append-only, immutable
```

Modules 76, 77 and 78 are **downstream-only**. Nothing may depend on them and
they may not block anyone, which is what keeps the graph acyclic.

## Conventions that are not negotiable

- **Response envelope.** `ok()`, `created()`, `paginated()` from
  `shared/utils/response.util`. The frontend parses one shape.
- **Errors.** `throw new NotFoundError("Elder")`. Never `res.status(404)`.
- **Async controllers.** Always wrapped in `asyncHandler`.
- **Views.** Return `serializeElder(elder)`, never the raw document. A field
  reaches the client because someone added it to the view on purpose.
- **Money.** Integer cents via `shared/utils/money.util`. No floats, ever.
- **Phone numbers.** Normalised to `+254…` before storage.
- **Coordinates.** GeoJSON `[longitude, latitude]` — longitude first.
- **Files.** Upload via `storageService`, store the returned **key** in your
  model, and hand clients a short-lived `signedUrl(key)`. Never store a URL,
  never make the bucket public.
- **Secrets.** Only from `shared/config/env`. No `process.env` anywhere else.
- **Sensitive actions.** Attach the `audit(...)` middleware.
- **Imports.** Always the `@/` alias, never `../../..`.

## Why it is built this way

Twelve teams on one codebase fails in one predictable way: everyone edits the
same files. This layout gives each team a folder nobody else touches, a shared
contract small enough to read in one sitting, and a lint rule that catches the
shortcut before code review has to.
