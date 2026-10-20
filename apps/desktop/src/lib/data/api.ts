// The desktop's journal repository: the JournalRepository port bound to the
// Tauri/SQLite adapter. Components use `repository` and never call `invoke`.

import { invoke } from "@tauri-apps/api/core";

import type { JournalRepository } from "./schemas";
import { createTauriRepository } from "./tauri-repository";

export { RepositoryError as DataError } from "./schemas";

export const repository: JournalRepository = createTauriRepository(invoke);
