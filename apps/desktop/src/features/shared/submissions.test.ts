import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { FeatureDataError } from "./errors";
import { submissionsFor, WRITE_TIMEOUT_MS } from "./submissions";
import { deferred } from "./test-fixtures";
afterEach(() => vi.useRealTimers());
it("prevents duplicate submissions across consumers without serially replaying writes", async () => {
  const state = submissionsFor(new QueryClient()); const response = deferred<number>(); const task = vi.fn(() => response.promise);
  const first = state.execute("same-record", task);
  await expect(state.execute("same-record", task)).rejects.toMatchObject({ category: "duplicate-submission" });
  expect(state.status("same-record")).toBe("pending");
  response.resolve(1); expect(await first).toBe(1); expect(task).toHaveBeenCalledTimes(1);
  expect(state.status("same-record")).toBe("idle");
});
it("retains uncertainty after a deadline and late success until settled records are explicitly reviewed", async () => {
  vi.useFakeTimers(); const state = submissionsFor(new QueryClient()); const response = deferred<number>(); const task = vi.fn(() => response.promise);
  const promise = state.execute("import", task);
  const rejected = expect(promise).rejects.toMatchObject({ category: "uncertain-outcome" });
  await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS); await rejected;
  expect(state.canAcknowledge("import")).toBe(false);
  expect(() => state.acknowledge("import", { recordsReviewed: true })).toThrow();
  await expect(state.execute("import", task)).rejects.toMatchObject({ category: "uncertain-outcome" });
  response.resolve(1); await vi.advanceTimersByTimeAsync(0);
  expect(state.status("import")).toBe("uncertain"); expect(state.canAcknowledge("import")).toBe(true);
  state.acknowledge("import", { recordsReviewed: true }); expect(state.status("import")).toBe("idle");
  expect(task).toHaveBeenCalledTimes(1);
});
it("unlocks definite failures and keeps malformed/unconfirmed writes uncertain", async () => {
  const state = submissionsFor(new QueryClient());
  await expect(state.execute("a", async () => { throw new FeatureDataError("validation"); })).rejects.toMatchObject({ category: "validation" });
  expect(state.status("a")).toBe("idle");
  await expect(state.execute("a", async () => { throw new Error("unrecognized bridge failure"); })).rejects.toMatchObject({ category: "uncertain-outcome" });
  expect(state.status("a")).toBe("uncertain");
});
