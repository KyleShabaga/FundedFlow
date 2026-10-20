// @vitest-environment jsdom
// Failed-account history, archive/restore and the reset-attempt flow.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { Account } from "../lib/data/schemas";

const repo = vi.hoisted(() => ({
  accounts: {
    list: vi.fn(), archive: vi.fn(), restore: vi.fn(), changeStatus: vi.fn(), resetAttempt: vi.fn(),
    lineage: vi.fn(), previewDeletion: vi.fn(),
  },
  rulebooks: { list: vi.fn(), listVersions: vi.fn() },
}));
vi.mock("../lib/data/api", async () => {
  const { RepositoryError } = await import("../lib/data/schemas");
  return { repository: repo, DataError: RepositoryError };
});

import { AccountLifecyclePanel } from "./AccountLifecycle";

const T = "2026-10-19T14:30:00.000Z";
const account = (id: string, status: Account["status"], extra: Partial<Account> = {}): Account => ({
  id, name: id, broker: "Tradovate", propFirm: "Topstep", externalRef: "123", accountType: "evaluation", status,
  currency: "USD", startingBalance: "50000", timezone: "America/New_York", tradingDayResetTime: "17:00", notes: null,
  createdAt: T, updatedAt: T, archivedAt: null, predecessorAccountId: null, successorAccountId: null, ...extra,
});

const list = [
  account("Live eval", "active"),
  account("Failed eval", "failed"),
  account("Old eval", "passed", { archivedAt: T }),
];

beforeEach(() => {
  vi.clearAllMocks();
  repo.accounts.list.mockResolvedValue(list);
  repo.rulebooks.list.mockResolvedValue([]);
});
afterEach(cleanup);

it("shows live accounts by default and keeps failed and archived accounts one filter away", async () => {
  const user = userEvent.setup();
  render(<AccountLifecyclePanel />);
  expect(await screen.findByText("Live eval")).toBeTruthy();
  expect(screen.queryByText("Failed eval")).toBeNull();
  expect(repo.accounts.list).toHaveBeenCalledWith({ includeArchived: true });

  await user.click(screen.getByRole("button", { name: /^Failed \(1\)/ }));
  expect(screen.getByText("Failed eval")).toBeTruthy();
  expect(screen.getByText(/Historical: not available for live trading or risk/)).toBeTruthy();

  await user.click(screen.getByRole("button", { name: /^Archived \(1\)/ }));
  const row = screen.getByText("Old eval").closest("li") as HTMLElement;
  // The result and the archive flag are two separate badges.
  expect(within(row).getByText("Passed")).toBeTruthy();
  expect(within(row).getByText("Archived")).toBeTruthy();
  expect(within(row).getByRole("button", { name: "Restore…" })).toBeTruthy();
  expect(within(row).queryByRole("button", { name: /Archive…/ })).toBeNull();
  expect(within(row).queryByRole("button", { name: /Start new attempt/ })).toBeNull();
});

it("marks an account failed with the user's cause without archiving it", async () => {
  const user = userEvent.setup();
  repo.accounts.changeStatus.mockResolvedValue(account("Live eval", "failed"));
  render(<AccountLifecyclePanel />);
  await user.click(await screen.findByRole("button", { name: "Mark failed or closed…" }));
  await user.type(screen.getByLabelText(/Cause/), "Daily loss limit");
  // The effective time is the account's wall clock (America/New_York), whatever the computer's zone.
  const effective = screen.getByLabelText(/^Effective/) as HTMLInputElement;
  fireEvent.change(effective, { target: { value: "2026-10-20T20:00" } });
  await user.click(screen.getByRole("button", { name: "Save status" }));
  await waitFor(() => expect(repo.accounts.changeStatus).toHaveBeenCalled());
  const [id, input] = repo.accounts.changeStatus.mock.calls[0] as [string, Record<string, unknown>];
  expect(id).toBe("Live eval");
  expect(input).toMatchObject({ status: "failed", cause: "Daily loss limit", effectiveAt: "2026-10-21T00:00:00.000Z" });
  expect(repo.accounts.archive).not.toHaveBeenCalled();
  expect((await screen.findByRole("status")).textContent).toMatch(/Nothing was archived or deleted/);
});

it("archives only after confirmation and restores without changing the status", async () => {
  const user = userEvent.setup();
  render(<AccountLifecyclePanel />);
  await user.click(await screen.findByRole("button", { name: "Archive…" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(repo.accounts.archive).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Archive…" }));
  await user.click(screen.getByRole("button", { name: "Archive" }));
  await waitFor(() => expect(repo.accounts.archive).toHaveBeenCalledWith("Live eval"));

  await user.click(screen.getByRole("button", { name: /^Archived/ }));
  repo.accounts.restore.mockResolvedValue(account("Old eval", "passed"));
  await user.click(screen.getByRole("button", { name: "Restore…" }));
  expect(screen.getByText(/comes back with its status unchanged/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(repo.accounts.restore).toHaveBeenCalledWith("Old eval"));
  expect((await screen.findByRole("status")).textContent).toMatch(/restored as Passed/);
});

it("keeps the dialog open and says nothing changed when a restore is refused", async () => {
  const user = userEvent.setup();
  repo.accounts.restore.mockRejectedValue(new Error("cannot restore: 'New' is already an active account"));
  render(<AccountLifecyclePanel />);
  await user.click(await screen.findByRole("button", { name: /^Archived/ }));
  await user.click(screen.getByRole("button", { name: "Restore…" }));
  await user.click(screen.getByRole("button", { name: "Restore" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/cannot restore.*Nothing was changed/);
});

it("will not start a reset until the outcome, balance and rulebook are each chosen, then confirms", async () => {
  const user = userEvent.setup();
  const successor = account("Attempt 2", "active", { predecessorAccountId: "Live eval" });
  repo.accounts.resetAttempt.mockResolvedValue({ predecessor: account("Live eval", "failed"), successor });
  const onChanged = vi.fn();
  render(<AccountLifecyclePanel onChanged={onChanged} />);
  await user.click(await screen.findByRole("button", { name: "Start new attempt…" }));
  expect(screen.getByText(/new linked account/i)).toBeTruthy();

  const review = screen.getByRole("button", { name: "Review" }) as HTMLButtonElement;
  expect(review.disabled).toBe(true);
  await user.type(screen.getByLabelText("New attempt name"), "Attempt 2");
  expect(review.disabled).toBe(true);
  await user.selectOptions(screen.getByLabelText(/previous attempt's outcome/), "failed");
  await user.type(screen.getByLabelText(/Starting balance/), "50000");
  expect(review.disabled).toBe(true); // rulebook still undecided
  await user.selectOptions(screen.getByLabelText(/Rulebook for the new attempt/), "later");
  expect(review.disabled).toBe(false);

  await user.click(review);
  expect(screen.getByText(/keep all its trades, imports and journal/)).toBeTruthy();
  expect(repo.accounts.resetAttempt).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Create new attempt" }));
  await waitFor(() => expect(repo.accounts.resetAttempt).toHaveBeenCalledTimes(1));
  expect(repo.accounts.resetAttempt.mock.calls[0]?.[0]).toMatchObject({
    predecessorAccountId: "Live eval", priorOutcome: "failed", name: "Attempt 2", startingBalance: "50000",
    externalRef: "123", rulebook: { kind: "decideLater" },
  });
  await waitFor(() => expect(onChanged).toHaveBeenCalledWith(successor));
});

it("keeps what was entered and creates nothing when a reset fails", async () => {
  const user = userEvent.setup();
  repo.accounts.resetAttempt.mockRejectedValue(new Error("another active or paused account already uses this broker and account number"));
  render(<AccountLifecyclePanel />);
  await user.click(await screen.findByRole("button", { name: "Start new attempt…" }));
  await user.type(screen.getByLabelText("New attempt name"), "Attempt 2");
  await user.selectOptions(screen.getByLabelText(/previous attempt's outcome/), "failed");
  await user.type(screen.getByLabelText(/Starting balance/), "50000");
  await user.selectOptions(screen.getByLabelText(/Rulebook for the new attempt/), "later");
  await user.click(screen.getByRole("button", { name: "Review" }));
  await user.click(screen.getByRole("button", { name: "Create new attempt" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/already uses this broker/);
  expect((screen.getByLabelText("New attempt name") as HTMLInputElement).value).toBe("Attempt 2");
});

it("shows linked attempts with unknown results as a dash, and a deletion preview that deletes nothing", async () => {
  const user = userEvent.setup();
  repo.accounts.list.mockResolvedValue([account("A1", "failed", { successorAccountId: "A2" }), account("A2", "active", { predecessorAccountId: "A1" })]);
  const base = {
    archivedAt: null, externalRef: "123", startingBalance: "50000", createdAt: T, importCount: 0,
    firstTradingDay: null, lastTradingDay: null, tradesWithUnknownPnl: 0,
  };
  repo.accounts.lineage.mockResolvedValue([
    { ...base, accountId: "A1", attemptNumber: 1, name: "A1", status: "failed", tradeCount: 3, netPnl: "-1200.5", firstTradingDay: "2026-10-01", lastTradingDay: "2026-10-19",
      resetToNext: { predecessorAccountId: "A1", successorAccountId: "A2", priorOutcome: "failed", effectiveAt: "2026-10-21T01:00:00.000Z", reason: "Drawdown", source: "user_entered", rulebookDecision: "deferred", createdAt: T } },
    { ...base, accountId: "A2", attemptNumber: 2, name: "A2", status: "active", tradeCount: 0, netPnl: null, resetToNext: null },
  ]);
  repo.accounts.previewDeletion.mockResolvedValue({
    accountId: "A1", accountName: "A1", trades: 3, deletedTrades: 0, journalEntries: 1, importBatches: 1, statusEvents: 2,
    rulebookAssignments: 0, privateRulebooks: 0, snapshots: 0, ledgerEntries: 0, phaseEvents: 0, linkedAttempts: ["A2"],
    blockers: ["This account is part of an evaluation-reset chain."],
  });
  render(<AccountLifecyclePanel />);
  await user.click(await screen.findByRole("button", { name: "Attempts" }));
  const table = await screen.findByRole("table", { name: "Attempts" });
  const rows = within(table).getAllByRole("row");
  expect(within(rows[1] as HTMLElement).getByText("−1,200.50")).toBeTruthy();
  // 01:00 UTC on the 21st is still the 20th in the account's zone.
  expect(within(rows[1] as HTMLElement).getByText(/reset 2026-10-20/)).toBeTruthy();
  // Attempt 2 has no trades: net result and trading days are unknown, shown as a dash, not 0.
  expect(within(rows[2] as HTMLElement).getAllByText("—")).toHaveLength(2);
  expect(within(rows[2] as HTMLElement).getAllByRole("cell")[5]?.textContent).toBe("—");

  await user.click(screen.getAllByRole("button", { name: "Deletion preview" })[0] as HTMLElement);
  expect(await screen.findByText(/Nothing has been deleted/)).toBeTruthy();
  expect(screen.getByText(/Linked attempts that would stay: 1/)).toBeTruthy();
  expect(screen.getByText(/evaluation-reset chain/)).toBeTruthy();
});
