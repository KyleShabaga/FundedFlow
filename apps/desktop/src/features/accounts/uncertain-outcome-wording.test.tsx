// @vitest-environment jsdom
// TASK-024: a write whose outcome is unknown (no answer came back) is never reported as a definite failure. The
// active-account switch is a settings write whose lock lasts until FundedFlow restarts, so its sites say that; archive
// and restore say where to check and, for an account that shows as archived, that the lock lasts until a restart.
// Definite failures keep their wording. The repository is the in-memory Today store (synthetic accounts).
import type { Account } from "@fundedflow/domain";
import { RepositoryError } from "@fundedflow/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeState } from "../../app/RuntimeProvider";
import { ToastProvider } from "../../design-system";
import { warmUp } from "../../test/warm-up";
import { TodayPage } from "../today/components/TodayPage";
import { createTodayStore } from "../today/test-store";
import { ACTIVE_ACCOUNT_SETTING } from "./active-account";
import { AccountDetailPage } from "./components/AccountDetailPage";
import { AccountSwitcher } from "./components/AccountSwitcher";
import { makeAccount } from "./test-store";

const runtime = vi.hoisted(() => ({ state: { kind: "ready" } as unknown as RuntimeState, check: vi.fn() }));
const holder = vi.hoisted(() => ({ store: null as unknown as ReturnType<typeof createTodayStore> }));
vi.mock("../../app/RuntimeProvider", () => ({ useRuntime: () => runtime }));
vi.mock("../../lib/data/api", () => ({ get repository() { return holder.store.repository; } }));

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

const A = "acct-a";
const B = "acct-b";
let client: QueryClient;
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AccountSwitcher />
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/accounts" element={<p>Accounts page</p>} />
            <Route path="/accounts/:accountId" element={<AccountDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}
function fresh(accounts: Account[] = [makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" })]) {
  runtime.state = { kind: "ready", status: { state: "ready", stage: "ready", schemaVersion: 17, supportedSchemaVersion: 17, created: false, failure: null } } as unknown as RuntimeState;
  runtime.check.mockReset().mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  holder.store = createTodayStore(accounts);
  holder.store.settings.set(ACTIVE_ACCOUNT_SETTING, A);
}
beforeEach(() => fresh());
beforeAll(async () => {
  fresh();
  await warmUp(() => renderAt(`/accounts/${B}`), () => screen.findByRole("heading", { name: "Eval B", level: 2 }));
  client.clear();
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

const uncertain = () => new RepositoryError({ kind: "database", message: "no answer" });
const definite = () => new RepositoryError({ kind: "unavailable", message: "closed" });
/** The toast whose title is `title`, and its tone (from the design system's notice class). */
async function toast(title: string) {
  const el = (await screen.findByText(title)).closest(".ds-toast") as HTMLElement;
  return { el, tone: ["warning", "error", "success", "info"].find(t => el.classList.contains(`ds-notice-${t}`)) };
}
const SWITCH_TITLE = "The active account may have changed";
const SWITCH_TEXT = "No answer came back, so the active account may have changed. Switching is locked until you restart FundedFlow; check the active account after reopening it.";

/** The four active-account sites reachable from these pages (the fifth, the daily review, is in daily-reviews). */
const sites: { name: string; path: string; definiteTitle: string; press: (user: ReturnType<typeof userEvent.setup>) => Promise<void> }[] = [
  {
    name: "the account selector", path: `/accounts/${B}`, definiteTitle: "The active account wasn't changed",
    press: async user => {
      await user.click(await screen.findByRole("button", { name: /Eval A/ }));
      await user.click(await screen.findByRole("menuitemradio", { name: /Eval B/ }));
    },
  },
  {
    name: "the account menu's 'Use as active account'", path: `/accounts/${B}`, definiteTitle: "The active account wasn't changed",
    press: async user => {
      await user.click(await screen.findByRole("button", { name: "More account actions" }));
      await user.click(await screen.findByRole("menuitem", { name: "Use as active account" }));
    },
  },
  {
    name: "the detail page's 'Use as active and open Today'", path: `/accounts/${B}`, definiteTitle: "The account wasn't switched",
    press: async user => { await user.click(await screen.findByRole("button", { name: "Use as active and open Today" })); },
  },
  {
    name: "Today's 'Show'", path: "/", definiteTitle: "The account wasn't switched",
    press: async user => { await user.click(within(await screen.findByRole("region", { name: "Active accounts" })).getByRole("button", { name: "Show Eval B" })); },
  },
];

describe("active-account switch with no answer (TASK-024)", () => {
  for (const site of sites) {
    it(`${site.name}: says the switch may have happened and is locked until a restart, as a warning`, async () => {
      vi.spyOn(holder.store.repository.settings, "set").mockRejectedValue(uncertain());
      const user = userEvent.setup();
      renderAt(site.path);
      await site.press(user);
      const shown = await toast(SWITCH_TITLE);
      expect(shown.tone).toBe("warning");
      expect(within(shown.el).getByText(SWITCH_TEXT)).toBeTruthy();
      expect(screen.queryByText(site.definiteTitle)).toBeNull();
    });

    it(`${site.name}: a definite failure keeps its wording, as an error`, async () => {
      vi.spyOn(holder.store.repository.settings, "set").mockRejectedValue(definite());
      const user = userEvent.setup();
      renderAt(site.path);
      await site.press(user);
      expect((await toast(site.definiteTitle)).tone).toBe("error");
      expect(screen.queryByText(SWITCH_TITLE)).toBeNull();
    });
  }

  it("locked retry: a second switch sends nothing and says the same", async () => {
    const set = vi.spyOn(holder.store.repository.settings, "set").mockRejectedValue(uncertain());
    const user = userEvent.setup();
    renderAt(`/accounts/${B}`);
    await sites[0].press(user);
    await toast(SWITCH_TITLE);
    expect(set).toHaveBeenCalledTimes(1);
    await sites[0].press(user);
    await waitFor(() => expect(screen.getAllByText(SWITCH_TITLE)).toHaveLength(2));
    expect(set).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("The active account wasn't changed")).toBeNull();
  });
});

describe("archive and restore with no answer (TASK-024)", () => {
  const RESTART = /Archiving and restoring this account are locked until you restart FundedFlow; check the account after reopening it\./;

  it("an uncertain archive says where to check; once it shows archived, Restore names the restart and sends nothing", async () => {
    const original = holder.store.repository.accounts.archive.bind(holder.store.repository.accounts);
    vi.spyOn(holder.store.repository.accounts, "archive").mockImplementation(async id => { await original(id); throw uncertain(); });
    const restore = vi.spyOn(holder.store.repository.accounts, "restore");
    const user = userEvent.setup();
    renderAt(`/accounts/${B}`);
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive…" }));
    const archive = await screen.findByRole("alertdialog", { name: "Archive Eval B?" });
    await user.click(within(archive).getByRole("button", { name: "Archive" }));
    const said = await within(archive).findByText(/No answer came back, so it may have been archived\./);
    expect(said.textContent).toMatch(/check the account/i);
    expect(said.textContent).toMatch(/locked until you restart FundedFlow/);
    expect(within(archive).queryByText(/It wasn't archived/)).toBeNull();
    await user.click(within(archive).getByRole("button", { name: "Cancel" }));
    // The write committed: once the page reads the account again, it shows as archived and offers only Restore.
    await act(() => client.invalidateQueries());
    expect(await screen.findByText("Archived: read-only")).toBeTruthy();
    for (let attempt = 0; attempt < 2; attempt++) {
      await user.click(await screen.findByRole("button", { name: "Restore from archive" }));
      const dialog = await screen.findByRole("alertdialog", { name: "Restore Eval B?" });
      await user.click(within(dialog).getByRole("button", { name: "Restore" }));
      const text = (await within(dialog).findByText(RESTART)).textContent ?? "";
      expect(text).toMatch(/may .*have been .*restored/);
      expect(text).not.toMatch(/Edit|Change status|Start new attempt/);
      expect(within(dialog).queryByText(/It wasn't restored/)).toBeNull();
      expect(restore).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    }
  });

  it("an uncertain archive that did not commit points to the account's own dialogs", async () => {
    vi.spyOn(holder.store.repository.accounts, "archive").mockRejectedValue(uncertain());
    const user = userEvent.setup();
    renderAt(`/accounts/${B}`);
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive…" }));
    const archive = await screen.findByRole("alertdialog", { name: "Archive Eval B?" });
    await user.click(within(archive).getByRole("button", { name: "Archive" }));
    expect((await within(archive).findByText(/may have been archived/)).textContent).toMatch(/Edit, Change status or Start new attempt/);
  });

  it("definite archive and restore failures keep their wording", async () => {
    fresh([makeAccount({ id: A, name: "Eval A" }), makeAccount({ id: B, name: "Eval B" }), makeAccount({ id: "c", name: "Old", archivedAt: "2026-10-01T00:00:00.000Z" })]);
    vi.spyOn(holder.store.repository.accounts, "archive").mockRejectedValue(definite());
    vi.spyOn(holder.store.repository.accounts, "restore").mockRejectedValue(definite());
    const user = userEvent.setup();
    const view = renderAt(`/accounts/${B}`);
    await user.click(await screen.findByRole("button", { name: "More account actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Archive…" }));
    const archive = await screen.findByRole("alertdialog", { name: "Archive Eval B?" });
    await user.click(within(archive).getByRole("button", { name: "Archive" }));
    expect(await within(archive).findByText("It wasn't archived. Check the account and try again.")).toBeTruthy();
    view.unmount();
    renderAt("/accounts/c");
    await user.click(await screen.findByRole("button", { name: "Restore from archive" }));
    const restore = await screen.findByRole("alertdialog", { name: "Restore Old?" });
    await user.click(within(restore).getByRole("button", { name: "Restore" }));
    expect(await within(restore).findByText("It wasn't restored. Check the account and try again.")).toBeTruthy();
  });
});
