# Upgrade fixtures

Synthetic sample journals, each written by a real FundedFlow release with its own code (`db::open_file`
and the store and CSV-import functions). `db/upgrade_tests.rs` copies them before use. Never edit these
files or regenerate them with newer code: their value is that an older build wrote them.

| File | Written by | Schema | Contents |
|---|---|---|---|
| `fundedflow-v3.db` | 4e3c01f (CSV round-trip import, before the Build 8.75 weekend roll) | 3 | Three accounts, including a legacy 06:00 reset; 12 trades, some with Saturday trading days; one Performance import; one tagged journal entry |
| `fundedflow-v4.db` | aeafe1e (Build 8.5) | 4 | The same, plus an archived account; the legacy-reset account is omitted, because this release rejects morning resets |
| `fundedflow-v8-legacy-rules.db` | 31f9d79 (Build 8.75) | 8 | Legacy account-owned rulebooks for the Build 9.5 conversion: six versions (draft, active, retired, a deleted draft; manual, template and copied; two user-confirmed), 18 rules of all eight types (firm and personal, unknown values, manual checks, two position limits in one version), four snapshots (pinned to a retired and an active version, and one with none), a funded account linked to its evaluation account, an archived account with an active rulebook, and an account without rules. See `docs/rulebook-migration.md` |

`generate-legacy-rules.rs.txt` writes the legacy-rules journal. No release has a command for rulebooks, rules or
snapshots (they are reserved tables), so it inserts those rows with SQL through the shipped schema's checks and
triggers. Accounts, the trade and the archive go through the store code.

`generate.rs.txt` is the generator, the v4 variant. The v3 variant swaps the archived account for the legacy
06:00 account. To reproduce, check out the commit, add the file as a `#[cfg(test)]` module in `lib.rs`, and run
`FIXTURE_OUT=<path> cargo test --lib fixture_gen -- --ignored`. IDs and timestamps differ on every run, so the
tests match rows by content, not by ID.
