// Field schemas shared by the contracts.
//
// Money, prices and quantities are decimal strings ("50000", "5004.25") so
// nothing passes through floating point. Instants are ISO 8601 strings; the
// backend returns them as UTC with milliseconds ("2026-10-19T14:30:00.000Z").

import { z } from "zod";

export const decimal = z.string().trim().regex(/^[+-]?(\d+\.?\d*|\.\d+)$/, "Enter a number");
export const positiveDecimal = decimal.refine((v) => Number(v) > 0, "Must be greater than zero");
export const nonNegativeDecimal = decimal.refine((v) => !v.startsWith("-") || Number(v) === 0, "Must be zero or positive");
export const instant = z.iso.datetime({ offset: true, message: "Enter a date and time" });
export const optionalText = (max: number) => z.string().max(max).nullish();
