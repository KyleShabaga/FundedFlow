// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  Button,
  ChartPanel,
  type DataColumn,
  DataTable,
  EmptyState,
  ErrorState,
  LabeledValue,
  MetricCard,
  MiniMeter,
  MoneyCell,
  MonthYearPicker,
  RulebookLine,
  RuleStateBadge,
  RuleMeter,
  type SortState,
  StatList,
  Stepper,
  type YearMonth,
} from "./index";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

type Row = { id: string; name: string; balance: string | null };
const ROWS: Row[] = [
  { id: "a", name: "Apex $100K · PA-48213 with an unusually long account name that must not push actions away", balance: "105100" },
  { id: "b", name: "Topstep $50K", balance: "-2090.5" },
  { id: "c", name: "Personal", balance: null },
];
const COLUMNS: DataColumn<Row>[] = [
  { id: "name", header: "Account", cell: (r) => r.name, sortable: true, rowHeader: true },
  { id: "balance", header: "Balance", cell: (r) => r.balance ?? "—", align: "end", sortable: true, firstDirection: "descending" },
  { id: "menu", header: "Actions", hideHeader: true, cell: (r) => <Button size="sm">Open {r.id}</Button> },
];

describe("DataTable", () => {
  function Table({ onRowClick, onBulk }: { onRowClick?: (r: Row) => void; onBulk?: (ids: string[]) => void }) {
    const [sort, setSort] = useState<SortState | null>({ columnId: "balance", direction: "descending" });
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [page, setPage] = useState(1);
    return (
      <DataTable
        label="Accounts"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
        sort={sort}
        onSortChange={setSort}
        selection={{ selected, onChange: setSelected }}
        bulkActions={(ids) => <Button onClick={() => onBulk?.(ids)}>Archive</Button>}
        actions={<Button>Columns</Button>}
        onRowClick={onRowClick}
        pagination={{ page, pageSize: 3, total: 7, onPageChange: setPage }}
      />
    );
  }
  it("exposes one sort at a time with aria-sort and cycles direction", async () => {
    render(<Table />);
    const headers = screen.getAllByRole("columnheader");
    const account = headers.find((h) => h.textContent === "Account")!;
    const balance = headers.find((h) => h.textContent === "Balance")!;
    expect(balance.getAttribute("aria-sort")).toBe("descending");
    expect(account.getAttribute("aria-sort")).toBe("none");
    await userEvent.click(within(account).getByRole("button", { name: "Account" }));
    expect(account.getAttribute("aria-sort")).toBe("ascending");
    expect(balance.getAttribute("aria-sort")).toBe("none");
    await userEvent.click(within(account).getByRole("button", { name: "Account" }));
    expect(account.getAttribute("aria-sort")).toBe("descending");
    await userEvent.click(within(balance).getByRole("button", { name: "Balance" }));
    expect(balance.getAttribute("aria-sort")).toBe("descending");
  });
  it("selects rows, shows bulk actions and a mixed select-all", async () => {
    const onBulk = vi.fn();
    render(<Table onBulk={onBulk} />);
    const all = screen.getByRole("checkbox", { name: "Select all accounts on this page" }) as HTMLInputElement;
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Topstep $50K" }));
    expect(all.indeterminate).toBe(true);
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Columns" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onBulk).toHaveBeenCalledWith(["b"]);
    await userEvent.click(all);
    expect(screen.getByText("3 selected")).toBeTruthy();
    expect(all.checked).toBe(true);
    await userEvent.click(all);
    expect(screen.getByRole("button", { name: "Columns" })).toBeTruthy();
  });
  it("opens a row with Enter but not from its checkbox or buttons", async () => {
    const onRowClick = vi.fn();
    render(<Table onRowClick={onRowClick} />);
    const row = screen.getByRole("rowheader", { name: /Topstep/ }).closest("tr")!;
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
    await userEvent.click(screen.getByRole("checkbox", { name: "Select Topstep $50K" }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });
  it("labels the row header, right-aligns numbers and keeps unknown as a dash", () => {
    render(<Table />);
    expect(screen.getByRole("table", { name: "Accounts" })).toBeTruthy();
    expect(screen.getAllByRole("rowheader")).toHaveLength(3);
    const cell = screen.getAllByRole("cell").find((c) => c.textContent === "—")!;
    expect(cell.className).toContain("num");
  });
  it("pages with an accessible pager", async () => {
    render(<Table />);
    expect(screen.getByText("Showing 1–3 of 7")).toBeTruthy();
    const pager = screen.getByRole("navigation", { name: "Accounts pages" });
    expect(within(pager).getByRole("button", { name: "Previous page" })).toHaveProperty("disabled", true);
    expect(within(pager).getByRole("button", { name: "Page 1" }).getAttribute("aria-current")).toBe("page");
    expect(within(pager).getAllByRole("button", { name: /^Page/ })).toHaveLength(3);
    await userEvent.click(within(pager).getByRole("button", { name: "Next page" }));
    expect(within(pager).getByRole("button", { name: "Page 2" }).getAttribute("aria-current")).toBe("page");
  });
  it("keeps headers and swaps the body for a fallback", () => {
    const { rerender } = render(<DataTable label="Trades" columns={COLUMNS} rows={[]} getRowId={(r) => r.id} fallback={<EmptyState kind="no-matches" />} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getByText("No matches")).toBeTruthy();
    rerender(<DataTable label="Trades" columns={COLUMNS} rows={[]} getRowId={(r) => r.id} fallback={<ErrorState message="Couldn't load trades." />} />);
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load trades.");
    expect(screen.queryByText("No matches")).toBeNull();
  });
});

describe("MetricCard and values", () => {
  it("shows null money as unknown and zero as $0.00", () => {
    const { rerender } = render(<MetricCard label="Net P&L" value={{ kind: "money", amount: null }} />);
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.queryByText(/\$0/)).toBeNull();
    rerender(<MetricCard label="Net P&L" value={{ kind: "money", amount: "0" }} />);
    expect(screen.getByText("$0.00")).toBeTruthy();
    expect(screen.queryByText("Unknown")).toBeNull();
  });
  it("signs large negative values exactly", () => {
    render(<MetricCard label="Net P&L" value={{ kind: "money", amount: "-1234567.89" }} />);
    expect(screen.getByText("−$1,234,567.89").className).toContain("ds-text-loss");
  });
  it("shows basis, timestamp in the account zone and stale as text", () => {
    render(<MetricCard label="Balance" value={{ kind: "money", amount: "105100", signed: false }} basis="Realized" asOf="2026-10-19T20:12:00Z" timeZone="America/New_York" stale />);
    expect(screen.getByText("Realized")).toBeTruthy();
    expect(screen.getByText("As of Oct 19, 16:12")).toBeTruthy();
    expect(screen.getByText("Not current")).toBeTruthy();
  });
  it("explains unavailable values", () => {
    render(<MetricCard label="Room left" value={{ kind: "unavailable", reason: "No rulebook for this account" }} />);
    expect(screen.getByText("No rulebook for this account")).toBeTruthy();
    expect(screen.getByText(/Unavailable/)).toBeTruthy();
  });
  it("renders unknown counts and percents as a dash", () => {
    render(
      <StatList
        label="Day stats"
        items={[
          { label: "Trades", value: { kind: "count", value: 0 } },
          { label: "Win rate", value: { kind: "percent", value: null } },
          { label: "Account", value: "Apex $100K" },
          { label: "Fees", value: null },
        ]}
      />,
    );
    const terms = screen.getAllByRole("term").map((t) => t.textContent);
    expect(terms).toEqual(["Trades", "Win rate", "Account", "Fees"]);
    const defs = screen.getAllByRole("definition").map((d) => d.textContent);
    expect(defs).toEqual(["0", "—Unknown", "Apex $100K", "—Unknown"]);
  });
  it("lays out a labeled value", () => {
    render(<LabeledValue label="Fees" value={{ kind: "money", amount: "125.4", signed: false }} />);
    expect(screen.getByText("$125.40")).toBeTruthy();
  });
});

describe("Stepper", () => {
  it("marks done, current and upcoming steps", () => {
    render(<Stepper label="Import steps" current={2} steps={[{ label: "Choose file" }, { label: "Match columns" }, { label: "Review rows" }, { label: "Import" }]} />);
    const items = within(screen.getByRole("list", { name: "Import steps" })).getAllByRole("listitem");
    expect(items[2].getAttribute("aria-current")).toBe("step");
    expect(items[0].textContent).toContain("completed");
    expect(items[3].textContent).toContain("not started");
  });
});

describe("MonthYearPicker", () => {
  function Picker({ onChange }: { onChange?: (v: YearMonth) => void }) {
    const [v, setV] = useState<YearMonth>({ year: 2026, month: 10 });
    return (
      <MonthYearPicker
        value={v}
        onChange={(next) => {
          setV(next);
          onChange?.(next);
        }}
        today={{ year: 2026, month: 10 }}
        months={{ "2026-09": { pnl: "1240", trades: 20 }, "2026-10": { pnl: "-300", trades: 12 }, "2025-12": { pnl: null, trades: 3 } }}
      />
    );
  }
  it("steps months and disables the future", async () => {
    render(<Picker />);
    expect(screen.getByRole("button", { name: "Next month" })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("button", { name: /September 2026/ })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("button", { name: /October 2026/ })).toBeTruthy();
  });
  it("picks a month from the popover and returns focus", async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const title = screen.getByRole("button", { name: /October 2026/ });
    await userEvent.click(title);
    const dialog = screen.getByRole("dialog", { name: "Choose month and year" });
    expect(within(dialog).getByRole("button", { name: /November 2026/ })).toHaveProperty("disabled", true);
    expect(within(dialog).getByRole("button", { name: /October 2026/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByText("+$940")).toBeTruthy(); // YTD = 1240 - 300, whole dollars
    await userEvent.click(within(dialog).getByRole("button", { name: "September 2026, +$1,240" }));
    expect(onChange).toHaveBeenCalledWith({ year: 2026, month: 9 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("moves between months with arrow keys and treats unknown P&L as unknown", async () => {
    render(<Picker />);
    await userEvent.click(screen.getByRole("button", { name: /October 2026/ }));
    const dialog = screen.getByRole("dialog");
    within(dialog).getByRole("button", { name: /September 2026/ }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^October 2026/);
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^October 2026/); // November is disabled
    await userEvent.click(within(dialog).getByRole("button", { name: "Previous year" }));
    expect(within(dialog).getByRole("button", { name: "December 2025, unknown P&L" })).toBeTruthy();
    expect(within(dialog).getByText("Unknown")).toBeTruthy(); // YTD with an unknown month
  });
});

describe("Rule state", () => {
  it("never shows a meter for unknown or unsupported rules", () => {
    const meter = <RuleMeter label="Daily loss" used="100" limit="1000" />;
    const { rerender } = render(<RuleStateBadge presence="unknown" support="supported" meter={meter} setupAction={<Button size="sm">Add limit</Button>} />);
    expect(screen.getByText("Needs setup")).toBeTruthy();
    expect(screen.queryByRole("meter")).toBeNull();
    rerender(<RuleStateBadge presence="value" support="needs_setup" meter={meter} />);
    expect(screen.getByText("Needs setup")).toBeTruthy();
    rerender(<RuleStateBadge presence="value" support="unsupported" meter={meter} />);
    expect(screen.getByText("Not tracked")).toBeTruthy();
    rerender(<RuleStateBadge presence="value" support="manual_only" meter={meter} />);
    expect(screen.getByText("Manual check")).toBeTruthy();
    rerender(<RuleStateBadge presence="explicit_none" support="supported" />);
    expect(screen.getByText("None")).toBeTruthy();
    rerender(<RuleStateBadge presence="disabled" support="supported" />);
    expect(screen.getByText("Off")).toBeTruthy();
    rerender(<RuleStateBadge presence="value" support="supported" meter={meter} />);
    expect(screen.getByRole("meter", { name: "Daily loss" })).toBeTruthy();
  });
  it("hides not-applicable rules except in detail", () => {
    const { container, rerender } = render(<RuleStateBadge presence="not_applicable" support="supported" />);
    expect(container.textContent).toBe("");
    rerender(<RuleStateBadge presence="not_applicable" support="supported" context="detail" />);
    expect(screen.getByText("Not applicable")).toBeTruthy();
  });
  it("draws a mini meter with the same thresholds", () => {
    render(<MiniMeter label="Drawdown used" used="2200" limit="3000" />);
    const meter = screen.getByRole("meter", { name: "Drawdown used" });
    expect(meter.getAttribute("aria-valuenow")).toBe("73");
    expect(screen.getByText("$800 left").closest(".ds-mini")?.className).toContain("ds-mini-warn");
  });
  it("names the rulebook and its verification", () => {
    render(<RulebookLine name="Apex 100K" version={3} verification="needs_review" />);
    expect(screen.getByText("Rulebook Apex 100K · v3")).toBeTruthy();
    expect(screen.getByText("Needs review")).toBeTruthy();
  });
});

describe("ChartPanel", () => {
  it("renders the chart only with data and keeps the title in every state", () => {
    const draw = vi.fn(() => <svg role="img" aria-label="Balance chart" />);
    const { rerender } = render(<ChartPanel title="Balance" state={{ status: "loading" }}>{draw}</ChartPanel>);
    expect(screen.getByRole("region", { name: "Balance" })).toBeTruthy();
    expect(screen.getByText("Loading balance")).toBeTruthy();
    expect(draw).not.toHaveBeenCalled();
    rerender(<ChartPanel title="Balance" state={{ status: "empty", kind: "no-records" }} empty={{ "no-records": <EmptyState kind="no-records" title="No trades in this range" /> }}>{draw}</ChartPanel>);
    expect(screen.getByText("No trades in this range")).toBeTruthy();
    rerender(<ChartPanel title="Balance" timeZone="America/New_York" state={{ status: "success", data: [1, 2], asOf: "2026-10-19T20:12:00Z" }}>{draw}</ChartPanel>);
    expect(screen.getByRole("img", { name: "Balance chart" })).toBeTruthy();
    expect(screen.getByText("As of Oct 19, 16:12")).toBeTruthy();
  });
});

describe("currency", () => {
  it("formats money cells, metrics and meters in the account's currency", () => {
    render(
      <>
        <MoneyCell value="-412.5" currency="EUR" />
        <MetricCard label="Net P&L" value={{ kind: "money", amount: "1000", currency: "GBP" }} />
        <MiniMeter label="Drawdown" used="200" limit="1000" currency="EUR" />
      </>,
    );
    expect(screen.getByText("−€412.50")).toBeTruthy();
    expect(screen.getByText("+£1,000.00")).toBeTruthy();
    expect(screen.getByText("€200 / €1,000")).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});
