// Real plain-Node vs headless Chromium parity, independent of Vitest environments.
import { build } from "vite";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../../..", import.meta.url));
const { evaluateAccountRisk, engineSha256 } = await import(
  new URL("../dist/index.js", import.meta.url)
);
for (const value of ["", "abc", "π🙂 FundedFlow"])
  if (engineSha256(value) !== createHash("sha256").update(value).digest("hex"))
    throw Error("SHA-256 UTF-8 parity failed");
const cases = JSON.parse(
  readFileSync(
    new URL("../test/fixtures/engine-contract.json", import.meta.url),
    "utf8",
  ),
);
const variants = [...cases];
for (const family of [
  "profit_target",
  "daily_loss_limit",
  "min_trading_days",
  "consistency",
  "max_trades_per_day",
  "max_drawdown",
]) {
  const c = structuredClone(cases[0]);
  c.name = family;
  const r = c.input.rulebookVersions[0].rules[0];
  r.ruleType = family;
  r.parameters =
    family === "profit_target"
      ? { amount: { state: "value", value: "3000" }, basis: "balance" }
      : family === "daily_loss_limit"
        ? {
            limit: { state: "value", value: "100" },
            basis: "realized",
            resetBasis: "account_trading_day",
            condition: "always",
            breach: "hard",
          }
        : family === "min_trading_days"
          ? {
              days: { state: "value", value: 5 },
              minDayProfit: { state: "value", value: "150" },
              dayBasis: "trading_day",
            }
          : family === "consistency"
            ? {
                maxBestDayShare: { state: "value", value: "0.5" },
                denominator: "total_profit",
                appliesTo: "evaluation",
              }
            : family === "max_trades_per_day"
              ? { count: { state: "value", value: 5 } }
              : {
                  amount: { state: "value", value: "2000" },
                  method: "intraday_trailing",
                  basis: "realized_and_unrealized",
                  lock: { state: "explicit_none" },
                };
  variants.push(c);
}
const expected = variants.map((c) => evaluateAccountRisk(c.input, c.policy));
for (let i = 0; i < cases.length; i++)
  if (JSON.stringify(expected[i]) !== JSON.stringify(cases[i].result))
    throw Error(
      "Stale engine-contract fixture; regenerate and review deliberately",
    );
const dir = mkdtempSync(join(tmpdir(), "fundedflow-engine-browser-"));
try {
  await build({
    configFile: false,
    logLevel: "silent",
    build: {
      lib: {
        entry: resolve(root, "packages/domain/src/index.ts"),
        formats: ["iife"],
        name: "FundedFlowDomain",
        fileName: () => "engine.js",
      },
      outDir: dir,
      emptyOutDir: true,
    },
  });
  const code = readFileSync(join(dir, "engine.js"), "utf8");
  const data = JSON.stringify(
    variants.map((c) => ({ input: c.input, policy: c.policy })),
  ).replaceAll("<", "\\u003c");
  const executable =
    process.env.FUNDEDFLOW_CHROMIUM ?? "/usr/lib/chromium/chromium";
  const browser = spawn(
    executable,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-extensions",
      "--no-first-run",
      `--user-data-dir=${join(dir, "profile")}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let text = "";
      const timer = setTimeout(
        () =>
          reject(
            Error(`Chromium debugging startup timeout: ${text.slice(-1500)}`),
          ),
        20000,
      );
      browser.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      browser.stderr.on("data", (chunk) => {
        text += chunk;
        const match = text.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("CDP connection timeout")),
        10000,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(Error("CDP connection failed"));
        },
        { once: true },
      );
    });
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id);
        clearTimeout(timer);
        pending.delete(message.id);
        if (message.error) reject(Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
    const call = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error(`CDP ${method} timed out`));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    const target = await call("Target.createTarget", { url: "about:blank" });
    const attached = await call("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    const evaluated = await call(
      "Runtime.evaluate",
      {
        expression: `(()=>{${code};const cases=${data};return JSON.stringify(cases.map(c=>FundedFlowDomain.evaluateAccountRisk(c.input,c.policy)));})()`,
        returnByValue: true,
      },
      attached.sessionId,
    );
    if (evaluated.exceptionDetails)
      throw Error(JSON.stringify(evaluated.exceptionDetails));
    if (evaluated.result.value !== JSON.stringify(expected))
      throw Error("Browser and plain Node engine results differ");
    console.log(
      `Plain Node and Chromium produce identical JSON for ${variants.length} engine scenarios; SHA-256 UTF-8 parity passed`,
    );
    await call("Browser.close").catch(() => {});
  } finally {
    socket?.close();
    browser.kill("SIGKILL");
    browser.stderr.destroy();
    browser.unref();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
