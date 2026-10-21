import { FeatureDataError, normalizeError } from "./errors";
import { receipt, type ReadReceipt } from "./contracts";

export const READ_TIMEOUT_MS = 10_000;
/** CSV previews parse up to 10 MB / 50,000 rows in Rust, so they get a longer deadline than plain reads. */
export const PREVIEW_TIMEOUT_MS = 60_000;
/** Cancellation/deadline stops consumption only: JournalRepository has no native abort API. */
export function boundedRead<T>(task: () => Promise<T>, signal?: AbortSignal, timeoutMs = READ_TIMEOUT_MS): Promise<T> {
  if (signal?.aborted) return Promise.reject(new FeatureDataError("cancelled"));
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { finish(); reject(new FeatureDataError("cancelled")); };
    const timer = setTimeout(() => { finish(); reject(new FeatureDataError("timeout")); }, timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) throw new FeatureDataError("cancelled");
      return task();
    }).then(value => { finish(); resolve(value); }, error => { finish(); reject(error); });
  });
}
export async function readOperation<D, T>(task: () => Promise<D>, map: (dto: D) => T, signal?: AbortSignal, timeoutMs = READ_TIMEOUT_MS): Promise<ReadReceipt<T>> {
  let dto: D;
  try { dto = await boundedRead(task, signal, timeoutMs); } catch (error) { throw normalizeError(error); }
  try { return receipt(map(dto)); } catch { throw new FeatureDataError("invalid-response"); }
}
/** Hooks own deadlines, submission locks and uncertainty reconciliation. No optimistic writes. */
export async function writeOperation<D, T>(task: () => Promise<D>, map: (dto: D) => T, assertReady?: () => void): Promise<T> {
  let dto: D;
  try { assertReady?.(); dto = await task(); } catch (error) { throw normalizeError(error, true); }
  try { return map(dto); } catch { throw new FeatureDataError("uncertain-outcome"); }
}
export function requireAccount(actualId: string, accountId: string) {
  if (actualId !== accountId) throw new FeatureDataError("invalid-response");
}
