"""The Evidence tab: unverified publisher observations, from firm to programme to the values and their sources.

Left: firms, their programmes (with variant) and records (account size and phase), grouped across publishers.
Right: the values of the selected node with status and age, and the full provenance, history and the firm's own
stored pages for the selected value. Below: the review queue (conflicts, duplicates, uncertain identities, stale
pages). Review actions append notes and mappings only; nothing is approved and no rule is changed.
"""

from __future__ import annotations

import tkinter as tk
import webbrowser
from collections import defaultdict
from tkinter import ttk
from typing import TYPE_CHECKING

from fundedflow_collector.db.registry import RegistryError
from fundedflow_collector.directory import identity, review
from fundedflow_collector.directory.model import FIELDS, ObservationStatus
from fundedflow_collector.directory.review import ObservationView, ReviewItem
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

if TYPE_CHECKING:
    from fundedflow_collector.gui.app import CollectorApp

ALL = "All"
#: Worst first: a node shows the status that most needs attention among its values.
ATTENTION = (
    ObservationStatus.CONFLICTING,
    ObservationStatus.UNCERTAIN,
    ObservationStatus.STALE,
    ObservationStatus.SUPERSEDED,
    ObservationStatus.OBSERVED,
    ObservationStatus.OFFICIALLY_VERIFIED,
)
STATUS_TAGS = {
    ObservationStatus.CONFLICTING: "fail",
    ObservationStatus.UNCERTAIN: "warn",
    ObservationStatus.STALE: "warn",
    ObservationStatus.SUPERSEDED: "muted",
    ObservationStatus.OBSERVED: None,
    ObservationStatus.OFFICIALLY_VERIFIED: "ok",
}
STATUS_LABELS = {
    ObservationStatus.OBSERVED: "unverified",
    ObservationStatus.UNCERTAIN: "uncertain",
    ObservationStatus.CONFLICTING: "conflicting",
    ObservationStatus.STALE: "stale",
    ObservationStatus.SUPERSEDED: "superseded",
    ObservationStatus.OFFICIALLY_VERIFIED: "officially verified",
}


def _worst(views: list[ObservationView]) -> ObservationStatus:
    return min((v.status for v in views), key=ATTENTION.index, default=ObservationStatus.OBSERVED)


class EvidenceTab:
    def __init__(self, app: CollectorApp, notebook: ttk.Notebook) -> None:
        self.app = app
        self.views: list[ObservationView] = []
        self.items: list[ReviewItem] = []
        self.by_id: dict[str, ObservationView] = {}
        self.node_members: dict[str, list[ObservationView]] = {}
        tab = ttk.Frame(notebook, padding=PAD * 2)
        notebook.add(tab, text="Evidence")

        bar = ttk.Frame(tab)
        bar.grid(row=0, column=0, columnspan=2, sticky="we")
        ttk.Label(bar, text="Publisher").pack(side="left")
        self.publisher = ttk.Combobox(bar, state="readonly", width=24, values=[ALL])
        self.publisher.set(ALL)
        self.publisher.pack(side="left", padx=(PAD, PAD * 2))
        ttk.Label(bar, text="Status").pack(side="left")
        self.status = ttk.Combobox(
            bar, state="readonly", width=20, values=[ALL, *[STATUS_LABELS[s] for s in ATTENTION]]
        )
        self.status.set(ALL)
        self.status.pack(side="left", padx=(PAD, PAD * 2))
        ttk.Label(bar, text="Search").pack(side="left")
        self.search = tk.StringVar()
        entry = ttk.Entry(bar, textvariable=self.search, width=28)
        entry.pack(side="left", padx=(PAD, PAD * 2))
        entry.bind("<Return>", lambda _e: self.refresh())
        self.history = tk.BooleanVar(value=False)
        ttk.Checkbutton(bar, text="Include superseded values", variable=self.history, command=self.refresh).pack(
            side="left"
        )
        ttk.Button(bar, text="Refresh", command=self.refresh).pack(side="left", padx=PAD * 2)
        for combo in (self.publisher, self.status):
            combo.bind("<<ComboboxSelected>>", lambda _e: self.refresh())

        self.banner = tk.StringVar()
        ttk.Label(tab, textvariable=self.banner, style="Muted.TLabel", wraplength=1100).grid(
            row=1, column=0, columnspan=2, sticky="w", pady=(PAD, PAD)
        )

        panes = ttk.Panedwindow(tab, orient="horizontal")
        panes.grid(row=2, column=0, columnspan=2, sticky="nsew")
        left = ttk.Frame(panes)
        panes.add(left, weight=2)
        self.tree = scrolled_tree(
            left,
            [
                Column("publishers", "Publishers", 120),
                Column("values", "Values", 50),
                Column("status", "Status", 90),
                Column("observed", "Last observed", 115),
            ],
            height=14,
            hierarchy="Firm / programme / record",
            sortable=True,
        )
        outer(self.tree).pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", lambda _e: self.show_node())
        self.empty = ttk.Label(left, text="", style="Muted.TLabel", wraplength=480)
        self.empty.pack(anchor="w", pady=(PAD, 0))

        right = ttk.Frame(panes, padding=(PAD * 2, 0, 0, 0))
        panes.add(right, weight=3)
        self.fields = scrolled_tree(
            right,
            [
                Column("field", "Field", 195),
                Column("value", "Value", 120, stretch=True),
                Column("status", "Status", 90),
                Column("publisher", "Publisher", 125),
                Column("observed", "Observed", 115),
                Column("age", "Age (days)", 65),
            ],
            height=8,
            sortable=True,
        )
        outer(self.fields).pack(fill="both", expand=True)
        self.fields.bind("<<TreeviewSelect>>", lambda _e: self.show_observation())
        buttons = ttk.Frame(right)
        buttons.pack(fill="x", pady=PAD)
        ttk.Button(buttons, text="Open source page", command=self.open_page).pack(side="left")
        ttk.Button(buttons, text="Map firm name…", command=self.dialog_map).pack(side="left", padx=PAD)
        ttk.Button(buttons, text="Add note…", command=self.dialog_note).pack(side="left")
        ttk.Button(buttons, text="Record official check…", command=self.dialog_verify).pack(side="left", padx=PAD)
        self.details = readonly_text(right, height=12)
        outer(self.details).pack(fill="both", expand=True)

        queue = ttk.Frame(tab)
        queue.grid(row=3, column=0, columnspan=2, sticky="nsew", pady=(PAD * 2, 0))
        self.queue_title = tk.StringVar(value="Review queue")
        ttk.Label(queue, textvariable=self.queue_title, style="Title.TLabel").pack(anchor="w")
        self.queue = scrolled_tree(
            queue,
            [
                Column("kind", "Kind", 130),
                Column("title", "Item", 520, stretch=True),
                Column("publishers", "Publishers", 200),
                Column("note", "Note", 200),
            ],
            height=5,
            sortable=True,
        )
        outer(self.queue).pack(fill="both", expand=True, pady=PAD)
        self.queue.bind("<<TreeviewSelect>>", lambda _e: self.show_item())
        row = ttk.Frame(queue)
        row.pack(fill="x")
        ttk.Button(row, text="Dismiss with note…", command=self.dialog_dismiss).pack(side="left")
        ttk.Button(row, text="Different firms…", command=self.dialog_separate).pack(side="left", padx=PAD)
        tab.columnconfigure(0, weight=2)
        tab.columnconfigure(1, weight=3)
        tab.rowconfigure(2, weight=3)
        tab.rowconfigure(3, weight=1)

    # ------------------------------------------------------------------ loading

    def set_filters(
        self,
        *,
        publisher: str | None = None,
        status: str | None = None,
        search: str | None = None,
        history: bool | None = None,
    ) -> None:
        if publisher is not None:
            self.publisher.set(publisher)
        if status is not None:
            self.status.set(status)
        if search is not None:
            self.search.set(search)
        if history is not None:
            self.history.set(history)
        self.refresh()

    def refresh(self) -> None:
        app = self.app
        settings = app.settings()
        days = settings.directory.stale_after_days
        keys = [p.publisher_key for p in app.publishers()]
        self.publisher.configure(values=[ALL, *keys])
        if self.publisher.get() not in (ALL, *keys):
            self.publisher.set(ALL)
        chosen = None if self.publisher.get() == ALL else self.publisher.get()
        all_views = review.load(app.conn, now=app.clock.now(), stale_after_days=days, include_superseded=True)
        current_only = [v for v in all_views if v.current]
        self.items = review.review_items(current_only, app.conn, stale_after_days=days)
        views = all_views if self.history.get() else current_only
        if chosen is not None:
            views = [v for v in views if v.row["publisher_key"] == chosen]
        wanted = self.status.get()
        if wanted != ALL:
            views = [v for v in views if STATUS_LABELS[v.status] == wanted]
        needle = self.search.get().strip().lower()
        if needle:
            views = [v for v in views if needle in _haystack(v)]
        self.views = views
        self.by_id = {v.row["id"]: v for v in all_views}
        self._fill_tree(views)
        self._fill_queue(chosen)
        counts: dict[ObservationStatus, int] = defaultdict(int)
        for view in current_only:
            counts[view.status] += 1
        open_items = [i for i in self.items if not i.dismissed]
        kinds: dict[str, int] = defaultdict(int)
        for item in open_items:
            kinds[item.kind] += 1
        self.banner.set(
            "Every value here is an unverified third-party claim, not a rule. "
            f"{len(current_only)} current values: {counts[ObservationStatus.CONFLICTING]} conflicting, "
            f"{counts[ObservationStatus.UNCERTAIN]} uncertain, {counts[ObservationStatus.STALE]} stale. "
            f"Review queue: {kinds['conflict']} conflicts, {kinds['duplicate']} duplicates, "
            f"{kinds['uncertain_identity']} possible same-firm names, {kinds['stale']} stale pages."
        )
        if not all_views:
            self.empty.configure(
                text="No observations yet. Add a publisher on Research sources, then fetch it (when its terms allow) "
                "or import a saved page on Manual capture."
            )
        elif not views:
            self.empty.configure(text="Nothing matches these filters.")
        else:
            self.empty.configure(text="")
        self.show_node()

    def _fill_tree(self, views: list[ObservationView]) -> None:
        tree = self.tree
        selected = selected_id(tree)
        tree.delete(*tree.get_children())
        self.node_members = {}
        firms: dict[str, list[ObservationView]] = defaultdict(list)
        for view in views:
            firms[view.identity].append(view)
        for firm_id, firm_views in sorted(firms.items(), key=lambda kv: kv[1][0].row["firm_name"].lower()):
            names = sorted({v.row["firm_name"] for v in firm_views})
            label = names[0] + (f" (also shown as {', '.join(names[1:])})" if len(names) > 1 else "")
            if firm_views[0].mapped_firm_key:
                label += f"  → {firm_views[0].mapped_firm_key}"
            firm_node = self._insert("", f"f|{firm_id}", label, firm_views)
            programmes: dict[str, list[ObservationView]] = defaultdict(list)
            for view in firm_views:
                programmes[f"{view.row['programme_norm']}|{view.row['variant_norm']}"].append(view)
            for prog_key, prog_views in sorted(programmes.items()):
                first = prog_views[0].row
                text = first["programme_name"] or "(programme not shown)"
                if first["variant"]:
                    text += f" · {first['variant']}"
                prog_node = self._insert(firm_node, f"p|{firm_id}|{prog_key}", text, prog_views)
                records: dict[str, list[ObservationView]] = defaultdict(list)
                for view in prog_views:
                    records[view.comparison_key].append(view)
                for cmp_key, rec_views in sorted(records.items(), key=lambda kv: _record_label(kv[1][0])):
                    self._insert(prog_node, f"r|{cmp_key}", _record_label(rec_views[0]), rec_views)
        if selected and tree.exists(selected):
            tree.selection_set(selected)
            tree.see(selected)

    def _insert(self, parent: str, iid: str, text: str, views: list[ObservationView]) -> str:
        worst = _worst(views)
        tag = STATUS_TAGS[worst]
        self.tree.insert(
            parent,
            "end",
            iid=iid,
            text=text,
            values=(
                ", ".join(sorted({v.row["publisher_key"] for v in views})),
                len(views),
                STATUS_LABELS[worst],
                short_time(max(v.row["observed_at"] for v in views)),
            ),
            tags=(tag,) if tag else (),
            open=parent == "",
        )
        self.node_members[iid] = views
        return iid

    def _fill_queue(self, publisher: str | None) -> None:
        rows = []
        for item in self.items:
            if publisher is not None and publisher not in item.publishers:
                continue
            tag = "muted" if item.dismissed else ("fail" if item.kind == "conflict" else "warn")
            kind = item.kind.replace("_", " ") + (" (dismissed)" if item.dismissed else "")
            rows.append((item.key, (kind, item.title, ", ".join(item.publishers), item.note or ""), tag))
        fill_tree(self.queue, rows)
        open_count = sum(1 for i in self.items if not i.dismissed)
        self.queue_title.set(f"Review queue ({open_count} open)" if open_count else "Review queue (nothing to review)")

    # ------------------------------------------------------------------ showing

    def node_ids(self, parent: str = "") -> list[str]:
        return [str(i) for i in self.tree.get_children(parent)]

    def show_node(self) -> None:
        node = selected_id(self.tree)
        members = self.node_members.get(node or "", [])
        rows = []
        now = self.app.clock.now()
        for view in sorted(members, key=lambda v: (v.row["field"], v.row["publisher_key"], v.row["observed_at"])):
            age = view.age_days(now)
            rows.append(
                (
                    view.row["id"],
                    (
                        FIELDS[view.row["field"]].label,
                        view.display_value(),
                        STATUS_LABELS[view.status],
                        view.row["publisher_key"],
                        short_time(view.row["observed_at"]),
                        f"{age:.0f}" if age is not None else "",
                    ),
                    STATUS_TAGS[view.status],
                )
            )
        fill_tree(self.fields, rows)
        if not rows:
            set_text(
                self.details,
                "Select a firm, programme or record on the left to see its values." if self.views else "",
            )

    def select_node(self, iid: str) -> None:
        self.tree.selection_set(iid)
        self.show_node()

    def selected_view(self) -> ObservationView | None:
        obs = selected_id(self.fields)
        return self.by_id.get(obs) if obs else None

    def show_observation(self, observation_id: str | None = None) -> str:
        if observation_id is not None:
            self.fields.selection_set(observation_id)
        view = self.selected_view()
        if view is None:
            return ""
        row = view.row
        lines = [
            f"{FIELDS[row['field']].label}: {view.display_value()}   [{STATUS_LABELS[view.status]}]",
            "Unverified third-party claim." if not view.verified_by else "Officially checked by the operator.",
        ]
        if view.reasons:
            lines.append("Why: " + "; ".join(sorted(set(view.reasons))))
        lines += [
            "",
            f"Publisher    {row['publisher_name']} ({row['publisher_key']})",
            f"Firm         {row['firm_name']}  -> {view.mapped_firm_key or 'not mapped to a registered firm'}"
            f" ({view.mapping})",
            f"Programme    {row['programme_name'] or '-'}   variant {row['variant'] or '-'}",
            f"Size/phase   {row['account_size_raw'] or '-'}   {row['phase'].replace('_', ' ')}"
            f"   market {row['market']}",
            f"Shown as     {row['raw_label']}: {row['raw_value']}",
            f"Qualifier    {row['publisher_qualifier'] or '-'}",
            f"Page         {row['page_url']}",
            f"Observed     {row['observed_at']} via {row['capture_channel']}",
            f"Snapshot     {row['snapshot_id']}",
            f"Hash         {row['content_hash']}",
            f"Adapter      {row['adapter_name']} {row['adapter_version']} at {row['location']}",
            f"Official     {row['first_party_url'] or '-'} (as linked by the publisher; never fetched automatically)",
            "",
            "History of this value:",
        ]
        for point in review.field_history(self.app.conn, row["record_key"], row["field"]):
            mark = "CHANGED " if point.changed else "        "
            lines.append(f"  {point.observed_at}  {mark}{point.value}  (last seen {point.last_seen or '-'})")
        if view.mapped_firm_key:
            lines += ["", f"{view.mapped_firm_key}'s own stored pages on this topic (read both; nothing is decided):"]
            excerpts = review.official_evidence(self.app.conn, view.mapped_firm_key, row["field"])
            lines += [f"  {e.captured_at}  {e.url}\n    {e.excerpt}" for e in excerpts] or [
                "  none stored. Collect the firm's own rules pages (Firms tab) to compare."
            ]
        text = "\n".join(lines)
        set_text(self.details, text)
        return text

    def show_item(self) -> None:
        key = selected_id(self.queue)
        item = next((i for i in self.items if i.key == key), None)
        if item is None:
            return
        first = self.by_id.get(item.observation_ids[0]) if item.observation_ids else None
        if first is not None:
            for node in (f"r|{first.comparison_key}", f"f|{first.identity}"):
                if self.tree.exists(node):
                    self.tree.see(node)
                    self.tree.selection_set(node)
                    self.show_node()
                    break
        set_text(self.details, f"{item.title}\n\n{item.detail}\n\nKey: {item.key}\nNote: {item.note or '-'}")

    def open_page(self) -> None:
        view = self.selected_view()
        if view is None:
            self.app.notify("warning", "No value selected", "Select a value first.")
            return
        webbrowser.open(view.row["page_url"])  # the operator's own browser, on the publisher's public page

    # ------------------------------------------------------------------ review actions (what the tests call)

    def map_firm(self, publisher_key: str, firm_name: str, firm_key: str, note: str = "") -> None:
        subject = review.firm_name_subject(publisher_key, identity.norm_firm(firm_name))
        review.record_action(
            self.app.conn,
            action="map_firm",
            subject_type="firm_name",
            subject_key=subject,
            now=self.app.clock.now(),
            firm_key=firm_key,
            note=note,
        )
        self.refresh()

    def annotate(self, key: str, note: str, *, dismiss: bool = False) -> None:
        review.record_action(
            self.app.conn,
            action="dismiss" if dismiss else "annotate",
            subject_type="observation" if key.startswith("obs_") else "review_item",
            subject_key=key,
            now=self.app.clock.now(),
            note=note,
        )
        self.refresh()

    def mark_separate(self, key: str, note: str = "") -> None:
        if not key.startswith("pair|"):
            raise RegistryError("choose a 'possible same firm' item")
        review.record_action(
            self.app.conn,
            action="keep_separate",
            subject_type="review_item",
            subject_key=key,
            now=self.app.clock.now(),
            note=note,
        )
        self.refresh()

    def verify(self, observation_id: str, snapshot_id: str, note: str) -> None:
        review.record_action(
            self.app.conn,
            action="verify_official",
            subject_type="observation",
            subject_key=observation_id,
            now=self.app.clock.now(),
            note=note,
            official_snapshot_id=snapshot_id,
        )
        self.refresh()

    # ------------------------------------------------------------------ dialogs

    def dialog_map(self) -> None:
        view = self.selected_view()
        if view is None:
            self.app.notify("warning", "No value selected", "Select a value of the firm first.")
            return
        firms = self.app.firm_keys()
        if not firms:
            self.app.notify("warning", "No firms", "Register the firm on the Firms tab first.")
            return
        values = FormDialog(
            self.app.root,
            "Map a publisher's firm name",
            [Field("firm", "Registered firm", "combo", firms, view.mapped_firm_key or firms[0]), Field("note", "Note")],
            intro=f"{view.row['publisher_key']} shows '{view.row['firm_name']}'. Which registered firm is it? This "
            "only changes grouping and comparison; nothing is approved.",
        ).show()
        if values:
            self.app.guard(
                lambda: self.map_firm(
                    view.row["publisher_key"], view.row["firm_name"], str(values["firm"]), str(values["note"])
                )
            )

    def dialog_note(self) -> None:
        view = self.selected_view()
        if view is None:
            self.app.notify("warning", "No value selected", "Select a value first.")
            return
        values = FormDialog(self.app.root, "Add a note", [Field("note", "Note", width=70)]).show()
        if values:
            self.app.guard(lambda: self.annotate(view.row["id"], str(values["note"])))

    def dialog_verify(self) -> None:
        view = self.selected_view()
        if view is None:
            self.app.notify("warning", "No value selected", "Select a value first.")
            return
        values = FormDialog(
            self.app.root,
            "Record an official check",
            [
                Field("snapshot", "Official snapshot id", hint="A snapshot of the firm's OWN page (Results tab)."),
                Field("note", "What you checked", width=70),
            ],
            intro="Only do this after reading the value on the firm's own stored page. Agreement between comparison "
            "sites is not an official check. This records your check; it changes no rule.",
        ).show()
        if values:
            self.app.guard(lambda: self.verify(view.row["id"], str(values["snapshot"]).strip(), str(values["note"])))

    def dialog_dismiss(self) -> None:
        key = selected_id(self.queue)
        if key is None:
            self.app.notify("warning", "No item selected", "Select a review item first.")
            return
        values = FormDialog(
            self.app.root, "Dismiss review item", [Field("note", "Why", width=70)], intro="The values are kept."
        ).show()
        if values:
            self.app.guard(lambda: self.annotate(key, str(values["note"]), dismiss=True))

    def dialog_separate(self) -> None:
        key = selected_id(self.queue)
        if key is None:
            self.app.notify("warning", "No item selected", "Select a 'possible same firm' item first.")
            return
        values = FormDialog(self.app.root, "Different firms", [Field("note", "Note", width=70)]).show()
        if values:
            self.app.guard(lambda: self.mark_separate(key, str(values["note"])))


def _record_label(view: ObservationView) -> str:
    row = view.row
    size = row["account_size_raw"] or "size not shown"
    phase = "phase not shown" if row["phase"] == "unspecified" else row["phase"].replace("_", " ")
    return f"{size} · {phase}"


def _haystack(view: ObservationView) -> str:
    row = view.row
    parts = [
        row["firm_name"],
        row["programme_name"] or "",
        row["variant"] or "",
        row["publisher_key"],
        FIELDS[row["field"]].label,
        view.display_value(),
        row["raw_value"],
        row["account_size_raw"] or "",
    ]
    return " ".join(parts).lower()
