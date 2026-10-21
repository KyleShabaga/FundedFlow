import native from "../../../src-tauri/src/lib.rs?raw";
import { describe, expect, it, vi } from "vitest";
import fixture from "../../test/fixtures/evidence-wire.json";
import { createTauriRepository } from "./tauri-repository";
import { type FinancialEvidenceRepository, assessRuleEvidence, accountRiskInputsSchema } from "@fundedflow/domain";

const names: Record<string, keyof FinancialEvidenceRepository> = {
  get_account_risk_inputs:"inputs",create_financial_observation:"create",get_financial_observation:"get",
  list_financial_observations:"list",correct_financial_observation:"correct",get_ledger_history:"ledgerHistory",
  correct_ledger_entry:"correctLedger",remove_ledger_entry_with_reason:"removeLedger",reconcile_financial_balance:"reconcile",
  list_financial_reconciliations:"reconciliations",resolve_financial_reconciliation:"resolve",list_reconciliation_resolutions:"resolutions",
};
describe("native evidence command wire", () => {
  for (const f of fixture) it(f.command, async () => {
    const invoke=vi.fn().mockResolvedValue(f.output);
    const e=createTauriRepository(invoke).evidence;
    const args=f.args as Record<string,unknown>;
    let result:unknown;
    switch(names[f.command]) {
      case "inputs": result=await e.inputs(args.query as Parameters<typeof e.inputs>[0]);break;
      case "create": result=await e.create(args.input as Parameters<typeof e.create>[0]);break;
      case "get": result=await e.get(args.id as string);break;
      case "list": result=await e.list(args.accountId as string);break;
      case "correct": result=await e.correct(args.id as string,args.input as Parameters<typeof e.correct>[1]);break;
      case "ledgerHistory": result=await e.ledgerHistory(args.accountId as string);break;
      case "correctLedger": result=await e.correctLedger(args.id as string,args.input as Parameters<typeof e.correctLedger>[1],args.metadata as Parameters<typeof e.correctLedger>[2]);break;
      case "removeLedger": result=await e.removeLedger(args.id as string,args.metadata as Parameters<typeof e.removeLedger>[1]);break;
      case "reconcile": result=await e.reconcile(args.request as Parameters<typeof e.reconcile>[0]);break;
      case "reconciliations": result=await e.reconciliations(args.accountId as string);break;
      case "resolve": result=await e.resolve(args.id as string,args.input as Parameters<typeof e.resolve>[1]);break;
      case "resolutions": result=await e.resolutions(args.id as string);break;
      default:throw new Error(`Uncovered command ${f.command}`);
    }
    expect(result).toEqual(f.output===null?undefined:f.output);
    expect(invoke).toHaveBeenCalledWith(f.command,f.args);
    expect(native).toContain(`commands::${f.command},`);
  });
});
it("does not infer live risk sufficiency from caller coverage assertions", () => {
  const input=accountRiskInputsSchema.parse(fixture.find(f=>f.command==="get_account_risk_inputs")!.output);
  input.coverage.openPositions="available";input.coverage.intradayHistory="available";
  const parameters={amount:{state:"unknown"},method:"intraday_trailing",basis:"realized_and_unrealized",lock:{state:"unknown"}} as const;
  const result=assessRuleEvidence(input,"max_drawdown",parameters);
  expect(result.find(r=>r.requirement==="intradayHistory")!.state).toBe("unsupported");
  expect(result.find(r=>r.requirement==="current_equity")!.state).toBe("missing");
  input.observations=[];
  expect(assessRuleEvidence(input,"max_drawdown",parameters).find(r=>r.requirement==="baseline")!.state).toBe("missing");
  expect(accountRiskInputsSchema.safeParse({...input,trades:[{...input.trades[0],accountId:"other"}]}).success).toBe(false);
});

it("keeps stale, unconfirmed and conflicting equity distinct", () => {
  const input=accountRiskInputsSchema.parse(fixture.find(f=>f.command==="get_account_risk_inputs")!.output);
  const source=input.observations[0]!;
  const p={amount:{state:"unknown"},method:"static",basis:"realized_and_unrealized",lock:{state:"unknown"}} as const;
  const check=()=>assessRuleEvidence(input,"max_drawdown",p).find(r=>r.requirement==="current_equity")!.state;
  input.observations=[{...source,id:"equity",kind:"equity",basis:"equity",observedAt:"2026-10-19T00:00:00Z"}];expect(check()).toBe("stale");
  input.observations[0]!.observedAt=input.asOf;input.observations[0]!.confirmation="unconfirmed";expect(check()).toBe("manual_verification");
  input.observations[0]!.confirmation="user_confirmed";input.observations.push({...input.observations[0]!,id:"competing",value:"1"});expect(check()).toBe("conflicting");
});

it("does not count superseded EOD values as sufficient after a correction to unknown", () => {
  const input=accountRiskInputsSchema.parse(fixture.find(f=>f.command==="get_account_risk_inputs")!.output);
  const original={...input.observations[0]!,id:"eod-original",kind:"eod_settlement" as const};
  input.observations=[original,{...original,id:"eod-correction",supersedesId:original.id,value:null}];input.coverage.eodHistory="available";
  const p={amount:{state:"unknown"},method:"end_of_day_trailing",basis:"realized",lock:{state:"unknown"}} as const;
  expect(assessRuleEvidence(input,"max_drawdown",p).find(r=>r.requirement==="eodHistory")!.state).toBe("missing");
  expect(assessRuleEvidence(input,"manual_check",{description:"Check sourced provider policy"})[0]!.state).toBe("manual_verification");
});
