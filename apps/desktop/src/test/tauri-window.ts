// A fake of `@tauri-apps/api/window` for the window-close guard (TASK-023). Use it from a test file with
//   vi.mock("@tauri-apps/api/window", async () => (await import("../../test/tauri-window")).tauriWindowMock);
// `requestClose` does what the title-bar X and Alt+F4 do in Tauri 2.12: with no close-requested listener the
// window closes natively (tauri manager/window.rs: the close is vetoed only when a JS listener exists); with one,
// each listener runs and the window is destroyed unless the handler prevented it (@tauri-apps/api window.js,
// `onCloseRequested`).
import { vi } from "vitest";

type Handler = (event: { preventDefault(): void; isPreventDefault(): boolean }) => unknown;

const handlers: Handler[] = [];
const destroy = vi.fn<() => Promise<void>>(async () => undefined);
const close = vi.fn<() => Promise<void>>(async () => undefined);
const onCloseRequested = vi.fn(async (handler: Handler) => {
  handlers.push(handler);
  return () => {
    const i = handlers.indexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
});
const appWindow = { onCloseRequested, destroy, close };

export const tauriWindowMock = { getCurrentWindow: () => appWindow };

export const tauriWindow = {
  destroy,
  close,
  onCloseRequested,
  /** How many close-requested listeners the page has now. */
  listeners: () => handlers.length,
  /** The title-bar X or Alt+F4: "closed" natively, "destroyed" by the API after the handler, or "prevented". */
  async requestClose(): Promise<"closed" | "destroyed" | "prevented"> {
    if (handlers.length === 0) return "closed";
    for (const handler of [...handlers]) {
      let prevented = false;
      await handler({ preventDefault: () => { prevented = true; }, isPreventDefault: () => prevented });
      if (!prevented) {
        await destroy();
        return "destroyed";
      }
    }
    return "prevented";
  },
  reset() {
    handlers.length = 0;
    destroy.mockClear();
    close.mockClear();
    onCloseRequested.mockClear();
  },
};
