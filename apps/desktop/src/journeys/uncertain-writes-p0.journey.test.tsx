// @vitest-environment jsdom
// P0-03 journeys: every remaining surface releases an uncertain write lock only after the trader has checked
// what is stored, without a restart. One shared set of cases runs against each surface's real wiring through
// <App /> (rulebook draft save, publish, assignment and start draft; calculation; Today checkpoint; screenshots).
// The store's holds decide whether the write happened (`lose`: it ran, the answer was lost; `fail`: it never
// ran) and when its answer comes.
import { RepositoryError } from "@fundedflow/domain";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", async () => (await import("../test/boundaries")).tauriCoreMock);
vi.mock("../lib/data/api", async () => (await import("../test/boundaries")).apiMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("../test/boundaries")).dialogPluginMock);

import { catalogueRules } from "../features/rulebooks/test-store";
import { pngBytes } from "../features/journal/test-store";
import { WRITE_TIMEOUT_MS } from "../features/shared/submissions";
import { createAppStore, makeAccount, makeTrade, type AppStore } from "../test/app-store";
import { installBrowserShims, renderApp, resetHarness, warmUpApp } from "../test/harness";

beforeAll(installBrowserShims);
beforeAll(warmUpApp);
// The fake stores stamp records from 2026-10-20T15:00Z; the app's clock starts before that, as on one machine.
const NOW = new Date("2026-10-20T14:00:00.000Z");
beforeEach(() => { vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true, toFake: ["Date"] }); });
afterEach(resetHarness);

const A = "acct-a";
const B = "acct-b";
const lostAnswer = () => new RepositoryError({ kind: "database", message: "disk I/O error" });
const readFailure = () => new RepositoryError({ kind: "database", message: "busy" });
type User = ReturnType<typeof renderApp>["user"];
type Account = typeof A | typeof B;
const names: Record<Account, string> = { [A]: "Eval A", [B]: "Eval B" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const repo = (store: AppStore) => store.repository as unknown as Record<string, Record<string, (...args: any[]) => Promise<any>>>;
const isDisabled = (el: HTMLElement) => el.getAttribute("aria-disabled") === "true" || (el as HTMLButtonElement).disabled === true;
const paste = async (user: User, field: HTMLElement, text: string) => { await user.clear(field); await user.click(field); await user.paste(text); };

function newStore() {
  return createAppStore({
    accounts: [makeAccount({ id: A, name: names[A] }), makeAccount({ id: B, name: names[B] })],
    trades: [makeTrade({ id: "t-a", accountId: A }), makeTrade({ id: "t-b", accountId: B })],
    activeId: A,
  });
}

/** The account's own draft (the private rulebook created on first use), seeded through the repository. */
async function seedDraft(store: AppStore, account: Account) {
  const draft = await repo(store).rulebooks.createDraft({
    rulebookId: null, newRulebook: { providerId: null, ownerAccountId: account, slug: `account-${account}`, displayName: `${names[account]} rules`, description: null },
    supersedesVersionId: null, changeReason: null, capturedAt: "2026-10-01T00:00:00.000Z", effectiveFrom: null, effectiveTo: null,
    rules: catalogueRules(), applicability: [],
  }, { actor: "local_user", reason: null });
  return draft.version.id as string;
}
const draftOf = (store: AppStore, account: Account) => [...store.today.versions.values()].find(v => v.rulebook.ownerAccountId === account)!;

/** Closes an open dialog (as the trader would with Escape) before going elsewhere. */
async function closeDialogs(user: User) {
  if (!screen.queryByRole("dialog")) return;
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

async function chooseActive(user: User, account: Account) {
  await user.click(await screen.findByRole("button", { name: /Eval [AB]/, description: "Account" }));
  await user.click(await screen.findByRole("menuitem", { name: names[account] }));
  await screen.findByText(`${names[account]} is the active account`);
}

interface Surface {
  name: string;
  /** Repository method of the write. */
  write: string;
  /** One repository read the review re-reads. */
  read: string;
  seed?: (store: AppStore) => Promise<void>;
  /**
   * Where the app starts for account A (default Today). Starting on the surface's own route skips mounting Today
   * and its reads first, which every case of a non-Today surface paid for nothing (cases run ~3x slower under load).
   */
  start?: (store: AppStore) => string;
  /** Opens the surface for the account and returns where its form and review are. */
  open: (user: User, store: AppStore, account: Account) => Promise<HTMLElement>;
  /** Enters what the trader wants saved (kept through the review). */
  edit: (user: User, scope: HTMLElement) => Promise<void>;
  edited: (scope: HTMLElement) => void;
  submit: (user: User, scope: HTMLElement) => Promise<void>;
  /**
   * Presses whatever would send the write while it is locked (default: submit). A surface whose submit waits for
   * a confirmation sets this to press without waiting: a locked control opens none, and waiting for it spent the
   * whole 1 s findBy budget on every such press.
   */
  press?: (user: User, scope: HTMLElement) => Promise<void>;
  /** After the uncertain answer: where the review is (a confirmation may need closing first). */
  review?: (user: User, scope: HTMLElement) => Promise<HTMLElement>;
  /** The control that would send the write again. */
  submitControl: (scope: HTMLElement) => HTMLElement | null;
  stored: (store: AppStore, account: Account) => number;
  savedReview: RegExp;
  notSavedReview: RegExp;
  /** What a confirmed success would say; a late answer must never show it. */
  success: RegExp;
  /** Closes and reopens the surface (or leaves and returns), returning the fresh scope. */
  reopen: (user: User, store: AppStore, scope: HTMLElement) => Promise<HTMLElement>;
}

const draftSave: Surface = {
  name: "rulebook draft save", write: "rulebooks.updateDraft", read: "rulebooks.listEvents",
  seed: async store => { await seedDraft(store, A); await seedDraft(store, B); },
  start: store => `/accounts/${A}/rulebook/versions/${draftOf(store, A).version.id}`,
  open: async (_user, store, account) => {
    window.location.hash = `/accounts/${account}/rulebook/versions/${draftOf(store, account).version.id}`;
    await screen.findByRole("heading", { name: `${names[account]} rules · v1` });
    return document.body;
  },
  edit: (user, scope) => paste(user, within(scope).getByRole("textbox", { name: /What changes and why/ }), "Lower target"),
  edited: scope => expect((within(scope).getByRole("textbox", { name: /What changes and why/ }) as HTMLTextAreaElement).value).toBe("Lower target"),
  submit: (user, scope) => user.click(within(scope).getByRole("button", { name: "Save draft" })),
  submitControl: scope => within(scope).getByRole("button", { name: "Save draft" }),
  stored: (store, account) => store.today.events.filter(e => e.action === "draft_saved" && draftOf(store, account).version.id === e.rulebookVersionId).length,
  savedReview: /Lower target/, notSavedReview: /None given/, success: /^Draft saved\.?$/,
  reopen: async (_user, store, scope) => {
    window.location.hash = `/accounts/${A}/rulebook`;
    await screen.findByRole("heading", { name: /Rulebook · Eval A/ });
    return draftSave.open(_user, store, A).then(() => scope);
  },
};

const publish: Surface = {
  name: "rulebook publish", write: "rulebooks.publish", read: "rulebooks.listEvents",
  seed: draftSave.seed, start: draftSave.start,
  open: async (user, store, account) => {
    await draftSave.open(user, store, account);
    await user.click(screen.getByRole("tab", { name: "Review and publish" }));
    await screen.findByText("The saved draft passes every publish check.");
    // The draft editor stays mounted in its hidden tab and shows the same shared lock; check here.
    return screen.getByRole("tabpanel", { name: "Review and publish" });
  },
  edit: (user, scope) => paste(user, within(scope).getByRole("textbox", { name: /Note for the history/ }), "My limits"),
  edited: scope => expect((within(scope).getByRole("textbox", { name: /Note for the history/ }) as HTMLTextAreaElement).value).toBe("My limits"),
  submit: async (user, scope) => {
    const understood = within(scope).getByRole("checkbox", { name: /can't be edited after it is published/ }) as HTMLInputElement;
    if (!understood.checked) await user.click(understood);
    await user.click(within(scope).getByRole("button", { name: "Publish…" }));
    await user.click(within(await screen.findByRole("alertdialog", { name: /Publish Eval [AB] rules v1/ })).getByRole("button", { name: "Publish" }));
  },
  press: async (user, scope) => {
    await user.click(within(scope).getByRole("button", { name: "Publish…" }));
    const confirm = screen.queryByRole("alertdialog", { name: /Publish Eval [AB] rules v1/ });
    if (confirm) await user.click(within(confirm).getByRole("button", { name: "Publish" }));
  },
  review: async (user, scope) => {
    const confirm = screen.getByRole("alertdialog", { name: /Publish/ });
    expect(await within(confirm).findByText(/No answer came back, so it may have been saved/)).toBeTruthy();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    return scope;
  },
  submitControl: scope => within(scope).queryByRole("button", { name: "Publish…" }),
  stored: (store, account) => store.today.events.filter(e => e.action === "published" && draftOf(store, account).version.id === e.rulebookVersionId).length,
  savedReview: /Account rules \(private\)/, notSavedReview: /^Draft$/, success: /v1: Account rules/,
  reopen: async (user) => {
    await user.click(screen.getByRole("tab", { name: "Details" }));
    await user.click(screen.getByRole("tab", { name: "Review and publish" }));
    return screen.getByRole("tabpanel", { name: "Review and publish" });
  },
};

const openAssign = async (user: User, account: Account) => {
  await closeDialogs(user);
  window.location.hash = `/accounts/${account}/rulebook`;
  await screen.findByRole("heading", { name: new RegExp(`Rulebook · ${names[account]}`) });
  await screen.findByRole("table", { name: "Versions of Example 50K" });
  await waitFor(() => expect(isDisabled(screen.getAllByRole("button", { name: "Assign a version…" })[0]!)).toBe(false));
  await user.click(screen.getAllByRole("button", { name: "Assign a version…" })[0]!);
  return screen.findByRole("dialog", { name: "Assign a rulebook version" });
};
const assign: Surface = {
  name: "rulebook assignment", write: "rulebooks.assign", read: "rulebooks.listAssignments", start: () => `/accounts/${A}/rulebook`,
  open: (user, _store, account) => openAssign(user, account),
  edit: async (user, scope) => {
    await paste(user, within(scope).getByLabelText(/First trading day/), "2026-10-21");
    await paste(user, within(scope).getByRole("textbox", { name: /Reason/ }), "Start of attempt");
  },
  edited: scope => expect((within(scope).getByRole("textbox", { name: /Reason/ }) as HTMLTextAreaElement).value).toBe("Start of attempt"),
  submit: (user, scope) => user.click(within(scope).getByRole("button", { name: /Assign from 2026-10-21/ })),
  submitControl: scope => within(scope).getByRole("button", { name: /^Assign/ }),
  stored: (store, account) => store.today.assignments.filter(a => a.accountId === account).length,
  savedReview: /From 2026-10-21/, notSavedReview: /No rulebook is assigned to this account/, success: /Rulebook assigned/,
  reopen: async (user, _store, scope) => {
    await user.click(within(scope).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Assign a rulebook version" })).toBeNull());
    await user.click(screen.getAllByRole("button", { name: "Assign a version…" })[0]!);
    return screen.findByRole("dialog", { name: "Assign a rulebook version" });
  },
};

const openStart = async (user: User, account: Account) => {
  await closeDialogs(user);
  window.location.hash = `/accounts/${account}/rulebook`;
  await screen.findByRole("heading", { name: new RegExp(`Rulebook · ${names[account]}`) });
  await user.click(screen.getAllByRole("button", { name: "Write my own rules" })[0]!);
  return screen.findByRole("dialog", { name: "Start your own rules" });
};
const startDraft: Surface = {
  name: "start draft", write: "rulebooks.createDraft", read: "rulebooks.listEvents", start: () => `/accounts/${A}/rulebook`,
  open: (user, _store, account) => openStart(user, account),
  edit: (user, scope) => paste(user, within(scope).getByRole("textbox", { name: /What changes and why/ }), "My own limits"),
  edited: scope => expect((within(scope).getByRole("textbox", { name: /What changes and why/ }) as HTMLTextAreaElement).value).toBe("My own limits"),
  submit: (user, scope) => user.click(within(scope).getByRole("button", { name: "Create draft" })),
  submitControl: scope => within(scope).getByRole("button", { name: "Create draft" }),
  stored: (store, account) => [...store.today.versions.values()].filter(v => v.rulebook.ownerAccountId === account).length,
  savedReview: /Draft started/, notSavedReview: /No rulebook activity is recorded for this account/, success: /Draft created/,
  reopen: async (user, _store, scope) => {
    await user.click(within(scope).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getAllByRole("button", { name: /Write my own rules|New draft of my rules/ })[0]!);
    return screen.findByRole("dialog", { name: /Start your own rules|Start a draft/ });
  },
};

const openToday = async (user: User, account: Account, button: string, title: string) => {
  await closeDialogs(user);
  window.location.hash = "/";
  await screen.findByRole("heading", { level: 1 });
  if (account !== A) await chooseActive(user, account);
  await user.click(await screen.findByRole("button", { name: button }));
  return screen.findByRole("dialog", { name: title });
};
const calculation: Surface = {
  // P0-02: a calculation is written by native compare-and-promote.
  name: "calculation", write: "snapshots.promote", read: "snapshots.list",
  open: async (user, _store, account) => {
    const dialog = await openToday(user, account, "Calculate estimate", "Calculate estimate");
    await waitFor(() => expect(isDisabled(within(dialog).getByRole("button", { name: "Calculate and save" }))).toBe(false));
    return dialog;
  },
  // The calculation settings are the trader's selection here: stating fees as complete.
  edit: async (user, scope) => {
    await user.click(within(scope).getByRole("combobox", { name: /Fees are complete/ }));
    await user.click(await screen.findByRole("option", { name: "Yes, complete" }));
  },
  edited: scope => expect(within(scope).getByRole("combobox", { name: /Fees are complete/ }).textContent).toContain("Yes, complete"),
  submit: (user, scope) => user.click(within(scope).getByRole("button", { name: "Calculate and save" })),
  submitControl: scope => within(scope).getByRole("button", { name: "Calculate and save" }),
  stored: (store, account) => store.today.snapshots.filter(s => s.accountId === account).length,
  savedReview: /A calculation was saved after you pressed Calculate/, notSavedReview: /No calculation was saved after you pressed Calculate/,
  success: /Calculation saved/,
  reopen: async (user, _store, scope) => {
    await user.click(within(scope).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Calculate estimate" }));
    return screen.findByRole("dialog", { name: "Calculate estimate" });
  },
};

const checkpoint: Surface = {
  name: "Today checkpoint", write: "evidence.create", read: "evidence.list",
  open: (user, _store, account) => openToday(user, account, "Verify balance", "Verify balance against your firm's dashboard"),
  edit: async (user, scope) => {
    await paste(user, within(scope).getByRole("textbox", { name: /Amount/ }), "50125.5");
    await paste(user, within(scope).getByLabelText(/When you read it/), "2026-10-20T09:00");
    await paste(user, within(scope).getByRole("textbox", { name: /Where you read it/ }), "Firm dashboard");
  },
  edited: scope => expect((within(scope).getByRole("textbox", { name: /Amount/ }) as HTMLInputElement).value).toBe("50125.5"),
  submit: (user, scope) => user.click(within(scope).getByRole("button", { name: "Save checkpoint" })),
  submitControl: scope => within(scope).getByRole("button", { name: "Save checkpoint" }),
  stored: (store, account) => store.today.observations.filter(o => o.accountId === account).length,
  savedReview: /The checkpoint you entered is saved/, notSavedReview: /The checkpoint you entered is not among the saved ones/,
  success: /^Checkpoint saved$/,
  reopen: async (user, _store, scope) => {
    await user.click(within(scope).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Verify balance" }));
    return screen.findByRole("dialog", { name: "Verify balance against your firm's dashboard" });
  },
};

const tradeOf: Record<Account, string> = { [A]: "t-a", [B]: "t-b" };
const screenshots: Surface = {
  name: "screenshots", write: "reviews.addScreenshot", read: "reviews.get", start: () => `/journal/trades/${tradeOf[A]}`,
  open: async (_user, _store, account) => {
    if (account !== A) {
      window.location.hash = "/";
      await chooseActive(_user, account);
    }
    window.location.hash = `/journal/trades/${tradeOf[account]}`;
    return screen.findByRole("region", { name: "Review" });
  },
  edit: async (user, scope) => paste(user, await within(scope).findByLabelText(/^Notes and reflection/), "keep me"),
  edited: scope => expect((within(scope).getByLabelText(/^Notes and reflection/) as HTMLTextAreaElement).value).toBe("keep me"),
  submit: (user, scope) => user.upload(scope.querySelector('input[type="file"]') as HTMLInputElement, new File([pngBytes(1)], "entry.png", { type: "image/png" })),
  submitControl: scope => scope.querySelector<HTMLElement>(".ds-dropzone"),
  stored: (store, account) => store.journal.reviews.get(tradeOf[account])?.attachments.length ?? 0,
  savedReview: /1\. entry\.png/, notSavedReview: /No screenshot is saved on this trade/, success: /Screenshot attached/,
  reopen: async () => {
    window.location.hash = "/journal";
    await screen.findByRole("heading", { level: 1, name: "Journal" });
    window.location.hash = `/journal/trades/${tradeOf[A]}`;
    return screen.findByRole("region", { name: "Review" });
  },
};

const SURFACES = [draftSave, publish, assign, startDraft, calculation, checkpoint, screenshots];

async function setup(surface: Surface, options: { fakeTimers?: boolean } = {}) {
  const store = newStore();
  await surface.seed?.(store);
  const { user } = renderApp(surface.start?.(store) ?? "/", store, options);
  await screen.findByRole("heading", { level: 1 });
  const scope = await surface.open(user, store, A);
  await surface.edit(user, scope);
  return { store, user, scope };
}

/** Sends the write once and makes its answer uncertain; `happened` decides whether it was stored. */
async function uncertain(surface: Surface, store: AppStore, user: User, scope: HTMLElement, happened: boolean) {
  const hold = store.hold(surface.write);
  await surface.submit(user, scope);
  await waitFor(() => expect(hold.calls).toHaveLength(1));
  await act(() => (happened ? hold.lose(lostAnswer()) : hold.fail(lostAnswer())));
  const at = surface.review ? await surface.review(user, scope) : scope;
  await within(at).findByText("Couldn't confirm it saved");
  return { hold, at };
}

const locked = (surface: Surface, scope: HTMLElement) => {
  const control = surface.submitControl(scope);
  return control === null || isDisabled(control);
};

/** A refusal the data layer knows changed nothing (validation), shown as an ordinary failure. */
const refused = () => new RepositoryError({ kind: "validation", message: "refused", issues: [{ field: "row", message: "refused by the test" }] });
/** Dismisses a confirmation left open by a failed write, if any. */
async function closeConfirm(user: User) {
  const confirm = screen.queryByRole("alertdialog");
  if (!confirm) return;
  await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}

describe.each(SURFACES)("uncertain $name", surface => {
  it("a definite failure unlocks at once without a review, and the trader's next save is sent once", async () => {
    const { store, user, scope } = await setup(surface);
    const hold = store.hold(surface.write);
    await surface.submit(user, scope);
    await waitFor(() => expect(hold.calls).toHaveLength(1));
    await act(() => hold.fail(refused()));
    await closeConfirm(user);
    expect(screen.queryByText("Couldn't confirm it saved")).toBeNull();
    expect(surface.stored(store, A)).toBe(0);
    await waitFor(() => expect(locked(surface, scope)).toBe(false));
    surface.edited(scope);
    const next = store.hold(surface.write);
    await surface.submit(user, scope);
    await waitFor(() => expect(next.calls).toHaveLength(1));
    await act(() => next.release());
    await waitFor(() => expect(surface.stored(store, A)).toBe(1));
    expect(hold.calls).toHaveLength(1);
  });

  it("a second press while the write is pending sends nothing, and the one answer is the only write", async () => {
    const { store, user, scope } = await setup(surface);
    const hold = store.hold(surface.write);
    await surface.submit(user, scope);
    await waitFor(() => expect(hold.calls).toHaveLength(1));
    expect(locked(surface, scope)).toBe(true);
    // Whatever the trader can still reach (a disabled control, or one behind the open confirmation) sends nothing.
    await (surface.press ?? surface.submit)(user, scope).catch(() => {});
    expect(hold.calls).toHaveLength(1);
    await act(() => hold.release());
    await waitFor(() => expect(surface.stored(store, A)).toBe(1));
    expect(hold.calls).toHaveLength(1);
    expect(screen.queryByText("Couldn't confirm it saved")).toBeNull();
  });


  it("did save but the answer was lost: Check result shows it stored, and acknowledging saves nothing", async () => {
    const { store, user, scope } = await setup(surface);
    const { hold, at } = await uncertain(surface, store, user, scope, true);
    expect(surface.stored(store, A)).toBe(1);
    expect(locked(surface, at)).toBe(true);
    await user.click(within(at).getByRole("button", { name: "Check result" }));
    const ack = await within(at).findByRole("button", { name: "I've checked; allow saving again" });
    expect((await within(at).findAllByText(surface.savedReview)).length).toBeGreaterThan(0);
    // Reviewing alone neither unlocks nor resends.
    expect(locked(surface, at)).toBe(true);
    await waitFor(() => expect(isDisabled(ack)).toBe(false));
    await user.click(ack);
    await waitFor(() => expect(within(at).queryByText(/Couldn't confirm it saved|Check the .* below/)).toBeNull());
    expect(hold.calls).toHaveLength(1);
    expect(surface.stored(store, A)).toBe(1);
    expect(screen.queryByText(surface.success)).toBeNull();
  });

  it("did not save: Check result shows nothing stored, the edits stay, and one deliberate save follows", async () => {
    const { store, user, scope } = await setup(surface);
    const { hold, at } = await uncertain(surface, store, user, scope, false);
    expect(surface.stored(store, A)).toBe(0);
    await (surface.press ?? surface.submit)(user, at).catch(() => {});
    expect(hold.calls).toHaveLength(1);
    await user.click(within(at).getByRole("button", { name: "Check result" }));
    expect((await within(at).findAllByText(surface.notSavedReview)).length).toBeGreaterThan(0);
    const ack = within(at).getByRole("button", { name: "I've checked; allow saving again" });
    await waitFor(() => expect(isDisabled(ack)).toBe(false));
    await user.click(ack);
    await waitFor(() => expect(within(at).queryByText(/Check the .* below/)).toBeNull());
    surface.edited(at);
    expect(surface.stored(store, A)).toBe(0);
    await waitFor(() => expect(locked(surface, at)).toBe(false));
    await surface.submit(user, at);
    await waitFor(() => expect(surface.stored(store, A)).toBe(1));
  });

  it("keeps the lock when the check fails, and Check again recovers", async () => {
    const { store, user, scope } = await setup(surface);
    const { hold, at } = await uncertain(surface, store, user, scope, false);
    // The re-read fails (and so does the one automatic read retry): still locked, nothing resent.
    const reads = store.hold(surface.read);
    await user.click(within(at).getByRole("button", { name: "Check result" }));
    await waitFor(() => expect(reads.calls.length).toBeGreaterThan(0));
    const retried = store.hold(surface.read);
    await act(() => reads.fail(readFailure()));
    await waitFor(() => expect(retried.calls.length).toBeGreaterThan(0));
    await act(() => retried.fail(readFailure()));
    expect(await within(at).findByText(/^Couldn't check /)).toBeTruthy();
    expect(within(at).queryByRole("button", { name: "I've checked; allow saving again" })).toBeNull();
    expect(locked(surface, at)).toBe(true);
    await user.click(within(at).getByRole("button", { name: "Check again" }));
    expect(await within(at).findByRole("button", { name: "I've checked; allow saving again" })).toBeTruthy();
    expect(hold.calls).toHaveLength(1);
    surface.edited(at);
  });

  it("can't be acknowledged while the original request still runs after its timeout, and a late answer claims nothing", async () => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { store, user, scope } = await setup(surface, { fakeTimers: true });
    const slow = store.hold(surface.write);
    await surface.submit(user, scope);
    await waitFor(() => expect(slow.calls).toHaveLength(1));
    await act(() => vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS + 10));
    const at = surface.review ? await surface.review(user, scope) : scope;
    expect(await within(at).findByText("Couldn't confirm it saved")).toBeTruthy();
    await user.click(within(at).getByRole("button", { name: "Check result" }));
    const ack = await within(at).findByRole("button", { name: "I've checked; allow saving again" });
    expect(isDisabled(ack)).toBe(true);
    expect(within(at).getByText(/The original request is still running/)).toBeTruthy();
    await user.click(ack);
    expect(locked(surface, at)).toBe(true);
    // The late answer is a success, but it never becomes a success message, a retry or an unlock.
    await act(() => slow.release());
    expect(screen.queryByText(surface.success)).toBeNull();
    expect(locked(surface, at)).toBe(true);
    expect(within(at).getByRole("button", { name: "I've checked; allow saving again" })).toBeTruthy();
    await user.click(within(at).getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(at).queryByRole("button", { name: "I've checked; allow saving again" })).toBeNull());
    expect(slow.calls).toHaveLength(1);
    expect(surface.stored(store, A)).toBe(1);
  });

  it("keeps the lock after closing and reopening the surface, where recovery is still offered", async () => {
    const { store, user, scope } = await setup(surface);
    const { hold, at } = await uncertain(surface, store, user, scope, false);
    const again = await surface.reopen(user, store, at);
    expect(await within(again).findByText("Couldn't confirm it saved")).toBeTruthy();
    expect(locked(surface, again)).toBe(true);
    await user.click(within(again).getByRole("button", { name: "Check result" }));
    await user.click(await within(again).findByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(again).queryByText("Couldn't confirm it saved")).toBeNull());
    expect(hold.calls).toHaveLength(1);
    expect(surface.stored(store, A)).toBe(0);
  });

  it("locks only this account: another account's same write proceeds", async () => {
    const { store, user, scope } = await setup(surface);
    const { hold } = await uncertain(surface, store, user, scope, false);
    const other = await surface.open(user, store, B);
    expect(within(other).queryByText("Couldn't confirm it saved")).toBeNull();
    await surface.edit(user, other);
    await surface.submit(user, other);
    await waitFor(() => expect(surface.stored(store, B)).toBe(1));
    expect(hold.calls).toHaveLength(1);
    expect(surface.stored(store, A)).toBe(0);
  });
});

describe("shared rulebook lock", () => {
  it("an uncertain draft save is recoverable from the assignment dialog, where the activity shows the save", async () => {
    const { store, user, scope } = await setup(draftSave);
    const { hold } = await uncertain(draftSave, store, user, scope, true);
    window.location.hash = `/accounts/${A}/rulebook`;
    await screen.findByRole("table", { name: "Versions of Example 50K" });
    await user.click(screen.getAllByRole("button", { name: "Assign a version…" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "Assign a rulebook version" });
    expect(within(dialog).getByText("Couldn't confirm it saved")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Check result" }));
    const activity = await within(dialog).findByRole("list", { name: "Recent rulebook activity" });
    expect(within(activity).getByText("Draft saved")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(dialog).queryByText("Couldn't confirm it saved")).toBeNull());
    expect(hold.calls).toHaveLength(1);
  });

  it("after a saved draft is reviewed, the editor adopts the stored draft instead of reporting a conflict", async () => {
    const { store, user, scope } = await setup(draftSave);
    await uncertain(draftSave, store, user, scope, true);
    expect(screen.queryByText("This draft changed somewhere else")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Check result" }));
    await user.click(await screen.findByRole("button", { name: "I've checked; allow saving again" }));
    expect(await screen.findByText("All changes saved")).toBeTruthy();
    expect(screen.queryByText("This draft changed somewhere else")).toBeNull();
    draftSave.edited(document.body);
  });
});

describe("Today comparison", () => {
  it("an uncertain comparison shows the stored comparisons and checkpoints, then releases the evidence lock", async () => {
    const store = newStore();
    // Compare needs a confirmed opening checkpoint other than this one. Seeded before the app starts: seeding it
    // with the dialog open meant filling the form twice (~0.5 s alone) with nothing asserted in between.
    await repo(store).evidence.create({
      accountId: A, kind: "opening_balance", value: "50000", currency: "USD", basis: "balance", observedAt: "2026-10-19T12:00:00.000Z",
      sourceCategory: "firm_dashboard", sourceReference: "Opening", confirmation: "user_confirmed", confidence: "user_reported",
      validUntil: null, actor: "local_user", note: null,
    });
    const { user } = renderApp("/", store);
    const again = await checkpoint.open(user, store, A);
    await user.click(within(again).getByRole("radio", { name: /Current balance/ }));
    await checkpoint.edit(user, again);
    await user.click(within(again).getByRole("checkbox", { name: /confirm it/ }));
    await user.click(within(again).getByRole("button", { name: "Save checkpoint" }));
    await within(again).findByText("Compare with your records");
    const hold = store.hold("evidence.reconcile");
    await user.click(within(again).getByRole("button", { name: "Compare" }));
    await act(() => hold.lose(lostAnswer()));
    await user.click(await within(again).findByRole("button", { name: "Check result" }));
    const compared = await within(again).findByLabelText("Saved comparisons, newest first");
    expect(within(compared).getByText(/incomplete/)).toBeTruthy();
    await user.click(within(again).getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(again).queryByText("Couldn't confirm it saved")).toBeNull());
    expect(hold.calls).toHaveLength(1);
    expect(store.today.reconciliations).toHaveLength(1);
  });
});

describe("screenshot removal", () => {
  it("an uncertain removal says it may have been removed and is checked against the stored screenshots", async () => {
    const store = newStore();
    await repo(store).reviews.addScreenshot({ accountId: A, tradeId: "t-a", fileName: "entry.png", dataBase64: "iVBORw0KGgoAAAA" });
    const { user } = renderApp(`/journal/trades/t-a`, store);
    const card = await screen.findByRole("region", { name: "Review" });
    await user.click(await within(card).findByRole("button", { name: "Remove entry.png" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Remove this screenshot?" });
    const hold = store.hold("reviews.removeScreenshot");
    await user.click(within(confirm).getByRole("button", { name: "Remove" }));
    await act(() => hold.lose(lostAnswer()));
    expect(await within(confirm).findByText(/may have been removed/)).toBeTruthy();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await user.click(await within(card).findByRole("button", { name: "Check result" }));
    expect(await within(card).findByText("No screenshot is saved on this trade.")).toBeTruthy();
    await user.click(within(card).getByRole("button", { name: "I've checked; allow saving again" }));
    await waitFor(() => expect(within(card).queryByText("Couldn't confirm it saved")).toBeNull());
    expect(hold.calls).toHaveLength(1);
  });
});
