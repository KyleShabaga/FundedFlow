// Create and edit an account. One form for both: the persisted account contract,
// no invented fields. Client checks give immediate feedback; Rust still validates
// on save. Values stay as typed after a failed save, and a dirty form asks before
// it is discarded.
import { accountInputSchema, accountStatuses, accountTypes, statusLabels, toMicros, type AccountInput } from "@fundedflow/domain";
import { type FormEvent, useId, useMemo, useRef, useState } from "react";

import {
  Button,
  ConfirmDialog,
  Dialog,
  focusFirstInvalid,
  FormSection,
  InlineNotice,
  MutationFeedback,
  Select,
  Textarea,
  TextField,
  useToast,
  ValidationSummary,
  type ValidationIssue,
  zonedWallTime,
} from "../../../design-system";
import { useCatalogue } from "../../references/hooks/references";
import { fieldErrors, toMutationState } from "../../shared/presentation";
import { useCreateAccount, useUpdateAccount } from "../hooks/accounts";
import type { AccountViewModel } from "../view-models/account";
import { ACCOUNT_TYPE_LABELS } from "./presentation";

export interface AccountFormValues {
  name: string;
  accountType: AccountViewModel["accountType"];
  status: AccountViewModel["status"];
  propFirm: string;
  broker: string;
  externalRef: string;
  currency: string;
  timezone: string;
  startingBalance: string;
  tradingDayResetTime: string;
  notes: string;
}
type Field = keyof AccountFormValues;

const FIELD_LABELS: Record<Field, string> = {
  name: "Account name",
  accountType: "Account type",
  status: "Status",
  propFirm: "Prop firm",
  broker: "Broker or platform",
  externalRef: "Account number",
  currency: "Currency",
  timezone: "Time zone",
  startingBalance: "Starting balance",
  tradingDayResetTime: "Trading day starts at",
  notes: "Notes",
};
const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "JPY"];
const RESET_SUGGESTIONS = ["00:00", "16:00", "17:00", "18:00"];

type IntlWithValues = typeof Intl & { supportedValuesOf?: (key: "currency" | "timeZone") => string[] };
const supported = (key: "currency" | "timeZone"): string[] => {
  try {
    return (Intl as IntlWithValues).supportedValuesOf?.(key) ?? [];
  } catch {
    return [];
  }
};

/** The computer's zone: a visible, editable default. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function emptyAccountValues(): AccountFormValues {
  return {
    name: "",
    accountType: "evaluation",
    status: "active",
    propFirm: "",
    broker: "",
    externalRef: "",
    currency: "USD",
    timezone: localTimeZone(),
    startingBalance: "",
    tradingDayResetTime: "00:00",
    notes: "",
  };
}

export function accountValues(account: AccountViewModel): AccountFormValues {
  return {
    name: account.name,
    accountType: account.accountType,
    status: account.status,
    propFirm: account.propFirm ?? "",
    broker: account.broker ?? "",
    externalRef: account.externalRef ?? "",
    currency: account.currency,
    timezone: account.timezone,
    startingBalance: account.startingBalance,
    tradingDayResetTime: account.tradingDayResetTime,
    notes: account.notes ?? "",
  };
}

const optional = (v: string) => (v.trim() === "" ? null : v.trim());

export function toAccountInput(v: AccountFormValues): AccountInput {
  return {
    name: v.name.trim(),
    accountType: v.accountType,
    status: v.status,
    propFirm: optional(v.propFirm),
    broker: optional(v.broker),
    externalRef: optional(v.externalRef),
    currency: v.currency.trim().toUpperCase(),
    timezone: v.timezone.trim(),
    startingBalance: v.startingBalance.trim(),
    tradingDayResetTime: v.tradingDayResetTime.trim(),
    notes: v.notes.trim() === "" ? null : v.notes,
  };
}

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Immediate, friendly checks. Rust remains the authority and runs again on save. */
export function validateAccountValues(v: AccountFormValues): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  const parsed = accountInputSchema.safeParse(toAccountInput(v));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as Field;
      if (errors[field]) continue;
      errors[field] = issue.code === "invalid_type" ? "Required" : issue.message;
    }
  }
  if (!errors.name && v.name.trim() === "") errors.name = "Required";
  // Plain digits only: no sign, separators or exponents, exact in micro-units (never parsed as a float).
  const balance = v.startingBalance.trim();
  delete errors.startingBalance;
  if (balance === "") errors.startingBalance = "Enter the balance the account started with";
  else if (!/^\d+(\.\d{1,6})?$/.test(balance) || toMicros(balance) === null) errors.startingBalance = "Use a number such as 50000 or 50000.00, up to 6 decimal places";
  const currencies = supported("currency");
  const code = v.currency.trim().toUpperCase();
  if (!errors.currency && currencies.length > 0 && !currencies.includes(code)) errors.currency = `${code} isn't a currency code this computer recognises`;
  const zone = v.timezone.trim();
  if (zone === "") errors.timezone = "Required";
  else if (!validTimeZone(zone)) errors.timezone = "Use a time zone name such as America/New_York";
  return errors;
}

const fieldId = (base: string, field: string) => `${base}-${field}`;

export interface AccountFormDialogProps {
  mode: "create" | "edit";
  /** The account to edit. */
  account?: AccountViewModel;
  /** Trades already recorded on the account, when known: drives the warning about re-derived trading days. */
  tradeCount?: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the saved account after Rust confirms the write. */
  onSaved?: (account: AccountViewModel) => void;
}

export function AccountFormDialog(props: AccountFormDialogProps) {
  // Mount the form fresh each time the dialog opens, so it always starts from the saved values.
  return props.open ? <AccountFormDialogBody {...props} /> : null;
}

function AccountFormDialogBody({ mode, account, tradeCount, open, onOpenChange, onSaved }: AccountFormDialogProps) {
  const base = useId().replace(/:/g, "");
  const initial = useMemo(() => (account && mode === "edit" ? accountValues(account) : emptyAccountValues()), [account, mode]);
  const [values, setValues] = useState<AccountFormValues>(initial);
  const [clientErrors, setClientErrors] = useState<Partial<Record<Field, string>>>({});
  const [summary, setSummary] = useState<ValidationIssue[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const create = useCreateAccount();
  const update = useUpdateAccount(account?.id ?? "");
  const mutation = mode === "create" ? create : update;
  const catalogue = useCatalogue();
  const firms = useMemo(() => [...new Set((catalogue.data?.graph.providers ?? []).map(p => p.displayName))].sort(), [catalogue.data]);
  const zones = useMemo(() => supported("timeZone"), []);

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const serverErrors = fieldErrors(mutation.error) as Partial<Record<Field, string>>;
  const errorFor = (field: Field) => clientErrors[field] ?? serverErrors[field];
  const set = (field: Field) => (value: string) => {
    setValues(v => ({ ...v, [field]: value }));
    if (clientErrors[field]) setClientErrors(e => ({ ...e, [field]: undefined }));
  };

  const historicalChange =
    mode === "edit" && account !== undefined &&
    (values.currency.trim().toUpperCase() !== account.currency || values.timezone.trim() !== account.timezone || values.tradingDayResetTime.trim() !== account.tradingDayResetTime);
  const balanceChange = mode === "edit" && account !== undefined && values.startingBalance.trim() !== account.startingBalance;

  const requestClose = () => {
    if (mutation.isPending) return;
    if (dirty) setConfirmDiscard(true);
    else onOpenChange(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const errors = validateAccountValues(values);
    setClientErrors(errors);
    const issues = (Object.keys(errors) as Field[]).map(f => ({ fieldId: fieldId(base, f), message: `${FIELD_LABELS[f]}: ${errors[f]}` }));
    setSummary(issues);
    if (issues.length > 0) {
      queueMicrotask(() => focusFirstInvalid(form.current));
      return;
    }
    const input = toAccountInput(values);
    mutation
      .submit(input)
      .then(saved => {
        toast.show({ tone: "success", title: mode === "create" ? `${saved.name} added` : `${saved.name} saved` });
        onOpenChange(false);
        onSaved?.(saved);
      })
      .catch(() => queueMicrotask(() => focusFirstInvalid(form.current)));
  };

  const feedback = toMutationState(mutation, {
    success: mode === "create" ? "Account added." : "Changes saved.",
    fieldId: f => fieldId(base, f),
    fieldLabel: f => FIELD_LABELS[f as Field],
  });
  const now = new Date().toISOString();
  const zonePreview = validTimeZone(values.timezone.trim()) && values.timezone.trim() !== "" ? zonedWallTime(now, values.timezone.trim()).slice(11) : null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={next => (next ? onOpenChange(true) : requestClose())}
        size="lg"
        title={mode === "create" ? "Add account" : `Edit ${account?.name ?? "account"}`}
        description={
          mode === "create"
            ? "Only the name, money and time settings are needed now. Firm rules can be set up later."
            : "Status changes, archiving and new attempts have their own actions on the account page."
        }
        dismissible={!mutation.isPending}
        footer={
          <>
            <Button onClick={requestClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" form={fieldId(base, "form")} variant="primary" loading={mutation.isPending} disabled={!mutation.canSubmit && !mutation.isPending} disabledReason={mutation.canSubmit || mutation.isPending ? undefined : "Saving isn't available right now"}>
              {mutation.isPending ? "Saving…" : mode === "create" ? "Add account" : "Save changes"}
            </Button>
          </>
        }
      >
        <form id={fieldId(base, "form")} ref={form} onSubmit={submit} noValidate className="acct-form" aria-label={mode === "create" ? "New account" : "Edit account"}>
          <ValidationSummary issues={summary} title={summary.length === 1 ? "Fix 1 problem before saving" : undefined} />
          {feedback.status !== "idle" && feedback.status !== "submitting" && feedback.status !== "success" && (
            <MutationFeedback state={feedback} onCheck={() => onOpenChange(false)} />
          )}
          <FormSection title="Account" description="How you recognise this account. Never your broker password or keys.">
            <TextField id={fieldId(base, "name")} label={FIELD_LABELS.name} required value={values.name} onChange={e => set("name")(e.target.value)} error={errorFor("name")} maxLength={100} placeholder="PA-48213 or Eval #2" autoFocus />
            <Select<AccountViewModel["accountType"]>
              id={fieldId(base, "accountType")}
              label={FIELD_LABELS.accountType}
              required
              value={values.accountType}
              onValueChange={set("accountType")}
              error={errorFor("accountType")}
              options={accountTypes.map(t => ({ value: t, label: ACCOUNT_TYPE_LABELS[t] }))}
            />
            {mode === "create" && (
              <Select<AccountViewModel["status"]>
                id={fieldId(base, "status")}
                label={FIELD_LABELS.status}
                required
                description="Add a finished account as Passed, Failed or Closed to journal its past trades."
                value={values.status}
                onValueChange={set("status")}
                error={errorFor("status")}
                options={accountStatuses.map(s => ({ value: s, label: statusLabels[s] }))}
              />
            )}
            <TextField id={fieldId(base, "propFirm")} label={FIELD_LABELS.propFirm} optional value={values.propFirm} onChange={e => set("propFirm")(e.target.value)} error={errorFor("propFirm")} maxLength={100} list={fieldId(base, "firms")} description="Leave empty for a personal account. A firm not in the list can be typed." />
            <datalist id={fieldId(base, "firms")}>
              {firms.map(f => <option key={f} value={f} />)}
            </datalist>
            <TextField id={fieldId(base, "broker")} label={FIELD_LABELS.broker} optional value={values.broker} onChange={e => set("broker")(e.target.value)} error={errorFor("broker")} maxLength={100} placeholder="Tradovate, Rithmic, MetaTrader 5" />
            <TextField id={fieldId(base, "externalRef")} label={FIELD_LABELS.externalRef} optional value={values.externalRef} onChange={e => set("externalRef")(e.target.value)} error={errorFor("externalRef")} maxLength={100} description="The firm's or broker's number for it, used to match imports." />
          </FormSection>

          <FormSection title="Money and time" description="These decide how trades are counted. Changing them later recalculates existing trades.">
            <TextField id={fieldId(base, "currency")} label={FIELD_LABELS.currency} required value={values.currency} onChange={e => set("currency")(e.target.value.toUpperCase())} error={errorFor("currency")} maxLength={3} list={fieldId(base, "currencies")} description="3-letter code. Amounts are never converted between currencies." />
            <datalist id={fieldId(base, "currencies")}>
              {COMMON_CURRENCIES.map(c => <option key={c} value={c} />)}
            </datalist>
            <TextField id={fieldId(base, "startingBalance")} label={FIELD_LABELS.startingBalance} required numeric inputMode="decimal" suffix={values.currency.trim().toUpperCase() || undefined} value={values.startingBalance} onChange={e => set("startingBalance")(e.target.value)} error={errorFor("startingBalance")} placeholder="50000" description="The balance this attempt started with, not today's balance." />
            <TextField id={fieldId(base, "timezone")} label={FIELD_LABELS.timezone} required value={values.timezone} onChange={e => set("timezone")(e.target.value)} error={errorFor("timezone")} list={fieldId(base, "zones")} description={zonePreview ? `It is ${zonePreview} there now. Trade times show in this zone.` : "The zone the firm counts trading days in, such as America/New_York."} />
            <datalist id={fieldId(base, "zones")}>
              {zones.map(z => <option key={z} value={z} />)}
            </datalist>
            <TextField id={fieldId(base, "tradingDayResetTime")} label={FIELD_LABELS.tradingDayResetTime} required value={values.tradingDayResetTime} onChange={e => set("tradingDayResetTime")(e.target.value)} error={errorFor("tradingDayResetTime")} list={fieldId(base, "resets")} maxLength={5} placeholder="17:00" description="In the account's time zone. 00:00 for calendar days; many futures firms use 17:00 New York. Not an evaluation reset." />
            <datalist id={fieldId(base, "resets")}>
              {RESET_SUGGESTIONS.map(t => <option key={t} value={t} />)}
            </datalist>
          </FormSection>

          {historicalChange && (
            <InlineNotice tone="warning" title="This recalculates existing trades" live="polite">
              {tradeCount
                ? `Saving re-derives the trading day and P&L of ${tradeCount === 1 ? "1 recorded trade" : `${tradeCount} recorded trades`} from the new currency, time zone and day start. Amounts are not converted.`
                : "Saving re-derives the trading day and P&L of any trades on this account from the new settings. Amounts are not converted."}
            </InlineNotice>
          )}
          {balanceChange && (
            <InlineNotice tone="info" live="off">
              The starting balance is this attempt's baseline. Changing it doesn't change past trades; risk figures will use the new value once they are available.
            </InlineNotice>
          )}

          <FormSection title="Notes">
            <Textarea id={fieldId(base, "notes")} label={FIELD_LABELS.notes} optional hideLabel value={values.notes} onChange={e => set("notes")(e.target.value)} error={errorFor("notes")} rows={3} placeholder="Anything worth remembering about this account" />
          </FormSection>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        tone="neutral"
        title="Discard your changes?"
        confirmLabel="Discard"
        onConfirm={async () => {
          setConfirmDiscard(false);
          onOpenChange(false);
        }}
      >
        <p>{mode === "create" ? "The new account hasn't been added." : "Your edits to this account haven't been saved."} Keep editing to save them.</p>
      </ConfirmDialog>
    </>
  );
}

export { FIELD_LABELS as ACCOUNT_FIELD_LABELS };
