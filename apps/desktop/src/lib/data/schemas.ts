// Runtime schemas for the Rust command payloads (src-tauri/src/store, csv_import).
// The DTO shapes live in @fundedflow/domain (packages/domain/src/contracts) so
// any host can share them; this module keeps the desktop's existing import path.

export * from "@fundedflow/domain";
