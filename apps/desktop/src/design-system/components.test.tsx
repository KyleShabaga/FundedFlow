// @vitest-environment jsdom
import type { Trade } from "@fundedflow/domain";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountCard, Pnl, PnlCalendar, RuleMeter, ruleState, TradeTable, tradeResult } from "./index";
import { monthWeeks } from "./components/journal";

afterEach(cleanup);

describe("Pnl", () => {
  it("signs and colours by value", () => {
    const { container } = render(<Pnl value="-275.73" percent={-1.08} />);
    expect(container.textContent).toBe("−$275.73−1.08%");
    expect(container.firstElementChild?.className).toContain("ds-pnl-loss");
  });
  it("shows unknown P&L as a dash", () => {
    const { container } = render(<Pnl value={null} />);
    expect(container.textContent).toBe("—");
    expect(container.firstElementChild?.className).toContain("ds-pnl-unknown");
  });
});

describe("RuleMeter", () => {
  it("turns amber at 70% and red at 100% of a limit", () => {
    expect(ruleState({ label: "Daily loss", used: "699.99", limit: "1000" })).toBe("ok");
    expect(ruleState({ label: "Daily loss", used: "700", limit: "1000" })).toBe("warn");
    expect(ruleState({ label: "Daily loss", used: "1000", limit: "1000" })).toBe("breach");
    expect(ruleState({ kind: "target", label: "Target", used: "6000", limit: "6000" })).toBe("done");
    expect(ruleState({ kind: "count", label: "Days", used: 3, limit: 4 })).toBe("progress");
  });
  it("says what is left", () => {
    render(<RuleMeter label="Daily loss limit" used="1120" limit="5000" />);
    const meter = screen.getByRole("meter", { name: "Daily loss limit" });
    expect(meter.getAttribute("aria-valuenow")).toBe("22");
    expect(screen.getByText("$3,880 room left")).toBeTruthy();
  });
  it("reports a breach", () => {
    render(<RuleMeter label="Max loss" used="2090" limit="2000" />);
    expect(screen.getByText("Limit breached")).toBeTruthy();
  });
});

describe("AccountCard", () => {
  it("shows balance change exactly", () => {
    render(<AccountCard name="PA-1" firm="Apex" phase="Evaluation" balance="100000.1" startingBalance="99999.9" />);
    expect(screen.getByText("+$0.20")).toBeTruthy();
  });
  it("treats an unknown balance as unknown", () => {
    const { container } = render(<AccountCard name="PA-1" phase="Evaluation" balance={null} startingBalance="50000" />);
    expect(container.querySelector(".ds-num-xl")?.textContent).toBe("—");
  });
});

describe("PnlCalendar", () => {
  it("lays out Monday-first weeks", () => {
    const weeks = monthWeeks(2026, 10);
    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, "2026-10-01"]);
    expect(weeks[weeks.length - 1][4]).toBe("2026-10-30");
  });
  it("totals weeks and the month, and opens a day", async () => {
    const onSelectDay = vi.fn();
    render(
      <PnlCalendar
        year={2026}
        month={10}
        days={{ "2026-10-05": { pnl: "0.1", trades: 1 }, "2026-10-06": { pnl: "0.2", trades: 2 } }}
        onSelectDay={onSelectDay}
      />,
    );
    expect(screen.getByText("+$0.30")).toBeTruthy(); // month total, exact
    await userEvent.click(screen.getByRole("button", { name: /Tue Oct 6/ }));
    expect(onSelectDay).toHaveBeenCalledWith("2026-10-06");
  });
  it("hides weekends by default", () => {
    render(<PnlCalendar year={2026} month={10} days={{}} />);
    expect(screen.queryByText("Sat")).toBeNull();
  });
});

describe("TradeTable", () => {
  const base: Trade = {
    id: "t1", accountId: "a", source: "manual", importBatchId: null, brokerTradeId: null, symbol: "MNQZ6", side: "long",
    quantity: "1", entryAt: "2026-10-19T13:31:00.000Z", entryPrice: "21412.25", exitAt: "2026-10-19T13:44:00.000Z", exitPrice: "21448.5",
    fees: "1.24", tradingDay: "2026-10-19", reportedPnl: null, grossPnl: "72.5", realizedPnl: "71.26", pnlStatus: "calculated",
    notes: null, roundTrip: null, createdAt: "2026-10-19T14:00:00.000Z", updatedAt: "2026-10-19T14:00:00.000Z",
  };
  it("derives the result from net P&L and status", () => {
    expect(tradeResult(base).text).toBe("Win");
    expect(tradeResult({ ...base, realizedPnl: "-1" }).text).toBe("Loss");
    expect(tradeResult({ ...base, pnlStatus: "open", realizedPnl: null }).text).toBe("Open");
    expect(tradeResult({ ...base, pnlStatus: "missing_instrument", realizedPnl: null }).text).toBe("—");
  });
  it("shows entry time in the account time zone", () => {
    render(<TradeTable label="Trades" trades={[base]} timeZone="America/New_York" />);
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("09:31")).toBeTruthy();
    expect(within(row).getByText("+$71.26")).toBeTruthy();
  });
});
