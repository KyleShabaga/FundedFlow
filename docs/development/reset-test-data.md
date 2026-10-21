# Reset local data for testing

Task: [Developer reset tool](https://app.notion.com/p/4001bd4b6bde819eb773f32b50deb1c0).

Close every FundedFlow instance first. From the repository root, preview the data directory:

```sh
node scripts/reset-test-data.mjs
```

Reset it:

```sh
node scripts/reset-test-data.mjs --yes
```

Restart FundedFlow. Its existing Rust startup/migration path creates a fresh journal with the normal seeds.
This clears accounts, trades, imports, journal entries, rulebooks/catalogue edits, settings, snapshots and
other persisted records, plus app-data attachments and old migration backups from the active data directory.
The tool introduces no SQL reset logic, migration changes or application UI.

The entire previous directory is **moved to a unique sibling backup**, including the SQLite database,
WAL/SHM files and attachments. The command prints that backup path. To undo a reset, close FundedFlow,
move the new app-data directory aside, and rename the printed backup to the original data-directory path.
Earlier sibling reset backups remain available; the tool does not permanently erase them.

The default directory comes from the Tauri app identifier and OS conventions:

| OS | Default |
| --- | --- |
| Windows | `%APPDATA%\com.fundedflow.desktop` |
| macOS | `~/Library/Application Support/com.fundedflow.desktop` |
| Linux | `$XDG_DATA_HOME/com.fundedflow.desktop`, otherwise `~/.local/share/com.fundedflow.desktop` |

For a disposable test location, specify its app directory explicitly:

```sh
node scripts/reset-test-data.mjs --data-dir /tmp/test-journal/com.fundedflow.desktop
node scripts/reset-test-data.mjs --data-dir /tmp/test-journal/com.fundedflow.desktop --yes
```

Only an app-specific directory named `com.fundedflow.desktop` is accepted. Files and directory symlinks
are refused; missing/empty data is a no-op. Reset checks for a running `fundedflow`/`fundedflow.exe` process
and refuses to continue if one is found or process listing fails. Keep the app closed for the whole reset;
this standalone developer tool does not acquire the running app's database connection or prevent another
instance from being launched concurrently.

This resets local journal/app-data files. Webview caches and browser-local preferences outside that
directory are managed by the platform separately. There is no production reset command or remote deletion.

Tests (Node 22+, no extra dependencies):

```sh
node --test scripts/reset-test-data.test.mjs
```

The tests use temporary app directories only and cover preview, full-bundle backup/reset, missing/empty
states, active-process refusal, symlink/broad-target refusal, OS path selection and CLI argument handling.
