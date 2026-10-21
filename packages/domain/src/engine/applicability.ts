import { canAssign, checkRuleDefinitions } from "../rulebook/integrity.js";
import { derivePhaseHistory } from "../catalogue/lifecycle.js";
import type { AccountRiskInputs } from "../risk/contracts.js";

/** Immutable explicit assignment only; never selects the newest published version. */
export function resolveEngineApplicability(input: AccountRiskInputs) {
  const candidates=input.assignments.filter(a=>a.accountId===input.account.id && a.effectiveFrom<=input.effectiveTradingDay && (a.effectiveTo===null||a.effectiveTo>input.effectiveTradingDay));
  const assignment=candidates.length===1?candidates[0]!:null;
  const versions=input.rulebookVersions.filter(v=>v.version.id===assignment?.rulebookVersionId);
  const detail=versions.length===1?versions[0]!:null;
  const reasons:string[]=[];
  if(candidates.length!==1) reasons.push(candidates.length?"ambiguous_assignment":"missing_assignment");
  if(!detail) reasons.push("missing_or_ambiguous_version");
  if(assignment && input.applicableAssignment?.id!==assignment.id) reasons.push("assignment_context_mismatch");
  if(detail && !canAssign(detail.rulebook,detail.version,input.account.id)) reasons.push("unverified_or_archived_rulebook");
  if(detail && checkRuleDefinitions(detail.rules).length) reasons.push("invalid_rule_definitions");
  if(detail && detail.rules.some(r=>r.rulebookVersionId!==detail.version.id)) reasons.push("foreign_rule_version");
  if(detail && (detail.version.effectiveFrom!==null && Date.parse(detail.version.effectiveFrom)>Date.parse(input.asOf) || detail.version.effectiveTo!==null && Date.parse(detail.version.effectiveTo)<=Date.parse(input.asOf))) reasons.push("rulebook_outside_effective_interval");
  const phases=derivePhaseHistory(input.account.id,input.phaseHistory.filter(e=>e.occurredAt===null||Date.parse(e.occurredAt)<=Date.parse(input.asOf)));
  if(phases.issues.length) reasons.push("conflicting_phase_history");
  const phase=phases.effective.at(-1);
  if(detail?.rulebook.ownerAccountId===null && assignment) {
    if(!phase || phase.occurredAt===null || phase.programmePhaseId!==assignment.programmePhaseId || phase.phasePathId!==assignment.phasePathId || phase.catalogueVersionId!==input.catalogueLink.catalogueVersionId || input.catalogueLink.selectedPhasePathId!==assignment.phasePathId) reasons.push("phase_path_context_unresolved");
    if(detail.rulebook.providerId!==input.catalogueLink.providerId) reasons.push("provider_mismatch");
    const applicable=detail.applicability.filter(a=>a.rulebookVersionId===detail.version.id && a.catalogueVersionId===input.catalogueLink.catalogueVersionId && a.programmePhaseId===assignment.programmePhaseId && a.phasePathId===assignment.phasePathId);
    if(applicable.length!==1) reasons.push("ambiguous_or_missing_applicability");
  }
  if(detail && new Set(detail.rules.map(r=>r.id)).size!==detail.rules.length) reasons.push("duplicate_rule_id");
  return {assignment,detail,phase,phaseKey:phases.currentPhase,reasons,providerVerified:detail?.rulebook.ownerAccountId===null && detail.version.verificationStatus==="verified"};
}
