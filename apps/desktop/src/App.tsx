import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppProviders } from "./app/AppProviders";
import { AppShell, NotFound, RoutePlaceholder } from "./app/AppShell";
import { RuntimeGate } from "./components/RuntimeGate";
import { AccountDetailPage } from "./features/accounts/components/AccountDetailPage";
import { AccountsPage } from "./features/accounts/components/AccountsPage";
import { RulebookPage } from "./features/rulebooks/components/RulebookPage";
import { RulebookVersionPage } from "./features/rulebooks/components/RulebookVersionPage";
import { ImportHistoryPage } from "./features/imports/components/ImportHistoryPage";
import { ImportWizardPage } from "./features/imports/components/ImportWizardPage";
import { JournalPage } from "./features/journal/components/JournalPage";
import { TradeDetailPage } from "./features/journal/components/TradeDetailPage";
import { DailyReviewPage } from "./features/daily-reviews/components/DailyReviewPage";
import { DataControlsPage } from "./features/data-controls/components/DataControlsPage";
import { TodayPage } from "./features/today/components/TodayPage";
import { InsightsPage } from "./features/insights/components/InsightsPage";
import "./App.css";

const DeveloperTools = import.meta.env.DEV
  ? lazy(() => import("./app/DeveloperTools"))
  : null;

export default function App() {
  return (
    <AppProviders>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<RuntimeGate showStatus={false}><TodayPage /></RuntimeGate>} />
          <Route path="journal" element={<RuntimeGate showStatus={false}><JournalPage /></RuntimeGate>} />
          <Route path="journal/trades/:tradeId" element={<RuntimeGate showStatus={false}><TradeDetailPage /></RuntimeGate>} />
          <Route path="journal/days/:tradingDay" element={<RuntimeGate showStatus={false}><DailyReviewPage /></RuntimeGate>} />
          <Route path="insights" element={<RuntimeGate showStatus={false}><InsightsPage /></RuntimeGate>} />
          <Route path="accounts" element={<RuntimeGate showStatus={false}><AccountsPage /></RuntimeGate>} />
          <Route path="accounts/:accountId" element={<RuntimeGate showStatus={false}><AccountDetailPage /></RuntimeGate>} />
          <Route path="accounts/:accountId/rulebook" element={<RuntimeGate showStatus={false}><RulebookPage /></RuntimeGate>} />
          <Route path="accounts/:accountId/rulebook/versions/:versionId" element={<RuntimeGate showStatus={false}><RulebookVersionPage /></RuntimeGate>} />
          <Route path="import" element={<RuntimeGate showStatus={false}><ImportWizardPage /></RuntimeGate>} />
          <Route path="import/history" element={<RuntimeGate showStatus={false}><ImportHistoryPage /></RuntimeGate>} />
          <Route path="settings" element={<DataControlsPage />} />
          {DeveloperTools && (
            <Route path="/settings/developer" element={
              <Suspense fallback={<p role="status">Opening developer tools…</p>}>
                <DeveloperTools />
              </Suspense>
            } />
          )}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AppProviders>
  );
}
