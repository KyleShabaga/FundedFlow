// First-run acceptance state (NA-3). The record lives in a per-install file (src-tauri/src/legal.rs), not in
// the journal, so these queries never wait for the journal runtime, and the data-control reset (restore,
// erase) doesn't touch them: its keys are under featureKeys.root, this one isn't.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { coversCurrent, currentAcceptance } from "../../legal";
import { type LegalAcceptance, legalGateway, peekLegalAcceptance, primeLegalAcceptance } from "../../lib/data/legal";

export const LEGAL_ACCEPTANCE_KEY = ["fundedflow", "legal", "acceptance"] as const;

/** The stored record, or one accepted this session that couldn't be saved (`saved: false`). */
export type KnownAcceptance = LegalAcceptance & { saved: boolean };

export function useLegalAcceptance() {
  const preloaded = peekLegalAcceptance();
  return useQuery<KnownAcceptance | null>({
    queryKey: LEGAL_ACCEPTANCE_KEY,
    queryFn: async () => {
      const record = await legalGateway.read();
      return record && { ...record, saved: true };
    },
    initialData: preloaded === undefined ? undefined : preloaded && { ...preloaded, saved: true },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export const isCurrent = (acceptance: KnownAcceptance | null | undefined) => coversCurrent(acceptance?.documents);

/**
 * Records acceptance of the current documents. If the record can't be saved, the user still continues for
 * this session (`saved: false`) and is asked again next launch: never trapped behind the screen.
 */
export function useAcceptLegal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<KnownAcceptance> => {
      try {
        const record = await legalGateway.record(currentAcceptance());
        primeLegalAcceptance(record);
        return { ...record, saved: true };
      } catch {
        return { documents: currentAcceptance(), acceptedAt: new Date().toISOString(), saved: false };
      }
    },
    onSuccess: acceptance => client.setQueryData(LEGAL_ACCEPTANCE_KEY, acceptance),
  });
}
