// Copyright (c) 2026 Kyle Shabaga
// SPDX-License-Identifier: MIT

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installLeaveGuardHistory } from "./features/shared/hooks/use-leave-guard";
import { preloadLegalAcceptance } from "./lib/data/legal";

// The unsaved-edit guard's popstate listener must be on window before HashRouter adds its own (TASK-022; see
// use-leave-guard.ts): Chromium runs window's popstate listeners in the order they were added.
installLeaveGuardHistory();

// Read the first-run acceptance record before the first render, so app content never shows before the
// agreement screen (NA-3). A slow or failed read is retried by the screen itself.
void preloadLegalAcceptance().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
