"""The collector's desktop window.

It calls the same functions as the CLI (registry, runner, capture, export, health checks), so every safety rule
applies unchanged and the window adds no settings that could weaken them. Network runs happen on a worker thread
with its own database connection and the same run lock as the CLI; the window only reads.

Build 29.25 adds comparison publishers: the Research sources tab (gui/research.py), the Evidence tab
(gui/evidence.py), publisher selection and per-site counts on Fetch, publisher captures and the directory export.
"""

from __future__ import annotations

import os
import queue
import sqlite3
import sys
import threading
import tkinter as tk
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Any

from fundedflow_collector import __version__, services
from fundedflow_collector.capture import import_capture
from fundedflow_collector.clock import Clock, SystemClock, format_instant
from fundedflow_collector.config import EXAMPLE_CONFIG, ConfigError, Settings, load_settings, update_user_agent
from fundedflow_collector.db import registry, runs, snapshots
from fundedflow_collector.db.connection import DatabaseError, RunLock, open_database
from fundedflow_collector.db.migrate import MigrationError, recover_interrupted_runs
from fundedflow_collector.db.registry import RegistryError
from fundedflow_collector.export.validate import schema_name, validation_errors
from fundedflow_collector.gui.evidence import EvidenceTab
from fundedflow_collector.gui.research import ResearchTab
from fundedflow_collector.gui.widgets import (
    PAD,
    Column,
    Field,
    FormDialog,
    append_text,
    fill_tree,
    outer,
    readonly_text,
    scrolled_tree,
    selected_id,
    set_text,
)
from fundedflow_collector.net.client import UserAgentNotConfigured
from fundedflow_collector.outcomes import OUTCOME_INFO, Category, HostRole, Outcome, SourceKind, TermsDecision
from fundedflow_collector.parse.document import ParseError, ParseTimeout
from fundedflow_collector.paths import AppDatabaseGuardError, CollectorPaths, resolve_paths
from fundedflow_collector.policy import circuit
from fundedflow_collector.policy.terms import review_expires, terms_block_reason
from fundedflow_collector.render.browser import browser_status
from fundedflow_collector.runner import RunOptions, RunSummary, run_firms

ALL_FIRMS = "All enabled firms"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
PRACTICE_SITE = PROJECT_ROOT / "examples" / "fixture-site"
KNOWN_ERRORS = (
    RegistryError,
    ConfigError,
    UserAgentNotConfigured,
    DatabaseError,
    MigrationError,
    AppDatabaseGuardError,
    ParseError,
    ParseTimeout,
    sqlite3.Error,
    ValueError,
    OSError,
)
STATUS_TAGS = {"ok": "ok", "WARN": "warn", "FAIL": "fail", "info": "muted"}
CATEGORY_TAGS = {Category.OK: "ok", Category.POLICY: "warn", Category.FAILURE: "fail"}

Notifier = Callable[[str, str, str], None]  # (kind: info|warning|error, title, message)
Asker = Callable[[str, str], bool]


@dataclass
class _Message:
    kind: str  # log | done | error
    payload: Any = None


class CollectorApp:
    def __init__(
        self,
        root: tk.Tk | tk.Toplevel,
        *,
        data_dir: Path | None = None,
        config_path: Path | None = None,
        clock: Clock | None = None,
        threaded: bool = True,
        notify: Notifier | None = None,
        ask: Asker | None = None,
        browser_check: services.BrowserCheck = browser_status,
    ) -> None:
        self.root = root
        self.clock = clock or SystemClock()
        self.threaded = threaded
        self.notify: Notifier = notify or _messagebox_notify
        self.ask: Asker = ask or (lambda title, message: bool(messagebox.askyesno(title, message, parent=root)))
        self.browser_check = browser_check
        self.paths: CollectorPaths = resolve_paths(data_dir)
        self.config_file = config_path or self.paths.default_config
        self.conn = self._open()
        self._queue: queue.Queue[_Message] = queue.Queue()
        self._stop = threading.Event()
        self._busy = False
        self._on_done: Callable[[Any], None] | None = None

        root.title(f"FundedFlow collector {__version__}")
        root.geometry("1180x760")
        root.minsize(980, 620)
        style = ttk.Style(root)
        if "vista" in style.theme_names():
            style.theme_use("vista")
        # Tk 8.6 themes can override per-row tag colours in tables; drop the theme's default colour map.
        untyped_style: Any = style
        for option in ("foreground", "background"):
            kept = [m for m in untyped_style.map("Treeview", query_opt=option) if m[:2] != ("!disabled", "!selected")]
            untyped_style.map("Treeview", **{option: kept})
        style.configure("Title.TLabel", font=("Segoe UI", 13, "bold"))
        style.configure("Muted.TLabel", foreground="#6b6b6b")

        self.tabs = ttk.Notebook(root)
        self.tabs.pack(fill="both", expand=True, padx=PAD, pady=(PAD, 0))
        self._build_setup()
        self._build_firms()
        self.research = ResearchTab(self, self.tabs)
        self._build_fetch()
        self._build_capture()
        self._build_results()
        self.evidence = EvidenceTab(self, self.tabs)
        self._build_export()
        self.status = tk.StringVar(value=f"Data folder: {self.paths.data_dir}")
        ttk.Label(root, textvariable=self.status, style="Muted.TLabel", anchor="w").pack(
            fill="x", padx=PAD + 2, pady=(2, PAD)
        )
        self.refresh_all()
        if self.threaded:
            root.after(100, self._poll)

    # ------------------------------------------------------------------ plumbing

    def _open(self) -> sqlite3.Connection:
        """Create the data folder, settings file and database on first start (the CLI's `init-db`)."""
        self.paths.data_dir.mkdir(parents=True, exist_ok=True)
        if not self.config_file.exists():
            self.config_file.write_text(EXAMPLE_CONFIG, encoding="utf-8")
        return open_database(self.paths.db, create=True)

    def select_tab(self, name: str) -> None:
        notebook: Any = self.tabs
        for tab_id in notebook.tabs():
            if str(notebook.tab(tab_id, "text")).lower() == name.lower():
                notebook.select(tab_id)

    def close(self) -> None:
        self._stop.set()
        self.conn.close()

    def guard(self, action: Callable[[], None], title: str = "Could not do that") -> None:
        try:
            action()
        except KNOWN_ERRORS as exc:
            self.notify("error", title, str(exc))

    def _poll(self) -> None:
        self._drain()
        self.root.after(100, self._poll)

    def _drain(self) -> None:
        while True:
            try:
                message = self._queue.get_nowait()
            except queue.Empty:
                return
            if message.kind == "log":
                append_text(self.fetch_log, str(message.payload))
            elif message.kind == "error":
                self._finish_job()
                append_text(self.fetch_log, f"Error: {message.payload}")
                self.notify("error", "Run stopped", str(message.payload))
            elif message.kind == "done":
                callback = self._on_done
                self._finish_job()
                if callback is not None:
                    callback(message.payload)

    def _run_job(self, work: Callable[[Callable[[str], None]], Any], on_done: Callable[[Any], None]) -> None:
        """Run `work(emit)` off the UI thread; `emit` streams log lines. `on_done` runs back on the UI thread."""
        if self._busy:
            self.notify("warning", "Busy", "A run is already in progress.")
            return
        self._busy = True
        self._stop.clear()
        self._on_done = on_done
        self._set_running(True)

        def emit(line: str) -> None:
            self._queue.put(_Message("log", line))

        def target() -> None:
            try:
                self._queue.put(_Message("done", work(emit)))
            except KNOWN_ERRORS as exc:
                self._queue.put(_Message("error", exc))
            except KeyboardInterrupt:
                self._queue.put(_Message("error", "interrupted"))

        if self.threaded:
            threading.Thread(target=target, daemon=True, name="collector-run").start()
        else:
            target()
            self._drain()

    def _finish_job(self) -> None:
        self._busy = False
        self._on_done = None
        self._set_running(False)
        self.refresh_all()

    def firm_keys(self) -> list[str]:
        return [f.firm_key for f in registry.list_firms(self.conn)]

    def publishers(self) -> list[registry.Publisher]:
        return registry.list_publishers(self.conn)

    def settings(self) -> Settings:
        try:
            return load_settings(self.config_file)[0]
        except ConfigError:
            return Settings()

    def refresh_all(self) -> None:
        self.refresh_setup()
        self.refresh_firms()
        self.research.refresh()
        self.refresh_results()
        keys = self.firm_keys()
        publisher_keys = [p.publisher_key for p in self.publishers()]
        for combo, extra in (
            (self.fetch_firm, [ALL_FIRMS]),
            (self.export_firm, []),
            (self.snap_filter, ["All firms"]),
        ):
            combo.configure(values=[*extra, *keys])
            if not combo.get() and (extra or keys):
                combo.set((extra or keys)[0])
        self._refresh_capture_owners(keys, publisher_keys)
        self.export_publisher.configure(values=publisher_keys)
        if not self.export_publisher.get() and publisher_keys:
            self.export_publisher.set(publisher_keys[0])
        self._refresh_publisher_list()
        self.evidence.refresh()

    # ------------------------------------------------------------------ Setup tab

    def _build_setup(self) -> None:
        tab = ttk.Frame(self.tabs, padding=PAD * 2)
        self.tabs.add(tab, text="Setup")
        ttk.Label(tab, text="Status", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(
            tab,
            text="The same checks as `collector doctor`. Fix any FAIL; WARN lines tell you what is limited.",
            style="Muted.TLabel",
        ).grid(row=1, column=0, sticky="w", pady=(0, PAD))
        self.checks = scrolled_tree(
            tab,
            [
                Column("status", "Status", 70),
                Column("label", "Check", 230),
                Column("detail", "Detail", 760, stretch=True),
            ],
            height=14,
        )
        outer(self.checks).grid(row=2, column=0, columnspan=3, sticky="nsew")

        form = ttk.LabelFrame(tab, text="How websites see the collector", padding=PAD * 2)
        form.grid(row=3, column=0, columnspan=3, sticky="we", pady=(PAD * 2, 0))
        ttk.Label(
            form,
            text="Info URL (required for live fetching): a page that explains this collector, e.g. the "
            "FundedFlow repository or a page you control.",
            wraplength=900,
        ).grid(row=0, column=0, columnspan=3, sticky="w")
        self.info_url = tk.StringVar()
        self.contact = tk.StringVar()
        ttk.Label(form, text="Info URL").grid(row=1, column=0, sticky="w", pady=4)
        ttk.Entry(form, textvariable=self.info_url, width=70).grid(row=1, column=1, sticky="w", pady=4)
        ttk.Label(form, text="Contact (optional)").grid(row=2, column=0, sticky="w", pady=4)
        ttk.Entry(form, textvariable=self.contact, width=70).grid(row=2, column=1, sticky="w", pady=4)
        ttk.Button(form, text="Save", command=lambda: self.guard(self.save_user_agent)).grid(row=1, column=2, padx=PAD)
        self.ua_preview = tk.StringVar()
        ttk.Label(form, textvariable=self.ua_preview, style="Muted.TLabel").grid(
            row=3, column=0, columnspan=3, sticky="w"
        )
        buttons = ttk.Frame(tab)
        buttons.grid(row=4, column=0, sticky="w", pady=(PAD * 2, 0))
        ttk.Button(buttons, text="Refresh checks", command=self.refresh_setup).pack(side="left")
        ttk.Button(buttons, text="Open data folder", command=self.open_data_folder).pack(side="left", padx=PAD)
        tab.rowconfigure(2, weight=1)
        tab.columnconfigure(0, weight=1)

    def refresh_setup(self) -> None:
        health = services.health_checks(self.paths, self.config_file, self.clock, browser_check=self.browser_check)
        rows = [
            (f"check{n}", (c.status, c.label, c.detail), STATUS_TAGS.get(c.status)) for n, c in enumerate(health.checks)
        ]
        fill_tree(self.checks, rows)
        try:
            settings, _ = load_settings(self.config_file)
        except ConfigError:
            return
        self.info_url.set(settings.user_agent.info_url or "")
        self.contact.set(settings.user_agent.contact or "")
        from fundedflow_collector.net.client import build_user_agent

        self.ua_preview.set(
            "Sites will see: " + build_user_agent(settings)
            if settings.user_agent.info_url
            else "Live fetching is refused until an info URL is saved."
        )

    def save_user_agent(self) -> None:
        update_user_agent(self.config_file, self.info_url.get(), self.contact.get())
        self.refresh_setup()
        self.status.set(f"Saved {self.config_file}")

    def open_data_folder(self) -> None:
        if sys.platform == "win32":
            os.startfile(self.paths.data_dir)  # noqa: S606

    # ------------------------------------------------------------------ Firms tab

    def _build_firms(self) -> None:
        tab = ttk.Frame(self.tabs, padding=PAD * 2)
        self.tabs.add(tab, text="Firms")
        left = ttk.Frame(tab)
        left.grid(row=0, column=0, rowspan=2, sticky="nsew", padx=(0, PAD * 2))
        ttk.Label(left, text="Firms", style="Title.TLabel").pack(anchor="w")
        self.firms = scrolled_tree(
            left,
            [Column("key", "Key", 120), Column("name", "Name", 170, stretch=True), Column("enabled", "Enabled", 60)],
            height=20,
        )
        outer(self.firms).pack(fill="both", expand=True, pady=(PAD, PAD))
        self.firms.bind("<<TreeviewSelect>>", lambda _e: self.refresh_firm_detail())
        row = ttk.Frame(left)
        row.pack(fill="x")
        ttk.Button(row, text="Add firm…", command=self.dialog_add_firm).pack(side="left")
        ttk.Button(row, text="Import from file…", command=self.dialog_import_firm).pack(side="left", padx=PAD)
        ttk.Button(row, text="Enable / disable", command=self.dialog_toggle_firm).pack(side="left")

        hosts = ttk.Frame(tab)
        hosts.grid(row=0, column=1, sticky="nsew")
        ttk.Label(hosts, text="Hosts and terms reviews", style="Title.TLabel").pack(anchor="w")
        ttk.Label(
            hosts,
            text="Only hosts you add are ever contacted. Each needs a terms review before live fetching.",
            style="Muted.TLabel",
        ).pack(anchor="w")
        self.hosts = scrolled_tree(
            hosts,
            [
                Column("host", "Host", 150, stretch=True),
                Column("role", "Role", 85),
                Column("terms", "Terms", 150),
                Column("expires", "Review expires", 100),
                Column("circuit", "Circuit", 140),
                Column("live", "Live fetch", 120),
            ],
            height=7,
        )
        outer(self.hosts).pack(fill="both", expand=True, pady=PAD)
        row = ttk.Frame(hosts)
        row.pack(fill="x")
        ttk.Button(row, text="Add host…", command=self.dialog_add_host).pack(side="left")
        ttk.Button(row, text="Record terms review…", command=self.dialog_terms).pack(side="left", padx=PAD)
        ttk.Button(row, text="Re-enable stopped host…", command=self.dialog_reenable).pack(side="left")

        sources = ttk.Frame(tab)
        sources.grid(row=1, column=1, sticky="nsew", pady=(PAD * 2, 0))
        ttk.Label(sources, text="Sources (starting pages and pages found by discovery)", style="Title.TLabel").pack(
            anchor="w"
        )
        self.sources = scrolled_tree(
            sources,
            [
                Column("url", "URL", 300, stretch=True),
                Column("kind", "Kind", 60),
                Column("channel", "Found via", 95),
                Column("js", "JS", 50),
                Column("enabled", "Enabled", 60),
                Column("outcome", "Last outcome", 150),
            ],
            height=9,
        )
        outer(self.sources).pack(fill="both", expand=True, pady=PAD)
        row = ttk.Frame(sources)
        row.pack(fill="x")
        ttk.Button(row, text="Add source…", command=self.dialog_add_source).pack(side="left")
        ttk.Button(row, text="Enable / disable source", command=self.toggle_source).pack(side="left", padx=PAD)
        tab.columnconfigure(1, weight=1)
        tab.rowconfigure(0, weight=1)
        tab.rowconfigure(1, weight=1)

    def refresh_firms(self) -> None:
        rows = [
            (
                f.firm_key,
                (f.firm_key, f.display_name, "yes" if f.enabled else f"no: {f.disabled_reason}"),
                None if f.enabled else "muted",
            )
            for f in registry.list_firms(self.conn)
        ]
        fill_tree(self.firms, rows)
        if not self.firms.selection() and rows:
            self.firms.selection_set(rows[0][0])
        self.refresh_firm_detail()

    def selected_firm(self) -> registry.Firm | None:
        key = selected_id(self.firms)
        return registry.get_firm(self.conn, key) if key else None

    def _need_firm(self) -> registry.Firm:
        firm = self.selected_firm()
        if firm is None:
            raise RegistryError("select a firm first (or add one)")
        return firm

    def refresh_firm_detail(self) -> None:
        firm = self.selected_firm()
        if firm is None:
            fill_tree(self.hosts, [])
            fill_tree(self.sources, [])
            return
        now = self.clock.now()
        host_rows = []
        for h in registry.list_hosts(self.conn, firm.id):
            state = circuit.current(self.conn, h.host, now, persist=False)
            terms = h.terms_decision.value if h.terms_decision else "not reviewed"
            if h.terms_decision is TermsDecision.UNCLEAR:
                terms += " (acknowledged)" if h.unclear_terms_accepted_at else " (not acknowledged)"
            expires = review_expires(h)
            blocked = terms_block_reason(h, now)
            live = "assets only" if h.role is HostRole.ASSET else ("manual capture only" if blocked else "allowed")
            tag = "fail" if state.open else ("warn" if blocked and h.role is not HostRole.ASSET else None)
            host_rows.append(
                (
                    h.host,
                    (h.host, h.role.value, terms, f"{expires:%Y-%m-%d}" if expires else "", state.state.value, live),
                    tag,
                )
            )
        fill_tree(self.hosts, host_rows)
        source_rows = []
        for s in registry.list_sources(self.conn, firm.id):
            outcome = s.last_outcome
            known = _outcome(outcome)
            tag = CATEGORY_TAGS[OUTCOME_INFO[known].category] if known else None
            js = "always" if s.requires_js else "never" if s.js_disabled else "auto"
            source_rows.append(
                (
                    s.id,
                    (s.canonical_url, s.kind.value, s.source_channel.value, js, "yes" if s.enabled else "no", outcome),
                    tag if s.enabled else "muted",
                )
            )
        fill_tree(self.sources, source_rows)

    # firm actions (the dialogs collect values; these methods do the work and are what the tests call)

    def add_firm(self, key: str, name: str, homepage: str, max_fetches: str = "", excluded: str = "") -> None:
        excluded_paths = [p.strip() for p in excluded.split(",") if p.strip()]
        firm = registry.add_firm(
            self.conn,
            firm_key=key.strip(),
            display_name=name,
            homepage_url=homepage,
            now=self.clock.now(),
            max_fetches=_int_or_none(max_fetches, "max fetches"),
            excluded_paths=excluded_paths,
        )
        self.refresh_all()
        self.firms.selection_set(firm.firm_key)
        self.status.set(f"Added firm {firm.firm_key}. Next: add its hosts and record a terms review for each.")

    def add_host(self, host: str, role: str) -> None:
        firm = self._need_firm()
        record = registry.add_host(self.conn, firm, host, HostRole(role), self.clock.now())
        self.refresh_firm_detail()
        self.status.set(f"Authorised {record.host}. Next: read its terms of use and record your review.")

    def record_terms(
        self,
        host: str,
        decision: str,
        terms_url: str,
        notes: str = "",
        min_delay: str = "",
        accept_unclear: bool = False,
    ) -> str:
        firm = self._need_firm()
        record = registry.record_terms(
            self.conn,
            firm,
            registry.require_host(self.conn, firm, host),
            decision=TermsDecision(decision),
            terms_url=terms_url,
            now=self.clock.now(),
            notes=notes or None,
            min_delay_seconds=_float_or_none(min_delay, "minimum delay"),
            accept_unclear=accept_unclear,
        )
        reason = terms_block_reason(record, self.clock.now())
        self.refresh_firm_detail()
        message = "Live fetching: allowed." if reason is None else f"Live fetching: not allowed ({reason})."
        self.status.set(f"Recorded terms for {record.host}: {decision}. {message}")
        return message

    def reenable_host(self, host: str, reason: str) -> None:
        circuit.reenable(self.conn, host, reason, self.clock.now())
        self.refresh_firm_detail()
        self.status.set(f"Re-enabled {host}.")

    def add_source(self, url: str, kind: str, label: str = "", priority: str = "", js: str = "auto") -> None:
        firm = self._need_firm()
        source = registry.add_source(
            self.conn,
            firm,
            url=url,
            kind=SourceKind(kind),
            now=self.clock.now(),
            requires_js=js == "always",
            js_disabled=js == "never",
            label=label or None,
            priority=_int_or_none(priority, "priority") or 0,
        )
        self.refresh_firm_detail()
        self.status.set(f"Added source {source.canonical_url}.")

    def toggle_source(self) -> None:
        def action() -> None:
            source_id = selected_id(self.sources)
            if source_id is None:
                raise RegistryError("select a source first")
            source = registry.require_source(self.conn, source_id)
            registry.update_source(self.conn, source, now=self.clock.now(), enabled=not source.enabled)
            self.refresh_firm_detail()

        self.guard(action)

    def import_firm_file(self, path: Path) -> None:
        from fundedflow_collector.cli.registry_cmds import import_firm_spec

        key = import_firm_spec(self.conn, path, self.clock.now(), echo=lambda _line: None)
        self.refresh_all()
        self.firms.selection_set(key)
        self.status.set(f"Imported {key} from {path.name}.")

    def set_firm_enabled(self, enabled: bool, reason: str = "") -> None:
        firm = self._need_firm()
        registry.set_firm_enabled(self.conn, firm, enabled, reason or None, self.clock.now())
        self.refresh_all()

    # dialogs

    def dialog_add_firm(self) -> None:
        values = FormDialog(
            self.root,
            "Add firm",
            [
                Field("key", "Key", hint="Short id: lowercase letters, digits and hyphens, e.g. example-firm."),
                Field("name", "Name"),
                Field("homepage", "Homepage URL", default="https://"),
                Field("max_fetches", "Max requests per run", hint="Optional, 1-300. Default 75."),
                Field("excluded", "Excluded paths", hint="Optional, comma separated, e.g. /blog/*, /login*"),
            ],
        ).show()
        if values:
            self.guard(
                lambda: self.add_firm(
                    str(values["key"]),
                    str(values["name"]),
                    str(values["homepage"]),
                    str(values["max_fetches"]),
                    str(values["excluded"]),
                )
            )

    def dialog_import_firm(self) -> None:
        name = filedialog.askopenfilename(
            parent=self.root,
            title="Import firm definition",
            filetypes=[("Firm definition", "*.toml"), ("All files", "*.*")],
            initialdir=str(PROJECT_ROOT / "config" / "firms"),
        )
        if name:
            self.guard(lambda: self.import_firm_file(Path(name)))

    def dialog_toggle_firm(self) -> None:
        firm = self.selected_firm()
        if firm is None:
            self.notify("warning", "No firm selected", "Select a firm first.")
            return
        if firm.enabled:
            values = FormDialog(
                self.root,
                f"Disable {firm.firm_key}",
                [Field("reason", "Reason")],
                intro="A disabled firm is skipped by fetches. Its evidence is kept.",
            ).show()
            if values:
                self.guard(lambda: self.set_firm_enabled(False, str(values["reason"])))
        else:
            self.guard(lambda: self.set_firm_enabled(True))

    def dialog_add_host(self) -> None:
        firm = self.selected_firm()
        if firm is None:
            self.notify("warning", "No firm selected", "Select a firm first.")
            return
        values = FormDialog(
            self.root,
            f"Add host to {firm.firm_key}",
            [
                Field("host", "Host", hint="Host name only, e.g. help.firm.com. Subdomains each need their own entry."),
                Field(
                    "role",
                    "Role",
                    "combo",
                    [r.value for r in HostRole],
                    "homepage",
                    hint="Use 'asset' only for a vendor script server the browser needs; it is never read as a page.",
                ),
            ],
            intro="Only add the firm's own websites.",
        ).show()
        if values:
            self.guard(lambda: self.add_host(str(values["host"]), str(values["role"])))

    def dialog_terms(self) -> None:
        host = selected_id(self.hosts)
        if host is None:
            self.notify("warning", "No host selected", "Select a host first.")
            return
        values = FormDialog(
            self.root,
            f"Terms review for {host}",
            [
                Field("decision", "Decision", "combo", [d.value for d in TermsDecision], "unclear"),
                Field("terms_url", "Terms page URL", default="https://"),
                Field("notes", "Notes", hint="What the terms say about robots, scrapers or automated access."),
                Field("min_delay", "Minimum delay (s)", hint="Optional: a slower pace the terms ask for."),
                Field("accept_unclear", "I accept unclear terms (slow 5 s pace)", "check", default=False),
            ],
            intro="allowed / allowed_with_limits: live fetching. unclear: only if you tick the box below. "
            "prohibited: manual capture only. The collector never decides this for you.",
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
                self.notify("info", "Terms recorded", message)

            self.guard(action)

    def dialog_reenable(self) -> None:
        host = selected_id(self.hosts)
        if host is None:
            self.notify("warning", "No host selected", "Select a stopped host first.")
            return
        values = FormDialog(
            self.root,
            f"Re-enable {host}",
            [Field("reason", "Reason")],
            intro="Only re-enable a host if the firm agreed or you know the cause is fixed. Never work around a block.",
        ).show()
        if values:
            self.guard(lambda: self.reenable_host(host, str(values["reason"])))

    def dialog_add_source(self) -> None:
        firm = self.selected_firm()
        if firm is None:
            self.notify("warning", "No firm selected", "Select a firm first.")
            return
        values = FormDialog(
            self.root,
            f"Add source to {firm.firm_key}",
            [
                Field("url", "URL", default="https://"),
                Field(
                    "kind",
                    "Kind",
                    "combo",
                    [k.value for k in SourceKind],
                    "page",
                    hint="zendesk: a help-center address like https://help.firm.com/hc/en-us",
                ),
                Field("label", "Label"),
                Field("priority", "Priority", hint="Optional, -100 to 100; higher is fetched first."),
                Field("js", "JavaScript", "combo", ["auto", "always", "never"], "auto"),
            ],
        ).show()
        if values:
            self.guard(
                lambda: self.add_source(
                    str(values["url"]),
                    str(values["kind"]),
                    str(values["label"]),
                    str(values["priority"]),
                    str(values["js"]),
                )
            )

    # ------------------------------------------------------------------ Fetch tab

    def _build_fetch(self) -> None:
        tab = ttk.Frame(self.tabs, padding=PAD * 2)
        self.tabs.add(tab, text="Fetch")
        top = ttk.Frame(tab)
        top.grid(row=0, column=0, sticky="we")
        options = ttk.LabelFrame(top, text="What to fetch", padding=PAD * 2)
        options.pack(side="left", fill="y")
        self.fetch_kind = tk.StringVar(value="firms")
        ttk.Radiobutton(options, text="Firm", value="firms", variable=self.fetch_kind).grid(row=0, column=0, sticky="w")
        self.fetch_firm = ttk.Combobox(options, state="readonly", width=30)
        self.fetch_firm.grid(row=0, column=1, sticky="w", padx=PAD)
        sites = ttk.LabelFrame(top, text="Or comparison publishers (select one or more)", padding=PAD * 2)
        sites.pack(side="left", fill="both", expand=True, padx=(PAD * 2, 0))
        ttk.Radiobutton(sites, text="Research sources", value="publishers", variable=self.fetch_kind).grid(
            row=0, column=0, sticky="w"
        )
        self.publisher_list = tk.Listbox(sites, selectmode="extended", height=6, exportselection=False, width=60)
        self.publisher_list.grid(row=1, column=0, sticky="nsew", pady=(PAD, 0))
        self.publisher_list.bind("<<ListboxSelect>>", lambda _e: self.fetch_kind.set("publishers"))
        ttk.Label(
            sites,
            text="Only enabled publishers are fetched live; Preview works for any of them. Manual-only "
            "publishers are never fetched.",
            style="Muted.TLabel",
            wraplength=430,
        ).grid(row=2, column=0, sticky="w", pady=(PAD, 0))
        sites.columnconfigure(0, weight=1)
        self._publisher_keys: list[str] = []
        self.dry_run = tk.BooleanVar(value=True)
        self.skip_discovery = tk.BooleanVar(value=False)
        self.force = tk.BooleanVar(value=False)
        self.use_browser = tk.BooleanVar(value=True)
        self.max_fetches = tk.StringVar()
        ttk.Checkbutton(options, text="Preview only (no network, nothing saved)", variable=self.dry_run).grid(
            row=1, column=0, columnspan=2, sticky="w", pady=(PAD, 0)
        )
        ttk.Checkbutton(options, text="Skip discovery (re-check known pages only)", variable=self.skip_discovery).grid(
            row=2, column=0, columnspan=2, sticky="w"
        )
        ttk.Checkbutton(options, text="Force (fetch even if unchanged)", variable=self.force).grid(
            row=3, column=0, columnspan=2, sticky="w"
        )
        ttk.Checkbutton(
            options, text="Use the browser for JavaScript pages (if installed)", variable=self.use_browser
        ).grid(row=4, column=0, columnspan=2, sticky="w")
        ttk.Label(options, text="Max requests (optional)").grid(row=5, column=0, sticky="w", pady=(PAD, 0))
        ttk.Entry(options, textvariable=self.max_fetches, width=8).grid(
            row=5, column=1, sticky="w", padx=PAD, pady=(PAD, 0)
        )
        self.practice = tk.BooleanVar(value=False)
        self.practice_dir = tk.StringVar(value=str(PRACTICE_SITE) if PRACTICE_SITE.exists() else "")
        ttk.Checkbutton(
            options, text="Practice mode: replay a fixture folder instead of the internet", variable=self.practice
        ).grid(row=6, column=0, columnspan=2, sticky="w", pady=(PAD, 0))
        folder = ttk.Frame(options)
        folder.grid(row=7, column=0, columnspan=3, sticky="w")
        ttk.Entry(folder, textvariable=self.practice_dir, width=70).pack(side="left")
        ttk.Button(folder, text="Browse…", command=self._browse_practice).pack(side="left", padx=PAD)

        buttons = ttk.Frame(tab)
        buttons.grid(row=1, column=0, sticky="w", pady=PAD)
        self.start_button = ttk.Button(buttons, text="Start", command=self.start_fetch)
        self.start_button.pack(side="left")
        self.stop_button = ttk.Button(buttons, text="Stop", command=self.stop_fetch, state="disabled")
        self.stop_button.pack(side="left", padx=PAD)
        ttk.Button(buttons, text="Clear log", command=lambda: set_text(self.fetch_log, "")).pack(side="left")
        self.fetch_state = tk.StringVar(
            value="Idle. Requests are at least 2 s apart, so a full firm takes a few minutes."
        )
        ttk.Label(buttons, textvariable=self.fetch_state, style="Muted.TLabel").pack(side="left", padx=PAD * 2)
        self.fetch_log = readonly_text(tab, height=14)
        outer(self.fetch_log).grid(row=2, column=0, sticky="nsew")
        ttk.Label(tab, text="Per-site results of the last run", style="Title.TLabel").grid(
            row=3, column=0, sticky="w", pady=(PAD, 0)
        )
        self.site_results = scrolled_tree(
            tab,
            [
                Column("site", "Site", 190),
                Column("status", "Run status", 120),
                Column("collected", "Collected", 70),
                Column("unchanged", "Unchanged", 75),
                Column("skipped", "Skipped", 60),
                Column("failed", "Failed", 55),
                Column("blocked", "Blocked", 60),
                Column("why", "Why (if not all collected)", 420, stretch=True),
            ],
            height=4,
            sortable=True,
        )
        outer(self.site_results).grid(row=4, column=0, sticky="nsew")
        tab.rowconfigure(2, weight=3)
        tab.rowconfigure(4, weight=1)
        tab.columnconfigure(0, weight=1)

    def _browse_practice(self) -> None:
        name = filedialog.askdirectory(
            parent=self.root, title="Fixture site folder", initialdir=self.practice_dir.get() or str(PROJECT_ROOT)
        )
        if name:
            self.practice_dir.set(name)

    def _set_running(self, running: bool) -> None:
        self.start_button.configure(state="disabled" if running else "normal")
        self.stop_button.configure(state="normal" if running else "disabled")
        self.fetch_state.set(
            "Running… (Stop finishes the current request, then saves and stops.)" if running else "Idle."
        )

    def _refresh_publisher_list(self) -> None:
        selected = set(self.selected_publishers())
        self._publisher_keys = []
        self.publisher_list.delete(0, "end")
        now = self.clock.now()
        from fundedflow_collector.directory.review import publisher_status

        for publisher in self.publishers():
            status = publisher_status(self.conn, publisher, now)
            self._publisher_keys.append(publisher.publisher_key)
            self.publisher_list.insert("end", f"{publisher.publisher_key}  -  {status.label}")
            if publisher.publisher_key in selected:
                self.publisher_list.selection_set("end")

    def selected_publishers(self) -> list[str]:
        if not hasattr(self, "publisher_list"):
            return []
        listbox: Any = self.publisher_list
        indices = listbox.curselection()
        return [self._publisher_keys[int(i)] for i in indices if int(i) < len(self._publisher_keys)]

    def select_publishers_for_fetch(self, keys: list[str]) -> None:
        self.fetch_kind.set("publishers")
        self.publisher_list.selection_clear(0, "end")
        for index, key in enumerate(self._publisher_keys):
            if key in keys:
                self.publisher_list.selection_set(index)

    def start_fetch(self) -> None:
        if self.fetch_kind.get() == "publishers":
            self.guard(self._start_publisher_fetch, "Could not start")
            return

        def action() -> None:
            choice = self.fetch_firm.get()
            keys = None if choice == ALL_FIRMS else [choice]
            if keys == [""]:
                raise RegistryError("add a firm first")
            fixture = Path(self.practice_dir.get()) if self.practice.get() else None
            if fixture is not None and not fixture.is_dir():
                raise RegistryError(f"practice folder not found: {fixture}")
            max_fetches = _int_or_none(self.max_fetches.get(), "max requests")
            if max_fetches is not None and not 1 <= max_fetches <= 300:
                raise RegistryError("max requests must be between 1 and 300")
            options = RunOptions(
                command="fetch",
                dry_run=self.dry_run.get(),
                force=self.force.get(),
                discover=not self.skip_discovery.get(),
                use_browser=self.use_browser.get(),
                max_fetches=max_fetches,
                fixture_site=fixture,
            )
            if (
                not options.dry_run
                and fixture is None
                and not self.ask(
                    "Contact the firms' websites?",
                    "This live run sends polite, identified requests to the hosts you authorised, and stops at "
                    "the first sign of a block. Continue?",
                )
            ):
                return
            append_text(
                self.fetch_log,
                f"--- {choice}: {'preview' if options.dry_run else 'fetch'} "
                f"{'(practice mode)' if fixture else ''}".rstrip(),
            )
            self._run_job(lambda emit: self._fetch_work(keys, options, emit), self._fetch_done)

        self.guard(action, "Could not start")

    def _options(self) -> RunOptions:
        fixture = Path(self.practice_dir.get()) if self.practice.get() else None
        if fixture is not None and not fixture.is_dir():
            raise RegistryError(f"practice folder not found: {fixture}")
        max_fetches = _int_or_none(self.max_fetches.get(), "max requests")
        if max_fetches is not None and not 1 <= max_fetches <= 300:
            raise RegistryError("max requests must be between 1 and 300")
        return RunOptions(
            command="fetch",
            dry_run=self.dry_run.get(),
            force=self.force.get(),
            discover=not self.skip_discovery.get(),
            use_browser=self.use_browser.get(),
            max_fetches=max_fetches,
            fixture_site=fixture,
        )

    def _start_publisher_fetch(self) -> None:
        keys = self.selected_publishers()
        if not keys:
            raise RegistryError("select one or more publishers in the list (add them on Research sources)")
        options = self._options()
        chosen = [registry.require_publisher(self.conn, k) for k in keys]
        if not options.dry_run:
            refused = [
                f"{p.publisher_key}: {'manual capture only' if p.capture_mode != 'auto' else p.disabled_reason}"
                for p in chosen
                if not p.enabled
            ]
            if refused:
                raise RegistryError(
                    "these publishers are not enabled for live collection: " + "; ".join(refused) + ". Use Preview, "
                    "or import saved pages on Manual capture."
                )
            hosts = sorted({h.host for p in chosen for h in registry.list_hosts(self.conn, p.id)})
            if options.fixture_site is None and not self.ask(
                "Contact the publishers' websites?",
                "This live run sends polite, identified requests to: "
                + ", ".join(hosts)
                + ". It respects robots.txt and your terms reviews, follows only the adapter's own page links, and "
                "stops at the first sign of a block. Continue?",
            ):
                return
        append_text(
            self.fetch_log,
            f"--- {', '.join(keys)}: {'preview' if options.dry_run else 'fetch'} "
            f"{'(practice mode)' if options.fixture_site else ''}".rstrip(),
        )
        self._run_job(lambda emit: self._fetch_work(None, options, emit, publisher_keys=keys), self._fetch_done)

    def stop_fetch(self) -> None:
        self._stop.set()
        self.fetch_state.set("Stopping after the current request…")

    def _fetch_work(
        self,
        keys: list[str] | None,
        options: RunOptions,
        emit: Callable[[str], None],
        *,
        publisher_keys: list[str] | None = None,
    ) -> tuple[list[str], list[RunSummary]]:
        conn = open_database(self.paths.db)
        try:
            settings, sha = load_settings(self.config_file)
            firms: list[registry.Owner]
            if publisher_keys:
                firms = services.select_owners(conn, publisher_keys=publisher_keys)
            elif keys:
                firms = services.select_owners(conn, firm_keys=keys)
            else:
                firms = services.select_owners(conn, all_firms=True)
            if not firms:
                return ["No enabled firms."], []
            if options.dry_run:
                env = services.build_environment(
                    conn,
                    settings,
                    sha,
                    clock=self.clock,
                    fixture_dir=options.fixture_site,
                    use_browser=False,
                    headed=False,
                    live=False,
                )
                summaries = run_firms(env, firms, options)
                return summary_lines(summaries, dry_run=True), summaries
            with RunLock(self.paths.data_dir):
                recover_interrupted_runs(conn)
                env = services.build_environment(
                    conn,
                    settings,
                    sha,
                    clock=self.clock,
                    fixture_dir=options.fixture_site,
                    use_browser=options.use_browser,
                    headed=False,
                    live=True,
                    progress=emit,
                    should_stop=self._stop.is_set,
                    browser_check=self.browser_check,
                )
                try:
                    summaries = run_firms(env, firms, options)
                    return summary_lines(summaries, dry_run=False), summaries
                finally:
                    if env.fetcher is not None:
                        env.fetcher.close()
        finally:
            conn.close()

    def _fetch_done(self, result: tuple[list[str], list[RunSummary]]) -> None:
        lines, summaries = result
        for line in lines:
            append_text(self.fetch_log, line)
        rows = []
        for n, summary in enumerate(summaries):
            counts = services.bucket_counts(summary)
            why = sorted(
                {
                    f"{r.outcome.value}: {r.reason or OUTCOME_INFO[r.outcome].meaning}"
                    for r in summary.results
                    if r.counted and services.outcome_bucket(r.outcome) in ("failed", "blocked")
                }
                | {f"{r.directory}: {r.url}" for r in summary.results if r.directory in _PAGE_PROBLEMS}
            )
            if summary.message and not why:
                why = [summary.message]
            tag = "fail" if counts["failed"] or counts["blocked"] else ("warn" if why else None)
            rows.append(
                (
                    f"site{n}",
                    (
                        summary.firm_key,
                        summary.status,
                        counts["collected"],
                        counts["unchanged"],
                        counts["skipped"],
                        counts["failed"],
                        counts["blocked"],
                        "; ".join(why)[:400],
                    ),
                    tag,
                )
            )
        fill_tree(self.site_results, rows)
        self.status.set("Run finished. See Results for every request and Evidence for publisher values.")

    # ------------------------------------------------------------------ Manual capture tab

    def _build_capture(self) -> None:
        tab = ttk.Frame(self.tabs, padding=PAD * 2)
        self.tabs.add(tab, text="Manual capture")
        ttk.Label(tab, text="Import a page you saved from your browser", style="Title.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w"
        )
        ttk.Label(
            tab,
            text="Works for every firm, including blocked or terms-prohibited ones, and makes no network "
            "requests. Save the page with Ctrl+S (Webpage, HTML only) or Ctrl+P (Save as PDF), or copy "
            "the text into a .txt file.",
            wraplength=950,
            style="Muted.TLabel",
        ).grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, PAD * 2))
        self.capture_target = tk.StringVar(value="firm")
        target = ttk.Frame(tab)
        ttk.Radiobutton(
            target, text="A firm's own site", value="firm", variable=self.capture_target, command=self.refresh_all
        ).pack(side="left")
        ttk.Radiobutton(
            target,
            text="A comparison publisher",
            value="publisher",
            variable=self.capture_target,
            command=self.refresh_all,
        ).pack(side="left", padx=PAD * 2)
        self.capture_firm = ttk.Combobox(tab, state="readonly", width=30)
        self.capture_url = tk.StringVar(value="https://")
        self.capture_file = tk.StringVar()
        self.capture_time = tk.StringVar()
        for row, (label, widget) in enumerate(
            [
                ("Page belongs to", target),
                ("Firm or publisher", self.capture_firm),
                ("Original page URL", ttk.Entry(tab, textvariable=self.capture_url, width=80)),
                ("Saved file", ttk.Entry(tab, textvariable=self.capture_file, width=80)),
                ("Saved at (optional, UTC)", ttk.Entry(tab, textvariable=self.capture_time, width=30)),
            ],
            start=2,
        ):
            ttk.Label(tab, text=label).grid(row=row, column=0, sticky="w", pady=3)
            widget.grid(row=row, column=1, sticky="w", pady=3)
        ttk.Button(tab, text="Browse…", command=self._browse_capture).grid(row=5, column=2, sticky="w", padx=PAD)
        ttk.Label(tab, text="e.g. 2026-10-20T14:30:00Z. Leave empty for now.", style="Muted.TLabel").grid(
            row=6, column=2, sticky="w", padx=PAD
        )
        ttk.Button(tab, text="Import", command=lambda: self.guard(self.import_capture_now, "Could not import")).grid(
            row=7, column=1, sticky="w", pady=PAD * 2
        )
        self.capture_result = readonly_text(tab, height=8)
        outer(self.capture_result).grid(row=8, column=0, columnspan=3, sticky="nsew")
        tab.rowconfigure(8, weight=1)
        tab.columnconfigure(3, weight=1)

    def _browse_capture(self) -> None:
        name = filedialog.askopenfilename(
            parent=self.root,
            title="Saved page",
            filetypes=[("Saved pages", "*.html *.htm *.pdf *.txt"), ("All files", "*.*")],
        )
        if name:
            self.capture_file.set(name)

    def _refresh_capture_owners(self, firm_keys: list[str], publisher_keys: list[str]) -> None:
        values = publisher_keys if self.capture_target.get() == "publisher" else firm_keys
        self.capture_firm.configure(values=values)
        if self.capture_firm.get() not in values:
            self.capture_firm.set(values[0] if values else "")

    def import_capture_now(self) -> None:
        if not self.capture_file.get():
            raise RegistryError("choose the saved file first")
        owner = self.capture_firm.get()
        if not owner:
            raise RegistryError("choose the firm or publisher the page belongs to")
        publisher = self.capture_target.get() == "publisher"
        settings, _ = load_settings(self.config_file)
        with RunLock(self.paths.data_dir):
            result = import_capture(
                self.conn,
                settings,
                self.clock,
                firm_key=None if publisher else owner,
                publisher_key=owner if publisher else None,
                url=self.capture_url.get(),
                file=Path(self.capture_file.get()),
                captured_at=self.capture_time.get().strip() or None,
            )
        set_text(
            self.capture_result,
            "\n".join(
                [
                    f"{result.outcome.value}: {result.snapshot_id}",
                    f"  title     {result.title or '-'}",
                    f"  text      {result.text_chars} characters",
                    f"  captured  {result.captured_at} (manual_capture)",
                    *([f"  warnings  {', '.join(result.warnings)}"] if result.warnings else []),
                    *([f"  read as   {result.directory} (unverified)"] if result.directory else []),
                ]
            ),
        )
        self.refresh_all()
        self.status.set(f"Imported {Path(self.capture_file.get()).name} as {result.snapshot_id}.")

    # ------------------------------------------------------------------ Results tab

    def _build_results(self) -> None:
        tab = ttk.Frame(self.tabs, padding=PAD * 2)
        self.tabs.add(tab, text="Results")
        top = ttk.Frame(tab)
        top.grid(row=0, column=0, sticky="nsew")
        ttk.Label(top, text="Runs", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Button(top, text="Refresh", command=self.refresh_results).grid(row=0, column=1, sticky="e")
        self.runs = scrolled_tree(
            top,
            [
                Column("started", "Started (UTC)", 175),
                Column("firm", "Firm", 110),
                Column("status", "Status", 90),
                Column("requests", "Requests", 65),
            ],
            height=6,
        )
        outer(self.runs).grid(row=1, column=0, sticky="nsew", padx=(0, PAD))
        self.runs.bind("<<TreeviewSelect>>", lambda _e: self.refresh_attempts())
        self.attempts = scrolled_tree(
            top,
            [
                Column("outcome", "Outcome", 150),
                Column("http", "HTTP", 45),
                Column("url", "URL", 300, stretch=True),
                Column("reason", "Reason", 190),
            ],
            height=6,
        )
        outer(self.attempts).grid(row=1, column=1, sticky="nsew")
        self.attempts.bind("<<TreeviewSelect>>", lambda _e: self.explain_attempt())
        self.attempt_help = tk.StringVar(value="Select an attempt to see what its outcome means and what to do.")
        ttk.Label(top, textvariable=self.attempt_help, wraplength=1050, style="Muted.TLabel").grid(
            row=2, column=0, columnspan=2, sticky="w", pady=(PAD, 0)
        )
        top.columnconfigure(1, weight=1)
        top.rowconfigure(1, weight=1)

        bottom = ttk.Frame(tab)
        bottom.grid(row=1, column=0, sticky="nsew", pady=(PAD * 2, 0))
        ttk.Label(bottom, text="Snapshots (unverified evidence)", style="Title.TLabel").grid(
            row=0, column=0, sticky="w"
        )
        self.snap_filter = ttk.Combobox(bottom, state="readonly", width=28)
        self.snap_filter.grid(row=0, column=1, sticky="e")
        self.snap_filter.bind("<<ComboboxSelected>>", lambda _e: self.refresh_snapshots())
        self.snaps = scrolled_tree(
            bottom,
            [
                Column("captured", "Captured (UTC)", 175),
                Column("firm", "Firm", 120),
                Column("method", "Method", 110),
                Column("chars", "Chars", 60),
                Column("url", "URL", 300, stretch=True),
            ],
            height=8,
        )
        outer(self.snaps).grid(row=1, column=0, sticky="nsew", padx=(0, PAD))
        self.snaps.bind("<<TreeviewSelect>>", lambda _e: self.show_snapshot())
        self.snap_text = readonly_text(bottom, height=12)
        outer(self.snap_text).grid(row=1, column=1, sticky="nsew")
        bottom.columnconfigure(0, weight=1)
        bottom.columnconfigure(1, weight=1)
        bottom.rowconfigure(1, weight=1)
        tab.columnconfigure(0, weight=1)
        tab.rowconfigure(0, weight=1)
        tab.rowconfigure(1, weight=2)

    def refresh_results(self) -> None:
        rows = [
            (
                r["id"],
                (r["started_at"], r["firm_key"], r["status"], r["fetches_used"]),
                "warn" if r["status"] in ("aborted", "deadline_exceeded") else None,
            )
            for r in runs.list_runs(self.conn, limit=100)
        ]
        fill_tree(self.runs, rows)
        if not self.runs.selection() and rows:
            self.runs.selection_set(rows[0][0])
        self.refresh_attempts()
        self.refresh_snapshots()

    def refresh_attempts(self) -> None:
        run_id = selected_id(self.runs)
        rows = []
        if run_id:
            for a in runs.list_attempts(self.conn, run_id):
                known = _outcome(a["outcome"])
                info = OUTCOME_INFO[known] if known else None
                rows.append(
                    (
                        a["id"],
                        (a["outcome"], a["http_status"], a["requested_url"], a["policy_reason"] or a["error_detail"]),
                        CATEGORY_TAGS[info.category] if info else None,
                    )
                )
        fill_tree(self.attempts, rows)

    def explain_attempt(self) -> None:
        attempt_id = selected_id(self.attempts)
        if attempt_id is None:
            return
        outcome = _outcome(str(self.attempts.item(attempt_id, "values")[0]))
        if outcome is not None:
            info = OUTCOME_INFO[outcome]
            self.attempt_help.set(f"{outcome.value}: {info.meaning} What to do: {info.action}")

    def refresh_snapshots(self) -> None:
        choice = self.snap_filter.get()
        firm = registry.get_firm(self.conn, choice) if choice and choice != "All firms" else None
        rows = [
            (r["id"], (r["captured_at"], r["firm_key"], r["fetch_method"], r["text_chars"], r["canonical_url"]), None)
            for r in snapshots.list_snapshots(self.conn, firm.id if firm else None, limit=500)
        ]
        fill_tree(self.snaps, rows)

    def show_snapshot(self) -> None:
        snapshot_id = selected_id(self.snaps)
        row = snapshots.get_snapshot(self.conn, snapshot_id) if snapshot_id else None
        if row is None:
            return
        first, last, count = snapshots.observations(self.conn, row["id"])
        header = [
            f"Snapshot {row['id']} (unverified evidence)",
            f"Requested  {row['requested_url']}",
            f"Final      {row['final_url']}",
            f"Captured   {row['captured_at']} via {row['fetch_method']}",
            f"Title      {row['title'] or '-'}",
            f"Hash       {row['content_hash']}",
            f"Parser     {row['parser_name']} ({row['parser_version']})",
            f"Seen       {count} time(s), first {first}, last {last}",
            f"Warnings   {row['warnings']}",
            "",
            str(row["text"]),
        ]
        set_text(self.snap_text, _safe("\n".join(header)))

    # ------------------------------------------------------------------ Export tab

    def _build_export(self) -> None:
        tab = ttk.Frame(self.tabs, padding=PAD * 2)
        self.tabs.add(tab, text="Export")
        ttk.Label(tab, text="Export unverified evidence for Build 31", style="Title.TLabel").grid(
            row=0, column=0, columnspan=3, sticky="w"
        )
        ttk.Label(
            tab,
            text="Writes a JSON file that is checked against collector-snapshot-v1 before it is saved. "
            "It is page text with its source and date, not a rulebook.",
            style="Muted.TLabel",
            wraplength=950,
        ).grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, PAD * 2))
        self.export_scope = tk.StringVar(value="all")
        ttk.Radiobutton(tab, text="All firms", value="all", variable=self.export_scope).grid(
            row=2, column=0, sticky="w"
        )
        ttk.Radiobutton(tab, text="One firm:", value="one", variable=self.export_scope).grid(
            row=3, column=0, sticky="w"
        )
        self.export_firm = ttk.Combobox(tab, state="readonly", width=30)
        self.export_firm.grid(row=3, column=1, sticky="w")
        self.export_attempts = tk.BooleanVar(value=False)
        self.export_csv = tk.BooleanVar(value=False)
        ttk.Checkbutton(tab, text="Include the full request log", variable=self.export_attempts).grid(
            row=4, column=0, columnspan=2, sticky="w", pady=(PAD, 0)
        )
        ttk.Checkbutton(
            tab, text="Also write a CSV list (URLs and dates, no page text)", variable=self.export_csv
        ).grid(row=5, column=0, columnspan=2, sticky="w")
        self.export_path = tk.StringVar()
        ttk.Label(tab, text="Save to (optional)").grid(row=6, column=0, sticky="w", pady=(PAD, 0))
        ttk.Entry(tab, textvariable=self.export_path, width=80).grid(row=6, column=1, sticky="w", pady=(PAD, 0))
        ttk.Button(tab, text="Choose…", command=self._browse_export).grid(
            row=6, column=2, sticky="w", padx=PAD, pady=(PAD, 0)
        )
        buttons = ttk.Frame(tab)
        buttons.grid(row=7, column=1, sticky="w", pady=PAD * 2)
        ttk.Button(buttons, text="Export", command=lambda: self.guard(self.export_now, "Export failed")).pack(
            side="left"
        )
        ttk.Button(buttons, text="Validate a file…", command=self._validate_file).pack(side="left", padx=PAD)
        ttk.Button(buttons, text="Open exports folder", command=self._open_exports).pack(side="left")
        directory = ttk.LabelFrame(
            tab, text="Comparison publishers (collector-directory-observations-v1, a separate format)", padding=PAD * 2
        )
        directory.grid(row=8, column=0, columnspan=3, sticky="we", pady=(0, PAD * 2))
        self.export_publisher_scope = tk.StringVar(value="all")
        ttk.Radiobutton(directory, text="All publishers", value="all", variable=self.export_publisher_scope).grid(
            row=0, column=0, sticky="w"
        )
        ttk.Radiobutton(directory, text="One publisher:", value="one", variable=self.export_publisher_scope).grid(
            row=1, column=0, sticky="w"
        )
        self.export_publisher = ttk.Combobox(directory, state="readonly", width=30)
        self.export_publisher.grid(row=1, column=1, sticky="w")
        self.export_history = tk.BooleanVar(value=False)
        ttk.Checkbutton(directory, text="Include superseded (history) values", variable=self.export_history).grid(
            row=2, column=0, columnspan=2, sticky="w"
        )
        ttk.Button(
            directory,
            text="Export observations",
            command=lambda: self.guard(self.export_directory_now, "Export failed"),
        ).grid(row=3, column=0, sticky="w", pady=(PAD, 0))
        self.export_result = readonly_text(tab, height=10)
        outer(self.export_result).grid(row=9, column=0, columnspan=3, sticky="nsew")
        tab.rowconfigure(9, weight=1)
        tab.columnconfigure(3, weight=1)

    def _browse_export(self) -> None:
        name = filedialog.asksaveasfilename(
            parent=self.root,
            title="Save evidence as",
            defaultextension=".json",
            filetypes=[("JSON", "*.json")],
            initialdir=str(self.paths.exports),
        )
        if name:
            self.export_path.set(name)

    def _open_exports(self) -> None:
        self.paths.exports.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            os.startfile(self.paths.exports)  # noqa: S606

    def export_now(self) -> None:
        keys = None if self.export_scope.get() == "all" else [self.export_firm.get()]
        if keys == [""]:
            raise RegistryError("choose a firm, or export all firms")
        out = Path(self.export_path.get()) if self.export_path.get().strip() else None
        csv_out = (out or self.paths.exports / "evidence.json").with_suffix(".csv") if self.export_csv.get() else None
        try:
            result = services.write_export(
                self.conn,
                self.paths,
                firm_keys=keys,
                generated_at=format_instant(self.clock.now()),
                out=out,
                include_attempts=self.export_attempts.get(),
                csv_out=csv_out,
            )
        except services.ExportInvalid as exc:
            set_text(self.export_result, "\n".join([str(exc), *exc.errors]))
            raise ValueError(str(exc)) from exc
        env = result.envelope
        set_text(
            self.export_result,
            "\n".join(
                [
                    f"Wrote {result.path}",
                    f"  export_id  {env.export_id}",
                    f"  firms {len(env.firms)}, snapshots {len(env.snapshots)}, attempts {len(env.attempts)}",
                    "  schema     collector-snapshot-v1: valid",
                    "  status     unverified evidence (not rules, not verified provider data)",
                    *([f"  csv        {result.csv_path}"] if result.csv_path else []),
                ]
            ),
        )
        self.status.set(f"Exported {len(env.snapshots)} snapshots to {result.path}")

    def export_directory_now(self) -> None:
        keys = None if self.export_publisher_scope.get() == "all" else [self.export_publisher.get()]
        if keys == [""]:
            raise RegistryError("choose a publisher, or export all publishers")
        out = Path(self.export_path.get()) if self.export_path.get().strip() else None
        try:
            result = services.write_directory_export(
                self.conn,
                self.paths,
                self.settings(),
                now=self.clock.now(),
                publisher_keys=keys,
                out=out,
                include_superseded=self.export_history.get(),
            )
        except services.ExportInvalid as exc:
            set_text(self.export_result, "\n".join([str(exc), *exc.errors]))
            raise ValueError(str(exc)) from exc
        summary = result.document["summary"]
        set_text(
            self.export_result,
            "\n".join(
                [
                    f"Wrote {result.path}",
                    f"  export_id  {result.document['export_id']}",
                    f"  records {summary['records']}, values {summary['observations']}, pages "
                    f"{len(result.document['pages'])}",
                    f"  statuses   {', '.join(f'{k} {v}' for k, v in summary['by_status'].items()) or '-'}",
                    "  schema     collector-directory-observations-v1: valid",
                    "  status     unverified third-party observations (not rules)",
                ]
            ),
        )
        self.status.set(f"Exported {summary['observations']} publisher values to {result.path}")

    def validate_file(self, path: Path) -> list[str]:
        import json

        try:
            document = json.loads(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return [f"not JSON: {exc}"]
        return validation_errors(document)

    def _validate_file(self) -> None:
        name = filedialog.askopenfilename(
            parent=self.root,
            title="Validate evidence file",
            filetypes=[("JSON", "*.json")],
            initialdir=str(self.paths.exports),
        )
        if not name:
            return
        errors = self.validate_file(Path(name))
        try:
            import json

            kind = schema_name(json.loads(Path(name).read_text(encoding="utf-8")))
        except (OSError, ValueError):
            kind = "collector-snapshot-v1"
        set_text(
            self.export_result,
            f"{name}: valid {kind}" if not errors else "\n".join([f"{name} does not match {kind}:", *errors]),
        )


# ---------------------------------------------------------------------- helpers


_PAGE_PROBLEMS = frozenset({"structure_changed", "js_unavailable", "parse_error"})


def summary_lines(summaries: list[RunSummary], *, dry_run: bool) -> list[str]:
    """The same run summary text as the services layer (kept here for callers of the Build 29 GUI)."""
    return services.summary_lines(summaries, dry_run=dry_run)


def _outcome(value: str | None) -> Outcome | None:
    try:
        return Outcome(value) if value else None
    except ValueError:
        return None


def _safe(text: str) -> str:
    return "".join(ch if ch in "\n\t" or (ord(ch) >= 32 and ord(ch) != 127) else "�" for ch in text)


def _int_or_none(value: str, what: str) -> int | None:
    text = value.strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError as exc:
        raise RegistryError(f"{what} must be a whole number") from exc


def _float_or_none(value: str, what: str) -> float | None:
    text = value.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError as exc:
        raise RegistryError(f"{what} must be a number") from exc


def _messagebox_notify(kind: str, title: str, message: str) -> None:
    {"info": messagebox.showinfo, "warning": messagebox.showwarning}.get(kind, messagebox.showerror)(title, message)


def main(argv: list[str] | None = None) -> None:
    """Entry point for `collector-gui` and `collector gui`."""
    import argparse

    parser = argparse.ArgumentParser(prog="collector-gui", description="FundedFlow collector desktop window")
    parser.add_argument("--data-dir", type=Path, default=None)
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--tab", default=None, help="Open on this tab, e.g. Firms or Fetch.")
    args = parser.parse_args(argv)
    root = tk.Tk()
    try:
        app = CollectorApp(
            root,
            data_dir=args.data_dir or _env_path("FFC_DATA_DIR"),
            config_path=args.config or _env_path("FFC_CONFIG"),
        )
    except KNOWN_ERRORS as exc:
        root.withdraw()
        messagebox.showerror("FundedFlow collector", str(exc))
        root.destroy()
        return

    def report(exc: type[BaseException], value: BaseException, tb: object) -> None:
        messagebox.showerror("Unexpected error", f"{exc.__name__}: {value}")

    root.report_callback_exception = report

    def on_close() -> None:
        app.close()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
    if args.tab:
        app.select_tab(args.tab)
    root.mainloop()


def _env_path(name: str) -> Path | None:
    value = os.environ.get(name)
    return Path(value) if value else None
