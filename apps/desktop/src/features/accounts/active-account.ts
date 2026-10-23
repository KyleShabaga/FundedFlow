// The one active-account selection. It is stored once, in the local settings
// table, so it survives a restart and every view reads the same value; there is
// no second copy in component state or browser storage. Selection is by stable
// account id. An archived or missing account is never silently replaced: the
// hook reports it so the UI can ask the trader to choose again.
import type { ToastInput } from "../../design-system";
import { useAccounts } from "./hooks/accounts";
import type { AccountViewModel } from "./view-models/account";
import { useSetSetting, useSetting } from "../settings/hooks/settings";

export const ACTIVE_ACCOUNT_SETTING = "accounts.active_account_id";

/**
 * A switch with no answer may have been saved. Settings have no review that releases the lock, so it lasts until
 * FundedFlow restarts, and the toast never invites trying again now (TASK-024).
 */
export const UNCERTAIN_SWITCH: ToastInput = {
  tone: "warning",
  title: "The active account may have changed",
  description: "No answer came back, so the active account may have changed. Switching is locked until you restart FundedFlow; check the active account after reopening it.",
};
/** The toast for a switch that didn't succeed: the site's own definite failure, unless no answer came back. */
export function switchFailure(error: unknown, definite: ToastInput): ToastInput {
  return (error as { category?: string } | null)?.category === "uncertain-outcome" ? UNCERTAIN_SWITCH : definite;
}

export type ActiveAccountState =
  /** Settings or accounts are still loading (or the runtime is starting). */
  | { kind: "loading" }
  /** Settings or accounts could not be read; nothing is assumed. */
  | { kind: "error" }
  /** The journal has no accounts yet. */
  | { kind: "no-accounts" }
  /** Accounts exist but none is chosen. */
  | { kind: "unset" }
  /** The chosen account was archived or no longer exists; the trader must choose again. */
  | { kind: "unavailable"; account: AccountViewModel | null }
  | { kind: "selected"; account: AccountViewModel };

/** Only accounts that are not archived can be the active account. Historical results stay selectable for review. */
export function canBeActive(account: Pick<AccountViewModel, "archivedAt">): boolean {
  return account.archivedAt === null;
}

export function resolveActiveAccount(storedId: unknown, accounts: readonly AccountViewModel[] | undefined): ActiveAccountState {
  if (!accounts) return { kind: "loading" };
  if (accounts.length === 0) return { kind: "no-accounts" };
  if (typeof storedId !== "string" || storedId === "") return { kind: "unset" };
  const account = accounts.find(a => a.id === storedId) ?? null;
  if (!account || !canBeActive(account)) return { kind: "unavailable", account };
  return { kind: "selected", account };
}

export function useActiveAccount() {
  const setting = useSetting(ACTIVE_ACCOUNT_SETTING);
  const accounts = useAccounts("all");
  const save = useSetSetting(ACTIVE_ACCOUNT_SETTING);
  const settled = setting.data !== undefined && accounts.data !== undefined;
  const failed = !settled && (setting.error !== null && !setting.isRuntimePending || accounts.error !== null && !accounts.isRuntimePending);
  const state: ActiveAccountState = failed
    ? { kind: "error" }
    : !settled
      ? { kind: "loading" }
      : resolveActiveAccount(setting.data?.value ?? null, accounts.data);
  return {
    state,
    activeId: state.kind === "selected" ? state.account.id : null,
    accounts: accounts.data,
    /** Persists the choice. Rejects (safely) when the runtime is unavailable or a save is already running. */
    select: (id: string) => save.submit(id),
    isSaving: save.isPending,
    saveError: save.error,
  };
}
