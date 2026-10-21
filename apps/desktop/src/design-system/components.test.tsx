// @vitest-environment jsdom
import type { Trade } from "@fundedflow/domain";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountCard, AccountOverviewCard, BrandLogo, BrandMark, meterFraction, Pnl, PnlBars, PnlCalendar, ProgressMeter, RuleMeter, ruleState, TabPanel, Tabs, TradeTable, tradeResult } from "./index";
import { monthWeeks } from "./components/journal";

afterEach(cleanup);

describe("BrandLogo", () => {
  it("reads FundedFlow, with Flow in the accent and a decorative mark", () => {
    const { container } = render(<BrandLogo />);
    expect(container.textContent).toBe("FundedFlow");
    expect(screen.getByText("Flow").className).toBe("ds-brand-name-accent");
    const mark = container.querySelector("svg.ds-brand-mark")!;
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.getAttribute("width")).toBe("32");
  });
  it("shows the mark alone without the name", () => {
    const { container } = render(<BrandLogo showName={false} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("svg.ds-brand-mark")).toBeTruthy();
  });
  it("gives each mark its own gradients, referenced by valid fragment ids", () => {
    const { container } = render(<><BrandMark /><BrandMark size={20} /></>);
    const ids = [...container.querySelectorAll("linearGradient")].map(g => g.id);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^[\w-]+$/);
    for (const path of container.querySelectorAll("path")) {
      const ref = path.getAttribute("fill")!.match(/^url\(#([\w-]+)\)$/)![1];
      expect(ids).toContain(ref);
    }
  });
});

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
  it("marks the selected day and week as pressed, opens a week, and shows an unknown day as a dash without a tint", async () => {
    const onSelectWeek = vi.fn();
    const { container } = render(
      <PnlCalendar year={2026} month={10} selectedDay="2026-10-06" selectedWeek={2} onSelectDay={() => {}} onSelectWeek={onSelectWeek}
        days={{ "2026-10-05": { pnl: null, trades: 2 }, "2026-10-06": { pnl: "-40", trades: 1 } }} />,
    );
    expect(screen.getByRole("button", { name: /Tue Oct 6/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Mon Oct 5/ }).getAttribute("aria-pressed")).toBe("false");
    const unknown = screen.getByRole("button", { name: /Mon Oct 5: P&L unknown, 2 trades/ });
    expect(unknown.className).not.toMatch(/ds-cal-(profit|loss|flat)/);
    expect(unknown.textContent).toContain("—");
    const week = screen.getByRole("button", { name: /^Week 2: P&L unknown, 3 trades/ });
    expect(week.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(week);
    expect(onSelectWeek).toHaveBeenCalledWith(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"], 2);
    expect(container.querySelector(".ds-cal-week.is-selected")).toBeTruthy();
  });
  it("leads with trades or win rate when asked", () => {
    const days = { "2026-10-05": { pnl: "25", trades: 3, winRate: "66.7" }, "2026-10-06": { pnl: "-5", trades: 1, winRate: null } };
    const { rerender } = render(<PnlCalendar year={2026} month={10} days={days} display="winRate" onSelectDay={() => {}} />);
    expect(screen.getByRole("button", { name: /Mon Oct 5: \+\$25, 3 trades, win rate 66.7%/ }).textContent).toContain("66.7%");
    expect(screen.getByRole("button", { name: /Tue Oct 6: .*win rate unknown/ }).textContent).toContain("—");
    rerender(<PnlCalendar year={2026} month={10} days={days} display="trades" onSelectDay={() => {}} title={<span>Custom title</span>} />);
    expect(screen.getByText("Custom title")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Mon Oct 5/ }).querySelector(".ds-cal-pnl")?.textContent).toBe("3");
  });
});

describe("PnlBars", () => {
  const items = [
    { key: "1", label: "Monday", value: "921.87", detail: "12 trades" },
    { key: "2", label: "Tuesday", value: "-388.2" },
    { key: "3", label: "Wednesday", value: null, detail: "1 trade with unknown P&L" },
  ];
  it("labels every bar with its exact amount and opens the selected row", async () => {
    const onSelect = vi.fn();
    const { container } = render(<PnlBars items={items} label="Net P&L by weekday" onSelect={onSelect} selectedKey="2" currency="EUR" />);
    expect(screen.getByRole("list", { name: "Net P&L by weekday" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Monday: +€921.87, 12 trades" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tuesday: −€388.20" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Wednesday: P&L unknown, 1 trade with unknown P&L" }).textContent).toContain("—");
    // Unknown draws no bar; loss bars grow left of the axis.
    expect(container.querySelectorAll(".ds-bars-bar")).toHaveLength(2);
    expect((container.querySelector(".ds-bars-bar.is-loss") as HTMLElement).style.right).toBe("50%");
    await userEvent.click(screen.getByRole("button", { name: /Monday/ }));
    expect(onSelect).toHaveBeenCalledWith("1");
  });
  it("renders read-only rows without onSelect", () => {
    render(<PnlBars items={items.slice(0, 1)} label="By weekday" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("group", { name: "Monday: +$921.87, 12 trades" })).toBeTruthy();
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

describe("currency on Build 7 components", () => {
  it("uses the account currency for Pnl, AccountCard and PnlCalendar", () => {
    const { container } = render(
      <>
        <Pnl value="-275.73" currency="EUR" />
        <AccountCard name="PA-1" phase="Evaluation" balance="100100" startingBalance="100000" currency="GBP" rules={[{ label: "Daily loss", used: "100", limit: "1000" }]} />
        <PnlCalendar year={2026} month={10} days={{ "2026-10-05": { pnl: "12000", trades: 1 } }} currency="EUR" />
      </>,
    );
    expect(screen.getByText("−€275.73")).toBeTruthy();
    expect(screen.getByText("£100,100.00")).toBeTruthy();
    expect(container.querySelector(".ds-rule-amt")?.textContent).toBe("£100 / £1,000");
    expect(container.textContent).not.toContain("$");
  });
});

describe("TabPanel heading", () => {
  it("adds a visually hidden h2 so the panel's h3 sections keep the outline", () => {
    render(
      <Tabs label="Sections" items={[{ value: "a", label: "Overview" }]}>
        <TabPanel value="a" heading="Overview"><h3>Trades</h3></TabPanel>
      </Tabs>,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "Overview" });
    expect(heading.className).toContain("ds-sr-only");
    expect(heading.closest('[role="tabpanel"]')).not.toBeNull();
  });
});

describe("TabPanel keepMounted", () => {
  it("keeps a form's unsaved input across tab switches, hidden while inactive", async () => {
    const user = userEvent.setup();
    render(
      <Tabs label="Sections" items={[{ value: "a", label: "Edit" }, { value: "b", label: "Other" }]}>
        <TabPanel value="a" keepMounted><input aria-label="Draft value" /></TabPanel>
        <TabPanel value="b"><p>Other panel</p></TabPanel>
      </Tabs>,
    );
    await user.type(screen.getByRole("textbox", { name: "Draft value" }), "2500");
    await user.click(screen.getByRole("tab", { name: "Other" }));
    const kept = screen.getByDisplayValue("2500");
    expect(kept.closest('[role="tabpanel"]')?.getAttribute("data-state")).toBe("inactive");
    expect(kept.closest(".ds-tab-panel-kept")).not.toBeNull();
    await user.click(screen.getByRole("tab", { name: "Edit" }));
    expect((screen.getByRole("textbox", { name: "Draft value" }) as HTMLInputElement).value).toBe("2500");
  });
});

describe("ProgressMeter", () => {
  it("sizes the bar from the two amounts it is given and reads them out", () => {
    render(<ProgressMeter label="Drawdown headroom" value="1500" max="2000" valueText="$1,500.00 of $2,000.00 left" note="Floor $48,500.00" />);
    const meter = screen.getByRole("meter", { name: "Drawdown headroom" });
    expect(meter.getAttribute("aria-valuenow")).toBe("75");
    expect(meter.getAttribute("aria-valuetext")).toBe("$1,500.00 of $2,000.00 left");
    expect(screen.getByText("Floor $48,500.00")).toBeTruthy();
  });
  it("is empty for negative or unknown amounts and full past the maximum", () => {
    expect(meterFraction("-10", "2000")).toBe(0);
    expect(meterFraction("abc", "2000")).toBe(0);
    expect(meterFraction("2500", "2000")).toBe(1);
    expect(meterFraction("0.000001", "0")).toBe(0);
  });
});

describe("AccountOverviewCard", () => {
  const card = (over: Partial<Parameters<typeof AccountOverviewCard>[0]> = {}) => (
    <AccountOverviewCard titleId="c1" mark="A" eyebrow="Apex" title="PA-48213" reference="••••8213" meta="Evaluation · Phase 1"
      badges={<span>Active</span>}
      primary={{ label: "Drawdown headroom", value: { kind: "unavailable", reason: "Nothing calculated yet" }, provenance: { label: "Not calculated", tone: "neutral" }, note: "Calculate on Today." }}
      figures={[{ label: "Balance", value: { kind: "money", amount: "50210.25", signed: false } }]}
      rules={[{ label: "Max drawdown", value: "$2,000.00 · Static" }, { label: "Started with", value: "$50,000.00", muted: true }]}
      activity="No imported trades" actions={<button type="button">View details</button>} {...over} />
  );
  it("is an article named by its title, with the masked number read as such", () => {
    render(card());
    const article = screen.getByRole("article", { name: /PA-48213/ });
    expect(within(article).getByRole("heading", { level: 3 }).textContent).toBe("PA-48213, account number ending ••••8213");
    expect(within(article).getByText("Apex")).toBeTruthy();
  });
  it("shows unknown as unknown with its provenance in words, never zero", () => {
    render(card());
    expect(screen.getByText("Not calculated")).toBeTruthy();
    expect(screen.getByTitle("Unavailable: Nothing calculated yet")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
    expect(screen.getByText("$50,210.25")).toBeTruthy();
  });
  it("lists rule lines as terms and keeps the details action and activity in the footer", () => {
    const { container } = render(card({ tint: "loss", selected: true }));
    expect(screen.getByText("Max drawdown").tagName).toBe("DT");
    expect(container.querySelector(".ds-aoc-rule.is-muted dd")?.textContent).toBe("$50,000.00");
    expect(within(container.querySelector("footer")!).getByRole("button", { name: "View details" })).toBeTruthy();
    expect(container.firstElementChild?.className).toContain("is-loss");
    expect(container.firstElementChild?.className).toContain("is-selected");
  });
});
