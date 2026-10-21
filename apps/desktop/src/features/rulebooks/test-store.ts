// TEST ONLY. In-memory rulebook repository for the Build 19 screens, following the Rust rules in
// src-tauri/src/store/rulebooks.rs (drafts editable until published, revision conflicts, stale
// bases, guarded and dated assignments, append-only audit log). Real persistence is covered by
// db/rulebook_editor_tests.rs and the native wire fixture. Synthetic data only.
import {
  canAssign,
  checkPublish,
  checkRuleDefinitions,
  RepositoryError,
  type Account,
  type AccountRulebookAssignment,
  type AssignmentGuard,
  type AssignmentInput,
  type ChangeContext,
  type RuleDefinitionInput,
  type Rulebook,
  type RulebookDraftInput,
  type RulebookDraftUpdate,
  type RulebookEvent,
  type RulebookEventQuery,
  type RulebookVersionDetail,
} from "@fundedflow/domain";
import evidenceWire from "../../test/fixtures/evidence-wire.json";
import { createTestStore } from "../accounts/test-store";

const conflict = (message: string) => new RepositoryError({ kind: "conflict", message });
const invalid = (field: string, message: string) => new RepositoryError({ kind: "validation", message, issues: [{ field, message }] });
const notFound = (what: string) => new RepositoryError({ kind: "notFound", message: `${what} was not found` });

export const PROVIDER = "01900000-0000-7000-8000-000000000008";
export const CATALOGUE_RULEBOOK = "01900000-0000-7000-8000-000000000090";

/** A synthetic verified catalogue version: a known target, a drawdown with an unknown method, a manual check. */
export function catalogueRules(): RuleDefinitionInput[] {
  return [
    { ruleKey: "profit_target", ruleType: "profit_target", parameterSchemaVersion: 1, providerLabel: "Profit Target", displayLabel: null, sourceText: "Profit target $3,000",
      supportStatus: "supported", overrideKind: null, displayOrder: 0, parameters: { amount: { state: "value", value: "3000" }, basis: "balance" } },
    { ruleKey: "max_drawdown", ruleType: "max_drawdown", parameterSchemaVersion: 1, providerLabel: "Max Drawdown", displayLabel: null, sourceText: "Trailing drawdown $2,000 (EOD)",
      supportStatus: "needs_setup", overrideKind: null, displayOrder: 1,
      parameters: { amount: { state: "value", value: "2000" }, method: "unknown", basis: "unknown", lock: { state: "unknown" } } },
    { ruleKey: "manual_check", ruleType: "manual_check", parameterSchemaVersion: 1, providerLabel: null, displayLabel: "No trading during news", sourceText: null,
      supportStatus: "manual_only", overrideKind: null, displayOrder: 2, parameters: { description: "Flat two minutes around tier-1 news" } },
  ];
}

export function createRulebookStore(seed: Account[]) {
  const base = createTestStore(seed);
  const rulebooks = new Map<string, Rulebook>();
  const versions = new Map<string, RulebookVersionDetail>();
  const assignments: AccountRulebookAssignment[] = [];
  const events: RulebookEvent[] = [];
  /** Every write the repository accepted, in order (the preview must add none). */
  const writes: string[] = [];
  let next = 1;
  let clock = Date.parse("2026-10-20T15:00:00.000Z");
  const id = () => `00000000-0000-7000-8000-${String(next++).padStart(12, "0")}`;
  const now = () => new Date((clock += 1000)).toISOString();

  const record = (versionId: string, action: RulebookEvent["action"], context: ChangeContext, accountId: string | null = null, assignmentId: string | null = null) => {
    const v = versions.get(versionId)!;
    events.push({ id: id(), rulebookId: v.rulebook.id, rulebookVersionId: versionId, accountId, assignmentId, action, actor: context.actor, reason: context.reason, occurredAt: now() });
  };
  const get = (vid: string) => {
    const v = versions.get(vid);
    if (!v) throw notFound(`rulebook version '${vid}'`);
    return structuredClone(v);
  };
  const rulesOf = (vid: string, rules: RuleDefinitionInput[]) => rules.map((r, i) => ({ ...structuredClone(r), id: `${vid}-r${i}`, rulebookVersionId: vid })) as RulebookVersionDetail["rules"];

  function addVersion(rulebook: Rulebook, input: Omit<RulebookDraftInput, "rulebookId" | "newRulebook">, status: RulebookVersionDetail["version"]["verificationStatus"] = "draft") {
    const vid = id();
    const at = now();
    const number = [...versions.values()].filter(v => v.rulebook.id === rulebook.id).length + 1;
    const detail: RulebookVersionDetail = {
      rulebook,
      version: {
        id: vid, rulebookId: rulebook.id, versionNumber: number, schemaVersion: 1, verificationStatus: status,
        origin: rulebook.ownerAccountId ? "user_authored" : "catalogue", capturedAt: input.capturedAt, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo,
        verifiedBy: status === "verified" ? "Reviewer" : null, verifiedAt: status === "verified" ? at : null, userConfirmedAt: null,
        changeReason: input.changeReason, supersedesVersionId: input.supersedesVersionId, recordStatus: "active", createdAt: at, updatedAt: at,
      },
      rules: rulesOf(vid, input.rules),
      applicability: input.applicability.map((a, i) => ({ ...a, id: `${vid}-a${i}`, rulebookVersionId: vid })),
      claims: [],
    };
    versions.set(vid, detail);
    return detail;
  }

  // The verified catalogue version every test can assign.
  const catalogue: Rulebook = {
    id: CATALOGUE_RULEBOOK, providerId: PROVIDER, ownerAccountId: null, slug: "example-50k", displayName: "Example 50K", description: "Synthetic terms",
    recordStatus: "active", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  };
  rulebooks.set(catalogue.id, catalogue);
  const verified = addVersion(catalogue, { supersedesVersionId: null, changeReason: null, capturedAt: "2026-10-01T00:00:00.000Z", effectiveFrom: null, effectiveTo: null, rules: catalogueRules(), applicability: [] }, "verified");

  const rulebookRepo = {
    list: async (accountId: string | null) => [...rulebooks.values()].filter(r => r.ownerAccountId === null || r.ownerAccountId === accountId).map(r => structuredClone(r)),
    listVersions: async (rulebookId: string) => [...versions.values()].filter(v => v.rulebook.id === rulebookId).sort((a, b) => b.version.versionNumber - a.version.versionNumber).map(v => structuredClone(v)),
    getVersion: async (vid: string) => get(vid),
    getApplicable: async () => ({ status: "none" as const, rulebookVersionIds: [] }),
    createDraft: async (input: RulebookDraftInput, context?: ChangeContext) => {
      const issues = checkRuleDefinitions(input.rules);
      if (issues.length) throw new RepositoryError({ kind: "validation", message: "invalid", issues });
      let rulebook: Rulebook;
      if (input.rulebookId) {
        rulebook = rulebooks.get(input.rulebookId) ?? (() => { throw notFound("rulebook"); })();
      } else {
        const n = input.newRulebook!;
        rulebook = { id: id(), providerId: n.providerId, ownerAccountId: n.ownerAccountId, slug: n.slug, displayName: n.displayName.trim(), description: n.description, recordStatus: "active", createdAt: now(), updatedAt: now() };
        rulebooks.set(rulebook.id, rulebook);
      }
      if (rulebook.ownerAccountId && input.applicability.length) throw invalid("applicability", "An account-private rulebook does not apply to catalogue phases");
      if (input.supersedesVersionId) {
        if (versions.get(input.supersedesVersionId)?.rulebook.id !== rulebook.id) throw invalid("supersedesVersionId", "Supersede a version of the same rulebook");
        if (!input.changeReason?.trim()) throw invalid("changeReason", "A superseding version needs a reason");
      }
      const d = addVersion(rulebook, input);
      writes.push("createDraft");
      record(d.version.id, "draft_created", context ?? { actor: "local_user", reason: null });
      return structuredClone(d);
    },
    updateDraft: async (vid: string, expected: string, input: RulebookDraftUpdate, context: ChangeContext) => {
      const issues = checkRuleDefinitions(input.rules);
      if (issues.length) throw new RepositoryError({ kind: "validation", message: "invalid", issues });
      const d = versions.get(vid) ?? (() => { throw notFound("version"); })();
      if (d.version.verificationStatus !== "draft") throw conflict(`version ${d.version.versionNumber} is ${d.version.verificationStatus} and can no longer be edited`);
      if (d.version.updatedAt !== expected) throw conflict("rulebook version changed since it was opened; reload it before saving");
      if (d.version.supersedesVersionId && !input.changeReason?.trim()) throw invalid("changeReason", "A superseding version needs a reason");
      Object.assign(d.version, { changeReason: input.changeReason, capturedAt: input.capturedAt, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, updatedAt: now() });
      d.rules = rulesOf(vid, input.rules);
      writes.push("updateDraft");
      record(vid, "draft_saved", context);
      return structuredClone(d);
    },
    discardDraft: async (vid: string, expected: string, context: ChangeContext) => {
      const d = versions.get(vid)!;
      if (!context.reason?.trim()) throw invalid("reason", "Say why the draft is discarded");
      if (d.version.verificationStatus !== "draft") throw conflict("not a draft");
      if (d.version.updatedAt !== expected) throw conflict("changed since it was opened");
      Object.assign(d.version, { verificationStatus: "rejected", updatedAt: now() });
      writes.push("discardDraft");
      record(vid, "draft_discarded", context);
      return structuredClone(d);
    },
    validateDraft: async (vid: string) => checkPublish(get(vid), null).filter(i => i.field !== "reviewer"),
    publish: async (vid: string, reviewer: string | null, options?: { expectedUpdatedAt: string; context: ChangeContext }) => {
      const d = versions.get(vid)!;
      if (options && d.version.updatedAt !== options.expectedUpdatedAt) throw conflict("changed since it was opened");
      const issues = checkPublish(d, reviewer);
      if (issues.length) throw new RepositoryError({ kind: "validation", message: "invalid", issues });
      if (d.version.verificationStatus === "draft" && d.version.supersedesVersionId) {
        const baseNumber = versions.get(d.version.supersedesVersionId)!.version.versionNumber;
        const newer = [...versions.values()].find(v => v.rulebook.id === d.rulebook.id && v.version.id !== vid && v.version.versionNumber > baseNumber
          && !["draft", "rejected"].includes(v.version.verificationStatus));
        if (newer) throw conflict(`version ${newer.version.versionNumber} was published after this draft was started; start a new draft from it`);
      }
      const at = now();
      if (d.version.verificationStatus === "draft") Object.assign(d.version, { verificationStatus: "needs_review", updatedAt: at });
      else Object.assign(d.version, { verificationStatus: "verified", verifiedBy: reviewer!.trim(), verifiedAt: at, updatedAt: at });
      writes.push("publish");
      record(vid, d.version.verificationStatus === "verified" ? "verified" : "published", options?.context ?? { actor: "local_user", reason: null });
      return structuredClone(d);
    },
    assign: async (input: AssignmentInput, guard?: AssignmentGuard) => {
      const mine = assignments.filter(a => a.accountId === input.accountId);
      const open = mine.find(a => a.effectiveTo === null) ?? null;
      if (guard && (open?.id ?? null) !== guard.expectedOpenAssignmentId) throw conflict("the account's rulebook assignment changed since this page was opened");
      const d = versions.get(input.rulebookVersionId)!;
      if (!canAssign(d.rulebook, d.version, input.accountId)) throw invalid("rulebookVersionId", "This version cannot be assigned");
      if (mine.some(a => a.effectiveFrom >= input.effectiveFrom)) throw conflict(`the account already has a rulebook assignment from ${input.effectiveFrom} or later`);
      if (open) open.effectiveTo = input.effectiveFrom;
      const a: AccountRulebookAssignment = { id: id(), ...input, effectiveTo: null, assignedAt: now(), assignmentSource: input.programmePhaseId ? "catalogue_selection" : "user" };
      assignments.push(a);
      writes.push("assign");
      record(d.version.id, "assigned", guard ? { actor: guard.actor, reason: guard.reason } : { actor: "local_user", reason: null }, a.accountId, a.id);
      return structuredClone(a);
    },
    listAssignments: async (accountId: string) => assignments.filter(a => a.accountId === accountId).map(a => structuredClone(a)),
    flagSourceConflict: async () => { throw notFound("not used"); },
    listEvents: async (q: RulebookEventQuery) => events.filter(e => e.accountId === q.accountId || rulebooks.get(e.rulebookId)?.ownerAccountId === q.accountId).map(e => structuredClone(e)),
  };

  const riskInputs = (accountId: string, asOf: string, coverage: unknown) => {
    const raw = evidenceWire.find(f => f.command === "get_account_risk_inputs")!.output as Record<string, unknown>;
    const text = JSON.stringify(raw).split("00000000-0000-4000-8000-000000000001").join(accountId);
    const value = JSON.parse(text) as Record<string, unknown>;
    const account = base.accounts.get(accountId);
    if (!account) throw notFound("account");
    return { ...value, account: { ...value.account as object, ...account }, asOf, coverage: { ...(coverage as object), openPositions: "unsupported", intradayHistory: "unsupported" } };
  };
  const evidenceCalls: string[] = [];
  const repository = {
    ...base.repository,
    rulebooks: rulebookRepo,
    evidence: { inputs: async (q: { accountId: string; asOf: string; coverage: unknown }) => { evidenceCalls.push(q.accountId); return riskInputs(q.accountId, q.asOf, q.coverage); } },
    snapshots: { latest: async () => null, list: async () => [] },
    catalogue: { load: async () => { throw notFound("no catalogue"); } },
  };
  return { ...base, repository, versions, rulebooks, assignments, events, writes, evidenceCalls, verifiedVersionId: verified.version.id };
}
