// Commercial offers and promotions (Build 9).
//
// Prices and fees version independently from trading rules and never feed
// drawdown, loss-limit, consistency or payout calculations. Amounts are
// canonical decimal text in `currency` (stored as *_micros, like other money);
// `null` means unknown and "0" means an explicit known zero (FREE / no fee).

import { z } from "zod";

import { MICROS_PER_UNIT, toMicros } from "../primitives/money.js";
import { catalogueId, catalogueInstant, catalogueMoney, currencyCode, providerLabel, windowIsOrdered } from "./fields.js";
import { verificationStatuses } from "./provenance.js";

export const billingModels = ["one_time", "recurring", "unknown"] as const;
export type BillingModel = (typeof billingModels)[number];

export const commercialOfferSchema = z
  .strictObject({
    id: catalogueId,
    catalogueVersionId: catalogueId,
    /** Null for an offer covering the whole programme variant. */
    programmePhaseId: catalogueId.nullable(),
    /** Only with `programmePhaseId`, and the path must belong to that phase. */
    phasePathId: catalogueId.nullable(),
    billingModel: z.enum(billingModels),
    currency: currencyCode.nullable(),
    listPrice: catalogueMoney.nullable(),
    /** Checkout price shown by the provider. A lower sale price does not imply a promotion. */
    salePrice: catalogueMoney.nullable(),
    resetFee: catalogueMoney.nullable(),
    activationFee: catalogueMoney.nullable(),
    effectiveFrom: catalogueInstant.nullable(),
    effectiveTo: catalogueInstant.nullable(),
    sourceIds: z.array(catalogueId),
  })
  .superRefine((o, ctx) => {
    if (o.phasePathId !== null && o.programmePhaseId === null) {
      ctx.addIssue({ code: "custom", path: ["programmePhaseId"], message: "A path offer must name its phase" });
    }
    const amounts = [o.listPrice, o.salePrice, o.resetFee, o.activationFee];
    if (o.currency === null && amounts.some((a) => a !== null)) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Amounts need a currency" });
    }
    if (!windowIsOrdered(o.effectiveFrom, o.effectiveTo)) {
      ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "Must be after effectiveFrom" });
    }
  });
export type CommercialOffer = z.infer<typeof commercialOfferSchema>;

/** Discount structure, when the source states it. Never inferred from a strike-through price. */
export const promotionDiscountSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("amount"), amount: catalogueMoney, currency: currencyCode }),
  z.strictObject({
    kind: z.literal("percent"),
    /** Canonical decimal text, greater than 0 and at most 100. */
    percent: catalogueMoney.refine((p) => {
      const micros = toMicros(p);
      return micros !== null && micros > 0n && micros <= 100n * MICROS_PER_UNIT;
    }, "Use a percentage above 0 and at most 100"),
  }),
  z.strictObject({ kind: z.literal("unknown") }),
]);
export type PromotionDiscount = z.infer<typeof promotionDiscountSchema>;

/** A provider-scoped, reusable promotion. Linked to offers through promotion offers. */
export const promotionSchema = z
  .strictObject({
    id: catalogueId,
    providerId: catalogueId,
    code: z.string().min(1).max(100).nullable(),
    /** Provider wording ("Save $50 with code GEMS"). */
    providerLabel,
    discount: promotionDiscountSchema,
    validFrom: catalogueInstant.nullable(),
    validTo: catalogueInstant.nullable(),
    verificationStatus: z.enum(verificationStatuses),
    sourceIds: z.array(catalogueId),
  })
  .refine((p) => windowIsOrdered(p.validFrom, p.validTo), { path: ["validTo"], message: "Must be after validFrom" });
export type Promotion = z.infer<typeof promotionSchema>;

/** Many-to-many link: one promotion can apply to several offers, each with its own window. */
export const promotionOfferSchema = z
  .strictObject({
    promotionId: catalogueId,
    commercialOfferId: catalogueId,
    validFrom: catalogueInstant.nullable(),
    validTo: catalogueInstant.nullable(),
  })
  .refine((p) => windowIsOrdered(p.validFrom, p.validTo), { path: ["validTo"], message: "Must be after validFrom" });
export type PromotionOffer = z.infer<typeof promotionOfferSchema>;
