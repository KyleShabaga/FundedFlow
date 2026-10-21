// Choosing the CSV for an import, shared by the wizard and Quick Import so a dropped file and a browsed file
// take exactly the same path: one file, read on this computer by readCsvFile, then handed to the page. Reading
// is asynchronous, so every pick gets a version and only the newest pick's result is ever delivered: a slow read
// of an earlier file can't replace the file chosen after it.
import { useCallback, useRef } from "react";

import { readCsvFile, type FileProblem, type LoadedFile } from "../wizard-state";

export function useCsvFileChoice(onResult: (result: LoadedFile | FileProblem) => void) {
  const version = useRef(0);
  const latest = useRef(onResult);
  latest.current = onResult;

  const pick = useCallback(async (files: File[]) => {
    const v = ++version.current;
    if (files.length === 0) return;
    if (files.length > 1) {
      latest.current({ kind: "several", count: files.length });
      return;
    }
    const read = await readCsvFile(files[0]!, v);
    if (v === version.current) latest.current(read);
  }, []);

  const tooMany = useCallback((count: number) => {
    ++version.current;
    latest.current({ kind: "several", count });
  }, []);

  /** Drops any read still in flight (the file was removed or the page is starting over). */
  const cancel = useCallback(() => {
    ++version.current;
  }, []);

  return { pick, tooMany, cancel };
}
