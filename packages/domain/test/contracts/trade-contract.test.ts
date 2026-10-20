import { describe, expect, it } from "vitest";

import { accountInputSchema, accountSchema, tradeInputSchema, tradeSchema } from "../../src/index.js";
import fixture from "../fixtures/trade-contract.json" with { type: "json" };

// Byte-for-byte wire equivalence: each schema must accept the exact JSON the
// Rust store sends over IPC and re-serialise it unchanged (same keys, order,
// nulls and decimal text), so no field is dropped, renamed or reformatted.
describe.each(fixture.cases)("$name", (c) => {
  it("accepts the inputs Rust accepted", () => {
    expect(accountInputSchema.safeParse(c.account).error).toBeUndefined();
    expect(tradeInputSchema.safeParse(c.trade).error).toBeUndefined();
  });

  it("round-trips the Account wire bytes", () => {
    expect(JSON.stringify(accountSchema.parse(JSON.parse(c.accountWire)))).toBe(c.accountWire);
  });

  it("round-trips the Trade wire bytes", () => {
    expect(JSON.stringify(tradeSchema.parse(JSON.parse(c.tradeWire)))).toBe(c.tradeWire);
  });
});
