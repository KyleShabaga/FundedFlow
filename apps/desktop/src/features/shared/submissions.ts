import type { QueryClient } from "@tanstack/react-query";
import { FeatureDataError, normalizeError } from "./errors";

export const WRITE_TIMEOUT_MS = 30_000;
type Entry = { status: "pending" | "uncertain"; settled: boolean };
/** Per-existing-QueryClient write coordination. It creates neither a repository nor a runtime manager. */
class Submissions {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private version = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  private changed() { this.version++; this.listeners.forEach(listener => listener()); }
  status(scope: string) { return this.entries.get(scope)?.status ?? "idle"; }
  canAcknowledge(scope: string) { const entry = this.entries.get(scope); return entry?.status === "uncertain" && entry.settled; }
  acknowledge(scope: string, confirmation: { recordsReviewed: true }) {
    if (!confirmation.recordsReviewed || !this.canAcknowledge(scope)) throw new FeatureDataError("uncertain-outcome");
    this.entries.delete(scope); this.changed();
  }
  execute<T>(scope: string, task: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(scope);
    if (existing) return Promise.reject(new FeatureDataError(existing.status === "uncertain" ? "uncertain-outcome" : "duplicate-submission"));
    const entry: Entry = { status: "pending", settled: false };
    this.entries.set(scope, entry); this.changed();
    return new Promise((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true; entry.status = "uncertain"; this.changed();
        reject(new FeatureDataError("uncertain-outcome"));
      }, WRITE_TIMEOUT_MS);
      Promise.resolve().then(task).then(value => {
        clearTimeout(timer); entry.settled = true;
        if (expired) { this.changed(); return; } // Late success never silently replays or claims a previously uncertain outcome.
        this.entries.delete(scope); this.changed(); resolve(value);
      }, cause => {
        clearTimeout(timer); entry.settled = true;
        const error = normalizeError(cause, true);
        if (expired || error.category === "uncertain-outcome") entry.status = "uncertain";
        else this.entries.delete(scope);
        this.changed();
        if (!expired) reject(error);
      });
    });
  }
}
const clients = new WeakMap<QueryClient, Submissions>();
export function submissionsFor(client: QueryClient) {
  let submissions = clients.get(client);
  if (!submissions) { submissions = new Submissions(); clients.set(client, submissions); }
  return submissions;
}
