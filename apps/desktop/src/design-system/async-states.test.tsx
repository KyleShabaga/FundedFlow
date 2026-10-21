// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type AsyncState,
  Button,
  EmptyState,
  ErrorState,
  hasData,
  isMutationBusy,
  LoadingState,
  MutationFeedback,
  type MutationState,
  Pnl,
  RefreshingIndicator,
  StaleDataNotice,
  StateBoundary,
  UnavailableState,
} from "./index";

afterEach(cleanup);

type Account = { name: string; balance: string | null };

function Accounts({ state, onRetry }: { state: AsyncState<Account[]>; onRetry?: () => void }) {
  return (
    <StateBoundary state={state} label="accounts" onRetry={onRetry} timeZone="America/New_York">
      {(rows) => (
        <ul>
          {rows.map((r) => (
            <li key={r.name}>
              {r.name} <Pnl value={r.balance} />
            </li>
          ))}
        </ul>
      )}
    </StateBoundary>
  );
}

const ROWS: Account[] = [{ name: "Apex", balance: "105100" }];

describe("StateBoundary", () => {
  it("shows a labelled skeleton with no numbers while loading", () => {
    const { container } = render(<Accounts state={{ status: "loading" }} />);
    expect(screen.getByText("Loading accounts")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$|\d/);
    expect(container.querySelector(".ds-boundary")?.getAttribute("aria-busy")).toBe("true");
  });
  it("keeps no-records, no-matches, error and unavailable apart", () => {
    const { rerender, container } = render(<Accounts state={{ status: "empty", kind: "no-records" }} />);
    expect(container.querySelector("[data-empty-kind='no-records']")).toBeTruthy();
    rerender(<Accounts state={{ status: "empty", kind: "no-matches" }} />);
    expect(screen.getByText("No matches")).toBeTruthy();
    rerender(<Accounts state={{ status: "error", error: { message: "The journal couldn't be read." } }} />);
    expect(screen.getByRole("alert").textContent).toContain("The journal couldn't be read.");
    expect(container.querySelector("[data-empty-kind]")).toBeNull();
    rerender(<Accounts state={{ status: "unavailable", reason: "The local runtime is not ready." }} />);
    expect(screen.getByText("Not available")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("never renders an error as empty data", () => {
    const children = vi.fn(() => null);
    render(
      <StateBoundary<Account[]> state={{ status: "error", error: { message: "Timed out" } }} label="accounts">
        {children}
      </StateBoundary>,
    );
    expect(children).not.toHaveBeenCalled();
    expect(screen.queryByText("Nothing here yet")).toBeNull();
  });
  it("announces a finished first load once and stays quiet on refresh", () => {
    const { rerender, container } = render(<Accounts state={{ status: "loading" }} />);
    rerender(<Accounts state={{ status: "success", data: ROWS }} />);
    const live = container.querySelector(".ds-boundary > [role='status']")!;
    expect(live.textContent).toBe("Accounts loaded");
    rerender(<Accounts state={{ status: "refreshing", data: ROWS }} />);
    rerender(<Accounts state={{ status: "success", data: ROWS }} />);
    expect(live.textContent).toBe("Accounts loaded");
  });
  it("keeps data visible while refreshing, with a silent indicator", () => {
    render(<Accounts state={{ status: "refreshing", data: ROWS }} />);
    expect(screen.getByText("+$105,100.00")).toBeTruthy();
    expect(screen.getByText("Updating")).toBeTruthy();
    expect(screen.getByText("Updating").getAttribute("role")).toBeNull();
  });
  it("labels stale data with its time and offers a refresh", async () => {
    const onRetry = vi.fn();
    render(<Accounts state={{ status: "stale", data: ROWS, asOf: "2026-10-19T20:12:00Z", cause: "refresh-failed" }} onRetry={onRetry} />);
    expect(screen.getByText(/Couldn't refresh\. Showing figures from Oct 19, 16:12 EDT; they may be out of date\./)).toBeTruthy();
    expect(screen.getByText("Not current")).toBeTruthy();
    expect(screen.queryByText(/live|up to date/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("moves focus to the error after a load the user waited for", () => {
    const { rerender } = render(<Accounts state={{ status: "loading" }} />);
    rerender(<Accounts state={{ status: "error", error: { title: "Couldn't load accounts", message: "Try again." } }} />);
    expect(document.activeElement?.textContent).toBe("Couldn't load accounts");
  });
  it("uses custom empty views per kind", () => {
    render(
      <StateBoundary<Account[]> state={{ status: "empty", kind: "no-records" }} label="accounts" empty={{ "no-records": <EmptyState kind="no-records" title="Add your first account" action={<Button>Add account</Button>} /> }}>
        {() => null}
      </StateBoundary>,
    );
    expect(screen.getByText("Add your first account")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add account" })).toBeTruthy();
  });
  it("narrows data states", () => {
    const s: AsyncState<number> = { status: "stale", data: 1, asOf: null, cause: "offline" };
    expect(hasData(s) && s.data).toBe(1);
    expect(hasData({ status: "empty", kind: "no-records" })).toBe(false);
  });
});

describe("state views", () => {
  it("shows unknown time when stale data has no timestamp", () => {
    render(<StaleDataNotice asOf={null} cause="offline" />);
    expect(screen.getByText(/from an unknown time/)).toBeTruthy();
  });
  it("retries an error only when asked, once per click, and blocks while retrying", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState message="Couldn't read the journal." onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<ErrorState message="Couldn't read the journal." onRetry={onRetry} retrying />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("offers the resolution for unavailable features", () => {
    render(<UnavailableState reason="This account has no rulebook yet." action={<Button>Choose a rulebook</Button>} />);
    expect(screen.getByRole("button", { name: "Choose a rulebook" })).toBeTruthy();
  });
  it("labels loading for screen readers", () => {
    render(<LoadingState label="Loading today's risk" layout="metrics" rows={4} />);
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Loading today's risk")).toBeTruthy();
  });
  it("can announce a refresh when asked", () => {
    render(<RefreshingIndicator announce label="Checking for new trades" />);
    expect(screen.getByRole("status").textContent).toBe("Checking for new trades");
  });
});

describe("MutationFeedback", () => {
  it("is busy while validating and submitting", () => {
    expect(isMutationBusy({ status: "submitting" })).toBe(true);
    expect(isMutationBusy({ status: "validating" })).toBe(true);
    expect(isMutationBusy({ status: "uncertain" })).toBe(false);
    render(<MutationFeedback state={{ status: "submitting", message: "Importing 64 trades…" }} />);
    expect(screen.getByRole("status").textContent).toBe("Importing 64 trades…");
  });
  it("offers a check, never a retry, when the outcome is uncertain", async () => {
    const onRetry = vi.fn();
    const onCheck = vi.fn();
    render(<MutationFeedback state={{ status: "uncertain" }} onRetry={onRetry} onCheck={onCheck} />);
    expect(screen.getByRole("alert").textContent).toContain("It may have saved");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Check result" }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
  it("only offers a retry when nothing changed", () => {
    const onRetry = vi.fn();
    const failed = (nothingChanged: boolean): MutationState => ({ status: "failed", message: "The file couldn't be read.", nothingChanged });
    const { rerender } = render(<MutationFeedback state={failed(true)} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Nothing was changed.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    rerender(<MutationFeedback state={failed(false)} onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Check what changed");
  });
  it("lists validation issues and confirms success", () => {
    const { rerender } = render(<MutationFeedback state={{ status: "validation-error", issues: [{ message: "Quantity must be greater than 0" }] }} />);
    expect(screen.getByRole("alert").textContent).toContain("Quantity must be greater than 0");
    rerender(<MutationFeedback state={{ status: "success", message: "Saved" }} />);
    expect(screen.getByRole("status").textContent).toBe("Saved");
    rerender(<MutationFeedback state={{ status: "idle" }} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Build 13 review follow-ups", () => {
  it("says 'last loaded' when the time is only a client receipt time", () => {
    render(<StaleDataNotice asOf="2026-10-19T20:12:00Z" cause="refresh-failed" asOfBasis="loaded" timeZone="America/New_York" />);
    expect(screen.getByText("Couldn't refresh. Showing figures last loaded Oct 19, 16:12 EDT; they may be out of date.")).toBeTruthy();
  });
  it("passes the stale basis through StateBoundary", () => {
    render(
      <StateBoundary<number> state={{ status: "stale", data: 1, asOf: null, cause: "offline", asOfBasis: "loaded" }} label="accounts">
        {() => null}
      </StateBoundary>,
    );
    expect(screen.getByText(/last loaded at an unknown time/)).toBeTruthy();
  });
  it("adds caller actions to an uncertain outcome without a retry", async () => {
    const acknowledge = vi.fn();
    render(<MutationFeedback state={{ status: "uncertain" }} onCheck={() => {}} actions={<Button onClick={acknowledge}>I've checked the records</Button>} />);
    await userEvent.click(screen.getByRole("button", { name: "I've checked the records" }));
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Check result" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
