// @vitest-environment jsdom
// Build 18 wizard and history through the real pages, Build 13 components and Build 14 hooks. Accounts come
// from the Build 15 in-memory test store; previews and batches replay the Rust-generated Build 17 golden
// fixture (test_csvimport/build17/normalization-v1.json). Synthetic data only.
import { RepositoryError, type CsvImportRequest, type CsvPreview, type ImportBatch } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import golden from "../../../../../test_csvimport/build17/normalization-v1.json";
import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { ACTIVE_ACCOUNT_SETTING } from "../accounts/active-account";
import { createTestStore, makeAccount } from "../accounts/test-store";
import { ImportHistoryPage } from "./components/ImportHistoryPage";
import { ImportWizardPage } from "./components/ImportWizardPage";

type Case = (typeof golden.cases)[number];
const byName = (name: string) => golden.cases.find(c => c.name === name)! as Case;

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ repository: null as unknown }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.repository; } }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

/* ---------- Fake import backend replaying Rust outputs ---------- */

function createImports() {
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

const last = <T,>(xs: T[]) => xs[xs.length - 1];
let store: ReturnType<typeof createTestStore>;
let imports: ReturnType<typeof createImports>;
let client: QueryClient;
let where = "";
function Where() {
  where = useLocation().pathname;
  return null;
}

function setup(accounts = [makeAccount({ id: "a", name: "PA-48213", propFirm: "Apex", broker: "Tradovate", externalRef: "48213" })], active: string | null = "a") {
  store = createTestStore(accounts);
  if (active) store.settings.set(ACTIVE_ACCOUNT_SETTING, active);
  imports = createImports();
  holder.repository = { ...store.repository, imports: imports.repository };
}

function renderAt(path = "/import", state?: unknown) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[{ pathname: path, state }]}>
          <Where />
          <Routes>
            <Route path="/import" element={<ImportWizardPage />} />
            <Route path="/import/history" element={<ImportHistoryPage />} />
            <Route path="/accounts" element={<p>Accounts page</p>} />
            <Route path="/accounts/:id" element={<p>Account page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const csvFile = (c: Case, name = c.request.fileName) => new File([c.request.content], name, { type: "text/csv" });
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;

async function choose(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(fileInput(), file);
  await screen.findByText(file.name);
}
async function checkFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Check the file" }));
}

beforeEach(() => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 14, supportedSchemaVersion: 14, created: false, failure: null } } as unknown as RuntimeState;
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  setup();
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

describe("entry and file selection", () => {
  it("asks for an account when there is none", async () => {
    setup([], null);
    renderAt();
    expect(await screen.findByText("Add an account first")).toBeTruthy();
  });

  it("defaults to the active account and shows the file, size and local-only note", async () => {
    const user = userEvent.setup();
    renderAt();
    const select = await screen.findByRole("combobox", { name: "Import into" });
    await waitFor(() => expect(select.textContent).toContain("PA-48213"));
    await choose(user, csvFile(byName("generic-fees-and-duplicate")));
    expect(screen.getByText(/read on this computer/)).toBeTruthy();
    expect(screen.getByText("307 B · read on this computer")).toBeTruthy();
  });

  it("rejects non-CSV, empty, unreadable and oversized files before any preview", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await user.upload(fileInput(), new File(["x"], "trades.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    expect(await screen.findByText(/trades.xlsx isn't a CSV file/)).toBeTruthy();
    await user.upload(fileInput(), new File([""], "empty.csv", { type: "text/csv" }));
    expect(await screen.findByText(/empty.csv is empty/)).toBeTruthy();
    await user.upload(fileInput(), new File([new Uint8Array([0xff, 0xfe, 0x00, 0xd8])], "bad.csv", { type: "text/csv" }));
    expect(await screen.findByText(/bad.csv couldn't be read as text/)).toBeTruthy();
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.csv", { type: "text/csv" });
    await user.upload(fileInput(), big);
    expect(await screen.findByText(/big.csv is 10.0 MB; the limit is 10 MB/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check the file" }) as HTMLButtonElement).disabled).toBe(true);
    expect(imports.repository.preview).not.toHaveBeenCalled();
  });

  it("shows an error, keeps the file and offers retry when the preview fails", async () => {
    const user = userEvent.setup();
    imports.repository.preview.mockRejectedValueOnce(new RepositoryError({ kind: "database", message: "SELECT secret" }));
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await choose(user, csvFile(byName("generic-fees-and-duplicate")));
    await checkFile(user);
    const alert = await screen.findByText("The file couldn't be checked", {}, { timeout: 3000 });
    expect(alert).toBeTruthy();
    expect(document.body.textContent).not.toContain("SELECT");
    expect(screen.getByText("synthetic-generic-fees-and-duplicate.csv")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("The file couldn't be checked")).toBeNull());
  });
});

describe("mapping and review", () => {
  it("imports a generic CSV end to end: prefilled mapping, counts, duplicate reason, confirmation, result and history", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await choose(user, csvFile(byName("generic-fees-and-duplicate")));
    await checkFile(user);
    expect(await screen.findByRole("heading", { name: "Match columns" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Symbol/ }).textContent).toContain("Symbol");
    expect(screen.getByRole("combobox", { name: /Quantity/ }).textContent).toContain("Qty");
    await user.click(screen.getByRole("button", { name: "Review rows" }));
    const table = await screen.findByRole("table", { name: "Rows in the file" });
    expect(within(table).getByText(/Same trade as line 2; skipped/)).toBeTruthy();
    expect(screen.getByText("Nothing is saved until you import.")).toBeTruthy();
    expect(imports.repository.commit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Continue with 1 trade" }));
    expect(await screen.findByRole("heading", { name: "Import into PA-48213" })).toBeTruthy();
    expect(screen.getByText("Will import")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Import 1 trade into PA-48213" }));
    expect(await screen.findByRole("heading", { name: "Imported 1 trade into PA-48213" })).toBeTruthy();
    expect(screen.getByText("batch-1")).toBeTruthy();
    expect(imports.repository.commit).toHaveBeenCalledTimes(1);
    expect(imports.repository.commit.mock.calls[0][0]).toMatchObject({ accountId: "a", timezone: "America/New_York", format: "auto", dateFormat: "auto" });
    await user.click(screen.getByRole("button", { name: "Import history" }));
    await waitFor(() => expect(where).toBe("/import/history"));
    const history = await screen.findByRole("table", { name: "Imports" });
    await user.click(within(history).getByRole("rowheader", { name: /synthetic-generic-fees-and-duplicate/ }));
    const drawer = await screen.findByRole("dialog", { name: "Import details" });
    expect(await within(drawer).findByRole("table", { name: "Problem rows" })).toBeTruthy();
    expect(within(drawer).getByText("Duplicate")).toBeTruthy();
  });

  it("shows a performance export's detected columns read-only and its row warnings", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await choose(user, csvFile(byName("paired-short-warning")));
    await checkFile(user);
    expect(await screen.findByText(/Performance export \(paired fills\)/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /Symbol/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Review rows" }));
    const table = await screen.findByRole("table", { name: "Rows in the file" });
    expect(within(table).getByText("Warning")).toBeTruthy();
    expect(within(table).getByText("Short")).toBeTruthy();
  });

  it("asks for the date order on ambiguous dates and never guesses", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await choose(user, csvFile(byName("ambiguous-dates")));
    await checkFile(user);
    expect(await screen.findByText("Choose the date order")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Review rows" }) as HTMLButtonElement).disabled).toBe(true);
    const orders = screen.getAllByRole("combobox", { name: /Date order/ });
    await user.click(orders[orders.length - 1]);
    await user.click(await screen.findByRole("option", { name: /Month\/day\/year/ }));
    await user.click(screen.getByRole("button", { name: "Review rows" }));
    await waitFor(() => expect(last(imports.previews)).toMatchObject({ dateFormat: "mdy" }));
  });

  it("separates new rows from errors in a mixed file, with the source cells of invalid rows", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await choose(user, csvFile(byName("mixed-date-lines")));
    await checkFile(user);
    await user.click(await screen.findByRole("button", { name: "Review rows" }));
    await screen.findByRole("table", { name: "Rows in the file" });
    const filters = screen.getByRole("group", { name: "Show rows" });
    expect(within(filters).getByRole("button", { name: "Will import 2" })).toBeTruthy();
    await user.click(within(filters).getByRole("button", { name: "Errors 1" }));
    const table = screen.getByRole("table", { name: "Rows in the file" });
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("Error")).toBeTruthy();
  });

  it("won't continue when every row is invalid", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await choose(user, csvFile(byName("dst-gap-and-overlap")));
    await checkFile(user);
    await user.click(await screen.findByRole("button", { name: "Review rows" }));
    expect(await screen.findByText("No new trades in this file")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Continue with 0 trades/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("counts restores within new rows and explains rows the large preview doesn't list", async () => {
    const user = userEvent.setup();
    const base = byName("reported-fallback-and-null");
    imports.overrides.set("big-export.csv", () => {
      const p = structuredClone(base.expected.preview) as CsvPreview;
      p.rows[0].restores = { key: "k", tradeId: "t-old", reason: "Deleted earlier." };
      return { ...p, restoreCount: 1, rowsOmitted: 2500, rowCount: p.rowCount + 2500, newCount: p.newCount + 2500 };
    });
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await choose(user, csvFile(base, "big-export.csv"));
    await checkFile(user);
    await user.click(await screen.findByRole("button", { name: "Review rows" }));
    expect(await screen.findByText("Includes 1 restored trade")).toBeTruthy();
    expect(screen.getByText(/2,500 plain new rows aren't listed/)).toBeTruthy();
    expect(screen.getByText(/2,500 more new rows aren't listed/)).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Rows in the file" })).getByText("Restore")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with 2,502 trades" })).toBeTruthy();
  });

  it("marks the preview stale when the time zone changes and checks again with the new zone", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await choose(user, csvFile(byName("local-zone-new-york")));
    await checkFile(user);
    await screen.findByRole("heading", { name: "Match columns" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    const zone = screen.getByRole("textbox", { name: /Times in the file are in/ });
    await user.clear(zone);
    await user.type(zone, "Asia/Tokyo");
    await checkFile(user);
    await waitFor(() => expect(last(imports.previews)).toMatchObject({ timezone: "Asia/Tokyo" }));
    expect(imports.previews).toHaveLength(2);
  });

  it("starts clean when another file is chosen", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await choose(user, csvFile(byName("generic-fees-and-duplicate")));
    await checkFile(user);
    await screen.findByRole("heading", { name: "Match columns" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    // Replacing needs no extra step: the new file is read and the old mapping, preview and confirmation go.
    await choose(user, csvFile(byName("paired-short-warning")));
    await checkFile(user);
    expect(await screen.findByText(/Performance export/)).toBeTruthy();
    expect(last(imports.previews)!.columns).toBeNull();
  });
});

describe("destination safety", () => {
  it("refuses an archived account", async () => {
    setup([makeAccount({ id: "a", name: "Live" }), makeAccount({ id: "z", name: "Old", archivedAt: "2026-10-01T00:00:00.000Z" })], "a");
    const user = userEvent.setup();
    renderAt("/import", { accountId: "z" });
    expect(await screen.findByText(/"Old" is archived. Restore it first/)).toBeTruthy();
    await choose(user, csvFile(byName("generic-fees-and-duplicate")));
    expect((screen.getByRole("button", { name: "Check the file" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("names linked attempts sharing a broker number and requires confirmation for a finished attempt", async () => {
    setup([
      makeAccount({ id: "p", name: "Eval", broker: "Tradovate", externalRef: "999", status: "failed", successorAccountId: "s" }),
      makeAccount({ id: "s", name: "Eval attempt 2", broker: "Tradovate", externalRef: "999", predecessorAccountId: "p" }),
    ], "s");
    const user = userEvent.setup();
    renderAt("/import", { accountId: "p" });
    expect(await screen.findByText("Another account uses the same account number")).toBeTruthy();
    expect(screen.getByText(/Eval attempt 2 \(999\)/)).toBeTruthy();
    await choose(user, csvFile(byName("generic-fees-and-duplicate")));
    await checkFile(user);
    await user.click(await screen.findByRole("button", { name: "Review rows" }));
    await user.click(await screen.findByRole("button", { name: "Continue with 1 trade" }));
    const importButton = await screen.findByRole("button", { name: /Import 1 trade into Eval/ });
    expect(importButton.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/"Eval" is failed, not an active attempt/)).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "These trades belong to this attempt" }));
    expect(screen.getByRole("button", { name: /Import 1 trade into Eval/ }).getAttribute("aria-disabled")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Import 1 trade into Eval/ }));
    await waitFor(() => expect(imports.repository.commit).toHaveBeenCalledTimes(1));
    expect(imports.batches[0].accountId).toBe("p");
  });

  it("keeps each account's history separate", async () => {
    setup([makeAccount({ id: "a", name: "First" }), makeAccount({ id: "b", name: "Second" })], "a");
    imports.batches.push({ ...(byName("generic-fees-and-duplicate").expected.batch as ImportBatch), id: "b1", accountId: "a", fileName: "first.csv" });
    imports.batches.push({ ...(byName("generic-fees-and-duplicate").expected.batch as ImportBatch), id: "b2", accountId: "b", fileName: "second.csv" });
    const user = userEvent.setup();
    renderAt("/import/history");
    const table = await screen.findByRole("table", { name: "Imports" });
    expect(within(table).getByText("first.csv")).toBeTruthy();
    expect(within(table).queryByText("second.csv")).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Import into" }));
    await user.click(await screen.findByRole("option", { name: /Second/ }));
    expect(await screen.findByText("second.csv")).toBeTruthy();
    expect(screen.queryByText("first.csv")).toBeNull();
  });
});

describe("commit outcomes", () => {
  async function reachConfirm(user: ReturnType<typeof userEvent.setup>) {
    renderAt();
    await screen.findByRole("combobox", { name: "Import into" });
    await choose(user, csvFile(byName("generic-fees-and-duplicate")));
    await checkFile(user);
    await user.click(await screen.findByRole("button", { name: "Review rows" }));
    await user.click(await screen.findByRole("button", { name: "Continue with 1 trade" }));
    return screen.findByRole("button", { name: "Import 1 trade into PA-48213" });
  }

  it("imports once when the button is pressed twice", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const original = imports.repository.commit.getMockImplementation()!;
    imports.repository.commit.mockImplementationOnce(req => new Promise(resolve => (release = () => resolve(original(req)))));
    const button = await reachConfirm(user);
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Importing…" }));
    fireEvent.click(screen.getByRole("button", { name: "Importing…" }));
    expect(imports.repository.commit).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(await screen.findByRole("heading", { name: /Imported 1 trade/ })).toBeTruthy();
  });

  it("reports a definite failure without claiming anything was saved", async () => {
    const user = userEvent.setup();
    imports.repository.commit.mockRejectedValueOnce(new RepositoryError({ kind: "conflict", message: "x" }));
    await user.click(await reachConfirm(user));
    expect(await screen.findByText("Nothing was imported")).toBeTruthy();
    expect(imports.batches).toHaveLength(0);
  });

  it("treats a lost answer as uncertain: no retry, a history check, and unlock only after review", async () => {
    const user = userEvent.setup();
    imports.repository.commit.mockResolvedValueOnce({ id: "" } as ImportBatch); // malformed acknowledgement
    await user.click(await reachConfirm(user));
    expect(await screen.findByRole("heading", { name: "Couldn't confirm the import finished" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again|Import 1 trade/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "I've checked the history" }));
    expect(await screen.findByRole("button", { name: "Check the file" })).toBeTruthy();
    expect(imports.repository.commit).toHaveBeenCalledTimes(1);
  });

  it("shows a batch Rust recorded as failed as not completed", async () => {
    const user = userEvent.setup();
    const ok = byName("generic-fees-and-duplicate").expected.batch as ImportBatch;
    imports.repository.commit.mockResolvedValueOnce({ ...ok, id: "bf", accountId: "a", status: "failed", importedCount: 0, errorSummary: "private db detail" });
    await user.click(await reachConfirm(user));
    expect(await screen.findByRole("heading", { name: "The import didn't complete" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("private db detail");
  });

  it("discards the import on cancel without writing anything", async () => {
    const user = userEvent.setup();
    await reachConfirm(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: "Discard this import?" })).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(where).toBe("/accounts"));
    expect(imports.repository.commit).not.toHaveBeenCalled();
  });
});
