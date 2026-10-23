// Which account actions are offered, and the one place that opens their dialogs.
// Archived accounts are read-only: they can be viewed, restored or permanently deleted.
// Permanent deletion is the Build 25 data-control flow, separate from archiving.
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { statusLabels } from "@fundedflow/domain";

import { type MenuEntry, useToast } from "../../../design-system";
import { DeletionDialog } from "../../data-controls/components/DeletionDialog";
import { switchFailure, useActiveAccount } from "../active-account";
import type { AccountViewModel } from "../view-models/account";
import { AccountFormDialog } from "./AccountFormDialog";
import { ArchiveDialog, ResetDialog, RestoreDialog, StatusDialog } from "./LifecycleDialogs";
import { accountLabel } from "./presentation";

export type AccountDialog =
  | { kind: "create" }
  | { kind: "edit"; account: AccountViewModel; tradeCount: number | null }
  | { kind: "status"; account: AccountViewModel; initial?: AccountViewModel["status"] }
  | { kind: "archive"; account: AccountViewModel }
  | { kind: "restore"; account: AccountViewModel }
  | { kind: "reset"; account: AccountViewModel; attemptNumber?: number }
  | { kind: "delete"; account: AccountViewModel; attemptNumber?: number };

export function useAccountDialogs() {
  const [dialog, setDialog] = useState<AccountDialog | null>(null);
  const navigate = useNavigate();
  const active = useActiveAccount();
  const toast = useToast();
  const close = (open: boolean) => !open && setDialog(null);

  const activate = (account: AccountViewModel) =>
    active
      .select(account.id)
      .then(() => toast.show({ tone: "success", title: `${account.name} is the active account` }))
      .catch(error => toast.show(switchFailure(error, { tone: "error", title: "The active account wasn't changed", description: "Try again when local data is available." })));

  const element = dialog && (
    <>
      {(dialog.kind === "create" || dialog.kind === "edit") && (
        <AccountFormDialog
          open
          mode={dialog.kind}
          account={dialog.kind === "edit" ? dialog.account : undefined}
          tradeCount={dialog.kind === "edit" ? dialog.tradeCount : undefined}
          onOpenChange={close}
          onSaved={saved => {
            if (dialog.kind !== "create") return;
            // The first account, or one added while none is active, becomes the active account.
            if (active.state.kind !== "selected") void activate(saved);
            navigate(`/accounts/${encodeURIComponent(saved.id)}`);
          }}
        />
      )}
      {dialog.kind === "status" && <StatusDialog open account={dialog.account} initialStatus={dialog.initial} onOpenChange={close} />}
      {dialog.kind === "archive" && <ArchiveDialog open account={dialog.account} onOpenChange={close} />}
      {dialog.kind === "restore" && <RestoreDialog open account={dialog.account} onOpenChange={close} />}
      {dialog.kind === "delete" && (
        <DeletionDialog
          open
          target={{ kind: "account", accountId: dialog.account.id, accountLabel: accountLabel(dialog.account), status: statusLabels[dialog.account.status], archived: dialog.account.archivedAt !== null, attemptNumber: dialog.attemptNumber }}
          onOpenChange={close}
          onDeleted={() => navigate("/accounts")}
          onArchiveInstead={dialog.account.archivedAt === null ? () => setDialog({ kind: "archive", account: dialog.account }) : undefined}
        />
      )}
      {dialog.kind === "reset" && (
        <ResetDialog
          open
          account={dialog.account}
          attemptNumber={dialog.attemptNumber}
          onOpenChange={close}
          onCreated={(successor, action) => {
            if (action === "activate") void activate(successor);
            navigate(`/accounts/${encodeURIComponent(successor.id)}`);
          }}
        />
      )}
    </>
  );
  return { open: setDialog, element, activate, activeId: active.activeId };
}

/** Row-menu entries for one account, in the order the account page shows them. */
export function accountMenu(
  account: AccountViewModel,
  { open, activate, activeId, onOpen, onRulebook, tradeCount, attemptNumber }: {
    open: (d: AccountDialog) => void;
    activate: (a: AccountViewModel) => void;
    activeId: string | null;
    onOpen: () => void;
    /** Opens the account's rulebook page (Build 19). */
    onRulebook?: () => void;
    tradeCount: number | null;
    attemptNumber?: number;
  },
): MenuEntry[] {
  const archived = account.archivedAt !== null;
  const entries: MenuEntry[] = [{ label: "Open", onSelect: onOpen }];
  if (onRulebook) entries.push({ label: archived ? "View rulebook" : "Rulebook and assignment", onSelect: onRulebook });
  if (archived) {
    entries.push(
      { type: "separator" },
      { label: "Restore from archive", onSelect: () => open({ kind: "restore", account }) },
      { label: "Delete permanently…", tone: "danger", onSelect: () => open({ kind: "delete", account, attemptNumber }) },
    );
    return entries;
  }
  entries.push(
    { label: "Edit", onSelect: () => open({ kind: "edit", account, tradeCount }) },
    { label: activeId === account.id ? "Active account" : "Use as active account", onSelect: () => activate(account), disabled: activeId === account.id },
    { type: "separator" },
  );
  if (account.status !== "failed") entries.push({ label: "Mark failed…", onSelect: () => open({ kind: "status", account, initial: "failed" }) });
  entries.push({ label: "Change status…", onSelect: () => open({ kind: "status", account }) });
  if (account.successorAccountId === null) entries.push({ label: "Start new attempt…", onSelect: () => open({ kind: "reset", account, attemptNumber }) });
  entries.push(
    { type: "separator" },
    { label: "Archive…", onSelect: () => open({ kind: "archive", account }) },
    { label: "Delete permanently…", tone: "danger", onSelect: () => open({ kind: "delete", account, attemptNumber }) },
  );
  return entries;
}
