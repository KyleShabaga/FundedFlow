# Build 12.4 — Shell-visible recovery and error containment

Source: [Build 12 card](https://app.notion.com/p/3fe1bd4b6bde81fcb69ecde4ae7835a5).
Continues the existing uncommitted Build 12 branch. No commit or PR was created.

- One `RuntimeRecoveryNotice` lives in `AppShell`, outside the route's data gate. Recovery remains visible
  on data routes, Settings, developer tools and unknown routes. Status changes use polite checking/recovering/
  ready announcements and assertive unavailable/unsupported-schema announcements, without autofocus stealing
  the user's editing focus.
- Recovery uses existing design tokens, card styling and Button. It distinguishes data-folder, open, backup,
  migration, newer-schema, paused initialization and unanswered-command failures. Guidance keeps journals and
  backups in place, never offers reset/restore/downgrade, and does not claim a timed-out mutation made no changes.
- `RuntimeGate` mounts data content only after ready. After that, a runtime failure retains the mounted tree
  and its local draft state. A disabled fieldset and inert subtree prevent data interactions; the notice labels
  previous content unavailable/out of date. Successful retry re-enables the same tree. Navigation does not
  automatically discard a draft because of runtime state changes; ordinary route changes may still unmount it.
- The shared provider rechecks a ready runtime when the window regains focus, using the same finite/deduplicated
  read-only check. It does not start another continuous polling loop or initialize automatically after failure.
  Build 14 feature queries must still use `state.kind === "ready"` for their enabled condition; the gate alone
  does not intercept arbitrary future effects or programmatic mutations.
- Retry is keyboard accessible, invokes actual initialization through the existing adapter, and restores focus
  to main content after success or Retry after failure when the user has not moved elsewhere. Button exposes
  its React 19 DOM ref for this focus behavior.
- Root render errors focus a useful fallback heading. Return to app and Open Settings remount at safe routes
  and check runtime status again. They do not display raw exception details or mutate journal files.

`src/app/RuntimeRecovery.test.tsx` proves draft/node retention, inert/disabled actions, route preservation,
post-ready loss on window focus, recovering-to-ready, keyboard-only Retry and focus, safe Settings/unknown-route
access, unsupported-schema guidance, valid empty-account versus runtime/query failure, and keyboard escape
from the root error fallback. The account-query consumer is a test-only harness; no production feature query
or hook was added. Existing gate/provider/route/error-boundary tests continue to pass.

Final checks, browser evidence, native limitations and the full acceptance reconciliation are recorded in
[Build 12 verification](build-12-verification.md). Runtime loss preserves local draft state; a render error,
app restart, route change or window close can still discard an unsaved draft. No persistence promise was added.
