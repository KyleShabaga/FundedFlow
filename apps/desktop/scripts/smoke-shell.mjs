// Basic Linux Chromium smoke checks for Build 12. No production runtime service or test data is added.
// Run from the repo root after npm run build. Override CHROMIUM_PATH if needed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const output = process.env.FUNDEDFLOW_SMOKE_OUTPUT || "/tmp/fundedflow-build12";
await mkdir(output, { recursive: true });
const processes = [];
function launch(command, args, cwd = root) {
  const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", data => { log = (log + data).slice(-4000); });
  child.stderr.on("data", data => { log = (log + data).slice(-4000); });
  child.on("error", error => { log += error.message; });
  processes.push(child);
  return () => log;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, description) {
  for (let count = 0; count < 100; count++) {
    try { if (await fn()) return; } catch {}
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}
async function cdpPage() {
  const target = await (await fetch("http://127.0.0.1:9333/json/new?about:blank", { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map();
  const exceptions = [];
  let id = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (!message.id) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
  const evaluate = async expression => {
    const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  return { send, evaluate, exceptions, close: async () => {
    socket.close();
    await fetch(`http://127.0.0.1:9333/json/close/${target.id}`);
  }};
}
const ready = { state: "ready", stage: "ready", schemaVersion: 13, supportedSchemaVersion: 13, created: false, failure: null };
const failed = { ...ready, state: "failed", stage: "open", failure: {
  category: "open_failed", retryable: true, message: "The journal could not be opened.",
  detail: "Simulated IPC failure for browser smoke verification", failedMigration: null,
}};
const results = [];
async function smoke(origin, name) {
  const page = await cdpPage();
  const { send, evaluate } = page;
  try {
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `
      try { localStorage.removeItem("fundedflow.sidebarCollapsed"); } catch {}
      window.__smokeReady = ${JSON.stringify(ready)};
      window.__smokeFailed = ${JSON.stringify(failed)};
      window.__smokeStatus = window.__smokeReady;
      window.__smokeCommands = [];
      window.__TAURI_INTERNALS__ = { invoke: async command => {
        window.__smokeCommands.push(command);
        if (command === "retry_runtime") window.__smokeStatus = window.__smokeReady;
        if (!["runtime_status", "retry_runtime"].includes(command)) throw new Error("Unexpected feature query");
        return structuredClone(window.__smokeStatus);
      }};
    ` });
    await send("Page.navigate", { url: `${origin}/#/` });
    await until(() => evaluate(`document.body.textContent.includes("Today is not built yet")`), `${name} startup`);
    assert.equal(await evaluate(`document.querySelectorAll('nav[aria-label="Primary navigation"] a').length`), 5);
    assert.equal(await evaluate(`document.querySelector('button[aria-describedby="import-unavailable"]').disabled`), true);
    assert.equal(await evaluate(`document.querySelector('aside').getBoundingClientRect().width`), 248);
    for (const [label, path] of [["Journal", "/journal"], ["Insights", "/insights"], ["Accounts", "/accounts"], ["Settings", "/settings"], ["Today", "/"]]) {
      await evaluate(`document.querySelector('nav a[aria-label="${label}"]').click()`);
      await until(() => evaluate(`location.hash === "#${path}" && document.querySelector('h1')?.textContent === "${label}"`), `${name} ${label}`);
      assert.equal(await evaluate(`document.querySelectorAll('nav a[aria-current="page"]').length`), 1);
    }
    await evaluate(`document.querySelector('nav a[aria-label="Journal"]').click()`);
    await until(() => evaluate(`location.hash === "#/journal"`), `${name} journal`);
    const previousDocument = await evaluate(`performance.timeOrigin`);
    await send("Page.reload");
    await until(() => evaluate(`performance.timeOrigin !== ${previousDocument} && document.querySelector('h1')?.textContent === "Journal" && document.body.textContent.includes("Journal is not built yet")`), `${name} reload`);
    await send("Page.bringToFront");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "b", code: "KeyB", modifiers: 2, windowsVirtualKeyCode: 66 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "b", code: "KeyB", modifiers: 2, windowsVirtualKeyCode: 66 });
    await until(() => evaluate(`document.querySelector('aside').getBoundingClientRect().width === 72`), `${name} Ctrl+B`);
    await evaluate(`document.querySelector('button[aria-label="Expand sidebar"]').click()`);
    await evaluate(`window.__smokeStatus = window.__smokeFailed; window.dispatchEvent(new Event("focus"))`);
    await until(() => evaluate(`document.querySelector('[role="alert"]')?.textContent.includes("couldn't be opened")`), `${name} post-ready failure`);
    assert.equal(await evaluate(`location.hash`), "#/journal");
    assert.equal(await evaluate(`document.querySelector('fieldset').disabled`), true);
    assert.equal(await evaluate(`Boolean(document.querySelector('fieldset [inert]'))`), true);
    await evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
    await delay(200);
    await writeFile(resolve(output, `${name}-recovery.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    for (const [width, height, scale] of [[1024, 640, 1], [1024, 640, 1.5], [640, 800, 1], [320, 640, 1]]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
      await until(() => evaluate(`document.querySelector('aside').getBoundingClientRect().width === ${width < 760 ? 72 : 248}`), `${name} responsive ${width}`);
      assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `${name} overflow ${width}@${scale}`);
      const outside = await evaluate(`(() => { const b = document.querySelector('[role="alert"] button').getBoundingClientRect(); return b.left < 0 || b.right > innerWidth; })()`);
      assert.equal(outside, false, `${name} recovery action outside viewport`);
    }
    await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await delay(200);
    await writeFile(resolve(output, `${name}-narrow.png`), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
    await send("Page.bringToFront");
    await evaluate(`document.querySelector('[role="alert"] button').focus()`);
    assert.equal(await evaluate(`document.activeElement.textContent`), "Retry");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until(() => evaluate(`!document.querySelector('[role="alert"]') && !document.querySelector('fieldset').disabled`), `${name} keyboard recovery`);
    assert.equal(await evaluate(`window.__smokeCommands.filter(command => command === "retry_runtime").length`), 1);
    await evaluate(`location.hash = "/missing"`);
    await until(() => evaluate(`document.body.textContent.includes("This page doesn't exist")`), `${name} unknown route`);
    assert.equal(await evaluate(`document.querySelectorAll('nav a[aria-current="page"]').length`), 0);
    await evaluate(`document.querySelector('main a').click()`);
    await until(() => evaluate(`document.querySelector('h1')?.textContent === "Today"`), `${name} return`);
    if (name === "production") {
      await evaluate(`location.hash = "/settings"`);
      await until(() => evaluate(`document.querySelector('h1')?.textContent === "Settings"`), "production Settings");
      assert.equal(await evaluate(`document.body.textContent.includes("Developer tools")`), false);
      await evaluate(`location.hash = "/settings/developer"`);
      await until(() => evaluate(`document.querySelector('h1')?.textContent === "Page not found"`), "production developer route excluded");
      assert.equal(await evaluate(`document.querySelectorAll('nav a[aria-current="page"]').length`), 0);
    }
    assert.deepEqual(page.exceptions, []);
    results.push({ mode: name, result: "passed", checks: "launch, 5 routes, reload, active state, Ctrl+B, responsive widths/scaling emulation, runtime loss, inert/disabled data, keyboard Retry, unknown route", runtime: "mocked IPC; not native Tauri" });
  } catch (error) {
    console.error("Smoke failure state", await evaluate(`JSON.stringify({hash:location.hash, commands:window.__smokeCommands, active:document.activeElement?.tagName, alert:document.querySelector('[role="alert"]')?.textContent, fieldsets:[...document.querySelectorAll('fieldset')].map(f=>({disabled:f.disabled, text:f.textContent}))})`));
    throw error;
  } finally { await page.close(); }
  const browserOnly = await cdpPage();
  try {
    await browserOnly.send("Page.navigate", { url: origin });
    await until(() => browserOnly.evaluate(`document.querySelector('[role="alert"]')?.textContent.includes("local data service")`), `${name} absent bridge`);
    assert.equal(await browserOnly.evaluate(`document.querySelectorAll('nav[aria-label="Primary navigation"] a').length`), 5);
    assert.equal(await browserOnly.evaluate(`Boolean(document.querySelector('fieldset'))`), false);
    assert.deepEqual(browserOnly.exceptions, []);
    results.push({ mode: name, result: "passed", checks: "browser without Tauri bridge shows recovery with navigation; no data content mounted" });
  } finally { await browserOnly.close(); }
}
try {
  const browserLog = launch(process.env.CHROMIUM_PATH || "chromium", ["--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-default-apps", "--no-first-run", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9333", `--user-data-dir=${resolve(output, "chrome-profile")}`, "about:blank"]);
  await until(async () => (await fetch("http://127.0.0.1:9333/json/version")).ok, `Chromium startup: ${browserLog()}`);
  launch(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", "1420", "--strictPort"], resolve(root, "apps/desktop"));
  launch(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "1422", "--strictPort"], resolve(root, "apps/desktop"));
  await until(async () => (await fetch("http://127.0.0.1:1420")).ok, "Vite development startup");
  await until(async () => (await fetch("http://127.0.0.1:1422")).ok, "Vite production preview startup");
  await smoke("http://127.0.0.1:1420", "development");
  await smoke("http://127.0.0.1:1422", "production");
  await writeFile(resolve(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ results, screenshots: output }, null, 2));
} finally {
  for (const child of processes.reverse()) child.kill("SIGTERM");
}
