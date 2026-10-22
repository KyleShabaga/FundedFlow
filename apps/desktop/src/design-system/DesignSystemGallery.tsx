// A live reference of every design-system component with example data, for
// building screens. Nothing here reads or writes the journal database.

import type { Trade } from "@fundedflow/domain";
import { Plus } from "lucide-react";
import { useState } from "react";

import {
  AccountCard,
  AppFrame,
  ContentFrame,
  Badge,
  BrandLogo,
  BrandMark,
  Button,
  DayCard,
  EquityCurve,
  Pnl,
  PnlBars,
  PnlCalendar,
  RuleMeter,
  StatTile,
  TabPanel,
  Tabs,
  ToastProvider,
  TradeTable,
  WinGauge,
} from ".";
import { AccountOverviewSection, AsyncSection, DataSection, DocumentsSection, FeedbackSection, FormsSection, OverlaysSection, Section } from "./GallerySections";
import "./gallery.css";

type Theme = "system" | "dark" | "light";

function exampleTrade(over: Partial<Trade> & Pick<Trade, "id" | "symbol" | "side" | "realizedPnl">): Trade {
  return {
    accountId: "example",
    source: "csv_import",
    importBatchId: null,
    brokerTradeId: null,
    quantity: "1",
    entryAt: "2026-10-19T13:31:00.000Z",
    entryPrice: "21412.25",
    exitAt: "2026-10-19T13:44:00.000Z",
    exitPrice: "21448.5",
    fees: "1.24",
    tradingDay: "2026-10-19",
    reportedPnl: null,
    grossPnl: over.realizedPnl,
    pnlStatus: "calculated",
    notes: null,
    roundTrip: null,
    createdAt: "2026-10-19T14:00:00.000Z",
    updatedAt: "2026-10-19T14:00:00.000Z",
    ...over,
  };
}

const TRADES: Trade[] = [
  exampleTrade({ id: "t1", symbol: "MNQZ6", side: "long", quantity: "2", realizedPnl: "143.76" }),
  exampleTrade({ id: "t2", symbol: "MESZ6", side: "short", entryAt: "2026-10-19T14:05:00.000Z", entryPrice: "6018", exitPrice: "6022.25", quantity: "3", realizedPnl: "-67.47" }),
  exampleTrade({ id: "t3", symbol: "MNQZ6", side: "long", entryAt: "2026-10-19T15:10:00.000Z", entryPrice: "21500", exitPrice: "21500", realizedPnl: "-1.24" }),
  exampleTrade({ id: "t4", symbol: "MCLX6", side: "long", entryAt: "2026-10-19T16:02:00.000Z", entryPrice: "71.42", exitAt: null, exitPrice: null, fees: "0", grossPnl: null, realizedPnl: null, pnlStatus: "open" }),
];

const DAYS = {
  "2026-10-01": { pnl: "-122.85", trades: 3 },
  "2026-10-02": { pnl: "156.62", trades: 2 },
  "2026-10-05": { pnl: "-46.81", trades: 1 },
  "2026-10-06": { pnl: "66.49", trades: 1 },
  "2026-10-08": { pnl: "-16.84", trades: 1 },
  "2026-10-09": { pnl: "40.48", trades: 1 },
  "2026-10-12": { pnl: "147.26", trades: 1 },
  "2026-10-13": { pnl: "171.38", trades: 1 },
  "2026-10-15": { pnl: "562.1", trades: 3 },
  "2026-10-16": { pnl: "1240", trades: 4 },
  "2026-10-19": { pnl: "75.05", trades: 4 },
};

const BALANCE = ["100000", "100250", "99800", "100120", "101400", "101100", "102300", "102050", "103400", "103900", "103300", "104800", "105300", "105100"];
const FLOOR = ["97000", "97250", "97250", "97250", "98400", "98400", "99300", "99300", "100000", "100000", "100000", "100000", "100000", "100000"];

export function DesignSystemGallery() {
  const [theme, setTheme] = useState<Theme>("system");
  const [day, setDay] = useState("2026-10-19");
  const [week, setWeek] = useState<number | null>(null);
  const [bar, setBar] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <ToastProvider>
      <div className="ds-surface dsg" data-theme={theme === "system" ? undefined : theme}>
        <header className="dsg-head">
          <div>
            <h1 className="dsg-title">FundedFlow design system</h1>
            <p className="ds-faint">Every component with example data. Nothing on this page touches your journal.</p>
          </div>
          <Tabs
            label="Theme"
            value={theme}
            onValueChange={(v) => setTheme(v as Theme)}
            items={[
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
          />
        </header>

        <Section title="Application frame" note="Host-independent 248 px sidebar and 72 px icon rail. The desktop host supplies routing and runtime state; sidebarEdge holds a control inside the sidebar header, top-right (the collapse toggle).">
          <div className="dsg-frame-preview">
            <AppFrame collapsed={false} sidebar={<p>Navigation slot</p>} sidebarEdge={<span className="dsg-edge-dot" aria-hidden="true" />} header={<h3>Header slot</h3>}>
              <p>Route content slot</p>
            </AppFrame>
          </div>
        </Section>
        <Section title="Content frame" note="ContentFrame (P0-D29): the page header and the page body each wrap their content in one, so they share left and right edges. Centred in the main column beside the sidebar; grows to --frame-max (1600 px) and stops. Gutters: space-8, then space-6 below 880 px and space-4 below 640 px of main column. Inner caps for text and forms stay with the content.">
          <div className="dsg-frame-demo">
            <ContentFrame className="dsg-frame-demo-row"><strong>Page title</strong><span>Header action</span></ContentFrame>
            <ContentFrame><p>Body content starts and ends on the same edges as the header.</p></ContentFrame>
          </div>
        </Section>
        <Section title="Brand mark and logo" note="BrandLogo: the mark beside &quot;Funded&quot; in ink and &quot;Flow&quot; in flow blue; showName={false} for the icon rail. The mark is decorative and takes its gradient from the brand-mark tokens, so it follows the theme. Files for other uses are in docs/brand.">
          <div className="dsg-row">
            <BrandLogo />
            <BrandLogo showName={false} />
            <BrandMark size={20} />
            <BrandMark size={64} />
          </div>
        </Section>
        <Section title="Button and Badge" note="One primary action per view. Badges label outcome, side, phase, setup and mistakes.">
          <div className="dsg-row">
            <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />}>
              Add trade
            </Button>
            <Button>Import CSV</Button>
            <Button variant="ghost">Find insights</Button>
            <Button variant="danger">Delete account</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="dsg-row">
            <Badge tone="profit">Win</Badge>
            <Badge tone="loss">Loss</Badge>
            <Badge>BE</Badge>
            <Badge tone="warn">Open</Badge>
            <Badge tone="profit" variant="outline">Long</Badge>
            <Badge tone="loss" variant="outline">Short</Badge>
            <Badge tone="flow">Evaluation</Badge>
            <Badge tone="profit">Funded</Badge>
            <Badge tone="loss">Breached</Badge>
          </div>
        </Section>

        <Section title="Pnl and StatTile" note="Money is decimal text from Rust. Always signed; null shows a dash, never $0.00.">
          <div className="dsg-grid-4">
            <StatTile label="Net P&L" aside="36 trades" value={<Pnl value="1792.68" size="xl" />} sub="+7.62% on $25,000" />
            <StatTile label="Win rate" value="61.1%" sub="22 W · 14 L">
              <WinGauge wins={22} losses={14} width={104} />
            </StatTile>
            <StatTile label="Profit factor" value="2.38" tone="profit" sub="Avg win $140.70 / loss $93.05" />
            <StatTile label="Unknown P&L" value={<Pnl value={null} />} sub="Missing instrument" />
          </div>
        </Section>

        <Section title="RuleMeter and AccountCard" note="Amber from 70% of a limit, red at 100%. Rules are examples until the rulebook lands (Build 9.5).">
          <div className="dsg-grid-2">
            <AccountCard
              firm="Apex"
              sizeLabel="$100K"
              name="PA-48213 · Example"
              phase="Evaluation"
              balance="105100"
              startingBalance="100000"
              rules={[
                { kind: "target", label: "Profit target", used: "5100", limit: "6000" },
                { label: "Trailing drawdown", used: "2200", limit: "3000", note: "Floor $100,000" },
                { kind: "count", label: "Minimum trading days", used: 6, limit: 7, unit: "day" },
              ]}
              footer={
                <>
                  <span>14 trades · 6 days</span>
                  <span>Example data</span>
                </>
              }
            />
            <AccountCard
              firm="Topstep"
              sizeLabel="$50K"
              name="Combine · Example"
              phase="Breached"
              phaseTone="loss"
              breached
              balance="47910"
              startingBalance="50000"
              rules={[
                { label: "Daily loss limit", used: "1000", limit: "1000", note: "Today" },
                { label: "Max loss", used: "2090", limit: "2000" },
              ]}
            />
          </div>
          <div className="ds-card dsg-stack">
            <RuleMeter label="Daily loss limit (ok)" used="1120" limit="5000" />
            <RuleMeter label="Daily loss limit (warn)" used="3600" limit="5000" />
          </div>
        </Section>

        <Section title="EquityCurve" note="Steps per trade, trailing drawdown floor and profit target drawn on the balance.">
          <div className="ds-card">
            <EquityCurve points={BALANCE} floor={FLOOR} target="106000" label="Example balance with drawdown floor and target" />
          </div>
        </Section>

        <Section title="PnlCalendar and DayCard" note="Trading days run Monday to Friday; weekend activity rolls to Monday.">
          <div className="dsg-cal">
            <PnlCalendar year={2026} month={10} days={DAYS} today="2026-10-19" onSelectDay={setDay} />
            <div className="dsg-stack">
              {["2026-10-19", "2026-10-16", "2026-10-15"].map((d) => (
                <DayCard
                  key={d}
                  day={d}
                  trades={DAYS[d as keyof typeof DAYS].trades}
                  pnl={DAYS[d as keyof typeof DAYS].pnl}
                  winRate={d === "2026-10-19" ? 33 : 100}
                  spark={d === "2026-10-19" ? ["0", "143.76", "76.29", "75.05"] : ["0", "210", "180", DAYS[d as keyof typeof DAYS].pnl]}
                  active={day === d}
                  onClick={() => setDay(d)}
                />
              ))}
            </div>
          </div>
        </Section>

        <Section title="Selectable PnlCalendar and PnlBars (Build 23)" note="Selected day and week are ringed and pressed; a day with an unknown P&L shows a dash without a tint. Every bar is a labelled row with its exact amount, so the chart reads as text.">
          <div className="dsg-cal">
            <PnlCalendar year={2026} month={10} days={{ ...DAYS, "2026-10-14": { pnl: null, trades: 2 } }} today="2026-10-19" display="pnl"
              onSelectDay={setDay} selectedDay={day} onSelectWeek={(_, w) => setWeek(w)} selectedWeek={week} />
            <div className="ds-card">
              <PnlBars label="Example net P&L by weekday" selectedKey={bar} onSelect={setBar} items={[
                { key: "1", label: "Monday", value: "921.87", detail: "12 trades" }, { key: "2", label: "Tuesday", value: "214.5", detail: "9 trades" },
                { key: "3", label: "Wednesday", value: "-388.2", detail: "11 trades" }, { key: "4", label: "Thursday", value: null, detail: "1 trade with unknown P&L" },
                { key: "5", label: "Friday", value: "-1282", detail: "14 trades" },
              ]} />
            </div>
          </div>
        </Section>

        <Section title="Tabs and TradeTable" note="TradeTable takes Trade objects exactly as list_trades returns them.">
          <Tabs label="Day views" defaultValue="trades" items={[{ value: "overview", label: "Overview" }, { value: "notes", label: "Notes" }, { value: "trades", label: "Trades", count: TRADES.length }]}>
            <TabPanel value="overview">
              <p className="ds-faint">Day stats and intraday P&amp;L go here.</p>
            </TabPanel>
            <TabPanel value="notes">
              <p className="ds-faint">Pre-market plan and post-session review go here.</p>
            </TabPanel>
            <TabPanel value="trades">
              <TradeTable label="Example trades" trades={TRADES} timeZone="America/New_York" selectedId={selected} onRowClick={(t) => setSelected(t.id)} />
            </TabPanel>
          </Tabs>
        </Section>

        <FormsSection />
        <OverlaysSection />
        <FeedbackSection />
        <AsyncSection />
        <DataSection />
        <AccountOverviewSection />
        <DocumentsSection />
      </div>
    </ToastProvider>
  );
}
