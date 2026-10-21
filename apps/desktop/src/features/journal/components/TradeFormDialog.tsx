// Manual trade entry and correction (Build 20). One form for both. Times are typed in the account's time zone and
// sent as UTC instants; Rust validates again, derives the trading day and calculates gross and net P&L. Nothing here
// computes a stored value. A correction names the revision it started from (a later change is a conflict, never an
// overwrite) and is recorded with an optional reason. Imported trades can be corrected; their original CSV row and
// source fills are kept unchanged. A dirty form asks before it is discarded.
import { tradeInputSchema, type TradeInput } from "@fundedflow/domain";
import { type FormEvent, useId, useMemo, useRef, useState } from "react";

import {
  Button,
  ConfirmDialog,
  Dialog,
  focusFirstInvalid,
  FormSection,
  InlineNotice,
  MutationFeedback,
  RadioGroup,
  Textarea,
  TextField,
  useToast,
  ValidationSummary,
  type ValidationIssue,
  zonedWallTime,
  zonedWallTimeToInstant,
} from "../../../design-system";
import type { AccountViewModel } from "../../accounts/view-models/account";
import { fieldErrors, toMutationState } from "../../shared/presentation";
import { useCorrectTrade, useCreateTrade } from "../../trades/hooks/trades";
import type { TradeViewModel } from "../../trades/view-models/trade";

export interface TradeFormValues {
  symbol: string;
  side: "long" | "short";
  quantity: string;
  entryAt: string;
  entryPrice: string;
  exitAt: string;
  exitPrice: string;
  fees: string;
  reportedPnl: string;
  notes: string;
  reason: string;
}
type Field = keyof TradeFormValues;

export const TRADE_FIELD_LABELS: Record<Field, string> = {
  symbol: "Symbol",
  side: "Side",
  quantity: "Quantity",
  entryAt: "Entry time",
  entryPrice: "Entry price",
  exitAt: "Exit time",
  exitPrice: "Exit price",
  fees: "Fees and commissions",
  reportedPnl: "Broker P&L (before fees)",
  notes: "Trade notes",
  reason: "Reason for the correction",
};
// Rust and the input schema name some fields differently.
const INPUT_FIELD: Record<string, Field> = { realizedPnl: "reportedPnl" };

export function emptyTradeValues(): TradeFormValues {
  return { symbol: "", side: "long", quantity: "1", entryAt: "", entryPrice: "", exitAt: "", exitPrice: "", fees: "", reportedPnl: "", notes: "", reason: "" };
}

export function tradeValues(trade: TradeViewModel): TradeFormValues {
  return {
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    entryAt: zonedWallTime(trade.entryAt, trade.timeZone),
    entryPrice: trade.entryPrice,
    exitAt: trade.exitAt ? zonedWallTime(trade.exitAt, trade.timeZone) : "",
    exitPrice: trade.exitPrice ?? "",
    fees: trade.fees === "0" ? "" : trade.fees,
    reportedPnl: trade.reportedPnl ?? "",
    notes: trade.notes ?? "",
    reason: "",
  };
}

const blank = (v: string) => (v.trim() === "" ? null : v.trim());

/**
 * The command input. A time left as it was keeps the stored instant exactly (seconds and milliseconds included), so
 * correcting the fees of an imported trade never moves its times.
 */
export function toTradeInput(accountId: string, v: TradeFormValues, timeZone: string, original?: TradeViewModel): TradeInput {
  const initial = original ? tradeValues(original) : null;
  const instant = (local: string, kept: string | null | undefined, keptLocal: string | undefined) =>
    local.trim() === "" ? null : kept && local === keptLocal ? kept : zonedWallTimeToInstant(local, timeZone) || local;
  return {
    accountId,
    symbol: v.symbol.trim(),
    side: v.side,
    quantity: v.quantity.trim(),
    entryAt: instant(v.entryAt, original?.entryAt, initial?.entryAt) ?? "",
    entryPrice: v.entryPrice.trim(),
    exitAt: instant(v.exitAt, original?.exitAt, initial?.exitAt),
    exitPrice: blank(v.exitPrice),
    fees: blank(v.fees),
    realizedPnl: blank(v.reportedPnl),
    notes: v.notes.trim() === "" ? null : v.notes,
  };
}

/** Immediate checks from the shared schema; Rust remains the authority and runs them again. */
export function validateTradeValues(accountId: string, v: TradeFormValues, timeZone: string, original?: TradeViewModel): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {};
  if (v.entryAt.trim() === "") errors.entryAt = "Enter when the trade was opened";
  if (v.exitAt.trim() !== "" && v.exitPrice.trim() === "") errors.exitPrice = "Enter the exit price, or clear the exit time for an open trade";
  if (v.exitAt.trim() === "" && v.exitPrice.trim() !== "") errors.exitAt = "Enter the exit time, or clear the exit price for an open trade";
  const parsed = tradeInputSchema.safeParse(toTradeInput(accountId, v, timeZone, original));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      const field = (INPUT_FIELD[key] ?? key) as Field;
      if (!(field in TRADE_FIELD_LABELS) || errors[field]) continue;
      errors[field] = issue.code === "invalid_type" ? "Required" : issue.message;
    }
  }
  if (v.reason.length > 2000) errors.reason = "Keep the reason under 2,000 characters";
  return errors;
}

export interface TradeFormDialogProps {
  account: AccountViewModel;
  /** The trade to correct; absent for a new manual trade. */
  trade?: TradeViewModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (trade: TradeViewModel) => void;
}

export function TradeFormDialog(props: TradeFormDialogProps) {
  // Mount fresh each time so the form starts from the stored values.
  return props.open ? <TradeFormBody {...props} /> : null;
}

const fieldId = (base: string, f: string) => `${base}-${f}`;

function TradeFormBody({ account, trade, open, onOpenChange, onSaved }: TradeFormDialogProps) {
  const mode = trade ? "edit" : "create";
  const base = useId().replace(/:/g, "");
  const initial = useMemo(() => (trade ? tradeValues(trade) : emptyTradeValues()), [trade]);
  const [values, setValues] = useState(initial);
  const [clientErrors, setClientErrors] = useState<Partial<Record<Field, string>>>({});
  const [summary, setSummary] = useState<ValidationIssue[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const create = useCreateTrade(account.id);
  const correct = useCorrectTrade(account.id, trade?.id ?? "");
  const mutation = trade ? correct : create;
  const zone = account.timezone;

  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const server = fieldErrors(mutation.error);
  const errorFor = (f: Field) => clientErrors[f] ?? server[f] ?? server[Object.entries(INPUT_FIELD).find(([, v]) => v === f)?.[0] ?? ""];
  const set = (f: Field) => (value: string) => {
    setValues(v => ({ ...v, [f]: value }));
    if (clientErrors[f]) setClientErrors(e => ({ ...e, [f]: undefined }));
  };
  const requestClose = () => {
    if (mutation.isPending) return;
    if (dirty) setConfirmDiscard(true);
    else onOpenChange(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    const errors = validateTradeValues(account.id, values, zone, trade);
    setClientErrors(errors);
    const issues = (Object.keys(errors) as Field[]).map(f => ({ fieldId: fieldId(base, f), message: `${TRADE_FIELD_LABELS[f]}: ${errors[f]}` }));
    setSummary(issues);
    if (issues.length) {
      queueMicrotask(() => focusFirstInvalid(form.current));
      return;
    }
    const input = toTradeInput(account.id, values, zone, trade);
    const saving = trade
      ? correct.submit({ input, options: { expectedUpdatedAt: trade.updatedAt, reason: blank(values.reason) } })
      : create.submit(input);
    saving
      .then(saved => {
        toast.show({ tone: "success", title: trade ? `${saved.symbol} corrected` : `${saved.symbol} trade added`, description: `Trading day ${saved.tradingDay}` });
        onOpenChange(false);
        onSaved?.(saved);
      })
      .catch(() => queueMicrotask(() => focusFirstInvalid(form.current)));
  };

  const feedback = toMutationState(mutation, {
    success: trade ? "Correction saved." : "Trade added.",
    fieldId: f => fieldId(base, INPUT_FIELD[f] ?? f),
    fieldLabel: f => TRADE_FIELD_LABELS[(INPUT_FIELD[f] ?? f) as Field],
  });
  const conflict = mutation.error?.category === "conflict";
  const imported = trade?.source === "csv_import";
  const zoneNote = `${zone}, the account's time zone`;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={next => (next ? onOpenChange(true) : requestClose())}
        size="lg"
        title={mode === "create" ? "Add a manual trade" : `Correct ${trade?.symbol} trade`}
        description={
          mode === "create"
            ? `For ${account.name}. One round trip: entry and, once closed, exit. Times are in ${zoneNote}.`
            : `Times are in ${zoneNote}. The correction is recorded with the old and new values.`
        }
        dismissible={!mutation.isPending}
        footer={
          <>
            <Button onClick={requestClose} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" form={fieldId(base, "form")} variant="primary" loading={mutation.isPending}
              disabled={!mutation.canSubmit && !mutation.isPending}
              disabledReason={mutation.canSubmit || mutation.isPending ? undefined : "Saving isn't available right now"}>
              {mutation.isPending ? "Saving…" : mode === "create" ? "Add trade" : "Save correction"}
            </Button>
          </>
        }
      >
        <form id={fieldId(base, "form")} ref={form} onSubmit={submit} noValidate className="jr-form" aria-label={mode === "create" ? "New manual trade" : "Correct trade"}>
          <ValidationSummary issues={summary} />
          {conflict && (
            <InlineNotice tone="warning" title="This trade changed after you opened it" live="polite">
              Close this form and open the trade again to see the stored values, then apply your correction. Nothing was saved.
            </InlineNotice>
          )}
          {!conflict && feedback.status !== "idle" && feedback.status !== "submitting" && feedback.status !== "success" && (
            <MutationFeedback state={feedback} onCheck={() => onOpenChange(false)} />
          )}
          {imported && (
            <InlineNotice tone="info" live="off">
              This trade was imported. Correcting it changes the journal's values only: the original CSV row and source fills stay exactly as
              exported, and re-importing the file will not undo the correction.
            </InlineNotice>
          )}
          <FormSection title="Instrument">
            <div className="jr-form-row">
              <TextField id={fieldId(base, "symbol")} label={TRADE_FIELD_LABELS.symbol} required value={values.symbol} onChange={e => set("symbol")(e.target.value.toUpperCase())} error={errorFor("symbol")} maxLength={32} placeholder="MNQZ6" autoFocus={mode === "create"} description="Futures roots such as ES, NQ, MES and MNQ get P&L from their point value." />
              <TextField id={fieldId(base, "quantity")} label={TRADE_FIELD_LABELS.quantity} required numeric inputMode="decimal" value={values.quantity} onChange={e => set("quantity")(e.target.value)} error={errorFor("quantity")} description="Contracts or units." />
            </div>
            <RadioGroup<"long" | "short"> label={TRADE_FIELD_LABELS.side} inline required value={values.side} onValueChange={v => set("side")(v)} error={errorFor("side")}
              options={[{ value: "long", label: "Long (bought first)" }, { value: "short", label: "Short (sold first)" }]} />
          </FormSection>
          <FormSection title="Entry and exit" description="Leave the exit empty while the trade is open; it then has no P&L.">
            <div className="jr-form-row">
              <TextField id={fieldId(base, "entryAt")} type="datetime-local" label={TRADE_FIELD_LABELS.entryAt} required value={values.entryAt} onChange={e => set("entryAt")(e.target.value)} error={errorFor("entryAt")} />
              <TextField id={fieldId(base, "entryPrice")} label={TRADE_FIELD_LABELS.entryPrice} required numeric inputMode="decimal" value={values.entryPrice} onChange={e => set("entryPrice")(e.target.value)} error={errorFor("entryPrice")} />
            </div>
            <div className="jr-form-row">
              <TextField id={fieldId(base, "exitAt")} type="datetime-local" label={TRADE_FIELD_LABELS.exitAt} optional value={values.exitAt} onChange={e => set("exitAt")(e.target.value)} error={errorFor("exitAt")} />
              <TextField id={fieldId(base, "exitPrice")} label={TRADE_FIELD_LABELS.exitPrice} optional numeric inputMode="decimal" value={values.exitPrice} onChange={e => set("exitPrice")(e.target.value)} error={errorFor("exitPrice")} />
            </div>
            <p className="ds-faint jr-form-note">
              The trading day is worked out when you save, from {zone} and the account's day start ({account.tradingDayResetTime}); weekends count toward Monday.
            </p>
          </FormSection>
          <FormSection title="Costs and P&L" description="FundedFlow calculates gross and net P&L when you save. Nothing here is estimated.">
            <div className="jr-form-row">
              <TextField id={fieldId(base, "fees")} label={TRADE_FIELD_LABELS.fees} optional numeric inputMode="decimal" suffix={account.currency} value={values.fees} onChange={e => set("fees")(e.target.value)} error={errorFor("fees")} placeholder="0" description="Total for the round trip, as a positive cost." />
              <TextField id={fieldId(base, "reportedPnl")} label={TRADE_FIELD_LABELS.reportedPnl} optional numeric inputMode="decimal" suffix={account.currency} value={values.reportedPnl} onChange={e => set("reportedPnl")(e.target.value)} error={errorFor("reportedPnl")} description="Used only when the symbol's point value is unknown." />
            </div>
          </FormSection>
          <FormSection title="Notes">
            <Textarea id={fieldId(base, "notes")} label={TRADE_FIELD_LABELS.notes} optional hideLabel value={values.notes} onChange={e => set("notes")(e.target.value)} error={errorFor("notes")} rows={3} maxLength={20_000} placeholder="Anything about the execution itself. The review has its own notes." />
          </FormSection>
          {mode === "edit" && (
            <FormSection title="Correction">
              <TextField id={fieldId(base, "reason")} label={TRADE_FIELD_LABELS.reason} optional value={values.reason} onChange={e => set("reason")(e.target.value)} error={errorFor("reason")} maxLength={2000} placeholder="Broker statement shows $4.12 fees" description="Kept in the trade's correction history." />
            </FormSection>
          )}
        </form>
      </Dialog>
      <ConfirmDialog open={confirmDiscard} onOpenChange={setConfirmDiscard} tone="neutral" title="Discard this trade?" confirmLabel="Discard"
        onConfirm={async () => { setConfirmDiscard(false); onOpenChange(false); }}>
        <p>{mode === "create" ? "The trade hasn't been added." : "Your correction hasn't been saved."} Keep editing to save it.</p>
      </ConfirmDialog>
    </>
  );
}
