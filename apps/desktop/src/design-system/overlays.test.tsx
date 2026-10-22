// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ActionPill,
  Button,
  ConfirmDialog,
  DiagnosticDetails,
  Dialog,
  Drawer,
  DropdownMenu,
  InlineNotice,
  Popover,
  StatusDot,
  StatusIndicator,
  ToastProvider,
  Tooltip,
  useToast,
} from "./index";

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  // Radix Tooltip/Menu measure with ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

describe("Dialog", () => {
  it("moves focus in, closes on Escape and returns focus to the trigger", async () => {
    render(
      <Dialog trigger={<Button>Edit account</Button>} title="Edit account" description="Changes apply to new trades." footer={<Button>Save</Button>}>
        <input aria-label="Name" />
      </Dialog>,
    );
    const trigger = screen.getByRole("button", { name: "Edit account" });
    await userEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Edit account" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it("cannot be dismissed while not dismissible", async () => {
    render(<Dialog defaultOpen dismissible={false} title="Saving" />);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Saving" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

describe("ConfirmDialog", () => {
  function Harness({ onConfirm }: { onConfirm: () => Promise<void> }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Delete account</Button>
        <ConfirmDialog open={open} onOpenChange={setOpen} title="Delete Apex $100K?" confirmLabel="Delete account" busyLabel="Deleting…" onConfirm={onConfirm}>
          <p>Deletes PA-48213 and its 67 trades.</p>
        </ConfirmDialog>
      </>
    );
  }
  it("focuses Cancel first and runs the action once", async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<Harness onConfirm={onConfirm} />);
    const opener = screen.getByRole("button", { name: "Delete account" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("alertdialog", { name: "Delete Apex $100K?" });
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(dialog.textContent).toContain("PA-48213");
    const confirm = screen.getAllByRole("button", { name: "Delete account" }).find((b) => dialog.contains(b))!;
    await userEvent.click(confirm);
    const busy = screen.getByRole("button", { name: "Deleting…" });
    await userEvent.click(busy);
    await userEvent.keyboard("{Escape}");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await act(async () => resolve());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
  it("stays open on failure without leaking the raw error or claiming nothing changed", async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error("SQLITE_BUSY at C:\\Users\\db.sqlite")));
    render(<Harness onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const dialog = screen.getByRole("alertdialog");
    await userEvent.click(screen.getAllByRole("button", { name: "Delete account" }).find((b) => dialog.contains(b))!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Check whether anything changed");
    expect(alert.textContent).not.toContain("SQLITE");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("Drawer", () => {
  it("is a labelled modal with its own close button", async () => {
    render(<Drawer trigger={<Button>Show calculation</Button>} title="How this was calculated">Steps</Drawer>);
    await userEvent.click(screen.getByRole("button", { name: "Show calculation" }));
    expect(screen.getByRole("dialog", { name: "How this was calculated" }).className).toContain("ds-drawer-right");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show calculation" }));
  });
});

describe("Popover", () => {
  it("exposes expanded state and closes on Escape and outside click", async () => {
    render(
      <>
        <Popover label="Choose month and year" trigger={<Button>October 2026</Button>}>
          <button type="button">Sep</button>
        </Popover>
        <p>Outside</p>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "October 2026" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    await userEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Choose month and year" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await userEvent.click(trigger);
    await userEvent.click(screen.getByText("Outside"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("DropdownMenu", () => {
  it("opens from the keyboard, skips disabled items and restores focus", async () => {
    const archive = vi.fn();
    const remove = vi.fn();
    render(
      <DropdownMenu
        trigger={<Button>Actions</Button>}
        items={[
          { label: "Edit", onSelect: () => {}, disabled: true },
          { label: "Archive", onSelect: archive },
          { type: "separator" },
          { label: "Delete", onSelect: remove, tone: "danger" },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    const items = await screen.findAllByRole("menuitem");
    expect(items[0].getAttribute("aria-disabled")).toBe("true");
    // Focus starts on the first enabled item.
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Archive"));
    await userEvent.keyboard("{Enter}");
    expect(archive).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("DropdownMenu choices (P0-D06)", () => {
  function Choices({ onChoose }: { onChoose: (id: string) => void }) {
    return (
      <DropdownMenu
        trigger={<Button>Account</Button>}
        items={[
          { type: "label", label: "Live accounts" },
          { label: "Eval A", description: "Fresh · updated Oct 21", icon: <StatusDot tone="success" />, checked: true, onSelect: () => onChoose("a") },
          { label: "Eval B", description: "Unknown · no records yet", icon: <StatusDot tone="unknown" />, checked: false, onSelect: () => onChoose("b") },
          { type: "separator" },
          { type: "note", text: "Dots show how recent each account's records are." },
          { label: "Manage accounts", onSelect: () => onChoose("manage") },
        ]}
      />
    );
  }
  it("renders choices as one radio group, the current one checked and enabled, with its line in the name", async () => {
    const chosen = vi.fn();
    render(<Choices onChoose={chosen} />);
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    const radios = await screen.findAllByRole("menuitemradio");
    expect(radios.map(r => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(radios[0].getAttribute("aria-disabled")).toBeNull();
    expect(radios[0].textContent).toBe("Eval AFresh · updated Oct 21");
    expect(radios[0].querySelector("svg")).toBeNull();
    expect(radios[0].querySelector(".ds-dot")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "Manage accounts" })).toBeTruthy();
    expect(screen.getByText("Dots show how recent each account's records are.")).toBeTruthy();
    // Choosing the checked one only closes the menu; another runs its action.
    await userEvent.click(radios[0]);
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(chosen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    await userEvent.click((await screen.findAllByRole("menuitemradio"))[1]);
    await waitFor(() => expect(chosen).toHaveBeenCalledWith("b"));
  });
  it("moves through choices and actions with the keyboard", async () => {
    const chosen = vi.fn();
    render(<Choices onChoose={chosen} />);
    screen.getByRole("button", { name: "Account" }).focus();
    await userEvent.keyboard("{Enter}");
    await screen.findAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement?.textContent).toContain("Eval A"));
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(chosen).toHaveBeenCalledWith("b"));
  });
});

describe("StatusDot (P0-D06)", () => {
  it("is decoration beside text, or an image with its own name when it stands alone", () => {
    render(<><StatusDot tone="success" /><StatusDot tone="unknown" label="Unknown" /></>);
    expect(document.querySelector(".ds-dot-success")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("img", { name: "Unknown" }).classList.contains("ds-dot-unknown")).toBe(true);
  });
});

describe("ActionPill", () => {
  it("is not itself a control: its one button opens the item's menu by keyboard and returns focus", async () => {
    const rename = vi.fn();
    render(<ActionPill label="ORB" meta="Used in 3 reviews" actionsLabel="Actions for tag ORB" actions={[{ label: "Rename…", onSelect: rename }, { label: "Archive…", onSelect: () => {} }]} />);
    expect(screen.getByText("Used in 3 reviews")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const trigger = screen.getByRole("button", { name: "Actions for tag ORB" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    trigger.focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("menu", { name: "Actions for tag ORB" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Rename…"));
    await userEvent.keyboard("{Enter}");
    expect(rename).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("marks a muted item and shows its badge", () => {
    const { container } = render(<ActionPill label="FOMO" badge={<span>Archived</span>} muted actionsLabel="Actions for tag FOMO" actions={[{ label: "Restore", onSelect: () => {} }]} />);
    expect(container.querySelector(".ds-action-pill.is-muted")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
  });
});

describe("Tooltip", () => {
  it("shows on keyboard focus", async () => {
    render(
      <Tooltip content="Resets at 17:00 New York" delayMs={0}>
        <Button>Day ends in 2h</Button>
      </Tooltip>,
    );
    await userEvent.tab();
    expect((await screen.findByRole("tooltip")).textContent).toContain("Resets at 17:00 New York");
  });
});

describe("InlineNotice", () => {
  it("announces errors as alerts and keeps info silent", () => {
    render(
      <>
        <InlineNotice tone="error" title="Couldn't save">Your changes are still here.</InlineNotice>
        <InlineNotice tone="info">Saved on this computer.</InlineNotice>
      </>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save");
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });
  it("can be dismissed", async () => {
    const onDismiss = vi.fn();
    render(<InlineNotice onDismiss={onDismiss}>Tip</InlineNotice>);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("Toast", () => {
  function Trigger({ tone }: { tone: "success" | "error" }) {
    const toast = useToast();
    return <Button onClick={() => toast.show({ tone, title: tone === "success" ? "Imported 64 trades" : "Couldn't export" })}>Go</Button>;
  }
  it("announces politely and dismisses success after its duration", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <ToastProvider>
          <Trigger tone="success" />
        </ToastProvider>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Go" }));
      const polite = screen.getByRole("region", { name: "Notifications" }).querySelector("[data-toast-live='polite']")!;
      expect(polite.getAttribute("aria-live")).toBe("polite");
      expect(polite.textContent).toContain("Imported 64 trades");
      await act(async () => vi.advanceTimersByTime(5100));
      expect(screen.queryByText("Imported 64 trades")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("keeps errors until dismissed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <ToastProvider>
          <Trigger tone="error" />
        </ToastProvider>,
      );
      await userEvent.click(screen.getByRole("button", { name: "Go" }));
      await act(async () => vi.advanceTimersByTime(60_000));
      const assertive = screen.getByRole("region", { name: "Notifications" }).querySelector("[data-toast-live='assertive']")!;
      expect(assertive.getAttribute("aria-live")).toBe("assertive");
      expect(assertive.textContent).toContain("Couldn't export");
      await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
      expect(screen.queryByText("Couldn't export")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("needs a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger tone="success" />)).toThrow(/ToastProvider/);
    vi.mocked(console.error).mockRestore();
  });
});

describe("StatusIndicator", () => {
  it("pairs text with an icon and keeps unknown distinct from safe", () => {
    render(
      <>
        <StatusIndicator status="unknown" label="Unknown" detail="No rulebook for this account" />
        <StatusIndicator status="success" label="Safe" />
      </>,
    );
    const unknown = screen.getByText("Unknown").parentElement!;
    expect(unknown.className).toContain("ds-status-unknown");
    expect(unknown.querySelector("svg")).toBeTruthy();
    expect(unknown.textContent).toContain("No rulebook for this account");
    expect(screen.getByText("Safe").parentElement!.className).toContain("ds-status-success");
  });
});

describe("focus return when the opener is gone", () => {
  it("moves focus to a surviving control in the same container, not the page body", async () => {
    function Harness() {
      const [rows, setRows] = useState(["a", "b"]);
      const [open, setOpen] = useState<string | null>(null);
      return (
        <>
          <ul aria-label="Accounts">
            {rows.map(r => (
              <li key={r}>
                <DropdownMenu trigger={<Button>Actions {r}</Button>} items={[{ label: "Delete…", onSelect: () => setOpen(r) }]} />
              </li>
            ))}
          </ul>
          <Dialog open={open !== null} onOpenChange={next => !next && setOpen(null)} title="Delete account"
            footer={<Button onClick={() => { setRows(rs => rs.filter(x => x !== open)); setOpen(null); }}>Delete</Button>} />
        </>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions a" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete account" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions b" })));
  });
});

describe("DropdownMenu opening a dialog", () => {
  it("keeps a dialog opened from a menu item open, with focus inside it", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <DropdownMenu trigger={<Button>Actions</Button>} items={[{ label: "Edit…", onSelect: () => setOpen(true) }]} />
          <Dialog open={open} onOpenChange={setOpen} title="Edit account"><input aria-label="Name" /></Dialog>
        </>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Edit…" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit account" });
    await act(async () => new Promise(r => setTimeout(r, 50)));
    expect(screen.getByRole("dialog", { name: "Edit account" })).toBe(dialog);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions" })));
  });
});

describe("DiagnosticDetails", () => {
  it("shows selectable text, copies it, and keeps it visible with a fallback when copying fails", async () => {
    const user = userEvent.setup();
    const summary = ["FundedFlow diagnostic summary", "Incident: FF-ABC"].join("\n");
    render(<DiagnosticDetails text={summary} />);
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await user.click(screen.getByText("Diagnostic summary"));
    expect(screen.getByLabelText("Diagnostic summary").textContent).toContain("Incident: FF-ABC");
    await user.click(screen.getByRole("button", { name: "Copy summary" }));
    expect(writeText).toHaveBeenCalledWith(summary);
    expect(screen.getByRole("status").textContent).toBe("Copied.");
    await user.click(screen.getByRole("button", { name: "Copy summary" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Couldn't copy/));
    expect(screen.getByLabelText("Diagnostic summary").textContent).toContain("FF-ABC");
  });
});
