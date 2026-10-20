// @vitest-environment jsdom
// Deleting a trade or journal entry always goes through a confirmation that
// names the record; cancelling or dismissing never deletes (#10, #14).

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account, JournalEntry, Trade } from "../lib/data/schemas";

const db = vi.hoisted(() => ({ trades: [] as unknown[], entries: [] as unknown[] }));
const repo = vi.hoisted(() => ({
  accounts: { list: vi.fn(), create: vi.fn(), update: vi.fn(), archive: vi.fn() },
  trades: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  journal: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  imports: { preview: vi.fn(), commit: vi.fn(), list: vi.fn(), problemRows: vi.fn() },
}));
vi.mock("../lib/data/api", async () => {
  const { RepositoryError } = await import("../lib/data/schemas");
  return { repository: repo, DataError: RepositoryError };
});

import { DataModelPanel } from "./DataModelPanel";

const T = "2026-10-19T14:30:00.000Z";
const account: Account = {
  id: "a1", name: "Eval", broker: null, propFirm: null, externalRef: null, accountType: "evaluation",
  status: "active", currency: "USD", startingBalance: "50000", timezone: "America/New_York",
  tradingDayResetTime: "17:00", notes: null, createdAt: T, updatedAt: T,
  archivedAt: null, predecessorAccountId: null, successorAccountId: null,
};
const trade = (id: string, symbol: string, entryPrice: string): Trade => ({
  id, accountId: "a1", source: "manual", importBatchId: null, brokerTradeId: null, symbol, side: "long",
  quantity: "1", entryAt: T, entryPrice, exitAt: null, exitPrice: null, fees: "0", tradingDay: "2026-10-19",
  reportedPnl: null, grossPnl: null, realizedPnl: null, pnlStatus: "open", notes: null, roundTrip: null,
  createdAt: T, updatedAt: T,
} as Trade);
const entry = (id: string, title: string, body: string): JournalEntry => ({
  id, accountId: "a1", tradeId: null, entryAt: T, title, body, tags: [], createdAt: T, updatedAt: T,
});

beforeEach(() => {
  db.trades = [trade("t1", "MESZ6", "6000"), trade("t2", "MNQZ6", "21000")];
  db.entries = [entry("j1", "Morning plan", "Wait for the open range"), entry("j2", "Review", "Cut losers")];
  vi.clearAllMocks();
  repo.accounts.list.mockResolvedValue([account]);
  repo.trades.list.mockImplementation(async () => db.trades);
  repo.journal.list.mockImplementation(async () => db.entries);
  repo.imports.list.mockResolvedValue([]);
  repo.trades.remove.mockImplementation(async (id: string) => {
    db.trades = db.trades.filter((t) => (t as Trade).id !== id);
  });
  repo.journal.remove.mockImplementation(async (id: string) => {
    db.entries = db.entries.filter((j) => (j as JournalEntry).id !== id);
  });
});
afterEach(cleanup);

async function open(label: RegExp) {
  const user = userEvent.setup();
  render(<DataModelPanel />);
  await user.click(await screen.findByRole("button", { name: label }));
  return { user, dialog: await screen.findByRole("alertdialog") };
}

describe("deleting a trade", () => {
  it("asks first, naming the trade", async () => {
    const { dialog } = await open(/Delete trade .*MNQZ6/);
    expect(within(dialog).getByText("MNQZ6")).toBeTruthy();
    expect(within(dialog).getByText(/Entry 21000/)).toBeTruthy();
    expect(repo.trades.remove).not.toHaveBeenCalled();
  });

  it("does nothing on Cancel or Escape", async () => {
    const { user, dialog } = await open(/Delete trade .*MESZ6/);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: /Delete trade .*MESZ6/ }));
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    expect(repo.trades.remove).not.toHaveBeenCalled();
    expect(screen.getByText("Trades (2)")).toBeTruthy();
  });

  it("deletes only that trade on confirm and refreshes", async () => {
    const { user, dialog } = await open(/Delete trade .*MESZ6/);
    await user.click(within(dialog).getByRole("button", { name: "Delete trade" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(repo.trades.remove).toHaveBeenCalledExactlyOnceWith("t1");
    expect(await screen.findByText("Trades (1)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete trade .*MESZ6/ })).toBeNull();
    expect(await screen.findByText(/Deleted trade .*MESZ6/)).toBeTruthy();
  });

  it("keeps the trade and shows the error when the delete fails", async () => {
    repo.trades.remove.mockRejectedValueOnce(new Error("database is locked"));
    const { user, dialog } = await open(/Delete trade .*MESZ6/);
    await user.click(within(dialog).getByRole("button", { name: "Delete trade" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/database is locked.*Nothing was deleted/);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Trades (2)")).toBeTruthy();
    expect(screen.queryByText(/Deleted trade/)).toBeNull();
  });
});

describe("deleting a journal entry", () => {
  it("asks first, naming the entry", async () => {
    const { dialog } = await open(/Delete journal entry Review/);
    expect(within(dialog).getByText("Review")).toBeTruthy();
    expect(within(dialog).getByText("Cut losers")).toBeTruthy();
    expect(repo.journal.remove).not.toHaveBeenCalled();
  });

  it("does nothing on Cancel or Escape", async () => {
    const { user, dialog } = await open(/Delete journal entry Review/);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: /Delete journal entry Review/ }));
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(repo.journal.remove).not.toHaveBeenCalled();
    expect(screen.getByText("Journal (2)")).toBeTruthy();
  });

  it("deletes exactly that entry on confirm", async () => {
    const { user, dialog } = await open(/Delete journal entry Review/);
    await user.click(within(dialog).getByRole("button", { name: "Delete entry" }));
    expect(await screen.findByText("Journal (1)")).toBeTruthy();
    expect(repo.journal.remove).toHaveBeenCalledExactlyOnceWith("j2");
    expect(screen.getByText("Morning plan")).toBeTruthy();
    expect(await screen.findByText(/Deleted journal entry "Review"/)).toBeTruthy();
  });

  it("keeps the entry and shows the error when the delete fails", async () => {
    repo.journal.remove.mockRejectedValueOnce(new Error("not found"));
    const { user, dialog } = await open(/Delete journal entry Review/);
    await user.click(within(dialog).getByRole("button", { name: "Delete entry" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/not found.*Nothing was deleted/);
    expect(screen.getByText("Journal (2)")).toBeTruthy();
  });
});
