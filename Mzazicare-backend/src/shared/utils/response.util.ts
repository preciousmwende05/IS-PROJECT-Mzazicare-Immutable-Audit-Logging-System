import type { Response } from "express";

import type { Paginated } from "@/shared/types";

/**
 * Every endpoint replies in one of these shapes. The frontend parses exactly
 * one envelope, so do not hand-roll res.json() in a controller.
 */
export const ok = <T>(res: Response, data: T, meta?: Record<string, unknown>) =>
  res.status(200).json({ success: true, data, meta });

export const created = <T>(res: Response, data: T) => res.status(201).json({ success: true, data });

export const noContent = (res: Response) => res.status(204).send();

export const paginated = <T>(res: Response, page: Paginated<T>) => {
  const { items, ...meta } = page;
  return res.status(200).json({ success: true, data: items, meta });
};
