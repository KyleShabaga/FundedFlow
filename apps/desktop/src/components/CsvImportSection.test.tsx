// @vitest-environment jsdom
// Cancelling a CSV import discards the pending preview without writing, and a
// new file starts from a clean state (#11). Restores are shown in the preview (#12).

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { CsvPreview, RowReport } from "../lib/data/schemas";

const repo = vi.hoisted(() => ({
  imports: { preview: vi.fn(), commit: vi.fn(), list: vi.fn(), problemRows: vi.fn() },
}));
vi.mock("../lib/data/api", async () => {
  const { RepositoryError } = await import("../lib/data/schemas");
  return { repository: repo, DataError: RepositoryError };
});

import { CsvImportSection } from "./CsvImportSection";

const row = (line: number, status: RowReport["status"], extra: Partial<RowReport> = {}): RowReport => ({
  rowNumber: line - 1, lineNumber: line, status, errors: [], warnings: [], duplicate: null, restores: null,
  raw: [], trade: null, ...extra,
});

function preview(rows: RowReport[], counts: Partial<CsvPreview> = {}): CsvPreview {
  return {
    format: "generic", formatReason: "has side, entry and exit columns", dateFormat: "ymd", dateFormatReason: "ISO",
    headers: ["symbol"], mapping: [{ field: "symbol", header: "symbol", required: true }], ignoredHeaders: [],
    targetAssessment: { previewToken: "test-preview", blocked: null, confirmations: [], startInclusive: null, endExclusive: null, candidateCount: rows.length },
    fileIssues: [], fileWarnings: [], filePreviouslyImported: false, rowCount: rows.length,
    newCount: rows.filter((r) => r.status === "new").length, restoreCount: 0, duplicateCount: 0, blankCount: 0,
    invalidCount: rows.filter((r) => r.status === "invalid").length, warningCount: 0, rows, rowsOmitted: 0,
    limits: { maxBytes: 10485760, maxRows: 50000 }, ...counts,
  };
}

const csv = (name: string, text: string) => new File([text], name, { type: "text/csv" });

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("cancels a preview without saving and starts clean with another file", async () => {
  const user = userEvent.setup();
  const onImported = vi.fn(async () => {});
  render(<CsvImportSection accountId="a1" imports={[]} onImported={onImported} />);
  const input = () => screen.getByLabelText("CSV file") as HTMLInputElement;

  // A preview with no valid rows still offers Cancel.
  repo.imports.preview.mockResolvedValueOnce(
    preview([row(2, "invalid", { errors: [{ field: "entryPrice", message: "is not a number" }] })]),
  );
  await user.upload(input(), csv("bad.csv", "symbol\nX\n"));
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByText(/is not a number/)).toBeTruthy();
  expect((screen.getByRole("button", { name: /Import 0 valid new rows/ }) as HTMLButtonElement).disabled).toBe(true);

  await user.click(screen.getByRole("button", { name: "Cancel import" }));
  expect(screen.getByRole("status").textContent).toMatch(/cancelled\. Nothing was saved/);
  expect(screen.queryByText(/is not a number/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Import \d+ valid/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel import" })).toBeNull();
  expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(true);
  expect(input().files?.length ?? 0).toBe(0);
  expect(repo.imports.commit).not.toHaveBeenCalled();
  expect(onImported).not.toHaveBeenCalled();

  // The next file is previewed on its own, with no state left from the first.
  repo.imports.preview.mockResolvedValueOnce(preview([row(2, "new")]));
  await user.upload(input(), csv("good.csv", "symbol\nMES\n"));
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByRole("button", { name: "Import 1 valid new row" })).toBeTruthy();
  expect(screen.queryByText(/is not a number/)).toBeNull();
  const second = repo.imports.preview.mock.calls[1][0];
  expect(second).toMatchObject({ fileName: "good.csv", content: "symbol\nMES\n", columns: null });
  expect(repo.imports.commit).not.toHaveBeenCalled();
});

it("can pick the same file again after cancelling", async () => {
  const user = userEvent.setup();
  render(<CsvImportSection accountId="a1" imports={[]} onImported={async () => {}} />);
  const file = csv("trades.csv", "symbol\nMES\n");
  await user.upload(screen.getByLabelText("CSV file"), file);
  await user.click(await screen.findByRole("button", { name: "Cancel import" }));
  await user.upload(screen.getByLabelText("CSV file"), file);
  await waitFor(() => expect((screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled).toBe(false));
});

it("says which new rows restore deleted trades", async () => {
  const user = userEvent.setup();
  render(<CsvImportSection accountId="a1" imports={[]} onImported={async () => {}} />);
  repo.imports.preview.mockResolvedValueOnce(
    preview(
      [
        row(2, "new", { restores: { key: "id:7", tradeId: "t7", reason: "Restores the trade saved on 2026-10-19 from 'a.csv' and deleted on 2026-10-20 (same trade ID (7))." } }),
        row(3, "duplicate", { duplicate: { of: "saved", key: "id:8", reason: "Same trade ID (8) as a trade already saved", lineNumber: null, tradeId: "t8" } }),
      ],
      { restoreCount: 1, duplicateCount: 1 },
    ),
  );
  await user.upload(screen.getByLabelText("CSV file"), csv("a.csv", "x"));
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(await screen.findByText(/Restores the trade saved on 2026-10-19/)).toBeTruthy();
  expect(screen.getAllByText(/1 ready to import \(1 restore deleted trades\), 1 duplicate/).length).toBeGreaterThan(0);
});
