# Building Your Module

A worked example, using `booking-service` (U-CS 71). Follow it top to bottom
the first time; after that it is muscle memory.

Fill the folders in this order — **models → views → validation → repository →
services → controllers → routes → consumers**. Bottom-up forces you to decide
what the data *is* before you decide what happens to it.

---

## 1. `models/booking.model.ts` — the schema

```ts
import { Schema, model, type InferSchemaType, type HydratedDocument, type Types } from "mongoose";

const bookingSchema = new Schema(
  {
    elderId:     { type: Schema.Types.ObjectId, ref: "Elder", required: true, index: true },
    serviceId:   { type: Schema.Types.ObjectId, ref: "CareService", required: true },
    caregiverId: { type: Schema.Types.ObjectId, ref: "Caregiver", index: true },
    status: {
      type: String,
      enum: ["requested", "confirmed", "in_progress", "completed", "cancelled"],
      default: "requested",
      index: true,
    },
    scheduledFor:    { type: Date, required: true, index: true },
    durationMinutes: { type: Number, required: true, min: 15 },
    location: {
      type:        { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },   // [lng, lat]
    },
  },
  { timestamps: true, collection: "bookings" },
);

bookingSchema.index({ location: "2dsphere" });
bookingSchema.index({ caregiverId: 1, scheduledFor: 1 });

export type Booking = InferSchemaType<typeof bookingSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};
export type NewBooking = InferSchemaType<typeof bookingSchema>;
export type BookingDocument = HydratedDocument<Booking>;

export const BookingModel = model("Booking", bookingSchema);
```

Model the **states** explicitly. A string union beats two booleans every time.
Index every field you will filter or sort by.

---

## 2. `views/booking.view.ts` — what the client may see

```ts
import type { Booking } from "@/modules/booking-service/models/booking.model";

export type BookingView = {
  id: string;
  elderId: string;
  status: string;
  scheduledFor: string;
  durationMinutes: number;
};

export const serializeBooking = (booking: Booking): BookingView => ({
  id: String(booking._id),
  elderId: String(booking.elderId),
  status: booking.status,
  scheduledFor: booking.scheduledFor.toISOString(),
  durationMinutes: booking.durationMinutes,
});
```

Views are not busywork. They are why a password hash or an ID-document URL
cannot leak by accident: a field reaches the client only if someone added it
here deliberately.

---

## 3. `validation/booking.validation.ts` — reject bad input at the door

```ts
import { z } from "zod";

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const bookingValidation = {
  create: z.object({
    body: z.object({
      elderId:         objectId,
      serviceId:       objectId,
      scheduledFor:    z.coerce.date().min(new Date(), "Cannot book in the past"),
      durationMinutes: z.number().int().min(15).max(480),
    }),
  }),

  list: z.object({
    query: z.object({
      status: z.enum(["requested", "confirmed", "completed", "cancelled"]).optional(),
      page:   z.coerce.number().int().min(1).default(1),
      limit:  z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
};
```

Validation answers *"is this well-formed?"*. It does **not** answer *"is this
caregiver free on Tuesday?"* — that is a service question.

---

## 4. `repository/booking.repository.ts` — the only database access

```ts
import { BookingModel, type Booking, type NewBooking } from "@/modules/booking-service/models/booking.model";

export const bookingRepository = {
  findById: async (id: string) => BookingModel.findById(id).lean<Booking>(),

  create: async (data: NewBooking): Promise<Booking> => {
    const doc = await BookingModel.create(data);
    return doc.toObject() as Booking;
  },

  findPage: async (where: Record<string, unknown>, skip: number, limit: number) =>
    Promise.all([
      BookingModel.find(where).sort({ scheduledFor: 1 }).skip(skip).limit(limit).lean<Booking[]>(),
      BookingModel.countDocuments(where),
    ]),

  existsAt: async (elderId: string, scheduledFor: Date) =>
    BookingModel.exists({
      elderId,
      scheduledFor,
      status: { $in: ["requested", "confirmed"] },
    }),
};
```

Repositories answer data questions. They never decide anything — no `throw`,
no policy, no events.

---

## 5. `services/booking.service.ts` — the actual system

```ts
import { publish } from "@/shared/events/bus";
import { ConflictError, NotFoundError } from "@/shared/errors";
import { buildPage, parsePagination } from "@/shared/utils/pagination.util";
import { bookingRepository } from "@/modules/booking-service/repository/booking.repository";
import { elderService } from "@/modules/elder-service/services/elder.service";   // service, not repository

export const bookingService = {
  create: async (input: CreateBookingInput, requestedBy: string) => {
    const elder = await elderService.getById(input.elderId);
    if (!elder) throw new NotFoundError("Elder");

    if (await bookingRepository.existsAt(input.elderId, input.scheduledFor)) {
      throw new ConflictError("This elder already has a booking at that time");
    }

    const booking = await bookingRepository.create({
      ...input,
      location: elder.homeLocation,
      status: "requested",
    });

    // Tell the world. notification (76), billing (75) and audit (78) react.
    await publish("booking.requested", {
      bookingId:    String(booking._id),
      elderId:      String(booking.elderId),
      serviceId:    String(booking.serviceId),
      scheduledFor: booking.scheduledFor.toISOString(),
    });

    return booking;
  },

  list: async (filters: { status?: string }, query: { page?: unknown; limit?: unknown }) => {
    const { page, limit, skip } = parsePagination(query);
    const where = filters.status ? { status: filters.status } : {};
    const [items, total] = await bookingRepository.findPage(where, skip, limit);
    return buildPage(items, total, page, limit);
  },
};
```

No `req`, no `res`, no status codes, no Mongoose queries. Pure domain logic —
callable from a controller, a worker or a seed script alike.

---

## 6. `controllers/booking.controller.ts` — translate HTTP ↔ domain

```ts
import type { Request, Response } from "express";

import { asyncHandler } from "@/shared/utils/async.util";
import { created, paginated } from "@/shared/utils/response.util";
import { bookingService } from "@/modules/booking-service/services/booking.service";
import { serializeBooking } from "@/modules/booking-service/views/booking.view";

export const bookingController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const booking = await bookingService.create(req.body, req.user!.id);
    return created(res, serializeBooking(booking));
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await bookingService.list({ status: req.query.status as string }, req.query);
    return paginated(res, { ...page, items: page.items.map(serializeBooking) });
  }),
};
```

Three lines each. A longer controller means logic has leaked into it.

---

## 7. `routes/booking.routes.ts` — wire it up

```ts
import { Router } from "express";

import { authMiddleware } from "@/shared/middleware/auth.middleware";
import { requirePermission } from "@/shared/middleware/role.middleware";
import { validate } from "@/shared/middleware/validate.middleware";
import { audit } from "@/shared/middleware/audit.middleware";
import { bookingController } from "@/modules/booking-service/controllers/booking.controller";
import { bookingValidation } from "@/modules/booking-service/validation/booking.validation";

export const bookingRoutes = Router();

bookingRoutes.get("/", authMiddleware, validate(bookingValidation.list), bookingController.list);

bookingRoutes.post(
  "/",
  authMiddleware,
  requirePermission("bookings:create"),
  validate(bookingValidation.create),
  audit("booking.created", (req) => ({ elderId: req.body.elderId })),
  bookingController.create,
);
```

**Middleware order is always the same:**
`authMiddleware → requireRole/requirePermission → validate → audit → controller`

Your router is already mounted in `src/app.ts`. You do not need to touch that
file — which is exactly why twelve teams can work at once.

---

## 8. `consumers/booking.handlers.ts` — react to other modules

```ts
import { on } from "@/shared/events/bus";
import { bookingService } from "@/modules/booking-service/services/booking.service";

on("caregiver.suspended", async ({ caregiverId }) => {
  await bookingService.releaseUpcomingFor(caregiverId);
});
```

`src/server.ts` already imports this file. Handlers must be **idempotent** —
a failed job is retried, so the same event can arrive twice.

---

## 9. `workers/<x>.worker.ts` — slow or scheduled work

Only some modules need one. A worker drains a queue declared in
`shared/queues/index.ts`, and `src/server.ts` starts it.

Use a worker for sending, calling an external API, or sweeping records. Use
the event bus for announcing a fact.

---

## Checklist before you open a pull request

- [ ] Every async controller wrapped in `asyncHandler`
- [ ] Every response goes through `ok` / `created` / `paginated`
- [ ] Every response body passes through a **view** — no raw documents
- [ ] Every error is an `AppError` subclass, thrown not returned
- [ ] No `process.env` outside `shared/config/env.ts`
- [ ] No import of another module's `repository/` or `models/`
- [ ] Imports use the `@/` alias, not `../../..`
- [ ] Indexes on every field you filter or sort by
- [ ] Money in integer cents, phones `+254…`, coordinates `[lng, lat]`
- [ ] Sensitive routes carry `audit(...)`
- [ ] New events added to `shared/events/types.ts` with their payload shape
- [ ] Event handlers are idempotent
- [ ] Your module `README.md` lists your endpoints and events
- [ ] `pnpm check` is clean

---

## Common mistakes

**Putting rules in the controller.** If you cannot call it from a worker, it
is in the wrong place.

**Querying the database from a service.** Go through your repository. It is
the seam that lets you change storage without rewriting your rules.

**Returning the raw document.** `res.json(user)` ships the password hash. Use
the view.

**Swallowing errors.** `try { … } catch { return null }` hides bugs. Let it
throw; `error.middleware` will produce the right status.

**Importing across modules to "just get one field".** That is the first crack.
Ask for a service method, or publish an event.

**Forgetting `await`.** A floating promise in a service means the response is
sent before the work is done — and the failure lands nowhere.

**Trusting the client.** `req.user.id` is trustworthy: the token was verified.
`req.body.userId` is not. Never read identity from the body.

**A non-idempotent handler.** "Charge the card" inside an event handler will
eventually charge twice. Make the operation safe to repeat, or key it.
