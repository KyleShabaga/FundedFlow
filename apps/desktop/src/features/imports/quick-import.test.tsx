// @vitest-environment jsdom
// Build 18.5 Quick Import through the real page, Build 13 components and Build 14 hooks. Accounts come from the
// Build 15 in-memory store; previews and batches replay the Rust-generated Build 17 golden fixture. Synthetic data.
import { RepositoryError, type CsvImportRequest, type CsvPreview, type ImportBatch } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
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
import { QuickImportPage, quickImportBlockers } from "./components/QuickImportPage";
import { useCsvFileChoice } from "./hooks/use-csv-file";

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

function createImports() {
  const batches: ImportBatch[] = [];
  const previews: CsvImportRequest[] = [];
  const overrides = new Map<string, (p: CsvPreview) => CsvPreview>();
  let n = 0;
  const caseFor = (req: CsvImportRequest) => golden.cases.find(c => c.request.content === req.content);
  const preview = vi.fn(async (req: CsvImportRequest): Promise<CsvPreview> => {
    previews.push(req);
    const c = caseFor(req);
    if (!c) throw new RepositoryError({ kind: "validation", message: "no fixture", issues: [{ field: "content", message: "The file is empty." }] });
    const p = structuredClone(c.expected.preview) as CsvPreview;
    return overrides.get(req.fileName)?.(p) ?? p;
  });
  const commit = vi.fn(async (req: CsvImportRequest): Promise<ImportBatch> => {
    const c = caseFor(req)!;
    const batch = { ...(c.expected.batch as ImportBatch), id: `batch-${++n}`, accountId: req.accountId, fileName: req.fileName };
    batches.push(batch);
    return batch;
  });
  return { repository: { preview, commit, list: vi.fn(async (id: string) => batches.filter(b => b.accountId === id)), problemRows: vi.fn(async () => []) }, batches, previews, overrides };
}

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

function renderAt(path = "/import/quick", state?: unknown) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[{ pathname: path, state }]}>
          <Where />
          <Routes>
            <Route path="/import" element={<ImportWizardPage />} />
            <Route path="/import/quick" element={<QuickImportPage />} />
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
const zone = () => document.querySelector(".ds-dropzone") as HTMLElement;
const drop = (...files: File[]) => fireEvent.drop(zone(), { dataTransfer: { files, types: ["Files"] } });
const confirmButton = () => screen.getByRole("button", { name: /^Confirm import/ });
const ready = async () => {
  const select = await screen.findByRole("combobox", { name: "Import into" });
  await waitFor(() => expect(select.textContent).not.toContain("Choose an account"));
};

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

describe("Quick import: eligible files", () => {
  it("checks a familiar export straight away, shows the compact summary, and writes only on Confirm", async () => {
    const user = userEvent.setup();
    renderAt();
    await ready();
    // NA-4: the copy describes detection and the account's zone, not remembered settings.
    expect(screen.getByText(/^Quick import: check and import a CSV in one step\. .*detects the format and reads times in the account's time zone/)).toBeTruthy();
    expect(screen.queryByText(/for a file you've imported before/)).toBeNull();
    await user.upload(fileInput(), csvFile(byName("paired-short-warning")));
    expect(await screen.findByRole("heading", { name: "What would be imported" })).toBeTruthy();
    expect(imports.repository.preview).toHaveBeenCalledTimes(1);
    expect(imports.previews[0]).toMatchObject({ accountId: "a", timezone: "America/New_York", format: "auto", dateFormat: "auto" });
    expect(screen.getByText("America/New_York (the account's zone)")).toBeTruthy();
    expect(screen.getByText(/Performance export/)).toBeTruthy();
    expect(screen.getByText("Will import")).toBeTruthy();
    expect(screen.getByText("Rows with warnings")).toBeTruthy();
    // Previewing never writes.
    expect(imports.repository.commit).not.toHaveBeenCalled();
    await user.click(confirmButton());
    expect(await screen.findByRole("heading", { name: /Imported 1 trade into PA-48213/ })).toBeTruthy();
    expect(imports.repository.commit).toHaveBeenCalledTimes(1);
    expect(imports.batches[0]).toMatchObject({ accountId: "a" });
  });

  it("gives a dropped file and a browsed file the same preview request", async () => {
    const user = userEvent.setup();
    renderAt();
    await ready();
    const c = byName("paired-short-warning");
    drop(csvFile(c));
    await screen.findByRole("heading", { name: "What would be imported" });
    await user.upload(fileInput(), csvFile(c));
    await waitFor(() => expect(imports.previews).toHaveLength(2));
    expect(imports.previews[1]).toEqual(imports.previews[0]);
  });

  it("lists every row and issue on request", async () => {
    const user = userEvent.setup();
    renderAt();
    await ready();
    await user.upload(fileInput(), csvFile(byName("paired-short-warning")));
    await user.click(await screen.findByRole("button", { name: "View all rows and issues" }));
    expect(screen.getByRole("table", { name: "Rows in the file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide rows and issues" }).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Quick import: files that need the wizard", () => {
  it("refuses to guess an ambiguous date order and hands over to the full wizard with the file kept", async () => {
    const user = userEvent.setup();
    renderAt();
    await ready();
    const c = byName("ambiguous-dates");
    await user.upload(fileInput(), csvFile(c));
    expect((await screen.findAllByText("This file needs the full wizard")).length).toBeGreaterThan(0);
    expect(screen.getByText(/The dates fit more than one order/)).toBeTruthy();
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
    await user.click(screen.getAllByRole("button", { name: "Continue in full wizard" })[0]!);
    await waitFor(() => expect(where).toBe("/import"));
    expect(await screen.findByText("Continued from Quick import")).toBeTruthy();
    expect(screen.getByText(c.request.fileName)).toBeTruthy();
    // The wizard re-checks: nothing is previewed again until the trader asks, and nothing was committed.
    expect(imports.repository.preview).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Check the file" }));
    await waitFor(() => expect(imports.repository.preview).toHaveBeenCalledTimes(2));
    expect(imports.previews[1]).toMatchObject({ accountId: "a", fileName: c.request.fileName, dateFormat: "auto" });
    expect(imports.repository.commit).not.toHaveBeenCalled();
  });

  it("sends a generic CSV to the wizard so its column matches are checked", async () => {
    const user = userEvent.setup();
    renderAt();
    await ready();
    await user.upload(fileInput(), csvFile(byName("generic-fees-and-duplicate")));
    expect(await screen.findByText(/columns were matched by name/)).toBeTruthy();
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
  });

  it("explains blockers from Rust's own file issues", () => {
    const p = structuredClone(byName("ambiguous-dates").expected.preview) as CsvPreview;
    expect(quickImportBlockers(p)[0]).toMatch(/more than one order/);
    const ok = structuredClone(byName("paired-short-warning").expected.preview) as CsvPreview;
    expect(quickImportBlockers(ok)).toEqual([]);
  });
});

describe("Quick import: file problems and replacement", () => {
  it("refuses several files at once, a non-CSV file and an empty file, with nothing previewed", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderAt();
    await ready();
    const c = byName("paired-short-warning");
    drop(csvFile(c, "a.csv"), csvFile(c, "b.csv"));
    expect(await screen.findByText(/2 files were dropped\. Import one CSV at a time/)).toBeTruthy();
    await user.upload(fileInput(), new File(["x"], "trades.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    expect(await screen.findByText(/trades.xlsx isn't a CSV file/)).toBeTruthy();
    drop(new File([""], "empty.csv", { type: "text/csv" }));
    expect(await screen.findByText(/empty.csv is empty/)).toBeTruthy();
    expect(imports.repository.preview).not.toHaveBeenCalled();
  });

  it("replaces a file cleanly: an earlier file's late preview never shows, and the same file can be chosen again", async () => {
    const user = userEvent.setup();
    let releaseFirst!: () => void;
    const original = imports.repository.preview.getMockImplementation()!;
    imports.repository.preview.mockImplementationOnce(req => new Promise(resolve => (releaseFirst = () => resolve(original(req)))));
    renderAt();
    await ready();
    await user.upload(fileInput(), csvFile(byName("generic-fees-and-duplicate")));
    await waitFor(() => expect(imports.repository.preview).toHaveBeenCalledTimes(1));
    // A second file while the first is still being checked.
    const second = csvFile(byName("paired-short-warning"));
    drop(second);
    expect(await screen.findByRole("heading", { name: "What would be imported" })).toBeTruthy();
    await act(async () => releaseFirst());
    expect(screen.queryByText(/columns were matched by name/)).toBeNull();
    expect(screen.getByText(/Performance export/)).toBeTruthy();
    // Unicode names survive, and choosing the same file again checks it again.
    const unicode = csvFile(byName("paired-short-warning"), "Trades — Zürich 東京.csv");
    await user.upload(fileInput(), unicode);
    await waitFor(() => expect(last(imports.previews).fileName).toBe("Trades — Zürich 東京.csv"));
    const count = imports.previews.length;
    await user.upload(fileInput(), unicode);
    await waitFor(() => expect(imports.previews.length).toBe(count + 1));
  });
});

const last = <T,>(xs: T[]) => xs[xs.length - 1]!;

describe("Quick import: destination", () => {
  it("never shows a preview made for the account the trader switched away from", async () => {
    setup([makeAccount({ id: "a", name: "Attempt one", externalRef: "777" }), makeAccount({ id: "b", name: "Attempt two", externalRef: "777" })], "a");
    const user = userEvent.setup();
    let releaseFirst!: () => void;
    const original = imports.repository.preview.getMockImplementation()!;
    imports.repository.preview.mockImplementationOnce(req => new Promise(resolve => (releaseFirst = () => resolve(original(req)))));
    renderAt();
    await ready();
    await user.upload(fileInput(), csvFile(byName("paired-short-warning")));
    await waitFor(() => expect(imports.repository.preview).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("combobox", { name: "Import into" }));
    await user.click(await screen.findByRole("option", { name: /Attempt two/ }));
    // Two attempts share broker number 777: the picker says so and keeps them apart by attempt.
    expect(await screen.findByText("Another account uses the same account number")).toBeTruthy();
    await waitFor(() => expect(imports.repository.preview).toHaveBeenCalledTimes(2));
    await act(async () => releaseFirst());
    expect(imports.repository.preview.mock.calls[1]![0].accountId).toBe("b");
    expect(screen.getAllByText(/Attempt two \(777\)/).length).toBeGreaterThan(0);
    await user.click(await screen.findByRole("button", { name: /^Confirm import of 1 trade/ }));
    await waitFor(() => expect(imports.repository.commit).toHaveBeenCalledTimes(1));
    expect(imports.batches[0]!.accountId).toBe("b");
  });

  it("refuses an archived attempt before checking anything", async () => {
    setup([makeAccount({ id: "a", name: "Live" }), makeAccount({ id: "z", name: "Old", archivedAt: "2026-10-01T00:00:00.000Z" })], "a");
    renderAt("/import/quick", { accountId: "z" });
    await screen.findByRole("combobox", { name: "Import into" });
    expect((await screen.findAllByText(/is archived/i)).length).toBeGreaterThan(0);
    drop(csvFile(byName("paired-short-warning")));
    await screen.findByText(/read on this computer/);
    expect(imports.repository.preview).not.toHaveBeenCalled();
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps the finished-attempt confirmation before importing, bound to that preview's token", async () => {
    setup([makeAccount({ id: "p", name: "Eval", status: "failed" })], "p");
    imports.overrides.set(byName("paired-short-warning").request.fileName, p => {
      p.targetAssessment.confirmations = ["Eval is a finished (failed) attempt. Confirm these historical trades belong to it."];
      return p;
    });
    const user = userEvent.setup();
    renderAt("/import/quick", { accountId: "p" });
    await ready();
    await user.upload(fileInput(), csvFile(byName("paired-short-warning")));
    await screen.findByRole("heading", { name: "What would be imported" });
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
    await user.click(screen.getByRole("checkbox", { name: "These trades belong to this attempt" }));
    expect(confirmButton().getAttribute("aria-disabled")).toBeNull();
    await user.click(confirmButton());
    await waitFor(() => expect(imports.repository.commit).toHaveBeenCalledTimes(1));
    expect(imports.repository.commit.mock.calls[0]![0].targetAcknowledgement).toEqual({ previewToken: "<preview-token>", historicalConfirmed: true });
  });

  it("refuses a file Rust says crosses the attempt's reset boundary; a tick can't override it", async () => {
    imports.overrides.set(byName("paired-short-warning").request.fileName, p => {
      p.targetAssessment.blocked = "One row spans this attempt's reset. Split the file.";
      return p;
    });
    const user = userEvent.setup();
    renderAt();
    await ready();
    await user.upload(fileInput(), csvFile(byName("paired-short-warning")));
    expect((await screen.findAllByText(/spans this attempt's reset/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("checkbox", { name: "These trades belong to this attempt" })).toBeNull();
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
    expect(imports.repository.commit).not.toHaveBeenCalled();
  });
});

describe("Quick import: commit safety", () => {
  async function eligible(user: ReturnType<typeof userEvent.setup>) {
    renderAt();
    await ready();
    await user.upload(fileInput(), csvFile(byName("paired-short-warning")));
    await screen.findByRole("heading", { name: "What would be imported" });
  }

  it("sends one import when Confirm is pressed twice", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const original = imports.repository.commit.getMockImplementation()!;
    imports.repository.commit.mockImplementationOnce(req => new Promise(resolve => (release = () => resolve(original(req)))));
    await eligible(user);
    await user.click(confirmButton());
    fireEvent.click(screen.getByRole("button", { name: "Importing…" }));
    await user.click(screen.getByRole("button", { name: "Importing…" }));
    expect(imports.repository.commit).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(await screen.findByRole("heading", { name: /Imported 1 trade/ })).toBeTruthy();
  });

  it("never retries an uncertain commit and points to the history to verify it", async () => {
    const user = userEvent.setup();
    imports.repository.commit.mockResolvedValueOnce({ id: "" } as ImportBatch); // malformed acknowledgement
    await eligible(user);
    await user.click(confirmButton());
    expect(await screen.findByRole("heading", { name: "Couldn't confirm the import finished" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Confirm import|Try again/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Verify in import history" }));
    await waitFor(() => expect(where).toBe("/import/history"));
    expect(imports.repository.commit).toHaveBeenCalledTimes(1);
  });
});

describe("useCsvFileChoice", () => {
  it("delivers only the newest pick when an earlier read finishes last", async () => {
    const results: string[] = [];
    const { result } = renderHook(() => useCsvFileChoice(r => results.push("content" in r ? r.name : r.kind)));
    let releaseSlow!: () => void;
    const slow = new File(["a,b\n1,2"], "slow.csv", { type: "text/csv" });
    const gate = new Promise<void>(resolve => (releaseSlow = resolve));
    const read = slow.arrayBuffer.bind(slow);
    slow.arrayBuffer = () => gate.then(read);
    let first!: Promise<void>;
    act(() => { first = result.current.pick([slow]); });
    await act(() => result.current.pick([new File(["a,b\n3,4"], "fast.csv", { type: "text/csv" })]));
    await act(async () => { releaseSlow(); await first; });
    expect(results).toEqual(["fast.csv"]);
  });
});
