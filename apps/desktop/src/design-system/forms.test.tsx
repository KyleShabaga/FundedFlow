// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type FormEvent, useRef, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  Button,
  Checkbox,
  ChipGroup,
  DisclosureButton,
  FieldGroup,
  FileDropzone,
  focusFirstInvalid,
  focusFirstInvalidWhenShown,
  useWindowFileDropGuard,
  formatFileSize,
  IconButton,
  RadioGroup,
  SearchField,
  SegmentedControl,
  Select,
  Switch,
  Textarea,
  TextField,
  ValidationSummary,
  type ValidationIssue,
} from "./index";

// Radix Select measures and captures pointers; jsdom has neither.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

describe("Button", () => {
  it("ignores clicks while loading and stays focusable", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(btn);
    btn.focus();
    await userEvent.keyboard("{Enter}");
    expect(onClick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(btn);
  });
  it("explains why it is disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled disabledReason="Choose an account first" onClick={onClick}>Import</Button>);
    const btn = screen.getByRole("button", { name: "Import" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Choose an account first").id).toBe(btn.getAttribute("aria-describedby"));
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("uses the native disabled state without a reason", () => {
    render(<Button disabled>Import</Button>);
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("names icon-only buttons", () => {
    render(<IconButton label="Next month" icon={<span aria-hidden="true">›</span>} />);
    expect(screen.getByRole("button", { name: "Next month" })).toBeTruthy();
  });
});

describe("DisclosureButton (P0-D18)", () => {
  function Harness({ count }: { count?: number | null }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <DisclosureButton expanded={open} controls="panel" count={count} countLabel={n => `${n} filters applied`} onClick={() => setOpen(o => !o)}>Filters</DisclosureButton>
        <section id="panel" aria-label="Panel" hidden={!open}>Body</section>
      </>
    );
  }
  it("links to its region, reports the open state and toggles with the keyboard", async () => {
    render(<Harness />);
    const btn = screen.getByRole("button", { name: "Filters" });
    expect(btn.getAttribute("aria-controls")).toBe("panel");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.className).not.toMatch(/is-expanded/);
    btn.focus();
    await userEvent.keyboard("{Enter}");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.className).toMatch(/is-expanded/);
    expect(screen.getByRole("region", { name: "Panel" })).toBeTruthy();
    await userEvent.keyboard(" ");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "Panel" })).toBeNull();
  });
  it("shows a count with its words for screen readers, and none for zero", () => {
    render(<Harness count={3} />);
    const btn = screen.getByRole("button", { name: "Filters, 3 filters applied" });
    expect(btn.textContent).toContain("· 3");
    cleanup();
    render(<Harness count={0} />);
    expect(screen.getByRole("button", { name: "Filters" }).textContent).not.toContain("·");
  });
});

describe("SegmentedControl", () => {
  it("marks the chosen option pressed and reports changes", async () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        label="Status"
        value="all"
        onValueChange={onValueChange}
        options={[{ value: "all", label: "All", count: 5 }, { value: "errors", label: "Errors", count: 0 }]}
      />,
    );
    expect(screen.getByRole("group", { name: "Status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All 5" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Errors 0" }));
    expect(onValueChange).toHaveBeenCalledWith("errors");
  });
});

describe("TextField", () => {
  it("links label, description and error", () => {
    render(<TextField label="Starting balance" description="From your firm's dashboard" error="Enter an amount" required numeric />);
    const input = screen.getByRole("textbox", { name: /Starting balance/ });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((input as HTMLInputElement).required).toBe(true);
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ");
    const texts = described.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(["From your firm's dashboard", "Enter an amount"]);
  });
  it("has no error state without an error", () => {
    render(<TextField label="Name" />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(input.getAttribute("aria-describedby")).toBeNull();
  });
  it("works uncontrolled and honours read-only", async () => {
    render(
      <>
        <TextField label="Note" defaultValue="Plan" />
        <TextField label="Account ID" value="PA-1" readOnly />
      </>,
    );
    const note = screen.getByRole("textbox", { name: "Note" }) as HTMLInputElement;
    await userEvent.type(note, " A");
    expect(note.value).toBe("Plan A");
    const id = screen.getByRole("textbox", { name: "Account ID" }) as HTMLInputElement;
    await userEvent.type(id, "x");
    expect(id.value).toBe("PA-1");
  });
  it("keeps a very long value intact", async () => {
    const long = "A".repeat(400);
    render(<Textarea label="Review" defaultValue={long} />);
    expect((screen.getByRole("textbox", { name: "Review" }) as HTMLTextAreaElement).value).toHaveLength(400);
  });
});

describe("SearchField", () => {
  function Search() {
    const [q, setQ] = useState("");
    return <SearchField label="Search accounts" value={q} onValueChange={setQ} placeholder="Search name, firm or ID" />;
  }
  it("clears with the button and with Escape, keeping focus", async () => {
    render(<Search />);
    const box = screen.getByRole("searchbox", { name: "Search accounts" }) as HTMLInputElement;
    await userEvent.type(box, "apex");
    await userEvent.click(screen.getByRole("button", { name: "Clear search accounts" }));
    expect(box.value).toBe("");
    expect(document.activeElement).toBe(box);
    await userEvent.type(box, "top{Escape}");
    expect(box.value).toBe("");
    expect(screen.queryByRole("button", { name: /Clear/ })).toBeNull();
  });
});

describe("Checkbox, Switch and RadioGroup", () => {
  it("shows the mixed state", () => {
    render(<Checkbox label="Select all" indeterminate />);
    const box = screen.getByRole("checkbox", { name: "Select all" }) as HTMLInputElement;
    expect(box.indeterminate).toBe(true);
    expect(box.getAttribute("aria-checked")).toBe("mixed");
  });
  it("toggles a switch with Space", async () => {
    const onChange = vi.fn();
    render(<Switch label="Follow the OS theme" onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Follow the OS theme" });
    sw.focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((sw as HTMLInputElement).checked).toBe(true);
  });
  it("does not toggle when disabled", async () => {
    render(<Checkbox label="Archive" disabled />);
    const box = screen.getByRole("checkbox", { name: "Archive" }) as HTMLInputElement;
    await userEvent.click(box);
    expect(box.checked).toBe(false);
  });
  it("moves through radios with the arrow keys", async () => {
    const onValueChange = vi.fn();
    function Pick() {
      const [v, setV] = useState<"long" | "short">("long");
      return (
        <RadioGroup
          label="Side"
          value={v}
          onValueChange={(next) => {
            setV(next);
            onValueChange(next);
          }}
          options={[{ value: "long", label: "Long" }, { value: "short", label: "Short" }]}
          error="Pick a side"
        />
      );
    }
    render(<Pick />);
    const group = screen.getByRole("radiogroup", { name: /Side/ });
    expect(group.getAttribute("aria-invalid")).toBe("true");
    screen.getByRole("radio", { name: "Long" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onValueChange).toHaveBeenLastCalledWith("short");
    expect((screen.getByRole("radio", { name: "Short" }) as HTMLInputElement).checked).toBe(true);
  });
  it("lays options out as cards with their descriptions linked, keeping native radio behaviour", async () => {
    const onValueChange = vi.fn();
    render(<RadioGroup label="What to export" cards defaultValue="archive" onValueChange={onValueChange}
      options={[{ value: "archive", label: "Full backup", description: "Restorable." }, { value: "csv", label: "Trade CSV", description: "Not a backup." }]} />);
    const group = screen.getByRole("radiogroup", { name: "What to export" });
    expect(group.classList.contains("is-cards")).toBe(true);
    const csv = screen.getByRole("radio", { name: "Trade CSV" });
    expect(csv.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(csv.getAttribute("aria-describedby")!)?.textContent).toBe("Not a backup.");
    await userEvent.click(screen.getByText("Trade CSV"));
    expect(onValueChange).toHaveBeenLastCalledWith("csv");
  });
});

describe("ChipGroup", () => {
  it("is a labelled group of pressed/unpressed buttons that toggles values by keyboard", async () => {
    function Demo() {
      const [value, setValue] = useState<string[]>(["a"]);
      return <ChipGroup label="Mistakes" tone="warn" value={value} onValueChange={setValue} options={[{ value: "a", label: "Chased" }, { value: "b", label: "Moved stop" }, { value: "c", label: "Old", note: "Archived", disabled: true }]} />;
    }
    render(<Demo />);
    const group = screen.getByRole("group", { name: "Mistakes" });
    expect(group).toBeTruthy();
    const chased = screen.getByRole("button", { name: "Chased" });
    const moved = screen.getByRole("button", { name: "Moved stop" });
    expect(chased.getAttribute("aria-pressed")).toBe("true");
    expect(moved.getAttribute("aria-pressed")).toBe("false");
    // P0-D25: a selected chip has no checkmark; its state is aria-pressed (and the selected styling), not an icon.
    expect(chased.querySelector("svg")).toBeNull();
    expect(chased.textContent).toBe("Chased");
    moved.focus();
    await userEvent.keyboard(" ");
    expect(moved.getAttribute("aria-pressed")).toBe("true");
    expect(moved.querySelector("svg")).toBeNull();
    await userEvent.click(chased);
    expect(chased.getAttribute("aria-pressed")).toBe("false");
    const old = screen.getByRole("button", { name: "Old, Archived" }) as HTMLButtonElement;
    expect(old.disabled).toBe(true);
  });

  it("shows the empty text when there are no options", () => {
    render(<ChipGroup label="Setups" value={[]} onValueChange={() => {}} options={[]} empty="No setups yet" />);
    expect(screen.getByText("No setups yet")).toBeTruthy();
  });
});

describe("Select", () => {
  it("opens from the keyboard, picks an option and returns focus", async () => {
    const onValueChange = vi.fn();
    render(
      <Select
        label="Import into"
        placeholder="Choose an account"
        onValueChange={onValueChange}
        options={[{ value: "a", label: "Apex $100K" }, { value: "b", label: "Topstep $50K", disabled: true }, { value: "c", label: "Personal" }]}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Import into" });
    expect(trigger.textContent).toContain("Choose an account");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Apex $100K", "Topstep $50K", "Personal"]);
    expect(options[1].getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(screen.getByRole("option", { name: "Personal" }));
    expect(onValueChange).toHaveBeenCalledWith("c");
    expect(document.activeElement).toBe(trigger);
  });
  it("closes on Escape without choosing", async () => {
    const onValueChange = vi.fn();
    render(<Select label="Rows per page" defaultValue="10" onValueChange={onValueChange} options={[{ value: "10", label: "10" }, { value: "25", label: "25" }]} />);
    const trigger = screen.getByRole("combobox", { name: "Rows per page" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    await screen.findAllByRole("option");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onValueChange).not.toHaveBeenCalled();
    expect(trigger.textContent).toContain("10");
  });
  it("reports an error on the trigger", () => {
    render(<Select label="Time zone" error="Choose a time zone" options={[]} />);
    const trigger = screen.getByRole("combobox", { name: "Time zone" });
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(trigger.getAttribute("aria-describedby")!)?.textContent).toBe("Choose a time zone");
  });
});

describe("Validation", () => {
  function Form() {
    const ref = useRef<HTMLFormElement>(null);
    const [issues, setIssues] = useState<ValidationIssue[]>([]);
    const [name, setName] = useState("");
    const [size, setSize] = useState("");
    const submit = (e: FormEvent) => {
      e.preventDefault();
      const next: ValidationIssue[] = [];
      if (!name) next.push({ fieldId: "acct-name", message: "Enter an account name" });
      if (!size) next.push({ fieldId: "acct-size", message: "Enter the starting balance" });
      setIssues(next);
      // Focus after the error props render.
      queueMicrotask(() => focusFirstInvalid(ref.current));
    };
    const errorFor = (id: string) => issues.find((i) => i.fieldId === id)?.message;
    return (
      <form ref={ref} onSubmit={submit} noValidate>
        <ValidationSummary issues={issues} />
        <FieldGroup label="Account">
          <TextField id="acct-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errorFor("acct-name")} />
          <TextField id="acct-size" label="Starting balance" value={size} onChange={(e) => setSize(e.target.value)} error={errorFor("acct-size")} />
        </FieldGroup>
        <Button type="submit" variant="primary">Save</Button>
      </form>
    );
  }
  it("lists problems, focuses the first invalid field and links to each", async () => {
    render(<Form />);
    await userEvent.type(screen.getByRole("textbox", { name: "Starting balance" }), "50000");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {});
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Fix 1 problem before saving");
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Starting balance" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await act(async () => {});
    expect(screen.getByRole("alert").textContent).toContain("Fix 2 problems before saving");
    await userEvent.click(screen.getByRole("link", { name: "Enter the starting balance" }));
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Starting balance" }));
  });
  it("renders nothing without issues", () => {
    const { container } = render(<ValidationSummary issues={[]} />);
    expect(container.innerHTML).toBe("");
  });

  // Build 26: repository field errors render on React Query's schedule, after any microtask from the submit handler.
  function ServerForm({ answer }: { answer: Promise<string | null> }) {
    const ref = useRef<HTMLFormElement>(null);
    const [error, setError] = useState<string | undefined>();
    const submit = (e: FormEvent) => {
      e.preventDefault();
      void answer.then(message => {
        setTimeout(() => setError(message ?? undefined), 20);
        focusFirstInvalidWhenShown(ref.current);
      });
    };
    return (
      <form ref={ref} onSubmit={submit} noValidate>
        <TextField label="Name" defaultValue="Eval" error={error} />
        <TextField label="Notes" />
        <Button type="submit" variant="primary">Save</Button>
      </form>
    );
  }
  it("focuses a field whose error renders after the submit handler has finished", async () => {
    render(<ServerForm answer={Promise.resolve("Already used")} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Name" })));
  });
  it("leaves focus alone when the user has moved on before the error appears", async () => {
    let answer!: (value: string) => void;
    render(<ServerForm answer={new Promise(resolve => { answer = resolve; })} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const notes = screen.getByRole("textbox", { name: "Notes" });
    await act(async () => answer("Already used"));
    notes.focus();
    await vi.waitFor(() => expect(screen.getByRole("textbox", { name: "Name" }).getAttribute("aria-invalid")).toBe("true"));
    expect(document.activeElement).toBe(notes);
  });
});

describe("FileDropzone", () => {
  // What WebView2 and Chromium hand a drop target for files from the operating system.
  const files = (...list: File[]) => ({ dataTransfer: { files: list, types: ["Files"], dropEffect: "none" } });
  const csv = (name = "Performance.csv") => new File(["a,b"], name, { type: "text/csv" });
  const zone = () => screen.getByRole("group", { name: "Choose a CSV file" });

  it("hands dropped and browsed files to the caller", async () => {
    const onFiles = vi.fn();
    const { container } = render(<FileDropzone label="Choose a CSV file" hint="CSV up to 10 MB" accept=".csv" onFiles={onFiles} />);
    const file = csv();
    fireEvent.drop(zone(), files(file));
    expect(onFiles).toHaveBeenLastCalledWith([file]);
    await userEvent.upload(container.querySelector('input[type="file"]') as HTMLInputElement, file);
    expect(onFiles).toHaveBeenCalledTimes(2);
    expect(onFiles).toHaveBeenLastCalledWith([file]);
  });
  it("accepts the drop, highlights while a file is over it and clears when the drag leaves", () => {
    render(<FileDropzone label="Choose a CSV file" onFiles={() => {}} />);
    const over = files(csv());
    expect(fireEvent.dragEnter(zone(), over)).toBe(false); // cancelled = this zone accepts the drop
    expect(over.dataTransfer.dropEffect).toBe("copy");
    expect(zone().className).toContain("is-dragging");
    expect(screen.getByText("Release to use this file")).toBeTruthy();
    // Moving onto a child of the zone is not leaving it; leaving the zone clears the highlight.
    // (jsdom's DragEvent drops relatedTarget, so the leave is built as a MouseEvent carrying dataTransfer.)
    const leave = (to: Element) => {
      const e = new MouseEvent("dragleave", { bubbles: true, relatedTarget: to });
      Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], files: [] } });
      act(() => { zone().dispatchEvent(e); });
    };
    leave(screen.getByText("Choose a CSV file"));
    expect(zone().className).toContain("is-dragging");
    leave(document.body);
    expect(zone().className).not.toContain("is-dragging");
  });
  it("clears the highlight when the drag is cancelled elsewhere", () => {
    render(<FileDropzone label="Choose a CSV file" onFiles={() => {}} />);
    fireEvent.dragEnter(zone(), files(csv()));
    act(() => { window.dispatchEvent(new Event("dragend")); });
    expect(zone().className).not.toContain("is-dragging");
  });
  it("clears the highlight when dragover stops without a dragleave (a cancelled OS drag)", () => {
    vi.useFakeTimers();
    try {
      render(<FileDropzone label="Choose a CSV file" onFiles={() => {}} />);
      fireEvent.dragEnter(zone(), files(csv()));
      act(() => { vi.advanceTimersByTime(300); });
      fireEvent.dragOver(zone(), files(csv()));
      act(() => { vi.advanceTimersByTime(300); });
      expect(zone().className).toContain("is-dragging");
      act(() => { vi.advanceTimersByTime(200); });
      expect(zone().className).not.toContain("is-dragging");
    } finally {
      vi.useRealTimers();
    }
  });
  it("ignores drags that carry no files", () => {
    const onFiles = vi.fn();
    render(<FileDropzone label="Choose a CSV file" onFiles={onFiles} />);
    expect(fireEvent.dragOver(zone(), { dataTransfer: { types: ["text/plain"], files: [] } })).toBe(true);
    fireEvent.drop(zone(), { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(onFiles).not.toHaveBeenCalled();
    expect(zone().className).not.toContain("is-dragging");
  });
  it("reports several files on a single-file zone instead of keeping the first", () => {
    const onFiles = vi.fn();
    const onTooMany = vi.fn();
    render(<FileDropzone label="Choose a CSV file" onFiles={onFiles} onTooMany={onTooMany} />);
    fireEvent.drop(zone(), files(csv("a.csv"), csv("b.csv")));
    expect(onTooMany).toHaveBeenCalledWith(2);
    expect(onFiles).not.toHaveBeenCalled();
  });
  it("refuses drops while disabled", () => {
    const onFiles = vi.fn();
    render(<FileDropzone label="Choose a CSV file" disabled onFiles={onFiles} />);
    const over = files(csv());
    fireEvent.dragOver(zone(), over);
    expect(over.dataTransfer.dropEffect).toBe("none");
    fireEvent.drop(zone(), files(csv()));
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Browse…" })).toHaveProperty("disabled", true);
  });
  it("replaces the chosen file by drop or picker, and the same file can be chosen again", async () => {
    const onFiles = vi.fn();
    const { container } = render(<FileDropzone label="Choose a CSV file" onFiles={onFiles} selected={{ name: "Performance.csv", size: 3 }} />);
    fireEvent.dragEnter(container.querySelector(".ds-dropzone")!, files(csv()));
    expect(screen.getByText("Release to replace this file")).toBeTruthy();
    fireEvent.drop(container.querySelector(".ds-dropzone")!, files(csv("Next.csv")));
    expect(onFiles).toHaveBeenLastCalledWith([expect.objectContaining({ name: "Next.csv" })]);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    await userEvent.click(screen.getByRole("button", { name: "Choose another…" }));
    expect(click).toHaveBeenCalled();
    const same = csv();
    await userEvent.upload(input, same);
    await userEvent.upload(input, same);
    expect(onFiles).toHaveBeenCalledTimes(3);
    expect(input.value).toBe("");
  });
  it("keeps a unicode file name intact", () => {
    render(<FileDropzone label="Choose a CSV file" onFiles={() => {}} selected={{ name: "Trades — Zürich 東京 📈.csv", size: 10 }} />);
    expect(screen.getByText("Trades — Zürich 東京 📈.csv").getAttribute("title")).toBe("Trades — Zürich 東京 📈.csv");
  });
  it("lets the host replace the browser picker", async () => {
    const onBrowse = vi.fn();
    render(<FileDropzone label="Choose a CSV file" onFiles={() => {}} onBrowse={onBrowse} />);
    await userEvent.click(screen.getByRole("button", { name: "Browse…" }));
    expect(onBrowse).toHaveBeenCalled();
  });
  it("summarises the chosen file and shows errors", () => {
    render(<FileDropzone label="Choose a CSV file" onFiles={() => {}} selected={{ name: "Performance.csv", size: 10035 }} error="File is over 10 MB" />);
    expect(screen.getByText("Performance.csv")).toBeTruthy();
    expect(screen.getByText("9.8 KB")).toBeTruthy();
    expect(screen.getByText("File is over 10 MB")).toBeTruthy();
  });
  it("formats sizes and treats unknown size as unknown", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatFileSize(null)).toBe("—");
  });
});

describe("useWindowFileDropGuard", () => {
  function Host({ zone }: { zone: boolean }) {
    useWindowFileDropGuard();
    return zone ? <FileDropzone label="Choose a CSV file" onFiles={() => {}} /> : <p>Elsewhere</p>;
  }
  const fileDrag = (type: "dragover" | "drop") => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    event.dataTransfer = { types: ["Files"], files: [], dropEffect: "copy" };
    return event as Event & { dataTransfer: { dropEffect: string } };
  };
  it("stops a stray file drop from opening the file in the window", () => {
    render(<Host zone={false} />);
    const over = fileDrag("dragover");
    screen.getByText("Elsewhere").dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe("none");
    const drop = fileDrag("drop");
    screen.getByText("Elsewhere").dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
  });
  it("leaves text drags and drop zones alone", () => {
    render(<Host zone />);
    const text = new Event("dragover", { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    text.dataTransfer = { types: ["text/plain"], files: [] };
    document.body.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
    const over = fileDrag("dragover");
    screen.getByRole("group", { name: "Choose a CSV file" }).dispatchEvent(over);
    expect(over.dataTransfer.dropEffect).toBe("copy");
  });
});
