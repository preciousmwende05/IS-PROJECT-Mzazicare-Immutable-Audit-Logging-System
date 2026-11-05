import type { NextFunction, Request, Response } from "express";
import { ZodError, type AnyZodObject } from "zod";

import { UnprocessableError } from "@/shared/errors";

/**
 * Validates and *replaces* body/params/query with the parsed result, so the
 * controller receives typed, coerced, extras-stripped data.
 *
 * Schemas live in `modules/<x>-service/validation/<x>.validation.ts`:
 *   z.object({ body: z.object({...}), params: z.object({...}) })
 */
export const validate =
  (schema: AnyZodObject) => async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      if (parsed.body) req.body = parsed.body;
      if (parsed.params) Object.assign(req.params, parsed.params);
      if (parsed.query) Object.assign(req.query, parsed.query);

      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(new UnprocessableError("Validation failed", err.flatten().fieldErrors));
      }
      return next(err);
    }
  };
