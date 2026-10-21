// Build 26.9: developer-only sidebar actions, directly above Settings. This module is imported only
// behind `import.meta.env.DEV` (AppShell), so production bundles contain none of it; the native
// commands it calls exist only in debug builds.
import { useQuery } from "@tanstack/react-query";
import { DatabasePlus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Tooltip, useToast } from "../../design-system";
import { AddFakeDataDialog } from "./AddFakeDataDialog";
import { devToolKeys, devTools, type ResetReport } from "./api";
import { ResetAllDataDialog } from "./ResetAllDataDialog";
import "./dev-tools.css";

function resetToast(report: ResetReport) {
  switch (report.status) {
    case "completed":
      return { tone: "success" as const, title: "Test journal reset", description: `Previous journal backed up to ${report.backup}. ${report.message}` };
    case "unchanged":
      return { tone: "info" as const, title: "Nothing to reset", description: report.message };
    case "pending":
      return { tone: "warning" as const, title: "Reset did not finish", description: "The reset helper did not report back, so the journal may be unchanged. Check the log beside the test journal, or run npm run reset:test-journal -- --yes with FundedFlow closed." };
    default:
      return { tone: "error" as const, title: "Reset failed", description: report.message };
  }
}

function SidebarAction({ label, icon, collapsed, onClick }: { label: string; icon: ReactNode; collapsed: boolean; onClick: () => void }) {
  const button = (
    <button type="button" className="shell-nav-link dev-sidebar-action" onClick={onClick} aria-label={label} aria-haspopup="dialog">
      {icon}
      <span className={collapsed ? "ds-sr-only" : undefined}>{label}</span>
    </button>
  );
  // Icon-only when collapsed: the tooltip names the action (the button keeps its accessible name).
  return collapsed ? <Tooltip content={label} side="right">{button}</Tooltip> : button;
}

/** Inside the desktop webview (as `isTauri()` in @tauri-apps/api/core checks it). */
const inDesktop = () => Boolean((globalThis as { isTauri?: boolean }).isTauri);

export default function DevSidebarTools({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState<"seed" | "reset" | null>(null);
  // Only inside the desktop webview (the commands do not exist in a plain browser); the dialogs ask again when opened.
  const status = useQuery({ queryKey: devToolKeys.status, queryFn: devTools.status, staleTime: Infinity, enabled: inDesktop() || open !== null });
  const toast = useToast();
  const shown = useRef(false);

  // The outcome of a reset handed off before the last restart: show it once, then clear it.
  const report = status.data?.lastReset;
  useEffect(() => {
    if (!report || shown.current) return;
    shown.current = true;
    toast.show({ ...resetToast(report), durationMs: null });
    void devTools.dismissResetReport().catch(() => { /* shown again next start */ });
  }, [report, toast]);

  return (
    <div role="group" aria-label="Developer tools" className="dev-sidebar-tools">
      <SidebarAction label="Add Fake Data" icon={<DatabasePlus size={20} aria-hidden="true" />} collapsed={collapsed} onClick={() => setOpen("seed")} />
      <SidebarAction label="Reset All Data" icon={<RotateCcw size={20} aria-hidden="true" />} collapsed={collapsed} onClick={() => setOpen("reset")} />
      <AddFakeDataDialog open={open === "seed"} onOpenChange={next => setOpen(next ? "seed" : null)} status={status} />
      <ResetAllDataDialog open={open === "reset"} onOpenChange={next => setOpen(next ? "reset" : null)} status={status} />
    </div>
  );
}
