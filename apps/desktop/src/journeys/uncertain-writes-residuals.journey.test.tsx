// @vitest-environment jsdom
// P0-03 residuals: the trade review save, the review Library and Settings (the remembered last export) release an
// uncertain write lock only after the trader has checked what is stored, without a restart. The same cases as
// uncertain-writes-p0.journey.test.tsx run against each surface's real wiring through <App />. The store's holds
// decide whether the write happened (`lose`: it ran, the answer was lost; `fail`: it never ran) and when its answer
// comes.
import { RepositoryError } from "@fundedflow/domain";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);

import { ACTIVE_ACCOUNT_SETTING } from "../features/accounts/active-account";
import { LAST_EXPORT_SETTING } from "../features/data-controls/api/data-controls";
import { WRITE_TIMEOUT_MS } from "../features/shared/submissions";
import { createAppStore, makeAccount, makeTrade, type AppStore } from "../test/app-store";
import { boundary } from "../test/boundaries";
import { installBrowserShims, renderApp, resetHarness, warmUpApp } from "../test/harness";

beforeAll(installBrowserShims);
beforeAll(warmUpApp);
const NOW = new Date("2026-10-20T14:00:00.000Z");
beforeEach(() => { vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true, toFake: ["Date"] }); });
afterEach(resetHarness);

const A = "acct-a";
const B = "acct-b";
const lostAnswer = () => new RepositoryError({ kind: "database", message: "disk I/O error" });
const readFailure = () => new RepositoryError({ kind: "database", message: "busy" });
const refused = () => new RepositoryError({ kind: "validation", message: "refused", issues: [{ field: "row", message: "refused by the test" }] });
type User = ReturnType<typeof renderApp>["user"];
type Account = typeof A | typeof B;
const names: Record<Account, string> = { [A]: "Eval A", [B]: "Eval B" };
const tradeOf: Record<Account, string> = { [A]: "t-a", [B]: "t-b" };
const BACKUP = "C:\\Users\\trader\\Backups\\fundedflow-2026-10-20.ffj.zip";
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled === true;
const paste = async (user: User, field: HTMLElement, text: string) => { await user.clear(field); await user.click(field); await user.paste(text); };

function newStore() {
  return createAppStore({
    accounts: [makeAccount({ id: A, name: names[A] }), makeAccount({ id: B, name: names[B] })],
    trades: [makeTrade({ id: "t-a", accountId: A }), makeTrade({ id: "t-b", accountId: B })],
    activeId: A,
  });
}

async function chooseActive(user: User, account: Account) {
  await user.click(await screen.findByRole("button", { name: /Eval [AB]/, description: "Account" }));
  await user.click(await screen.findByRole("menuitem", { name: names[account] }));
  await screen.findByText(`${names[account]} is the active account`);
}

interface Surface {
  name: string;
  /** Repository method of the write, and which of its calls are this surface's. */
  write: string;
  writeWhen?: (args: unknown[]) => boolean;
  /** The repository read the review re-reads. */
  read: string;
  readWhen?: (args: unknown[]) => boolean;
  open: (user: User, account: Account) => Promise<HTMLElement>;
  /** Enters what the trader wants saved (kept through the review). */
  edit: (user: User, scope: HTMLElement) => Promise<void>;
  edited: (scope: HTMLElement) => void;
  submit: (user: User, scope: HTMLElement) => Promise<void>;
  /** The control that would send the write again; absent when the write rides on another action (Settings). */
  submitControl?: (scope: HTMLElement) => HTMLElement | null;
  stored: (store: AppStore, account: Account) => number;
  savedReview: RegExp;
  notSavedReview: RegExp;
  /** What a confirmed success would say; a late answer must never show it. */
  success: RegExp;
  reopen: (user: User) => Promise<HTMLElement>;
  /** A write outside this lock (another account's, or another scope's) proceeds while it is held. */
  other: (user: User, store: AppStore) => Promise<void>;
}

const openReview = async (user: User, account: Account) => {
  if (account !== A) {
    window.location.hash = "/";
    await chooseActive(user, account);
  }
  window.location.hash = `/journal/trades/${tradeOf[account]}`;
  const region = await screen.findByRole("region", { name: "Review" });
  await within(region).findByLabelText(/^Notes and reflection/);
  return region;
};
const reflection = (scope: HTMLElement) => within(scope).getByLabelText(/^Notes and reflection/) as HTMLTextAreaElement;
const tradeReview: Surface = {
  name: "trade review save", write: "reviews.save", read: "reviews.get",
  open: (user, account) => openReview(user, account),
  edit: (user, scope) => paste(user, reflection(scope), "keep me"),
  edited: scope => expect(reflection(scope).value).toBe("keep me"),
  submit: (user, scope) => user.click(within(scope).getByRole("button", { name: /^(Save review|Saving…)$/ })),
  submitControl: scope => within(scope).queryByRole("button", { name: /^(Save review|Saving…)$/ }),
  stored: (store, account) => (store.journal.reviews.get(tradeOf[account])?.reflection === "keep me" ? 1 : 0),
  savedReview: /^keep me$/, notSavedReview: /^No review is saved for this trade\.$/, success: /^Review saved\.?$/,
  reopen: async () => {
    window.location.hash = "/journal";
    await screen.findByRole("heading", { level: 1, name: "Journal" });
    window.location.hash = `/journal/trades/${tradeOf[A]}`;
    return screen.findByRole("region", { name: "Review" });
  },
  other: async (user, store) => {
    const other = await openReview(user, B);
    expect(within(other).queryByText("Couldn't confirm it saved")).toBeNull();
    await tradeReview.edit(user, other);
    await tradeReview.submit(user, other);
    await waitFor(() => expect(tradeReview.stored(store, B)).toBe(1));
  },
};

const openPlaybook = async (user: User) => {
  window.location.hash = "/journal?view=library&section=playbooks";
  await user.click(await screen.findByRole("button", { name: "New playbook" }));
  return screen.findByRole("dialog", { name: "New playbook" });
};
const description = (scope: HTMLElement) => within(scope).getByRole("textbox", { name: /^Description/ }) as HTMLTextAreaElement;
const library: Surface = {
  name: "Library playbook save", write: "library.saveStrategy", read: "library.load",
  open: user => openPlaybook(user),
  edit: async (user, scope) => {
    await paste(user, within(scope).getByRole("textbox", { name: /^Name/ }), "Opening range");
    await paste(user, description(scope), "keep me");
  },
  edited: scope => expect(description(scope).value).toBe("keep me"),
  submit: (user, scope) => user.click(within(scope).getByRole("button", { name: "Save" })),
  submitControl: scope => within(scope).getByRole("button", { name: "Save" }),
  stored: store => [...store.journal.strategies.values()].filter(s => s.name === "Opening range").length,
  savedReview: /^Active$/, notSavedReview: /^No playbook named “Opening range” is in the library\.$/, success: /Opening range (saved|added)/,
  reopen: async user => {
    const dialog = screen.getByRole("dialog", { name: "New playbook" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The library page itself shows the open check too.
    expect(screen.getByText("Couldn't confirm it saved")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "New playbook" }));
    return screen.findByRole("dialog", { name: "New playbook" });
  },
  // The library is shared by every account, so its lock is too; a trade review (its own lock) still saves.
  other: async (user, store) => {
    await user.click(within(screen.getByRole("dialog", { name: "New playbook" })).getByRole("button", { name: "Cancel" }));
    const review = await openReview(user, A);
    await tradeReview.edit(user, review);
    await tradeReview.submit(user, review);
    await waitFor(() => expect(tradeReview.stored(store, A)).toBe(1));
  },
};

const isLastExport = (args: unknown[]) => args[0] === LAST_EXPORT_SETTING;
const openSettings = async () => {
  window.location.hash = "/settings";
  await screen.findByRole("button", { name: "Choose location and export…" });
  return document.body;
};
const settings: Surface = {
  name: "Settings last export", write: "settings.set", writeWhen: isLastExport, read: "settings.get", readWhen: isLastExport,
  open: () => openSettings(),
  edit: async user => { await user.click(screen.getByRole("checkbox", { name: /not encrypted/ })); },
  edited: scope => expect((within(scope).getByRole("checkbox", { name: /not encrypted/ }) as HTMLInputElement).checked).toBe(true),
  // The export itself always completes; remembering it is the write under test.
  submit: async (user, scope) => {
    boundary.dialog.save.push(BACKUP);
    await user.click(within(scope).getByRole("button", { name: /^(Choose location and export…|Exporting…)$/ }));
  },
  stored: store => (store.settings.has(LAST_EXPORT_SETTING) ? 1 : 0),
  savedReview: /^Last export$/, notSavedReview: /^No export is remembered in this journal\.$/, success: /^(Last export|Export) (saved|remembered)\.?$/,
  reopen: async () => {
    window.location.hash = "/";
    // Settings has a level-1 heading too: wait until it has really gone.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Choose location and export…" })).toBeNull());
    return openSettings();
  },
  // Other settings have their own lock: choosing the active account is saved.
  other: async (user, store) => {
    window.location.hash = "/";
    await chooseActive(user, B);
    await waitFor(() => expect(store.settings.get(ACTIVE_ACCOUNT_SETTING)).toBe(B));
  },
};

const SURFACES = [tradeReview, library, settings];

async function setup(surface: Surface, options: { fakeTimers?: boolean } = {}) {
  const store = newStore();
  const { user } = renderApp("/", store, options);
  await screen.findByRole("heading", { level: 1 });
  const scope = await surface.open(user, A);
  await surface.edit(user, scope);
  return { store, user, scope };
}
const holdWrite = (surface: Surface, store: AppStore) => store.hold(surface.write, surface.writeWhen);
const holdRead = (surface: Surface, store: AppStore) => store.hold(surface.read, surface.readWhen);

/** Sends the write once and makes its answer uncertain; `happened` decides whether it was stored. */
async function uncertain(surface: Surface, store: AppStore, user: User, scope: HTMLElement, happened: boolean) {
  const hold = holdWrite(surface, store);
  await surface.submit(user, scope);
  await waitFor(() => expect(hold.calls).toHaveLength(1));
  await act(() => (happened ? hold.lose(lostAnswer()) : hold.fail(lostAnswer())));
  await within(scope).findByText("Couldn't confirm it saved");
  return hold;
}

/** Whether the surface's save control is locked, or null where the write has no control of its own. */
const locked = (surface: Surface, scope: HTMLElement) => {
  if (!surface.submitControl) return null;
  const control = surface.submitControl(scope);
  return control === null || isDisabled(control);
};
const expectLocked = (surface: Surface, scope: HTMLElement, value: boolean) => {
  const now = locked(surface, scope);
  if (now !== null) expect(now).toBe(value);
};

describe.each(SURFACES)("uncertain $name", surface => {
  it("a definite failure unlocks at once without a review, and the trader's next save is sent once", async () => {
    const { store, user, scope } = await setup(surface);
    const hold = holdWrite(surface, store);
    await surface.submit(user, scope);
    await waitFor(() => expect(hold.calls).toHaveLength(1));
    await act(() => hold.fail(refused()));
    expect(screen.queryByText("Couldn't confirm it saved")).toBeNull();
    expect(surface.stored(store, A)).toBe(0);
    await waitFor(() => expectLocked(surface, scope, false));
    surface.edited(scope);
    const next = holdWrite(surface, store);
    await surface.submit(user, scope);
    await waitFor(() => expect(next.calls).toHaveLength(1));
    await act(() => next.release());
    await waitFor(() => expect(surface.stored(store, A)).toBe(1));
    expect(hold.calls).toHaveLength(1);
  });

  it("a second press while the write is pending sends nothing, and the one answer is the only write", async () => {
    const { store, user, scope } = await setup(surface);
    const hold = holdWrite(surface, store);
    await surface.submit(user, scope);
    await waitFor(() => expect(hold.calls).toHaveLength(1));
    expectLocked(surface, scope, true);
    await surface.submit(user, scope).catch(() => {});
    expect(hold.calls).toHaveLength(1);
    await act(() => hold.release());
    await waitFor(() => expect(surface.stored(store, A)).toBe(1));
    expect(hold.calls).toHaveLength(1);
    expect(screen.queryByText("Couldn't confirm it saved")).toBeNull();
  });

  it("did save but the answer was lost: Check result shows it stored, and acknowledging saves nothing", async () => {
    const { store, user, scope } = await setup(surface);
    const hold = await uncertain(surface, store, user, scope, true);
    expect(surface.stored(store, A)).toBe(1);
    expectLocked(surface, scope, true);
    // Locked: the trader's next press sends nothing.
    await surface.submit(user, scope).catch(() => {});
    expect(hold.calls).toHaveLength(1);
    await user.click(within(scope).getByRole("button", { name: "Check result" }));
    const ack = await within(scope).findByRole("button", { name: "I've checked; allow saving again" });
    expect((await within(scope).findAllByText(surface.savedReview)).length).toBeGreaterThan(0);
    // Reviewing alone neither unlocks nor resends.
    expectLocked(surface, scope, true);
    await waitFor(() => expect(isDisabled(ack)).toBe(false));
    await user.click(ack);
    await waitFor(() => expect(within(scope).queryByText(/Couldn't confirm it saved|Check the .* below/)).toBeNull());
    expect(hold.calls).toHaveLength(1);
    expect(surface.stored(store, A)).toBe(1);
    expect(screen.queryByText(surface.success)).toBeNull();
  });

  it("did not save: Check result shows nothing stored, the edits stay, and one deliberate save follows", async () => {
    const { store, user, scope } = await setup(surface);
    const hold = await uncertain(surface, store, user, scope, false);
    expect(surface.stored(store, A)).toBe(0);
    await surface.submit(user, scope).catch(() => {});
    expect(hold.calls).toHaveLength(1);
    await user.click(within(scope).getByRole("button", { name: "Check result" }));
    expect((await within(scope).findAllByText(surface.notSavedReview)).length).toBeGreaterThan(0);
    const ack = within(scope).getByRole("button", { name: "I've checked; allow saving again" });
    await waitFor(() => expect(isDisabled(ack)).toBe(false));
    await user.click(ack);
    await waitFor(() => expect(within(scope).queryByText(/Check the .* below/)).toBeNull());
    surface.edited(scope);
    expect(surface.stored(store, A)).toBe(0);
    await waitFor(() => expectLocked(surface, scope, false));
    await surface.submit(user, scope);
    await waitFor(() => expect(surface.stored(store, A)).toBe(1));
  });

  it("keeps the lock when the check fails, and Check again recovers", async () => {
    const { store, user, scope } = await setup(surface);
    const hold = await uncertain(surface, store, user, scope, false);
    // The re-read fails (and so does the one automatic read retry): still locked, nothing resent.
    const reads = holdRead(surface, store);
    await user.click(within(scope).getByRole("button", { name: "Check result" }));
    await waitFor(() => expect(reads.calls.length).toBeGreaterThan(0));
    const retried = holdRead(surface, store);
    await act(() => reads.fail(readFailure()));
    await waitFor(() => expect(retried.calls.length).toBeGreaterThan(0));
    await act(() => retried.fail(readFailure()));
    expect(await within(scope).findByText(/^Couldn't check /)).toBeTruthy();
    expect(within(scope).queryByRole("button", { name: "I've checked; allow saving again" })).toBeNull();
    expectLocked(surface, scope, true);
    // No raw error text reaches the review.
    expect(document.body.textContent).not.toMatch(/disk I\/O error|busy/);
    await user.click(within(scope).getByRole("button", { name: "Check again" }));
    expect(await within(scope).findByRole("button", { name: "I've checked; allow saving again" })).toBeTruthy();
    expect(hold.calls).toHaveLength(1);
    surface.edited(scope);
  });

  it("can't be acknowledged while the original request still runs after its timeout, and a late answer claims nothing", async () => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { store, user, scope } = await setup(surface, { fakeTimers: true });
    const slow = holdWrite(surface, store);
    await surface.submit(user, scope);
    await waitFor(() => expect(slow.calls).toHaveLength(1));
    await act(() => vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS + 10));
    expect(await within(scope).findByText("Couldn't confirm it saved")).toBeTruthy();
    await user.click(within(scope).getByRole("button", { name: "Check result" }));
    const ack = await within(scope).findByRole("button", { name: "I've checked; allow saving again" });
    expect(isDisabled(ack)).toBe(true);
    expect(within(scope).getByText(/The original request is still running/)).toBeTruthy();
    await user.click(ack);
    expectLocked(surface, scope, true);
    // The late answer is a success, but it never becomes a success message, a retry or an unlock.
    await act(() => slow.release());
    expect(screen.queryByText(surface.success)).toBeNull();
    expectLocked(surface, scope, true);
    await waitFor(() => expect(isDisabled(within(scope).getByRole("button", { name: "I've checked; allow saving again" }))).toBe(false));
    await user.click(within(scope).getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(scope).queryByRole("button", { name: "I've checked; allow saving again" })).toBeNull());
    expect(slow.calls).toHaveLength(1);
    expect(surface.stored(store, A)).toBe(1);
  });

  it("keeps the lock after closing and reopening the surface, where recovery is still offered", async () => {
    const { store, user, scope } = await setup(surface);
    const hold = await uncertain(surface, store, user, scope, false);
    const again = await surface.reopen(user);
    expect(await within(again).findByText("Couldn't confirm it saved")).toBeTruthy();
    expectLocked(surface, again, true);
    await user.click(within(again).getByRole("button", { name: "Check result" }));
    expect((await within(again).findAllByText(surface.notSavedReview)).length).toBeGreaterThan(0);
    await user.click(await within(again).findByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(screen.queryByText("Couldn't confirm it saved")).toBeNull());
    expect(hold.calls).toHaveLength(1);
    expect(surface.stored(store, A)).toBe(0);
  });

  it("locks only its own scope: a write elsewhere proceeds", async () => {
    const { store, user, scope } = await setup(surface);
    const hold = await uncertain(surface, store, user, scope, false);
    await surface.other(user, store);
    expect(hold.calls).toHaveLength(1);
    expect(surface.stored(store, A)).toBe(0);
  });
});

describe("uncertain Library changes", () => {
  it("an uncertain archive is checked against the stored item on the library page", async () => {
    const store = newStore();
    const saved = await (store.repository as unknown as { library: { saveTag: (id: null, input: { name: string; kind: string }) => Promise<{ id: string }> } })
      .library.saveTag(null, { name: "FOMO", kind: "emotion" });
    const { user } = renderApp("/journal?view=library&section=tags", store);
    const mindset = await screen.findByRole("region", { name: "Mindset" });
    const hold = store.hold("library.setArchived");
    await user.click(within(mindset).getByRole("button", { name: "Archive" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Archive" }));
    await act(() => hold.lose(lostAnswer()));
    expect(await within(confirm).findByText(/may have been archived/)).toBeTruthy();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    // Every library write waits for the check, with a reason.
    expect(isDisabled(within(mindset).getByRole("button", { name: "Archive" }))).toBe(true);
    await user.click(await screen.findByRole("button", { name: "Check result" }));
    const item = await screen.findByLabelText("The tag as saved now");
    expect(within(item).getByText("Archived")).toBeTruthy();
    expect(within(item).getByText("FOMO")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(screen.queryByText("Couldn't confirm it saved")).toBeNull());
    expect(hold.calls).toHaveLength(1);
    expect(store.journal.tags.get(saved.id)!.archived).toBe(true);
  });

  it("a checklist reopened after an uncertain save is checked by the name that was sent", async () => {
    const store = newStore();
    const { user } = renderApp("/journal?view=library&section=templates", store);
    await user.click(await screen.findByRole("button", { name: "New checklist" }));
    let dialog = await screen.findByRole("dialog", { name: "New checklist" });
    await paste(user, within(dialog).getByRole("textbox", { name: /^Name/ }), "Entry rules");
    const hold = store.hold("library.saveChecklist");
    await user.click(within(dialog).getByRole("button", { name: "Save checklist" }));
    await act(() => hold.lose(lostAnswer()));
    expect(await within(dialog).findByText("Couldn't confirm it saved")).toBeTruthy();
    expect(within(dialog).queryByText("It wasn't saved. Try again.")).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const discard = await screen.findByRole("alertdialog", { name: "Discard your changes?" });
    await user.click(within(discard).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "New checklist" }));
    dialog = await screen.findByRole("dialog", { name: "New checklist" });
    await user.click(within(dialog).getByRole("button", { name: "Check result" }));
    const saved = await within(dialog).findByLabelText("Saved checklists with this name");
    expect(within(saved).getByText("Entry rules")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(dialog).queryByText("Couldn't confirm it saved")).toBeNull());
    expect(hold.calls).toHaveLength(1);
    expect([...store.journal.checklists.values()].filter(c => c.name === "Entry rules")).toHaveLength(1);
  });
});
