// Form controls. Each control renders a native element (or a Radix primitive
// for Select) with its label, description and error wired together:
// aria-describedby lists the description and the error, aria-invalid marks the
// error, and the error text sits in a reserved slot so the layout does not
// jump when it appears. Controls work controlled or uncontrolled, like the
// native element they wrap.

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown, CircleAlert, FileText, Search, Upload, X } from "lucide-react";
import {
  type DragEvent,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { cx } from "./cx";

/* ---------- Field plumbing ---------- */

interface FieldText {
  /** Visible label. Required: every control has an accessible name. */
  label: string;
  /** Hide the label visually (search boxes in a toolbar); it is still the accessible name. */
  hideLabel?: boolean;
  /** Help text under the label. */
  description?: ReactNode;
  /** Validation message. Present means invalid. */
  error?: string | null;
  /** Shows "Optional" beside the label. Mark optional fields in forms where most fields are required. */
  optional?: boolean;
}

function useFieldIds(id: string | undefined) {
  const auto = useId();
  const base = id ?? auto;
  return { control: base, description: `${base}-description`, error: `${base}-error` };
}

function describedBy(ids: ReturnType<typeof useFieldIds>, description: unknown, error: unknown, extra?: string) {
  return cx(extra, description != null && ids.description, error ? ids.error : null) || undefined;
}

function FieldLabel({ htmlFor, label, required, optional, hidden, as = "label", id }: { htmlFor?: string; label: string; required?: boolean; optional?: boolean; hidden?: boolean; as?: "label" | "span"; id?: string }) {
  const Tag = as;
  return (
    <Tag id={id} htmlFor={as === "label" ? htmlFor : undefined} className={cx("ds-field-label", hidden && "ds-sr-only")}>
      {label}
      {required && (
        <span className="ds-field-req" aria-hidden="true">
          {" "}*
        </span>
      )}
      {optional && !required && <span className="ds-field-opt"> Optional</span>}
    </Tag>
  );
}

/** Validation message under a control. Rendered by every control; use directly for custom controls. */
export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <p id={id} className="ds-field-error">
      <CircleAlert size={14} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function FieldShell({ ids, text, required, children, className }: { ids: ReturnType<typeof useFieldIds>; text: FieldText; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cx("ds-field", text.error && "is-invalid", className)}>
      <FieldLabel htmlFor={ids.control} label={text.label} required={required} optional={text.optional} hidden={text.hideLabel} />
      {text.description != null && (
        <p id={ids.description} className="ds-field-desc">
          {text.description}
        </p>
      )}
      {children}
      <FieldError id={ids.error}>{text.error}</FieldError>
    </div>
  );
}

/* ---------- TextField ---------- */

export interface TextFieldProps extends FieldText, Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  ref?: Ref<HTMLInputElement>;
  /** Text after the input: a unit ("USD", "contracts"). */
  suffix?: ReactNode;
  /** Mono, right-aligned: prices, quantities, money. */
  numeric?: boolean;
  /** Extra class on the field wrapper. */
  fieldClassName?: string;
}

export function TextField({ label, hideLabel, description, error, optional, suffix, numeric, id, required, className, fieldClassName, ...rest }: TextFieldProps) {
  const ids = useFieldIds(id);
  return (
    <FieldShell ids={ids} text={{ label, hideLabel, description, error, optional }} required={required} className={fieldClassName}>
      <div className={cx("ds-input-wrap", suffix != null && "has-suffix")}>
        <input
          {...rest}
          id={ids.control}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ids, description, error, rest["aria-describedby"])}
          className={cx("ds-input", numeric && "is-numeric", className)}
        />
        {suffix != null && <span className="ds-input-suffix">{suffix}</span>}
      </div>
    </FieldShell>
  );
}

/* ---------- Textarea ---------- */

export interface TextareaProps extends FieldText, TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
  fieldClassName?: string;
}

export function Textarea({ label, hideLabel, description, error, optional, id, required, className, fieldClassName, rows = 4, ...rest }: TextareaProps) {
  const ids = useFieldIds(id);
  return (
    <FieldShell ids={ids} text={{ label, hideLabel, description, error, optional }} required={required} className={fieldClassName}>
      <textarea
        {...rest}
        rows={rows}
        id={ids.control}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, description, error, rest["aria-describedby"])}
        className={cx("ds-input", "ds-textarea", className)}
      />
    </FieldShell>
  );
}

/* ---------- SearchField ---------- */

export interface SearchFieldProps extends Omit<TextFieldProps, "type" | "suffix" | "numeric" | "value" | "onChange" | "defaultValue"> {
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * Toolbar search. Controlled: the screen owns the query and decides when to
 * filter. The label is visually hidden by default; Escape or the clear button
 * empties the box and keeps focus in it.
 */
export function SearchField({ label, hideLabel = true, description, error, optional, value, onValueChange, id, className, fieldClassName, onKeyDown, ref, ...rest }: SearchFieldProps) {
  const ids = useFieldIds(id);
  const inner = useRef<HTMLInputElement | null>(null);
  const setRef = (el: HTMLInputElement | null) => {
    inner.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  const clear = () => {
    onValueChange("");
    inner.current?.focus();
  };
  return (
    <FieldShell ids={ids} text={{ label, hideLabel, description, error, optional }} className={cx("ds-search", fieldClassName)}>
      <div className="ds-input-wrap ds-search-wrap">
        <Search size={16} className="ds-search-icon" aria-hidden="true" />
        <input
          {...rest}
          ref={setRef}
          id={ids.control}
          type="search"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && value) {
              e.preventDefault();
              clear();
            }
            onKeyDown?.(e);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ids, description, error, rest["aria-describedby"])}
          className={cx("ds-input", "ds-search-input", className)}
        />
        {value && !rest.disabled && !rest.readOnly && (
          <button type="button" className="ds-search-clear" aria-label={`Clear ${label.toLowerCase()}`} onClick={clear}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </FieldShell>
  );
}

/* ---------- Checkbox ---------- */

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  ref?: Ref<HTMLInputElement>;
  label: ReactNode;
  description?: ReactNode;
  error?: string | null;
  /** Mixed state for select-all. The DOM property, not an attribute. */
  indeterminate?: boolean;
  /** Hide the label visually (table row checkboxes). Pass a string label then. */
  hideLabel?: boolean;
}

export function Checkbox({ label, description, error, indeterminate = false, hideLabel, id, className, ref, ...rest }: CheckboxProps) {
  const ids = useFieldIds(id);
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const setRef = (el: HTMLInputElement | null) => {
    inner.current = el;
    if (el) el.indeterminate = indeterminate;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  return (
    <div className={cx("ds-check", error && "is-invalid", className)}>
      <span className="ds-check-row">
        <input
          {...rest}
          ref={setRef}
          id={ids.control}
          type="checkbox"
          aria-checked={indeterminate ? "mixed" : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ids, description, error, rest["aria-describedby"])}
          className="ds-check-input"
        />
        <label htmlFor={ids.control} className={cx("ds-check-label", hideLabel && "ds-sr-only")}>
          {label}
        </label>
      </span>
      {description != null && (
        <p id={ids.description} className="ds-field-desc ds-check-desc">
          {description}
        </p>
      )}
      <FieldError id={ids.error}>{error}</FieldError>
    </div>
  );
}

/* ---------- Switch ---------- */

export interface SwitchProps extends Omit<CheckboxProps, "indeterminate" | "hideLabel"> {}

/** On/off setting that applies at once (no Save). Native checkbox with role="switch": Space toggles. */
export function Switch({ label, description, error, id, className, ref, ...rest }: SwitchProps) {
  const ids = useFieldIds(id);
  return (
    <div className={cx("ds-check", "ds-switch", error && "is-invalid", className)}>
      <span className="ds-check-row">
        <input
          {...rest}
          ref={ref}
          id={ids.control}
          type="checkbox"
          role="switch"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ids, description, error, rest["aria-describedby"])}
          className="ds-switch-input"
        />
        <label htmlFor={ids.control} className="ds-check-label">
          {label}
        </label>
      </span>
      {description != null && (
        <p id={ids.description} className="ds-field-desc ds-check-desc">
          {description}
        </p>
      )}
      <FieldError id={ids.error}>{error}</FieldError>
    </div>
  );
}

/* ---------- RadioGroup ---------- */

export interface RadioOption<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<V extends string = string> {
  /** Legend of the group. */
  label: string;
  /** Shared name of the native radios. Default: generated. */
  name?: string;
  options: readonly RadioOption<V>[];
  value?: V | null;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  description?: ReactNode;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Lay options in a row (two or three short choices). */
  inline?: boolean;
  className?: string;
}

/** One choice of a few. Native radios: arrow keys move and select, Tab leaves the group. */
export function RadioGroup<V extends string>({ label, name, options, value, defaultValue, onValueChange, description, error, required, disabled, inline, className }: RadioGroupProps<V>) {
  const ids = useFieldIds(undefined);
  const groupName = name ?? ids.control;
  return (
    <fieldset
      className={cx("ds-fieldset", "ds-radio-group", inline && "is-inline", error && "is-invalid", className)}
      aria-describedby={describedBy(ids, description, error)}
      aria-invalid={error ? true : undefined}
      aria-required={required || undefined}
      disabled={disabled}
    >
      <legend className="ds-field-label">
        {label}
        {required && <span className="ds-field-req" aria-hidden="true"> *</span>}
      </legend>
      {description != null && (
        <p id={ids.description} className="ds-field-desc">
          {description}
        </p>
      )}
      <div className="ds-radio-options">
        {options.map((o) => {
          const optId = `${ids.control}-${o.value}`;
          return (
            <div key={o.value} className="ds-check">
              <span className="ds-check-row">
                <input
                  id={optId}
                  type="radio"
                  name={groupName}
                  value={o.value}
                  className="ds-radio-input"
                  disabled={o.disabled}
                  required={required}
                  checked={value === undefined ? undefined : value === o.value}
                  defaultChecked={value === undefined && defaultValue !== undefined ? defaultValue === o.value : undefined}
                  onChange={() => onValueChange?.(o.value)}
                  aria-describedby={o.description != null ? `${optId}-description` : undefined}
                />
                <label htmlFor={optId} className="ds-check-label">
                  {o.label}
                </label>
              </span>
              {o.description != null && (
                <p id={`${optId}-description`} className="ds-field-desc ds-check-desc">
                  {o.description}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <FieldError id={ids.error}>{error}</FieldError>
    </fieldset>
  );
}

/* ---------- ChipGroup ---------- */

export interface ChipOption<V extends string = string> {
  value: V;
  label: string;
  /** Shown as the chip's tooltip and to screen readers ("Archived: kept on past reviews"). */
  note?: string;
  disabled?: boolean;
}

export interface ChipGroupProps<V extends string = string> {
  /** Legend of the group ("Mistakes"). */
  label: string;
  options: readonly ChipOption<V>[];
  /** The chosen values (several may be chosen). */
  value: readonly V[];
  onValueChange: (value: V[]) => void;
  /** warn: chips that flag a problem (mistakes) turn amber when chosen. */
  tone?: "flow" | "warn";
  description?: ReactNode;
  error?: string | null;
  /** Shown in place of the chips when there are no options. */
  empty?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Several-of-many choice as toggle chips (setup, mistake and mindset tags). Each chip is a button with
 * aria-pressed in a labelled fieldset, so Tab moves between chips and Space or Enter toggles one.
 */
export function ChipGroup<V extends string>({ label, options, value, onValueChange, tone = "flow", description, error, empty, disabled, className }: ChipGroupProps<V>) {
  const ids = useFieldIds(undefined);
  const toggle = (v: V) => onValueChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <fieldset
      className={cx("ds-fieldset", "ds-chips", tone === "warn" && "is-warn", error && "is-invalid", className)}
      aria-describedby={describedBy(ids, description, error)}
      aria-invalid={error ? true : undefined}
      disabled={disabled}
    >
      <legend className="ds-field-label">{label}</legend>
      {description != null && (
        <p id={ids.description} className="ds-field-desc">
          {description}
        </p>
      )}
      {options.length === 0 && empty != null ? (
        <div className="ds-faint ds-chips-empty">{empty}</div>
      ) : (
        <div className="ds-chips-list">
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                className={cx("ds-chip", on && "is-on")}
                aria-pressed={on}
                disabled={o.disabled}
                title={o.note}
                onClick={() => toggle(o.value)}
              >
                {on && <Check size={12} aria-hidden="true" />}
                {o.label}
                {o.note && <span className="ds-sr-only">, {o.note}</span>}
              </button>
            );
          })}
        </div>
      )}
      <FieldError id={ids.error}>{error}</FieldError>
    </fieldset>
  );
}

/* ---------- Select (Radix) ---------- */

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> extends FieldText {
  options: readonly SelectOption<V>[];
  value?: V;
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  /** Shown when nothing is chosen. Nothing is chosen for you: there is no silent default. */
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  /** Form field name; Radix renders a hidden native select for form posts. */
  name?: string;
  id?: string;
  size?: "md" | "sm";
  className?: string;
}

/**
 * A choice from a list (account, time zone, rows per page). Radix Select:
 * Enter, Space and arrow keys open it, typing jumps to an option, Escape
 * closes it and focus returns to the trigger.
 */
export function Select<V extends string>({ label, hideLabel, description, error, optional, options, value, defaultValue, onValueChange, placeholder = "Choose…", required, disabled, name, id, size = "md", className }: SelectProps<V>) {
  const ids = useFieldIds(id);
  const labelId = `${ids.control}-label`;
  return (
    <div className={cx("ds-field", error && "is-invalid", className)}>
      <FieldLabel as="span" id={labelId} label={label} required={required} optional={optional} hidden={hideLabel} />
      {description != null && (
        <p id={ids.description} className="ds-field-desc">
          {description}
        </p>
      )}
      <RadixSelect.Root value={value} defaultValue={defaultValue} onValueChange={(v) => onValueChange?.(v as V)} required={required} disabled={disabled} name={name}>
        <RadixSelect.Trigger
          id={ids.control}
          className={cx("ds-input", "ds-select-trigger", `ds-select-${size}`)}
          aria-labelledby={labelId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(ids, description, error)}
          aria-required={required || undefined}
        >
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon className="ds-select-icon">
            <ChevronDown size={16} aria-hidden="true" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className="ds-pop ds-select-content" position="popper" sideOffset={4}>
            <RadixSelect.Viewport className="ds-select-viewport">
              {options.map((o) => (
                <RadixSelect.Item key={o.value} value={o.value} disabled={o.disabled} className="ds-menu-item ds-select-item">
                  <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="ds-select-check">
                    <Check size={14} aria-hidden="true" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      <FieldError id={ids.error}>{error}</FieldError>
    </div>
  );
}

/* ---------- FieldGroup and FormSection ---------- */

export interface FieldGroupProps {
  /** Legend for related controls ("Daily loss limit"). */
  label: string;
  description?: ReactNode;
  /** One message for the group (e.g. "Start must be before end"). */
  error?: string | null;
  /** Lay the fields side by side, wrapping when narrow. */
  inline?: boolean;
  children: ReactNode;
  className?: string;
}

/** A fieldset of controls that answer one question together (amount + unit, from + to). */
export function FieldGroup({ label, description, error, inline, children, className }: FieldGroupProps) {
  const ids = useFieldIds(undefined);
  return (
    <fieldset className={cx("ds-fieldset", error && "is-invalid", className)} aria-describedby={describedBy(ids, description, error)}>
      <legend className="ds-field-label">{label}</legend>
      {description != null && (
        <p id={ids.description} className="ds-field-desc">
          {description}
        </p>
      )}
      <div className={cx("ds-fieldgroup-body", inline && "is-inline")}>{children}</div>
      <FieldError id={ids.error}>{error}</FieldError>
    </fieldset>
  );
}

export interface FormSectionProps {
  title: string;
  description?: ReactNode;
  /** Buttons beside the title (rare; the form's Save sits at the end of the form). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled block of a longer form (Account details, Rules, Import options). */
export function FormSection({ title, description, actions, children, className }: FormSectionProps) {
  const headingId = useId();
  return (
    <section className={cx("ds-form-section", className)} aria-labelledby={headingId}>
      <header className="ds-form-section-head">
        <div>
          <h3 id={headingId} className="ds-title">
            {title}
          </h3>
          {description != null && <p className="ds-field-desc">{description}</p>}
        </div>
        {actions != null && <div className="ds-row">{actions}</div>}
      </header>
      <div className="ds-form-section-body">{children}</div>
    </section>
  );
}

/* ---------- ValidationSummary ---------- */

export interface ValidationIssue {
  /** id of the control to focus. Omit for form-level problems. */
  fieldId?: string;
  message: string;
}

export interface ValidationSummaryProps {
  issues: readonly ValidationIssue[];
  /** Heading. Default "Fix N problems before saving". */
  title?: string;
  className?: string;
}

/**
 * The list of problems after a submit attempt, at the top of the form. Each
 * issue links to its control. It is an alert so it is announced; pair it with
 * focusFirstInvalid() so focus lands on the first bad field.
 */
export function ValidationSummary({ issues, title, className }: ValidationSummaryProps) {
  if (issues.length === 0) return null;
  const heading = title ?? (issues.length === 1 ? "Fix 1 problem before saving" : `Fix ${issues.length} problems before saving`);
  return (
    <div role="alert" className={cx("ds-notice", "ds-notice-error", "ds-validation", className)}>
      <CircleAlert size={18} className="ds-notice-icon" aria-hidden="true" />
      <div className="ds-notice-body">
        <p className="ds-notice-title">{heading}</p>
        <ul className="ds-validation-list">
          {issues.map((issue, i) => (
            <li key={`${issue.fieldId ?? "form"}-${i}`}>
              {issue.fieldId ? (
                <a
                  href={`#${issue.fieldId}`}
                  onClick={(e) => {
                    const el = document.getElementById(issue.fieldId!);
                    if (!el) return;
                    e.preventDefault();
                    el.focus();
                  }}
                >
                  {issue.message}
                </a>
              ) : (
                issue.message
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Moves focus to the first control marked aria-invalid inside `root`, in
 * document order. Call after a failed submit. Returns whether one was found.
 */
export function focusFirstInvalid(root: ParentNode | null | undefined): boolean {
  const el = root?.querySelector<HTMLElement>('[aria-invalid="true"]:not(fieldset)') ?? root?.querySelector<HTMLElement>('fieldset[aria-invalid="true"] input:not(:disabled)');
  if (!el) return false;
  el.focus();
  return true;
}

/* ---------- FileDropzone ---------- */

export interface FileDropzoneProps {
  /** Accessible name and visible title ("Choose a CSV file"). */
  label: string;
  /** What is accepted ("CSV up to 10 MB"). Shown under the title. */
  hint?: ReactNode;
  /** Passed to the browser file input (".csv,text/csv"). Advisory only: validate in the feature. */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Files dropped or picked. The feature card reads and validates them; this component never opens them. */
  onFiles: (files: File[]) => void;
  /**
   * Replaces the browser file picker (a desktop host can open its own dialog).
   * When set, Browse calls this instead of the hidden input.
   */
  onBrowse?: () => void;
  /** The chosen file, shown as a summary row. Size is bytes. */
  selected?: { name: string; size?: number | null; detail?: ReactNode } | null;
  /** Shown under the summary: "Remove", "Choose another". */
  selectedActions?: ReactNode;
  error?: string | null;
  className?: string;
}

/** Bytes as "9.8 KB" for file summaries. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * Drop target with a Browse button. Visual only: it hands File objects (or a
 * Browse request) to the caller. Parsing, size limits and staging belong to
 * the CSV import and attachment cards.
 */
export function FileDropzone({ label, hint, accept, multiple, disabled, onFiles, onBrowse, selected, selectedActions, error, className }: FileDropzoneProps) {
  const ids = useFieldIds(undefined);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const browse = () => (onBrowse ? onBrowse() : input.current?.click());
  const drop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };
  return (
    <div className={cx("ds-field", className)}>
      <div
        className={cx("ds-dropzone", dragging && "is-dragging", error && "is-invalid", disabled && "is-disabled", selected && "has-file")}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        role="group"
        aria-labelledby={`${ids.control}-title`}
        aria-describedby={describedBy(ids, selected ? null : hint, error)}
      >
        {selected ? (
          <div className="ds-dropzone-file">
            <span className="ds-dropzone-mark" aria-hidden="true">
              <FileText size={18} />
            </span>
            <div className="ds-dropzone-text">
              <span id={`${ids.control}-title`} className="ds-dropzone-name">
                {selected.name}
              </span>
              <span className="ds-faint">
                {selected.size != null ? formatFileSize(selected.size) : null}
                {selected.size != null && selected.detail != null ? " · " : null}
                {selected.detail}
              </span>
            </div>
            {selectedActions != null && <div className="ds-row">{selectedActions}</div>}
          </div>
        ) : (
          <>
            <span className="ds-dropzone-mark" aria-hidden="true">
              <Upload size={18} />
            </span>
            <span id={`${ids.control}-title`} className="ds-dropzone-title">
              {label}
            </span>
            {hint != null && (
              <span id={ids.description} className="ds-faint">
                {hint}
              </span>
            )}
            <span className="ds-faint" aria-hidden="true">
              Drop a file here or
            </span>
            <button type="button" className="ds-btn ds-btn-secondary ds-btn-sm" onClick={browse} disabled={disabled}>
              Browse…
            </button>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onFiles(files);
            e.target.value = "";
          }}
        />
      </div>
      <FieldError id={ids.error}>{error}</FieldError>
    </div>
  );
}
