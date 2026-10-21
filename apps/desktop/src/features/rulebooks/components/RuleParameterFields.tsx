// Editable fields for one rule's typed parameters (Build 19). Tagged values pick a state
// first (Unknown, None, Off, Not applicable, Value); only "Value" asks for the value, so an
// unknown limit is never typed in as zero. Values are kept as the stored JSON (money as
// decimal text) and validated by the domain schema, not here.
import type { RuleType } from "@fundedflow/domain";
import { Plus, Trash2 } from "lucide-react";

import { Button, FieldGroup, IconButton, Select, TextField } from "../../../design-system";
import { enumLabel, PRESENCE_OPTIONS, RULE_FIELDS, type FieldSpec } from "../view-models/rule-fields";

type Params = Record<string, unknown>;
type Presence = { state: string; value?: unknown };

/** DOM id of a field, from its backend path ("rules[2].parameters.amount" → "rb-r2-amount"). */
export function fieldIdFor(path: string): string | undefined {
  const m = /^rules\[(\d+)\]\.(?:parameters\.)?([A-Za-z]+)/.exec(path);
  if (m) return `rb-r${m[1]}-${m[2]}`;
  if (["changeReason", "effectiveFrom", "effectiveTo", "capturedAt"].includes(path)) return `rb-${path}`;
  return undefined;
}

/** The first message under `prefix` (the field itself or anything inside it). */
export function errorUnder(errors: Record<string, string>, prefix: string): string | undefined {
  if (errors[prefix]) return errors[prefix];
  const key = Object.keys(errors).find(k => k.startsWith(`${prefix}.`) || k.startsWith(`${prefix}[`));
  return key ? errors[key] : undefined;
}

const countValue = (text: string): unknown => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : text);
const shown = (v: unknown) => (v === undefined || v === null ? "" : String(v));

interface FieldProps {
  spec: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
  error?: string;
  currency: string;
  disabled?: boolean;
}

function PresenceField({ spec, value, onChange, id, error, currency, disabled }: FieldProps) {
  const p = (value ?? { state: "unknown" }) as Presence;
  const setState = (state: string) => {
    if (state !== "value") return onChange({ state });
    const initial = spec.kind === "boolean" ? true : spec.kind === "limits" ? [{ contractClass: "mini", symbolRoot: null, maxContracts: 1 }]
      : spec.kind === "schedule" ? [{ balanceAtLeast: "", maxContracts: 1 }] : spec.kind === "lock" ? { triggerBalance: "", lockedFloor: "" } : "";
    onChange({ state: "value", value: p.state === "value" ? p.value : initial });
  };
  const set = (v: unknown) => onChange({ state: "value", value: v });
  return (
    <FieldGroup label={spec.label} error={error} className="rb-presence">
      <div className="rb-presence-row">
        <Select id={`${id}-state`} label={`${spec.label}: what the source says`} hideLabel size="sm" disabled={disabled}
          options={PRESENCE_OPTIONS} value={p.state} onValueChange={setState} />
        {p.state === "value" && <ValueInput spec={spec} value={p.value} onChange={set} id={id} currency={currency} disabled={disabled} />}
      </div>
    </FieldGroup>
  );
}

function ValueInput({ spec, value, onChange, id, currency, disabled }: Omit<FieldProps, "error">) {
  switch (spec.kind) {
    case "money":
      return <TextField id={id} label={spec.label} hideLabel numeric inputMode="decimal" suffix={currency} disabled={disabled}
        value={shown(value)} onChange={e => onChange(e.target.value.trim())} placeholder="0.00" />;
    case "count":
      return <TextField id={id} label={spec.label} hideLabel numeric inputMode="numeric" suffix={spec.unit} disabled={disabled}
        value={shown(value)} onChange={e => onChange(countValue(e.target.value))} />;
    case "share":
      return <TextField id={id} label={`${spec.label} (decimal, 0.5 = 50%)`} hideLabel numeric inputMode="decimal" disabled={disabled}
        description="Decimal share: 0.5 is 50%" value={shown(value)} onChange={e => onChange(e.target.value.trim())} placeholder="0.5" />;
    case "text":
      return <TextField id={id} label={spec.label} hideLabel disabled={disabled} value={shown(value)} onChange={e => onChange(e.target.value)} />;
    case "boolean":
      return <Select id={id} label={spec.label} hideLabel size="sm" disabled={disabled} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
        value={value === false ? "no" : "yes"} onValueChange={v => onChange(v === "yes")} />;
    case "lock": {
      const lock = (value ?? {}) as { triggerBalance?: string; lockedFloor?: string };
      return (
        <div className="rb-inline-fields">
          <TextField id={id} label="Locks once balance reaches" numeric inputMode="decimal" suffix={currency} disabled={disabled}
            value={shown(lock.triggerBalance)} onChange={e => onChange({ ...lock, triggerBalance: e.target.value.trim() })} />
          <TextField id={`${id}-floor`} label="Floor stops at" numeric inputMode="decimal" suffix={currency} disabled={disabled}
            value={shown(lock.lockedFloor)} onChange={e => onChange({ ...lock, lockedFloor: e.target.value.trim() })} />
        </div>
      );
    }
    case "limits": {
      const rows = (Array.isArray(value) ? value : []) as { contractClass: string; symbolRoot: string | null; maxContracts: unknown }[];
      const put = (i: number, row: Partial<(typeof rows)[number]>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...row } : r)));
      return (
        <div className="rb-rows" id={id} tabIndex={-1}>
          {rows.map((r, i) => (
            <div key={i} className="rb-inline-fields">
              <Select label={`Limit ${i + 1}: contract class`} size="sm" disabled={disabled} value={r.contractClass}
                options={["mini", "micro", "any"].map(c => ({ value: c, label: enumLabel(c) }))} onValueChange={v => put(i, { contractClass: v })} />
              <TextField label={`Limit ${i + 1}: symbol root`} optional disabled={disabled} value={r.symbolRoot ?? ""} placeholder="ES"
                onChange={e => put(i, { symbolRoot: e.target.value.trim() === "" ? null : e.target.value.trim().toUpperCase() })} />
              <TextField label={`Limit ${i + 1}: contracts`} numeric inputMode="numeric" disabled={disabled} value={shown(r.maxContracts)}
                onChange={e => put(i, { maxContracts: countValue(e.target.value) })} />
              <IconButton label={`Remove limit ${i + 1}`} icon={<Trash2 size={16} aria-hidden="true" />} variant="ghost" disabled={disabled || rows.length === 1}
                onClick={() => onChange(rows.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus size={16} aria-hidden="true" />} disabled={disabled}
            onClick={() => onChange([...rows, { contractClass: "mini", symbolRoot: null, maxContracts: 1 }])}>Add limit</Button>
        </div>
      );
    }
    case "schedule": {
      const rows = (Array.isArray(value) ? value : []) as { balanceAtLeast: string; maxContracts: unknown }[];
      const put = (i: number, row: Partial<(typeof rows)[number]>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...row } : r)));
      return (
        <div className="rb-rows" id={id} tabIndex={-1}>
          {rows.map((r, i) => (
            <div key={i} className="rb-inline-fields">
              <TextField label={`Step ${i + 1}: balance at least`} numeric inputMode="decimal" suffix={currency} disabled={disabled}
                value={shown(r.balanceAtLeast)} onChange={e => put(i, { balanceAtLeast: e.target.value.trim() })} />
              <TextField label={`Step ${i + 1}: contracts`} numeric inputMode="numeric" disabled={disabled} value={shown(r.maxContracts)}
                onChange={e => put(i, { maxContracts: countValue(e.target.value) })} />
              <IconButton label={`Remove step ${i + 1}`} icon={<Trash2 size={16} aria-hidden="true" />} variant="ghost" disabled={disabled || rows.length === 1}
                onClick={() => onChange(rows.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus size={16} aria-hidden="true" />} disabled={disabled}
            onClick={() => onChange([...rows, { balanceAtLeast: "", maxContracts: 1 }])}>Add step</Button>
        </div>
      );
    }
    default:
      return null;
  }
}

/** Every parameter of a rule of `type`, laid out as labelled fields. */
export function RuleParameterFields({ type, parameters, onChange, index, errors, currency, disabled }: {
  type: RuleType;
  parameters: Params;
  onChange: (parameters: Params) => void;
  index: number;
  errors: Record<string, string>;
  currency: string;
  disabled?: boolean;
}) {
  return (
    <div className="rb-params">
      {RULE_FIELDS[type].map(spec => {
        const id = `rb-r${index}-${spec.key}`;
        const error = errorUnder(errors, `rules[${index}].parameters.${spec.key}`);
        const set = (v: unknown) => onChange({ ...parameters, [spec.key]: v });
        if (spec.kind === "enum") {
          return <Select key={spec.key} id={id} label={spec.label} error={error} size="sm" disabled={disabled}
            options={spec.options.map(o => ({ value: o, label: enumLabel(o) }))} value={String(parameters[spec.key] ?? "")} onValueChange={set} />;
        }
        if (spec.kind === "description") {
          return <TextField key={spec.key} id={id} label={spec.label} error={error} optional={spec.nullable} disabled={disabled}
            value={shown(parameters[spec.key])} onChange={e => set(spec.nullable && e.target.value === "" ? null : e.target.value)} />;
        }
        return <PresenceField key={spec.key} spec={spec} value={parameters[spec.key]} onChange={set} id={id} error={error} currency={currency} disabled={disabled} />;
      })}
    </div>
  );
}
