// Quick Import → full wizard. The choices that are still safe to keep (the destination attempt, the file already
// read on this computer, its time zone and any format or date order the trader picked) move to the wizard in
// memory, never through router history, so the CSV text isn't written into session history. Approvals do not
// move: the wizard re-checks the file and asks for every destination confirmation again.
import type { CsvFormatChoice, DateFormatChoice, LoadedFile } from "./wizard-state";

export interface WizardHandoff {
  accountId: string;
  file: LoadedFile;
  timezone: string;
  /** True when the trader chose the zone; otherwise the wizard follows the account's zone. */
  timezoneChosen: boolean;
  format: CsvFormatChoice;
  dateFormat: DateFormatChoice;
  /** Why Quick Import sent the file here, shown once at the top of the wizard. */
  reasons: string[];
}

const pending = new Map<string, WizardHandoff>();
let counter = 0;

/** Keeps the choices until the wizard takes them; returns the token to pass in navigation state. */
export function putHandoff(handoff: WizardHandoff): string {
  pending.clear(); // Only the latest hand-off is ever wanted.
  const token = `handoff-${++counter}`;
  pending.set(token, handoff);
  return token;
}

/** Reads a hand-off without using it up (state initialisers may run twice in development). */
export function peekHandoff(token: string | null | undefined): WizardHandoff | null {
  return token ? pending.get(token) ?? null : null;
}

/** Forgets a hand-off once the wizard holds it, so Back then Forward doesn't bring the file back. */
export function dropHandoff(token: string | null | undefined) {
  if (token) pending.delete(token);
}
