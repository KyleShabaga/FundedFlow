// Real native rulebook editor payloads (src-tauri/src/db/rulebook_editor_tests.rs, rulebook_command_wire_fixture)
// replayed through the Tauri adapter: the adapter sends exactly the recorded arguments and accepts every output.
import native from "../../../src-tauri/src/lib.rs?raw";
import type { RulebookRepository } from "@fundedflow/domain";
import { describe, expect, it, vi } from "vitest";
import fixture from "../../test/fixtures/rulebook-wire.json";
import { createTauriRepository } from "./tauri-repository";

type Args = Record<string, never>;
const replay: Record<string, (r: RulebookRepository, a: Args) => Promise<unknown>> = {
  list_rulebooks: (r, a) => r.list(a.accountId),
  create_rulebook_draft: (r, a) => r.createDraft(a.input, a.context),
  update_rulebook_draft: (r, a) => r.updateDraft(a.id, a.expectedUpdatedAt, a.input, a.context),
  validate_rulebook_draft: (r, a) => r.validateDraft(a.id),
  publish_rulebook_version: (r, a) => r.publish(a.id, a.reviewer, { expectedUpdatedAt: a.expectedUpdatedAt, context: a.context }),
  assign_rulebook_to_account: (r, a) => r.assign(a.input, a.guard),
  list_account_rulebook_assignments: (r, a) => r.listAssignments(a.accountId),
  discard_rulebook_draft: (r, a) => r.discardDraft(a.id, a.expectedUpdatedAt, a.context),
  list_rulebook_versions: (r, a) => r.listVersions(a.rulebookId),
  get_rulebook_version: (r, a) => r.getVersion(a.id),
  list_rulebook_events: (r, a) => r.listEvents(a.query),
};

describe("native rulebook editor command wire", () => {
  for (const f of fixture) it(f.command, async () => {
    const invoke = vi.fn().mockResolvedValue(f.output);
    const run = replay[f.command];
    if (!run) throw new Error(`Uncovered command ${f.command}`);
    expect(await run(createTauriRepository(invoke).rulebooks, f.args as unknown as Args)).toEqual(f.output);
    expect(invoke).toHaveBeenCalledWith(f.command, f.args);
    expect(native).toContain(`commands::${f.command},`);
  });

  it("keeps the pre-Build 19 publish and assign shapes", async () => {
    const invoke = vi.fn().mockResolvedValue(fixture.find(f => f.command === "publish_rulebook_version")!.output);
    await createTauriRepository(invoke).rulebooks.publish("v1", "kyle");
    expect(invoke).toHaveBeenCalledWith("publish_rulebook_version", { id: "v1", reviewer: "kyle" });
  });

  it("records the editor journey in the audit log, oldest first", () => {
    const log = fixture.find(f => f.command === "list_rulebook_events")!.output as { action: string; reason: string | null }[];
    expect(log.map(e => e.action)).toEqual(["draft_created", "draft_saved", "published", "assigned", "draft_created", "draft_discarded"]);
    expect(log.find(e => e.action === "draft_discarded")?.reason).toBe("Not needed");
  });
});
