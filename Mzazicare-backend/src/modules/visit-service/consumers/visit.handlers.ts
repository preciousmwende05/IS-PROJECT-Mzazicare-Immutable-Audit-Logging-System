/**
 * U-CS 73 — Geo-Verified Visit Tracking System
 * Owner(s): Alvin Kimani, Hezekiah Muiruri Munene
 */

import { on } from "@/shared/events/bus";
import { visitService } from "@/modules/visit-service/services/visit.service";

on("booking.confirmed", async (payload) => {
  await visitService.handleBookingConfirmed(payload);
});
