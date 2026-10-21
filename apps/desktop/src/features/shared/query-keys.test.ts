import { hashKey } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { featureKeys as keys } from "./query-keys";
it("isolates account, resource, filter, period, preview/history and result identities", () => {
  const examples = [keys.accountList("all"), keys.accountList("archived"), keys.detail("a"), keys.detail("b"),
    keys.history("a"), keys.lineage("a"), keys.trades("a"), keys.trades("b"), keys.trades("a", { from: "2026-10-20" }),
    keys.trades("a", { symbol: "MES" }), keys.trades("a", { side: "short" }), keys.journal("a"), keys.journal("a", { tag: "review" }),
    keys.journal("a", { tradeId: "t" }), keys.imports("a"), keys.importResult("a", "b"), keys.importRows("a", "b"),
    keys.importRows("b", "b"), keys.snapshots("a"), keys.snapshots("a", { endOfDayOnly: true }), keys.latestSnapshot("a")];
  expect(new Set(examples.map(hashKey)).size).toBe(examples.length);
  expect(hashKey(keys.trades("a", { from: undefined }))).toBe(hashKey(keys.trades("a")));
  expect(hashKey(keys.snapshots("a", { to: "2026-10-20", from: "2026-10-01" })))
    .toBe(hashKey(keys.snapshots("a", { from: "2026-10-01", to: "2026-10-20" })));
});
