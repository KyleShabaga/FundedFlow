import { lazy, Suspense } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { AppProviders } from "./app/AppProviders";
import { AppShell, NotFound, RoutePlaceholder } from "./app/AppShell";
import { RuntimeGate } from "./components/RuntimeGate";
import { AccountDetailPage } from "./features/accounts/components/AccountDetailPage";
import { AccountsPage } from "./features/accounts/components/AccountsPage";
import "./App.css";

const DeveloperTools = import.meta.env.DEV
  ? lazy(() => import("./app/DeveloperTools"))
  : null;

export default function App() {
  return (
    <AppProviders>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<RuntimeGate showStatus={false}><RoutePlaceholder name="Today" /></RuntimeGate>} />
          <Route path="journal" element={<RuntimeGate showStatus={false}><RoutePlaceholder name="Journal" /></RuntimeGate>} />
          <Route path="insights" element={<RuntimeGate showStatus={false}><RoutePlaceholder name="Insights" /></RuntimeGate>} />
          <Route path="accounts" element={<RuntimeGate showStatus={false}><AccountsPage /></RuntimeGate>} />
          <Route path="accounts/:accountId" element={<RuntimeGate showStatus={false}><AccountDetailPage /></RuntimeGate>} />
          <Route path="settings" element={<>
            <RoutePlaceholder name="Settings" />
            {DeveloperTools && <p><Link to="/settings/developer">Developer tools</Link></p>}
          </>} />
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
