// Makes jsdom run window's popstate listeners the way Chromium (WebView2) does (TASK-022). When window is the
// event's target, Chromium runs its listeners in the order they were added, whatever their capture flag; jsdom runs
// capture listeners first. So a guard listener added with `{ capture: true }` after the router's passes in jsdom and
// fails in the packaged app. Registering every popstate listener as non-capture gives registration order in jsdom
// too. Install before the router mounts; the returned function undoes it.
type Options = boolean | AddEventListenerOptions | EventListenerOptions | undefined;

const withoutCapture = (options: Options): Options =>
  typeof options === "object" && options !== null ? { ...options, capture: false } : false;

export function emulateChromiumPopstateOrder(): () => void {
  const add = window.addEventListener;
  const remove = window.removeEventListener;
  window.addEventListener = function (this: Window, type: string, listener: EventListenerOrEventListenerObject, options?: Options) {
    add.call(this, type, listener, type === "popstate" ? withoutCapture(options) : options);
  } as typeof window.addEventListener;
  window.removeEventListener = function (this: Window, type: string, listener: EventListenerOrEventListenerObject, options?: Options) {
    remove.call(this, type, listener, type === "popstate" ? withoutCapture(options) : options);
  } as typeof window.removeEventListener;
  return () => {
    window.addEventListener = add;
    window.removeEventListener = remove;
  };
}
