"""The Research sources tab: comparison publishers (third-party directory sites), kept apart from firms.

The tab manages publishers through the same registry functions as `collector directory ...`. It can install the
four presets (always disabled), record terms reviews per host, enable or disable a publisher, edit its scope and
preview its planned requests. Nothing here can loosen robots.txt, terms, pacing or the circuit breaker.
"""

from __future__ import annotations

from tkinter import ttk
from typing import TYPE_CHECKING

from fundedflow_collector.db import registry
from fundedflow_collector.db.registry import RegistryError
from fundedflow_collector.directory import presets, review
from fundedflow_collector.directory.adapters import ADAPTERS, get_adapter
from fundedflow_collector.gui.widgets import (
    PAD,
    Column,
    Field,
    FormDialog,
    fill_tree,
    outer,
    readonly_text,
    scrolled_tree,
    selected_id,
    set_text,
    short_time,
)
from fundedflow_collector.outcomes import HostRole, SourceKind, TermsDecision
from fundedflow_collector.policy import circuit
from fundedflow_collector.policy.terms import review_expires, terms_block_reason

if TYPE_CHECKING:
    from fundedflow_collector.gui.app import CollectorApp

STATE_TAGS = {
    "collected": None,
    "unchanged": None,
    "not_reviewed": "warn",
    "disabled": "muted",
    "manual_capture": "muted",
    "disabled_by_terms": "warn",
    "robots_blocked": "warn",
    "rate_limited": "warn",
    "permissions_blocked": "fail",
    "structure_changed": "fail",
    "js_unavailable": "warn",
    "no_records": "muted",
    "never_collected": "muted",
}


class ResearchTab:
    def __init__(self, app: CollectorApp, notebook: ttk.Notebook) -> None:
        self.app = app
        tab = ttk.Frame(notebook, padding=PAD * 2)
        notebook.add(tab, text="Research sources")
        ttk.Label(
            tab,
            text="Comparison publishers are third-party directory sites, not prop firms. What they show is an "
            "unverified claim until you check it against the firm's own documents. Presets start disabled.",
            style="Muted.TLabel",
            wraplength=1100,
        ).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, PAD))

        left = ttk.Frame(tab)
        left.grid(row=1, column=0, rowspan=3, sticky="nsew", padx=(0, PAD * 2))
        ttk.Label(left, text="Publishers", style="Title.TLabel").pack(anchor="w")
        self.publishers = scrolled_tree(
            left,
            [
                Column("key", "Key", 140),
                Column("state", "State", 150, stretch=True),
                Column("enabled", "Enabled", 55),
                Column("checked", "Last checked", 115),
                Column("changed", "Last change", 115),
                Column("values", "Values", 50),
            ],
            height=12,
            sortable=True,
        )
        outer(self.publishers).pack(fill="both", expand=True, pady=PAD)
        self.publishers.bind("<<TreeviewSelect>>", lambda _e: self.refresh_detail())
        row = ttk.Frame(left)
        row.pack(fill="x")
        ttk.Button(row, text="Add preset…", command=self.dialog_preset).pack(side="left")
        ttk.Button(row, text="Add publisher…", command=self.dialog_add).pack(side="left", padx=PAD)
        ttk.Button(row, text="Edit settings…", command=self.dialog_edit).pack(side="left")
        row2 = ttk.Frame(left)
        row2.pack(fill="x", pady=(PAD, 0))
        ttk.Button(row2, text="Enable / disable", command=self.dialog_toggle).pack(side="left")
        ttk.Button(row2, text="Preview requests", command=lambda: app.guard(self.preview)).pack(side="left", padx=PAD)
        ttk.Button(row2, text="Show evidence", command=self.show_evidence).pack(side="left")

        ttk.Label(tab, text="Policy review and state", style="Title.TLabel").grid(row=1, column=1, sticky="w")
        self.policy = readonly_text(tab, height=9)
        outer(self.policy).grid(row=2, column=1, sticky="nsew", pady=(PAD, PAD))

        lower = ttk.Frame(tab)
        lower.grid(row=3, column=1, sticky="nsew")
        ttk.Label(lower, text="Hosts and terms reviews", style="Title.TLabel").pack(anchor="w")
        self.hosts = scrolled_tree(
            lower,
            [
                Column("host", "Host", 170, stretch=True),
                Column("terms", "Terms", 150),
                Column("expires", "Review expires", 100),
                Column("circuit", "Circuit", 150),
                Column("live", "Live fetch", 140),
            ],
            height=3,
        )
        outer(self.hosts).pack(fill="x", pady=PAD)
        row = ttk.Frame(lower)
        row.pack(fill="x")
        ttk.Button(row, text="Add host…", command=self.dialog_host).pack(side="left")
        ttk.Button(row, text="Record terms review…", command=self.dialog_terms).pack(side="left", padx=PAD)
        ttk.Button(row, text="Re-enable stopped host…", command=self.dialog_reenable).pack(side="left")
        ttk.Label(lower, text="Pages", style="Title.TLabel").pack(anchor="w", pady=(PAD * 2, 0))
        self.pages = scrolled_tree(
            lower,
            [
                Column("url", "URL", 300, stretch=True),
                Column("via", "Found via", 65),
                Column("state", "State", 190),
                Column("enabled", "Enabled", 55),
                Column("attempt", "Last attempt", 115),
            ],
            height=7,
            sortable=True,
        )
        outer(self.pages).pack(fill="both", expand=True, pady=PAD)
        row = ttk.Frame(lower)
        row.pack(fill="x")
        ttk.Button(row, text="Add seed page…", command=self.dialog_seed).pack(side="left")
        ttk.Button(row, text="Enable / disable page", command=lambda: app.guard(self.toggle_page)).pack(
            side="left", padx=PAD
        )
        tab.columnconfigure(0, weight=2)
        tab.columnconfigure(1, weight=3)
        tab.rowconfigure(3, weight=1)

    # ------------------------------------------------------------------ data

    def refresh(self) -> None:
        conn, now = self.app.conn, self.app.clock.now()
        rows = []
        for publisher in registry.list_publishers(conn):
            status = review.publisher_status(conn, publisher, now)
            rows.append(
                (
                    publisher.publisher_key,
                    (
                        publisher.publisher_key,
                        status.label,
                        "yes" if publisher.enabled else "no",
                        short_time(status.last_checked),
                        short_time(status.last_change),
                        status.current_observations,
                    ),
                    STATE_TAGS.get(status.state),
                )
            )
        fill_tree(self.publishers, rows)
        if not self.publishers.selection() and rows:
            self.publishers.selection_set(rows[0][0])
        self.refresh_detail()

    def selected(self) -> registry.Publisher | None:
        key = selected_id(self.publishers)
        return registry.get_publisher(self.app.conn, key) if key else None

    def need(self) -> registry.Publisher:
        publisher = self.selected()
        if publisher is None:
            raise RegistryError("select a publisher first (or add a preset)")
        return publisher

    def refresh_detail(self) -> None:
        publisher = self.selected()
        if publisher is None:
            set_text(
                self.policy,
                "No publishers yet. Click 'Add preset…' to add one of the four comparison sites. It is added "
                "disabled; read its terms, record your review for each host, then enable it.",
            )
            fill_tree(self.hosts, [])
            fill_tree(self.pages, [])
            return
        conn, now = self.app.conn, self.app.clock.now()
        status = review.publisher_status(conn, publisher, now)
        adapter = get_adapter(publisher.adapter)
        lines = [
            f"{publisher.display_name} ({publisher.publisher_key}): third-party comparison publisher",
            f"State        {status.label}{' - ' + status.detail if status.detail else ''}",
            f"Capture      {publisher.capture_mode}"
            + ("  (never fetched; import saved pages on Manual capture)" if publisher.capture_mode != "auto" else ""),
            f"Enabled      {'yes' if publisher.enabled else 'no: ' + str(publisher.disabled_reason)}",
            f"Adapter      {adapter.name} {adapter.version} - {adapter.description}",
            f"Allowed      {', '.join(publisher.allowed_paths) or '(pages the adapter reads)'}",
            f"Excluded     {', '.join(publisher.excluded_paths) or '-'}",
            f"Limits       {publisher.max_fetches or 'default'} requests per run, link depth "
            f"{publisher.max_depth if publisher.max_depth is not None else 'default'}",
        ]
        review_record = publisher.policy_review
        if review_record:
            lines.append("")
            lines.append(
                f"Policy review recorded {review_record.get('reviewed_on', '-')} (information, not a decision):"
            )
            for key in ("robots", "terms", "data_api", "summary", "page_notes"):
                if review_record.get(key):
                    lines.append(f"  {key.replace('_', ' ')}: {review_record[key]}")
            for key in ("robots_url", "terms_url"):
                if review_record.get(key):
                    lines.append(f"  {key.replace('_', ' ')}: {review_record[key]}")
        if publisher.notes:
            lines += ["", f"Notes: {publisher.notes}"]
        set_text(self.policy, "\n".join(lines))
        host_rows = []
        for host in registry.list_hosts(conn, publisher.id):
            state = circuit.current(conn, host.host, now, persist=False)
            terms = host.terms_decision.value if host.terms_decision else "not reviewed"
            if host.terms_decision is TermsDecision.UNCLEAR:
                terms += " (acknowledged)" if host.unclear_terms_accepted_at else " (not acknowledged)"
            expires = review_expires(host)
            blocked = terms_block_reason(host, now)
            live = "manual capture only" if publisher.capture_mode != "auto" or blocked else "allowed"
            tag = "fail" if state.open else ("warn" if blocked else None)
            host_rows.append(
                (
                    host.host,
                    (host.host, terms, f"{expires:%Y-%m-%d}" if expires else "", state.state.value, live),
                    tag,
                )
            )
        fill_tree(self.hosts, host_rows)
        page_rows = []
        for source in registry.list_sources(conn, publisher.id):
            latest = conn.execute(
                "SELECT status FROM directory_extractions WHERE snapshot_id = ? ORDER BY extracted_at DESC LIMIT 1",
                (source.latest_snapshot_id,),
            ).fetchone()
            state_key = review.page_state(source.last_outcome, latest["status"] if latest else None)
            page_rows.append(
                (
                    source.id,
                    (
                        source.canonical_url,
                        source.source_channel.value,
                        review.STATE_LABELS[state_key],
                        "yes" if source.enabled else "no",
                        short_time(source.last_attempt_at),
                    ),
                    STATE_TAGS.get(state_key) if source.enabled else "muted",
                )
            )
        fill_tree(self.pages, page_rows)

    # ------------------------------------------------------------------ actions (what the tests call)

    def install_preset(self, key: str) -> registry.Publisher:
        publisher = presets.install_preset(self.app.conn, key, self.app.clock.now())
        self.app.refresh_all()
        self.publishers.selection_set(publisher.publisher_key)
        self.app.status.set(
            f"Added {publisher.display_name} (disabled). Read its terms and record a review for each host first."
        )
        return publisher

    def add_publisher(
        self, key: str, name: str, homepage: str, adapter: str, manual_only: bool, notes: str = ""
    ) -> None:
        publisher = registry.add_publisher(
            self.app.conn,
            publisher_key=key.strip(),
            display_name=name,
            homepage_url=homepage,
            adapter=adapter,
            now=self.app.clock.now(),
            capture_mode="manual_only" if manual_only else "auto",
            excluded_paths=list(presets.COMMON_EXCLUDES),
            notes=notes or None,
        )
        self.app.refresh_all()
        self.publishers.selection_set(publisher.publisher_key)
        self.app.status.set(f"Added {publisher.publisher_key} (disabled). Next: add its host.")

    def update_settings(
        self,
        *,
        allowed: str | None = None,
        excluded: str | None = None,
        max_fetches: str = "",
        max_depth: str = "",
        notes: str | None = None,
        mode: str | None = None,
    ) -> None:
        publisher = self.need()

        def split(text: str | None) -> list[str] | None:
            return None if text is None else [p.strip() for p in text.split(",") if p.strip()]

        registry.update_publisher(
            self.app.conn,
            publisher,
            now=self.app.clock.now(),
            allowed_paths=split(allowed),
            excluded_paths=split(excluded),
            max_fetches=_int(max_fetches, "max requests"),
            max_depth=_int(max_depth, "link depth"),
            notes=notes,
            capture_mode=mode,
        )
        self.app.refresh_all()

    def set_enabled(self, enabled: bool, reason: str = "") -> None:
        publisher = registry.set_publisher_enabled(
            self.app.conn, self.need(), enabled, reason or None, self.app.clock.now()
        )
        self.app.refresh_all()
        self.app.status.set(f"{publisher.publisher_key} {'enabled' if enabled else 'disabled'}.")

    def add_host(self, host: str) -> None:
        record = registry.add_host(self.app.conn, self.need(), host, HostRole.HOMEPAGE, self.app.clock.now())
        self.refresh_detail()
        self.app.status.set(f"Authorised {record.host}. Next: read its terms and record your review.")

    def record_terms(
        self,
        host: str,
        decision: str,
        terms_url: str,
        notes: str = "",
        min_delay: str = "",
        accept_unclear: bool = False,
    ) -> str:
        publisher = self.need()
        record = registry.record_terms(
            self.app.conn,
            publisher,
            registry.require_host(self.app.conn, publisher, host),
            decision=TermsDecision(decision),
            terms_url=terms_url,
            now=self.app.clock.now(),
            notes=notes or None,
            min_delay_seconds=float(min_delay) if min_delay.strip() else None,
            accept_unclear=accept_unclear,
        )
        reason = terms_block_reason(record, self.app.clock.now())
        self.app.refresh_all()
        return "Live fetching: allowed." if reason is None else f"Live fetching: not allowed ({reason})."

    def add_seed(self, url: str, label: str = "") -> None:
        source = registry.add_source(
            self.app.conn, self.need(), url=url, kind=SourceKind.PAGE, now=self.app.clock.now(), label=label or None
        )
        self.refresh_detail()
        self.app.status.set(f"Added {source.canonical_url}.")

    def toggle_page(self) -> None:
        source_id = selected_id(self.pages)
        if source_id is None:
            raise RegistryError("select a page first")
        source = registry.require_source(self.app.conn, source_id)
        registry.update_source(self.app.conn, source, now=self.app.clock.now(), enabled=not source.enabled)
        self.refresh_detail()

    def preview(self) -> None:
        publisher = self.need()
        self.app.select_publishers_for_fetch([publisher.publisher_key])
        self.app.dry_run.set(True)
        self.app.select_tab("Fetch")
        self.app.start_fetch()

    def show_evidence(self) -> None:
        publisher = self.selected()
        self.app.select_tab("Evidence")
        if publisher is not None:
            self.app.evidence.set_filters(publisher=publisher.publisher_key)

    # ------------------------------------------------------------------ dialogs

    def dialog_preset(self) -> None:
        missing = [k for k in presets.PRESETS if registry.get_publisher(self.app.conn, k) is None]
        if not missing:
            self.app.notify("info", "All presets added", "Every preset publisher is already in the list.")
            return
        values = FormDialog(
            self.app.root,
            "Add a preset publisher",
            [Field("key", "Preset", "combo", missing, missing[0])],
            intro="Presets: "
            + "; ".join(f"{p.display_name} - {p.summary()}" for p in presets.PRESETS.values() if p.key in missing),
        ).show()
        if values:
            self.app.guard(lambda: _discard(self.install_preset(str(values["key"]))))

    def dialog_add(self) -> None:
        values = FormDialog(
            self.app.root,
            "Add a publisher",
            [
                Field("key", "Key", hint="Short id: lowercase letters, digits and hyphens."),
                Field("name", "Name"),
                Field("homepage", "Homepage URL", default="https://"),
                Field(
                    "adapter",
                    "Adapter",
                    "combo",
                    sorted(ADAPTERS),
                    "generic",
                    hint="'generic' keeps page snapshots only; site adapters read tables into values.",
                ),
                Field("manual", "Manual capture only (never fetch)", "check", default=False),
                Field("notes", "Notes"),
            ],
            intro="Only add a publisher whose site you are allowed to read. It is added disabled.",
        ).show()
        if values:
            self.app.guard(
                lambda: self.add_publisher(
                    str(values["key"]),
                    str(values["name"]),
                    str(values["homepage"]),
                    str(values["adapter"]),
                    bool(values["manual"]),
                    str(values["notes"]),
                )
            )

    def dialog_edit(self) -> None:
        publisher = self.selected()
        if publisher is None:
            self.app.notify("warning", "No publisher selected", "Select a publisher first.")
            return
        values = FormDialog(
            self.app.root,
            f"Settings for {publisher.publisher_key}",
            [
                Field("allowed", "Allowed paths", default=", ".join(publisher.allowed_paths), width=70),
                Field("excluded", "Excluded paths", default=", ".join(publisher.excluded_paths), width=70),
                Field("max_fetches", "Max requests per run", default=str(publisher.max_fetches or "")),
                Field(
                    "max_depth",
                    "Link depth",
                    default=str(publisher.max_depth if publisher.max_depth is not None else ""),
                ),
                Field("mode", "Capture mode", "combo", ["auto", "manual_only"], publisher.capture_mode),
                Field("notes", "Notes", default=publisher.notes or "", width=70),
            ],
            intro="Narrowing scope is always safe. Widening it does not bypass robots.txt, terms or pacing.",
        ).show()
        if values:
            self.app.guard(
                lambda: self.update_settings(
                    allowed=str(values["allowed"]),
                    excluded=str(values["excluded"]),
                    max_fetches=str(values["max_fetches"]),
                    max_depth=str(values["max_depth"]),
                    notes=str(values["notes"]),
                    mode=str(values["mode"]),
                )
            )

    def dialog_toggle(self) -> None:
        publisher = self.selected()
        if publisher is None:
            self.app.notify("warning", "No publisher selected", "Select a publisher first.")
            return
        if publisher.enabled:
            values = FormDialog(self.app.root, f"Disable {publisher.publisher_key}", [Field("reason", "Reason")]).show()
            if values:
                self.app.guard(lambda: self.set_enabled(False, str(values["reason"])))
        else:
            self.app.guard(lambda: self.set_enabled(True))

    def dialog_host(self) -> None:
        publisher = self.selected()
        if publisher is None:
            self.app.notify("warning", "No publisher selected", "Select a publisher first.")
            return
        values = FormDialog(
            self.app.root,
            f"Add host to {publisher.publisher_key}",
            [Field("host", "Host", hint="Only the publisher's own site, e.g. www.example-directory.com.")],
            intro="Links from a publisher to firms or affiliate redirects are never followed or authorised here.",
        ).show()
        if values:
            self.app.guard(lambda: self.add_host(str(values["host"])))

    def dialog_terms(self) -> None:
        host = selected_id(self.hosts)
        publisher = self.selected()
        if host is None or publisher is None:
            self.app.notify("warning", "No host selected", "Select a host first.")
            return
        suggested = publisher.policy_review.get("terms_url") or "https://"
        values = FormDialog(
            self.app.root,
            f"Terms review for {host}",
            [
                Field("decision", "Decision", "combo", [d.value for d in TermsDecision], "unclear"),
                Field("terms_url", "Terms page URL", default=str(suggested)),
                Field("notes", "Notes", hint="What the terms say about automated access and reuse."),
                Field("min_delay", "Minimum delay (s)", hint="Optional: a slower pace."),
                Field("accept_unclear", "I accept unclear terms (slow 5 s pace)", "check", default=False),
            ],
            intro="Read the terms yourself today. allowed / allowed_with_limits: live fetching. unclear: only if you "
            "tick the box. prohibited: manual capture only. The preset's review is information, not your decision.",
        ).show()
        if values:

            def action() -> None:
                message = self.record_terms(
                    host,
                    str(values["decision"]),
                    str(values["terms_url"]),
                    str(values["notes"]),
                    str(values["min_delay"]),
                    bool(values["accept_unclear"]),
                )
                self.app.notify("info", "Terms recorded", message)

            self.app.guard(action)

    def dialog_reenable(self) -> None:
        host = selected_id(self.hosts)
        if host is None:
            self.app.notify("warning", "No host selected", "Select a stopped host first.")
            return
        values = FormDialog(
            self.app.root,
            f"Re-enable {host}",
            [Field("reason", "Reason")],
            intro="Only re-enable a host if the publisher agreed or the cause is fixed. Never work around a block.",
        ).show()
        if values:
            self.app.guard(lambda: self.app.reenable_host(host, str(values["reason"])))

    def dialog_seed(self) -> None:
        publisher = self.selected()
        if publisher is None:
            self.app.notify("warning", "No publisher selected", "Select a publisher first.")
            return
        values = FormDialog(
            self.app.root,
            f"Add a seed page to {publisher.publisher_key}",
            [Field("url", "URL", default="https://"), Field("label", "Label")],
            intro="It must be on an authorised host, inside the allowed paths, and a page the adapter reads.",
        ).show()
        if values:
            self.app.guard(lambda: self.add_seed(str(values["url"]), str(values["label"])))


def _int(text: str, what: str) -> int | None:
    text = text.strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError as exc:
        raise RegistryError(f"{what} must be a whole number") from exc


def _discard(_value: object) -> None:
    return None
