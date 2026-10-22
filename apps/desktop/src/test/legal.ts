// TEST ONLY. NA-3 acceptance records for frontend tests. Rendering <App /> reads the record preloaded by
// main.tsx (`primeLegalAcceptance`), so tests prime it before rendering: `acceptedRecord()` for the app as
// existing users see it, `null` for a first launch.
import { currentAcceptance } from "../legal";
import { type LegalAcceptance, primeLegalAcceptance } from "../lib/data/legal";

export const ACCEPTED_AT = "2026-10-21T18:00:00.000Z";

export const acceptedRecord = (documents = currentAcceptance()): LegalAcceptance => ({ documents, acceptedAt: ACCEPTED_AT });

/** Existing tests start past the first-run screen. */
export const primeAccepted = () => primeLegalAcceptance(acceptedRecord());
