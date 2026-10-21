// TEST ONLY. A fake import backend replaying the Rust-generated Build 17 golden fixture
// (test_csvimport/build17/normalization-v1.json): previews and committed batches are Rust outputs, matched by file
// content. Shared by the Build 18 wizard tests and the Build 26 cross-feature journeys. Synthetic data only.
import { RepositoryError, type CsvImportRequest, type CsvPreview, type ImportBatch } from "@fundedflow/domain";
import { vi } from "vitest";

import golden from "../../../../../test_csvimport/build17/normalization-v1.json";

export { golden };
export type GoldenCase = (typeof golden.cases)[number];
export const goldenCase = (name: string) => golden.cases.find(c => c.name === name)! as GoldenCase;

export function createImports() {
  const batches: ImportBatch[] = [];
  const problems = new Map<string, CsvPreview["rows"]>();
  const previews: CsvImportRequest[] = [];
  const overrides = new Map<string, (req: CsvImportRequest) => CsvPreview>();
  let n = 0;
  const caseFor = (req: CsvImportRequest) => golden.cases.find(c => c.request.content === req.content);
  const preview = vi.fn(async (req: CsvImportRequest): Promise<CsvPreview> => {
    previews.push(req);
    const custom = overrides.get(req.fileName);
    if (custom) return custom(req);
    const c = caseFor(req);
    if (!c) throw new RepositoryError({ kind: "validation", message: "no fixture", issues: [{ field: "content", message: "The file is empty." }] });
    return structuredClone(c.expected.preview) as CsvPreview;
  });
  const commit = vi.fn(async (req: CsvImportRequest): Promise<ImportBatch> => {
    const c = caseFor(req);
    if (!c || !c.expected.batch) throw new RepositoryError({ kind: "validation", message: "x", issues: [{ field: "dateFormat", message: "Choose the date format." }] });
    const batch = { ...(c.expected.batch as ImportBatch), id: `batch-${++n}`, accountId: req.accountId, fileName: req.fileName };
    batches.push(batch);
    problems.set(batch.id, (c.expected.preview as CsvPreview).rows.filter(r => r.status !== "new"));
    return batch;
  });
  const repository = {
    preview,
    commit,
    list: vi.fn(async (accountId: string) => batches.filter(b => b.accountId === accountId)),
    problemRows: vi.fn(async (batchId: string) =>
      (problems.get(batchId) ?? []).map(r => ({ rowNumber: r.rowNumber, lineNumber: r.lineNumber, status: r.status === "blank" ? "skipped" : r.status, errors: r.errors, warnings: r.warnings, raw: r.raw, duplicateOfTradeId: r.duplicate?.tradeId ?? null })),
    ),
  };
  return { repository, batches, previews, overrides };
}
