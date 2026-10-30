// A minimal Chrome DevTools Protocol client: enough to load a page, emulate a
// viewport and colour scheme, run a little script and capture a region.
// Uses the Chrome already installed on the machine; no browser is downloaded.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export async function launchChrome() {
  const binary = CANDIDATES.find((p) => existsSync(p));
  if (!binary) throw new Error("No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.");
  const profile = mkdtempSync(path.join(tmpdir(), "receipts-chrome-"));
  const child = spawn(
    binary,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--disable-gpu",
      "--font-render-hinting=none",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not start:\n${log}`)), 15000);
    child.stderr.on("data", (chunk) => {
      log += chunk.toString();
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(log);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
  });
  const browser = await connect(endpoint);
  const close = async () => {
    browser.socket.close();
    child.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(profile, { recursive: true, force: true });
  };
  return { browser, close };
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else {
      for (const listener of listeners) listener(msg);
    }
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      socket.send(
        JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }),
      );
    });
  const once = (method, sessionId) =>
    new Promise((resolve) => {
      const listener = (msg) => {
        if (msg.method === method && msg.sessionId === sessionId) {
          listeners.delete(listener);
          resolve(msg.params);
        }
      };
      listeners.add(listener);
    });
  return { socket, send, once };
}

/** A tab with helpers for the screenshot script. */
export async function openPage(browser) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  return {
    async view(width, height, scheme, mobile = false) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 2,
        mobile,
      });
      await send("Emulation.setEmulatedMedia", {
        features: [
          { name: "prefers-color-scheme", value: scheme },
          { name: "prefers-reduced-motion", value: "reduce" },
        ],
      });
    },
    async goto(url) {
      const loaded = browser.once("Page.loadEventFired", sessionId);
      await send("Page.navigate", { url });
      await loaded;
      await new Promise((r) => setTimeout(r, 300));
    },
    async evaluate(expression) {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (exceptionDetails)
        throw new Error(exceptionDetails.exception?.description ?? "script failed");
      return result.value;
    },
    /** PNG of the page region from the top of `from` to the bottom of `to`. */
    async capture(from, to = from, { pad = 24, tight = false, maxHeight = Infinity } = {}) {
      await this.evaluate("scrollTo(0, 0)");
      const box = await this.evaluate(`(() => {
        const a = document.querySelector(${JSON.stringify(from)}).getBoundingClientRect();
        const b = document.querySelector(${JSON.stringify(to)}).getBoundingClientRect();
        return { x: a.left, w: a.width, y: a.top + scrollY, bottom: b.bottom + scrollY, width: document.documentElement.clientWidth };
      })()`);
      const y = Math.max(0, box.y - pad);
      const x = tight ? Math.max(0, box.x - pad) : 0;
      const width = tight ? Math.min(box.width - x, box.w + pad * 2) : box.width;
      const clip = { x, y, width, height: Math.min(box.bottom + pad - y, maxHeight), scale: 1 };
      const { data } = await send("Page.captureScreenshot", {
        format: "png",
        clip,
        captureBeyondViewport: true,
      });
      return Buffer.from(data, "base64");
    },
  };
}
