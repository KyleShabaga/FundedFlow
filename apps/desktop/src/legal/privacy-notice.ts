import type { LegalDocument } from "./document";

export const privacyNotice: LegalDocument = {
  "id": "privacy-notice",
  "title": "Privacy notice (draft)",
  "version": "0.2.1-draft",
  "effectiveDate": "2026-10-22",
  "draft": true,
  "summary": "The desktop journal is stored locally without app encryption. The app has no sign-in or telemetry; installer downloads, external services and files you share have separate privacy implications.",
  "sections": [
    {
      "heading": "About this draft",
      "paragraphs": [
        "Prepared 2026-10-22 for the current Windows desktop product maintained by Kyle Shabaga. This complete draft has not been reviewed by a lawyer or approved for release. Its displayed date identifies this revision, not release approval. Release requires factual and packaged verification, passing relevant checks, explicit owner approval of document versions and release scope, and recorded remaining risks. Independent review is optional."
      ]
    },
    {
      "heading": "Local storage and purpose",
      "paragraphs": [
        "FundedFlow stores accounts, trades, imported CSV records, journal and review text, rulebooks, source metadata, screenshots and settings to provide a trading journal and calculations. The journal is SQLite at %APPDATA%\\com.fundedflow.desktop\\fundedflow.db, with attachments beside it. SQLite may also create journal or WAL sidecar files.",
        "The separate legal-acceptance.json records document IDs, versions, digests and acknowledgment time (stored as acceptedAt for compatibility). WebView local storage holds UI preferences; session storage can hold edits you choose to keep for rulebooks and reviews. These stores are separate from journal backups and erasure.",
        "The app does not encrypt the journal, attachments, exports, temporary working files or recovery copies. Filesystem permissions and any Windows or disk encryption you enable provide separate protection. People and software with access to these files may read or copy them. Screenshot content and metadata may contain private information."
      ]
    },
    {
      "heading": "Network and external services",
      "paragraphs": [
        "The packaged desktop application has no hosted user account, journal upload, analytics, telemetry, automatic crash reporting, AI service or update checker. Its production content security policy allows local app communication rather than remote web connections. Fonts and legal documents are bundled. New versions are installed manually.",
        "The Windows installer can download Microsoft Edge WebView2 from Microsoft when needed. WebView2 and Windows are separate software with their own settings and services. This notice does not promise that the operating system or runtime makes no network requests.",
        "Visiting project or source links, downloading releases and posting support requests uses your browser and external services. Those services receive connection information such as IP address and request metadata under their own policies. Saving an export or journal in a cloud-synced folder, or sharing it, can transmit it through services you choose; the app does not perform that sync."
      ]
    },
    {
      "heading": "Retention, backups and temporary copies",
      "paragraphs": [
        "Local data remains until removed. Migration creates pre-upgrade database copies, retaining earlier copies when needed; these do not by themselves back up screenshots. Full .ffj.zip exports include journal data and managed attachments; CSV exports contain trade data and are not full backups.",
        "Restore replaces rather than merges the journal after restart. It keeps a pre-restore safety database and attachment copies under data-controls. Candidate databases, inventories, pending-operation markers and working files support validation and recovery. Exports stage plaintext database, JSON, CSV and attachment data near the selected destination; restore stages data under data-controls-work. Normal cleanup can leave files after interruption or failure. There is no timed automatic expiry promised for recovery copies.",
        "No desktop application log collection or automatic diagnostic submission is configured. Error messages can contain filesystem details. Windows, WebView2 and development tools can retain their own diagnostics; the separate collector writes logs as described below."
      ]
    },
    {
      "heading": "Deletion and uninstall",
      "paragraphs": [
        "Removing or archiving individual records can retain historical or soft-deleted records and attachment bytes. Use Settings data controls for permanent account deletion or whole-journal erasure, and read the preview and completion state.",
        "Account deletion removes the selected trading account and its dependent records and eligible attachments; ownership or linked-data ambiguity can block it. It leaves app-managed recovery copies intact. Whole-journal erasure replaces the active database with an empty journal and targets managed attachments, migration backups and data-controls recovery and working copies. Cleanup may remain pending after a filesystem failure and is retried. Do not treat a pending operation as completed deletion.",
        "These operations leave external exports, original import files, screenshots elsewhere, operating-system backups, cloud copies, the acceptance record and WebView storage untouched. They do not guarantee forensic secure erasure of disk sectors or SQLite remnants. Uninstall is not the journal-erasure control: do not rely on it to remove per-user data, recovery files or exports. After closing the app, inspect the app-data folder, WebView data and locations where you saved copies if you need further removal."
      ]
    },
    {
      "heading": "GitHub and support",
      "paragraphs": [
        "Kyle Shabaga can be contacted through https://github.com/KyleShabaga/FundedFlow/issues. Issues are public: do not post journals, account identifiers, private screenshots, credentials or sensitive trading data. Use a minimal redacted example.",
        "The desktop app does not send your journal to the maintainer. The maintainer can see information you voluntarily post or provide, public GitHub profile and activity associated with it, and download statistics GitHub exposes. This does not mean the maintainer receives every downloader's identity or IP address. GitHub processes service access under its own privacy policy.",
        "Support information may remain in public issue history, notifications, copies or forks without a fixed retention period. Request correction or removal through the same issue route without repeating sensitive data; the maintainer cannot guarantee removal from GitHub systems or other people's copies."
      ]
    },
    {
      "heading": "Separate standalone collector",
      "paragraphs": [
        "The Python prop-firm collector is a separate operator tool, not a desktop background service. It makes HTTP requests and DNS lookups to configured sources and robots policies; optional Playwright rendering contacts authorized hosts and approved asset hosts. Source services receive connection and request information. Installing dependencies or Chromium also uses their download services.",
        "The collector stores captured pages or PDFs, parsed source data, SQLite records, exports and JSON-lines logs in its configured locations without application encryption. Logging attempts to redact secrets in URLs and headers; that is not a guarantee that captured content or logs contain no private data. Its files are not removed by desktop journal erasure or uninstall. Operators must manage their own retention and source permissions."
      ]
    }
  ],
  "digest": "8b83157f3e1075a64fb631e39616c37e5b70cc3c70e54f473c05ec9d0db1c392"
};
