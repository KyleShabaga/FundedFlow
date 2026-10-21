// The header's account selector: shows the one active account and switches it.
// Archived accounts can't be chosen; finished attempts can, and say so. A missing
// or archived selection is shown as such and never silently replaced. Form
// dialogs are modal, so the selector can't be used while an edit is unsaved.
import { statusLabels } from "@fundedflow/domain";
import { Check, ChevronDown, CircleAlert } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { DropdownMenu, type MenuEntry, useToast } from "../../../design-system";
import { canBeActive, useActiveAccount } from "../active-account";
import { accountLabel } from "./presentation";
import "./accounts.css";

export function AccountSwitcher() {
  const { state, accounts, select, isSaving } = useActiveAccount();
  const toast = useToast();
  const navigate = useNavigate();

  if (state.kind === "loading") return <span className="acct-switch-placeholder" aria-hidden="true" />;
  if (state.kind === "error") return <span className="acct-switch-note">Accounts unavailable</span>;
  if (state.kind === "no-accounts") {
    return (
      <Link to="/accounts" className="acct-switch acct-switch-empty">
        No account yet · Add one
      </Link>
    );
  }

  const choosable = (accounts ?? []).filter(canBeActive);
  const live = choosable.filter(a => a.status === "active" || a.status === "paused");
  const finished = choosable.filter(a => !(a.status === "active" || a.status === "paused"));
  const current = state.kind === "selected" ? state.account.id : null;
  const choose = (id: string, name: string) =>
    select(id)
      .then(() => toast.show({ tone: "success", title: `${name} is the active account` }))
      .catch(() => toast.show({ tone: "error", title: "The active account wasn't changed", description: "Try again when local data is available." }));
  const item = (a: (typeof choosable)[number]): MenuEntry => ({
    label: `${accountLabel(a)}${a.status === "active" ? "" : ` (${statusLabels[a.status]})`}`,
    icon: <Check size={14} aria-hidden="true" className={a.id === current ? "acct-check" : "acct-check is-hidden"} />,
    disabled: a.id === current || isSaving,
    onSelect: () => void choose(a.id, a.name),
  });
  const items: MenuEntry[] = [
    ...(live.length ? [{ type: "label" as const, label: "Live accounts" }, ...live.map(item)] : []),
    ...(finished.length ? [{ type: "label" as const, label: "Finished attempts" }, ...finished.map(item)] : []),
    { type: "separator" },
    { label: "Manage accounts", onSelect: () => navigate("/accounts") },
  ];

  const label =
    state.kind === "selected"
      ? accountLabel(state.account)
      : state.kind === "unavailable"
        ? state.account
          ? `${state.account.name} was archived · choose an account`
          : "Chosen account is gone · choose another"
        : "Choose an account";
  const attention = state.kind !== "selected";
  return (
    <div className="acct-switch-wrap">
      <span className="acct-switch-caption" id="acct-switch-caption">Account</span>
      <DropdownMenu
        align="start"
        label="Choose the active account"
        items={items}
        trigger={
          <button type="button" className={`acct-switch${attention ? " is-attention" : ""}`} aria-describedby="acct-switch-caption" aria-busy={isSaving || undefined}>
            {attention && <CircleAlert size={14} aria-hidden="true" />}
            <span className="acct-switch-label">{label}</span>
            {state.kind === "selected" && state.account.status !== "active" && <span className="acct-switch-status">{statusLabels[state.account.status]}</span>}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        }
      />
    </div>
  );
}
