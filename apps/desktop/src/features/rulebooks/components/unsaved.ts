// Unsaved-edit protection for the draft editor (Build 19). The app uses a HashRouter, which has no
// navigation blocker, so: in-app links are intercepted while the form is dirty (the page asks
// first), closing the window asks through `beforeunload`, and the edits are kept in session storage
// against the revision they started from, so a navigation the page cannot intercept (a header
// button) loses nothing: reopening the draft offers them back. Storage is a per-window convenience:
// every access is guarded and the editor works without it.
import type { DraftForm } from "../view-models/draft-form";

export { useLeaveGuard } from "../../shared/hooks/use-leave-guard";

interface Kept { base: string; keptAt: string; form: DraftForm }
const key = (versionId: string) => `fundedflow.rulebookDraft.${versionId}`;

export function keepEdits(versionId: string, base: string, form: DraftForm) {
  try { sessionStorage.setItem(key(versionId), JSON.stringify({ base, keptAt: new Date().toISOString(), form } satisfies Kept)); } catch { /* Edits stay in the page. */ }
}
export function forgetEdits(versionId: string) {
  try { sessionStorage.removeItem(key(versionId)); } catch { /* Nothing kept. */ }
}
/** Kept edits for the draft, and whether they started from the revision now stored. */
export function keptEdits(versionId: string, currentRevision: string): { form: DraftForm; keptAt: string; sameRevision: boolean } | null {
  try {
    const raw = sessionStorage.getItem(key(versionId));
    if (!raw) return null;
    const kept = JSON.parse(raw) as Kept;
    if (!kept || typeof kept.base !== "string" || !kept.form || !Array.isArray(kept.form.rules)) return null;
    return { form: kept.form, keptAt: kept.keptAt, sameRevision: kept.base === currentRevision };
  } catch {
    return null;
  }
}
