// Copyright (c) 2026 Kyle Shabaga
// SPDX-License-Identifier: MIT

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { preloadLegalAcceptance } from "./lib/data/legal";

// Read the first-run acceptance record before the first render, so app content never shows before the
// agreement screen (NA-3). A slow or failed read is retried by the screen itself.
void preloadLegalAcceptance().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
