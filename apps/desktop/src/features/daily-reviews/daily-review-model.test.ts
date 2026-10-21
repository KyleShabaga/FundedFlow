// Build 22 view model: form values and payloads, status and adherence wording, and day-key navigation. Adherence and
// trading days themselves come from Rust; these only present them.
import type { DailyAdherence } from "@fundedflow/domain";
import { describe, expect, it } from "vitest";

import {
  adherenceShort, adherenceText, dailyReviewPath, isTradingDayKey, reviewValues, statusView, stepTradingDay, toDailyReviewInput,
} from "./view-models/daily-review";

const adherence = (over: Partial<DailyAdherence>): DailyAdherence => ({ followed: 0, missed: 0, notApplicable: 0, unanswered: 0, answered: 0, percent: null, ...over });

describe("daily review model", () => {
  it("steps Monday to Friday keys and rejects weekends and impossible dates", () => {
    expect(stepTradingDay("2026-10-16", 1)).toBe("2026-10-19");
    expect(stepTradingDay("2026-10-19", -1)).toBe("2026-10-16");
    expect(stepTradingDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(isTradingDayKey("2026-10-17")).toBe(false);
    expect(isTradingDayKey("2026-02-30")).toBe(false);
    expect(isTradingDayKey("2026-10-19")).toBe(true);
  });

  it("never shows 0% or 100% without applicable answers", () => {
    expect(adherenceText(adherence({ unanswered: 3 }))).toBe("Unknown: not enough answers");
    expect(adherenceText(adherence({ notApplicable: 2 }))).toBe("Unknown: only not-applicable answers");
    expect(adherenceText(adherence({ followed: 3, missed: 1, answered: 4, percent: "75" }))).toBe("3 of 4 applicable items followed (75%)");
    expect(adherenceShort(adherence({}))).toBe("Plan adherence —");
  });

  it("round-trips form values to a save payload, blank text as null", () => {
    const values = reviewValues(null);
    values.plan.focus = "  ";
    values.plan.maxRisk = " 250 ";
    values.reflection.keyLesson = "Wait";
    values.checklistId = null;
    values.answers = { item: { result: "followed", note: "" } };
    const input = toDailyReviewInput("a1", "2026-10-19", null, values, "complete");
    expect(input.plan.focus).toBeNull();
    expect(input.plan.maxRisk).toBe("250");
    expect(input.reflection.keyLesson).toBe("Wait");
    expect(input.answers).toEqual([]); // answers belong to a chosen checklist only
    expect(input.action).toBe("complete");
  });

  it("names statuses and builds an account-explicit deep link", () => {
    expect(statusView(null).label).toBe("Not started");
    expect(statusView({ status: "draft" }).label).toBe("Draft");
    expect(statusView({ status: "completed", editedAfterCompletionAt: "2026-10-20T00:00:00.000Z" }).label).toBe("Completed · edited");
    expect(dailyReviewPath("a b", "2026-10-19")).toBe("/journal/days/2026-10-19?account=a%20b");
  });
});
