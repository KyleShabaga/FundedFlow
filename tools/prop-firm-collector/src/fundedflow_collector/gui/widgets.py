"""Small tkinter building blocks: scrolled tables, read-only text and a simple form dialog."""

from __future__ import annotations

import tkinter as tk
from collections.abc import Sequence
from dataclasses import dataclass
from tkinter import ttk
from typing import cast

PAD = 6


@dataclass(frozen=True)
class Column:
    key: str
    heading: str
    width: int = 120
    stretch: bool = False


def outer(widget: tk.Widget) -> tk.Widget:
    """The frame that `scrolled_tree` / `readonly_text` packed the widget (and its scrollbar) into."""
    return cast(tk.Widget, widget.master)


def scrolled_tree(parent: tk.Misc, columns: Sequence[Column], height: int = 8) -> ttk.Treeview:
    """A Treeview table with a vertical scrollbar, packed into its own frame (the frame is the tree's master)."""
    frame = ttk.Frame(parent)
    tree = ttk.Treeview(frame, columns=[c.key for c in columns], show="headings", height=height, selectmode="browse")
    for column in columns:
        tree.heading(column.key, text=column.heading, anchor="w")
        tree.column(column.key, width=column.width, stretch=column.stretch, anchor="w")
    bar = ttk.Scrollbar(frame, orient="vertical", command=tree.yview)
    tree.configure(yscrollcommand=bar.set)
    tree.grid(row=0, column=0, sticky="nsew")
    bar.grid(row=0, column=1, sticky="ns")
    frame.rowconfigure(0, weight=1)
    frame.columnconfigure(0, weight=1)
    tree.tag_configure("ok", foreground="#1b6e2a")
    tree.tag_configure("warn", foreground="#9a5b00")
    tree.tag_configure("fail", foreground="#b00020")
    tree.tag_configure("muted", foreground="#6b6b6b")
    return tree


def fill_tree(tree: ttk.Treeview, rows: Sequence[tuple[str, Sequence[object], str | None]]) -> None:
    """Replace all rows. Each row is (item id, values, tag or None). Keeps the selection if the id still exists."""
    selected = tree.selection()
    tree.delete(*tree.get_children())
    for iid, values, tag in rows:
        shown = ["-" if v is None or v == "" else str(v) for v in values]
        tree.insert("", "end", iid=iid, values=shown, tags=(tag,) if tag else ())
    keep = [s for s in selected if tree.exists(s)]
    if keep:
        tree.selection_set(keep)


def selected_id(tree: ttk.Treeview) -> str | None:
    selection = tree.selection()
    return str(selection[0]) if selection else None


def readonly_text(parent: tk.Misc, height: int = 10) -> tk.Text:
    frame = ttk.Frame(parent)
    text = tk.Text(
        frame,
        height=height,
        wrap="word",
        state="disabled",
        font=("Consolas", 10),
        relief="flat",
        background="#fbfbfb",
        padx=PAD,
        pady=PAD,
    )
    bar = ttk.Scrollbar(frame, orient="vertical", command=text.yview)
    text.configure(yscrollcommand=bar.set)
    text.grid(row=0, column=0, sticky="nsew")
    bar.grid(row=0, column=1, sticky="ns")
    frame.rowconfigure(0, weight=1)
    frame.columnconfigure(0, weight=1)
    return text


def set_text(text: tk.Text, content: str) -> None:
    text.configure(state="normal")
    text.delete("1.0", "end")
    text.insert("1.0", content)
    text.configure(state="disabled")


def append_text(text: tk.Text, line: str) -> None:
    text.configure(state="normal")
    text.insert("end", line + "\n")
    text.see("end")
    text.configure(state="disabled")


@dataclass
class Field:
    name: str
    label: str
    kind: str = "entry"  # entry | combo | check
    choices: Sequence[str] = ()
    default: str | bool = ""
    hint: str = ""
    width: int = 48


class FormDialog(tk.Toplevel):
    """A modal form. After `show()`, `result` holds the entered values, or None if cancelled."""

    def __init__(self, parent: tk.Misc, title: str, fields: Sequence[Field], intro: str = "") -> None:
        super().__init__(parent)
        self.title(title)
        self.transient(parent.winfo_toplevel())
        self.resizable(False, False)
        self.result: dict[str, str | bool] | None = None
        self._vars: dict[str, tk.StringVar | tk.BooleanVar] = {}
        body = ttk.Frame(self, padding=12)
        body.grid(row=0, column=0, sticky="nsew")
        row = 0
        if intro:
            ttk.Label(body, text=intro, wraplength=460, justify="left").grid(
                row=row, column=0, columnspan=2, sticky="w", pady=(0, 8)
            )
            row += 1
        first: tk.Widget | None = None
        for spec in fields:
            widget: tk.Widget
            if spec.kind == "check":
                var: tk.StringVar | tk.BooleanVar = tk.BooleanVar(value=bool(spec.default))
                widget = ttk.Checkbutton(body, text=spec.label, variable=var)
                widget.grid(row=row, column=0, columnspan=2, sticky="w", pady=2)
            else:
                ttk.Label(body, text=spec.label).grid(row=row, column=0, sticky="w", padx=(0, 8), pady=2)
                var = tk.StringVar(value=str(spec.default))
                if spec.kind == "combo":
                    widget = ttk.Combobox(
                        body, textvariable=var, values=list(spec.choices), state="readonly", width=spec.width - 3
                    )
                else:
                    widget = ttk.Entry(body, textvariable=var, width=spec.width)
                widget.grid(row=row, column=1, sticky="we", pady=2)
            self._vars[spec.name] = var
            first = first or widget
            row += 1
            if spec.hint:
                ttk.Label(body, text=spec.hint, foreground="#6b6b6b", wraplength=440, justify="left").grid(
                    row=row, column=1, sticky="w", pady=(0, 4)
                )
                row += 1
        buttons = ttk.Frame(body)
        buttons.grid(row=row, column=0, columnspan=2, sticky="e", pady=(10, 0))
        ttk.Button(buttons, text="Cancel", command=self.destroy).pack(side="right")
        ttk.Button(buttons, text="OK", command=self._ok).pack(side="right", padx=(0, 6))
        self.bind("<Return>", lambda _e: self._ok())
        self.bind("<Escape>", lambda _e: self.destroy())
        if first is not None:
            first.focus_set()

    def _ok(self) -> None:
        self.result = {name: var.get() for name, var in self._vars.items()}
        self.destroy()

    def show(self) -> dict[str, str | bool] | None:
        self.grab_set()
        self.wait_window()
        return self.result
