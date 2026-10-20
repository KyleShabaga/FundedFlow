import { z } from "zod";
import { repository } from "../../../lib/data/api";
import { readAccount } from "../../accounts/api/accounts";
import { periodSchema, type Period } from "../../shared/contracts";
import { validateInput } from "../../shared/errors";
import { readOperation } from "../../shared/operations";
import { toSnapshotViewModel } from "../view-models/snapshot";

export type SnapshotFilters = Period & { endOfDayOnly?: boolean };
export async function readSnapshots(accountId: string, filters: SnapshotFilters = {}, signal?: AbortSignal) {
  const parsed = validateInput(periodSchema.and(z.object({ endOfDayOnly: z.boolean().optional() })), filters);
  const account = (await readAccount(accountId, signal)).value;
  return readOperation(() => repository.snapshots.list(accountId, parsed), rows => rows.map(row => toSnapshotViewModel(row, account)), signal);
}
export async function readLatestSnapshot(accountId: string, signal?: AbortSignal) {
  const account = (await readAccount(accountId, signal)).value;
  return readOperation(() => repository.snapshots.latest(accountId), row => row === null ? null : toSnapshotViewModel(row, account), signal);
}
