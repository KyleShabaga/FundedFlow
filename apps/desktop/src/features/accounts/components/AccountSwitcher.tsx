// The header's account selector: shows the one active account and switches it.
// Archived accounts can't be chosen; finished attempts can, and say so. A missing
// or archived selection is shown as such and never silently replaced. Form
// dialogs are modal, so the selector can't be used while an edit is unsaved.
// P0-D06: the active account is the menu's checked item (filled ground and accent bar, no checkmark), and every row
// carries a freshness dot with its reason written under the name, so nothing relies on colour.
import { statusLabels } from "@fundedflow/domain";
import { ChevronDown, CircleAlert } from "lucide-react";
import { Link } from "react-router-dom";

import { DropdownMenu, formatInstant, type MenuEntry, StatusDot, useToast } from "../../../design-system";
import { useDisplayTimeZone } from "../../settings/display-time-zone";
import { useGuardedNavigate } from "../../shared/hooks/use-leave-guard";
import { canBeActive, useActiveAccount } from "../active-account";
import { freshnessLine, policyText, type FreshnessStatus } from "../freshness";
import { useAccountFreshness } from "../hooks/freshness";
import { accountLabel } from "./presentation";
import "./accounts.css";

const DOT: Record<FreshnessStatus, "success" | "caution" | "unknown"> = { fresh: "success", attention: "caution", unknown: "unknown" };

export function AccountSwitcher() {
  const { state, accounts, select, isSaving } = useActiveAccount();
  const toast = useToast();
  // Manage accounts asks first when an editor has unsaved edits (TASK-022).
  const navigate = useGuardedNavigate();
  const freshness = useAccountFreshness(accounts?.filter(canBeActive));
  const display = useDisplayTimeZone();

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
  // Explanatory times use the display time zone; the freshness itself compares instants, so the zone never changes it.
  const at = (instant: string) => (display.kind === "resolved" ? formatInstant(instant, { timeZone: display.zone, zoneName: "offset" }) : formatInstant(instant, { zoneName: "offset" }));
  const item = (a: (typeof choosable)[number]): MenuEntry => {
    const f = freshness.get(a.id);
    return {
      label: `${accountLabel(a)}${a.status === "active" ? "" : ` (${statusLabels[a.status]})`}`,
      icon: f ? <StatusDot tone={DOT[f.status]} /> : <span className="acct-dot-slot" aria-hidden="true" />,
      description: f ? freshnessLine(f, at) : "Checking freshness…",
      checked: a.id === current,
      disabled: isSaving,
      onSelect: () => void choose(a.id, a.name),
    };
  };
  const policy = freshness.policy;
  const items: MenuEntry[] = [
    ...(live.length ? [{ type: "label" as const, label: "Live accounts" }, ...live.map(item)] : []),
    ...(finished.length ? [{ type: "label" as const, label: "Finished attempts" }, ...finished.map(item)] : []),
    { type: "separator" },
    {
      type: "note",
      text: `Freshness is how recent each account's records are. Fresh means ${policyText(policy.rules)} (${policy.mode === "custom" ? "your custom policy" : policy.mode === "default" ? "default policy" : "your chosen policy"}${policy.fallback ? ", because the saved one can't be used" : ""}). It isn't a live connection or a check of balances or rules.`,
    },
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
