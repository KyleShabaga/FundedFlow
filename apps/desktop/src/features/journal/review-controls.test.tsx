// @vitest-environment jsdom
// P0-D24: the trade review's Reviewed tile and segmented execution rating. Both are drafts until "Save review": the
// summary Status shows only the saved review, focusing a rating never picks one, an unrated trade stays unrated (never
// inferred from the P&L), Clear rating saves null, a failed or pending save implies no success, and one trade's draft
// marks never show on the next trade. The repository is an in-memory store (test-store.ts).
import { RepositoryError, type ReviewInput, type TradeReview } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { makeAccount } from "../accounts/test-store";
import { JournalPage } from "./components/JournalPage";
import { TradeDetailPage } from "./components/TradeDetailPage";
import { createJournalStore, trade } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createJournalStore> }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

let client: QueryClient;
let location = "";
function Where() {
  const l = useLocation();
  location = l.pathname + l.search;
  return null;
}
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <Routes>
            <Route path="/journal" element={<JournalPage />} />
            <Route path="/journal/trades/:tradeId" element={<TradeDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const A = "acct-a";
// t1 is a winner: a positive P&L must not pre-mark it reviewed or rate it.
const seed = () => [
  trade({ id: "t1", accountId: A, symbol: "ESZ6", entryAt: "2026-10-19T13:30:00.000Z", exitAt: "2026-10-19T14:00:00.000Z", tradingDay: "2026-10-19", realizedPnl: "96", grossPnl: "100", fees: "4" }),
  trade({ id: "t2", accountId: A, symbol: "NQZ6", side: "short", entryAt: "2026-10-19T15:00:00.000Z", exitAt: "2026-10-19T15:10:00.000Z", tradingDay: "2026-10-19", realizedPnl: "-54", grossPnl: "-50", fees: "4" }),
];

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
};

const newClient = () => new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
beforeEach(() => {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = newClient();
  holder.store = createJournalStore([makeAccount({ id: A, name: "Eval A" })], seed());
  try { sessionStorage.clear(); } catch { /* jsdom has it */ }
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

const NOT_SAVED = /^Not saved yet\./;
const card = () => screen.findByRole("region", { name: "Review" });
const ratingGroup = (c: HTMLElement) => within(c).getByRole("radiogroup", { name: "Execution rating" });
const ratingRadios = (c: HTMLElement) => within(ratingGroup(c)).getAllByRole("radio") as HTMLInputElement[];
const rating = (c: HTMLElement, n: string) => within(ratingGroup(c)).getByRole("radio", { name: n }) as HTMLInputElement;
const checkedRating = (c: HTMLElement) => ratingRadios(c).find(r => r.checked)?.getAttribute("value") ?? null;
const reviewed = (c: HTMLElement) => within(c).getByRole("checkbox", { name: "Reviewed" }) as HTMLInputElement;
// The draft note under the tile, linked to the checkbox only while the draft differs from the saved value.
const reviewedHint = (c: HTMLElement) => {
  const ids = reviewed(c).getAttribute("aria-describedby");
  return ids ? ids.split(" ").map(id => document.getElementById(id)?.textContent ?? "").join(" ") : "";
};
const STATUS_HELP = "Mark when you have finished reviewing this trade.";
const statusGroupHelp = (c: HTMLElement) => {
  const ids = within(c).getByRole("group", { name: "Review status" }).getAttribute("aria-describedby");
  return ids ? document.getElementById(ids)?.textContent ?? "" : "";
};
// The summary Status above the form (saved review only).
const status = (c: HTMLElement) => within(c).getByText("Status", { selector: ".jr-review-fact .ds-label" }).parentElement!.textContent!.replace(/^Status/, "");
const saveButton = (c: HTMLElement) => within(c).getByRole("button", { name: /^(Save review|Saving…)$/ });
const saves = () => holder.store.calls.filter(c => c.method === "reviews.save").map(c => c.args[0] as ReviewInput);
const leavePrompt = () => screen.queryByRole("alertdialog", { name: "Leave without saving the review?" });

async function openT1() {
  renderAt("/journal/trades/t1");
  const c = await card();
  await within(c).findByRole("radiogroup", { name: "Execution rating" });
  return c;
}
async function saveAndWait(user: ReturnType<typeof userEvent.setup>, c: HTMLElement) {
  const before = saves().length;
  await user.click(within(c).getByRole("button", { name: "Save review" }));
  await waitFor(() => expect(saves().length).toBe(before + 1));
  await waitFor(() => expect(within(c).queryByText("Unsaved changes")).toBeNull());
  await waitFor(() => expect(within(c).getByRole("button", { name: "Save review" })).toBeTruthy());
}

describe("Execution rating (P0-D24)", () => {
  it("opens a winning trade unrated and not reviewed: nothing is inferred from the P&L", async () => {
    const c = await openT1();
    expect(within(c).getByText("Outcome")).toBeTruthy();
    expect(ratingRadios(c)).toHaveLength(5);
    expect(checkedRating(c)).toBeNull();
    expect(within(c).getByText("Not rated")).toBeTruthy();
    expect(within(c).queryByRole("button", { name: "Clear rating" })).toBeNull();
    expect(reviewed(c).checked).toBe(false);
    expect(status(c)).toBe("Not reviewed");
    expect(within(c).queryByText("Unsaved changes")).toBeNull();
  });

  it("focusing a rating (Tab from Reviewed) picks nothing, leaves the form clean and saves nothing", async () => {
    const user = userEvent.setup();
    const c = await openT1();
    reviewed(c).focus();
    await user.tab();
    expect(document.activeElement).toBe(rating(c, "1"));
    expect(checkedRating(c)).toBeNull();
    expect(within(c).getByText("Not rated")).toBeTruthy();
    expect(within(c).queryByText("Unsaved changes")).toBeNull();
    expect(saves()).toHaveLength(0);
  });

  it("saves a chosen rating, shows it again after reopening, and Clear rating saves null (not 0 or 1)", async () => {
    const user = userEvent.setup();
    const view = renderAt("/journal/trades/t1");
    let c = await card();
    await within(c).findByRole("radiogroup", { name: "Execution rating" });
    await user.click(rating(c, "4"));
    expect(checkedRating(c)).toBe("4");
    expect(within(c).getByText("Unsaved changes")).toBeTruthy();
    expect(within(c).queryByText("Not rated")).toBeNull();
    expect(within(c).getByRole("button", { name: "Clear rating" })).toBeTruthy();
    await saveAndWait(user, c);
    expect(saves()[0].executionRating).toBe(4);
    expect(holder.store.reviews.get("t1")?.executionRating).toBe(4);

    view.unmount();
    client.clear();
    client = newClient();
    renderAt("/journal/trades/t1");
    c = await card();
    await waitFor(() => expect(checkedRating(c)).toBe("4"));
    expect(within(c).queryByText("Unsaved changes")).toBeNull();

    await user.click(within(c).getByRole("button", { name: "Clear rating" }));
    expect(checkedRating(c)).toBeNull();
    // The button is gone, so focus returns to the scale, which picks nothing.
    expect(document.activeElement).toBe(rating(c, "1"));
    expect(within(c).getByText("Not rated")).toBeTruthy();
    expect(within(c).getByText("Unsaved changes")).toBeTruthy();
    await saveAndWait(user, c);
    expect(saves()[saves().length - 1].executionRating).toBeNull();
    expect(holder.store.reviews.get("t1")?.executionRating).toBeNull();
    expect(checkedRating(c)).toBeNull();
  });
});

describe("Reviewed (P0-D24)", () => {
  it("is a draft until saved: the Status follows only the saved review, both ways", async () => {
    const user = userEvent.setup();
    const c = await openT1();
    expect(statusGroupHelp(c)).toBe(STATUS_HELP);
    expect(reviewedHint(c)).toBe("");
    expect(within(c).queryByText(NOT_SAVED)).toBeNull();
    await user.click(reviewed(c));
    expect(reviewed(c).checked).toBe(true);
    expect(reviewedHint(c)).toBe("Not saved yet. Save the review to mark it reviewed.");
    expect(status(c)).toBe("Not reviewed");
    expect(within(c).getByText("Unsaved changes")).toBeTruthy();

    await saveAndWait(user, c);
    expect(saves()[0].reviewed).toBe(true);
    await waitFor(() => expect(status(c)).toMatch(/^Reviewed /));
    expect(within(c).queryByText(NOT_SAVED)).toBeNull();
    expect(reviewedHint(c)).toBe("");
    expect(statusGroupHelp(c)).toBe(STATUS_HELP);
    expect(holder.store.reviews.get("t1")?.reviewedAt).not.toBeNull();

    await user.click(reviewed(c));
    expect(reviewedHint(c)).toBe("Not saved yet. Save the review to clear Reviewed.");
    expect(status(c)).toMatch(/^Reviewed /);
    await saveAndWait(user, c);
    expect(saves()[saves().length - 1].reviewed).toBe(false);
    await waitFor(() => expect(status(c)).toBe("Not reviewed"));
    expect(within(c).queryByText(NOT_SAVED)).toBeNull();
    expect(holder.store.reviews.get("t1")?.reviewedAt).toBeNull();
  });

  it("a failed save implies no success: still dirty, Not reviewed, and the hint stays", async () => {
    const user = userEvent.setup();
    const c = await openT1();
    await user.click(reviewed(c));
    await user.click(rating(c, "2"));
    holder.store.repository.reviews.save = async () => { throw new RepositoryError({ kind: "validation", message: "refused", issues: [{ field: "reflection", message: "refused" }] }); };
    await user.click(within(c).getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(within(c).queryByRole("button", { name: /Saving/ })).toBeNull());
    expect(screen.queryByText("Review saved")).toBeNull();
    expect(within(c).getByText("Unsaved changes")).toBeTruthy();
    expect(status(c)).toBe("Not reviewed");
    expect(reviewed(c).checked).toBe(true);
    expect(checkedRating(c)).toBe("2");
    expect(reviewedHint(c)).toMatch(NOT_SAVED);
    expect(holder.store.reviews.get("t1")).toBeUndefined();
  });

  it("while a save is pending the button is busy and the Status unchanged until it lands", async () => {
    const user = userEvent.setup();
    const c = await openT1();
    await user.click(reviewed(c));
    const gate = deferred<void>();
    const real = holder.store.repository.reviews.save;
    holder.store.repository.reviews.save = async (input: ReviewInput): Promise<TradeReview> => { await gate.promise; return real(input); };
    await user.click(within(c).getByRole("button", { name: "Save review" }));
    const busy = await within(c).findByRole("button", { name: "Saving…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(status(c)).toBe("Not reviewed");
    expect(reviewedHint(c)).toMatch(NOT_SAVED);
    await act(async () => gate.resolve());
    expect(await screen.findByText("Review saved")).toBeTruthy();
    await waitFor(() => expect(status(c)).toMatch(/^Reviewed /));
    expect(saveButton(c).textContent).toBe("Save review");
    expect(within(c).queryByText(NOT_SAVED)).toBeNull();
  });
});

describe("Draft marks stay with their own trade (P0-D24)", () => {
  it("an unsaved rating and Reviewed on t1 do not show on t2", async () => {
    const user = userEvent.setup();
    let c = await openT1();
    await user.click(rating(c, "5"));
    await user.click(reviewed(c));
    expect(within(c).getByText("Unsaved changes")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next trade" }));
    const prompt = leavePrompt() ?? await screen.findByRole("alertdialog", { name: "Leave without saving the review?" });
    await user.click(within(prompt).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(location).toBe("/journal/trades/t2"));
    expect(await screen.findByRole("heading", { name: "NQZ6" })).toBeTruthy();
    c = await card();
    await within(c).findByRole("radiogroup", { name: "Execution rating" });
    expect(checkedRating(c)).toBeNull();
    expect(within(c).getByText("Not rated")).toBeTruthy();
    expect(reviewed(c).checked).toBe(false);
    expect(status(c)).toBe("Not reviewed");
    expect(within(c).queryByText("Unsaved changes")).toBeNull();
    expect(within(c).queryByText(NOT_SAVED)).toBeNull();
    expect(saves()).toHaveLength(0);
  });
});
