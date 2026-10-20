import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { HashRouter } from "react-router-dom";

import { RootErrorBoundary } from "./RootErrorBoundary";
import { RuntimeProvider } from "./RuntimeProvider";

/** One composition point; routes must not install their own application providers. */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  }));

  return (
    <RootErrorBoundary>
      <HashRouter>
        <QueryClientProvider client={queryClient}>
          <RuntimeProvider>{children}</RuntimeProvider>
        </QueryClientProvider>
      </HashRouter>
    </RootErrorBoundary>
  );
}
