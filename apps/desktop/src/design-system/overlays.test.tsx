// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  Button,
  ConfirmDialog,
  Dialog,
  Drawer,
  DropdownMenu,
  InlineNotice,
  Popover,
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
