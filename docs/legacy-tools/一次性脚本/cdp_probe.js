const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const chromePath =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const targetUrl = process.env.MOMOTALK_URL || "http://127.0.0.1:8765/";
const port = Number(process.env.CDP_PORT || 9333);
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "momotalk-cdp-"));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Chrome is still starting.
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(url, sessionId = null) {
    this.socket = new WebSocket(url);
    this.sessionId = sessionId;
    this.pending = new Map();
    this.nextId = 0;
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (this.sessionId) payload.sessionId = this.sessionId;
      this.socket.send(JSON.stringify(payload));
    });
  }

  close() {
    this.socket.close();
  }
}

async function probe(width, height, mobile) {
  const target = await (
    await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
      { method: "PUT" },
    )
  ).json();
  const page = new CdpClient(target.webSocketDebuggerUrl);
  await page.ready;
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  await page.send("Page.navigate", { url: targetUrl });
  await delay(1200);
  const expression = `(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        selector,
        left: Math.round(box.left * 100) / 100,
        top: Math.round(box.top * 100) / 100,
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
        right: Math.round(box.right * 100) / 100,
        bottom: Math.round(box.bottom * 100) / 100,
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        padding: style.padding,
        display: style.display,
      };
    };
    const contacts = [...document.querySelectorAll(".side-entry")].map((node) => {
      const box = node.getBoundingClientRect();
      return {
        width: Math.round(box.width * 100) / 100,
        height: Math.round(box.height * 100) / 100,
      };
    });
    return {
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      phoneStack: rect(".phone-stack"),
      phonePreview: rect(".phone-preview"),
      panel: rect(".momotalk-panel"),
      rail: rect(".momotalk-rail"),
      side: rect(".momotalk-side"),
      chat: rect(".momotalk-chat"),
      header: rect(".chat-header"),
      contactName: rect(".contact-name"),
      contactName: rect(".contact-name"),
      history: rect(".history-button"),
      chatScroll: rect(".chat-scroll"),
      firstMessageAvatar: rect("#chatScroll .message-avatar"),
      firstBubble: rect("#chatScroll .bubble"),
      composer: rect(".momotalk-composer"),
      contactEntryMin: contacts.length
        ? contacts.reduce((min, item) => Math.min(min, item.width, item.height), Infinity)
        : null,
      contactEntryMax: contacts.length
        ? contacts.reduce((max, item) => Math.max(max, item.width, item.height), -Infinity)
        : null,
    };
  })()`;
  const result = await page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  page.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);
  return result.result.value;
}

async function main() {
  if (process.env.CDP_DEBUG === "1") console.error("[cdp] starting chrome");
  const keepAlive = setInterval(() => {}, 1000);
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  chrome.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  chrome.on("error", (error) => {
    stderr += `\nspawn error: ${error.stack || error.message}`;
  });
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    if (process.env.CDP_DEBUG === "1") console.error("[cdp] chrome ready");
    const desktop = await probe(1440, 980, false);
    if (process.env.CDP_DEBUG === "1") console.error("[cdp] desktop done");
    const mobile = await probe(390, 844, true);
    if (process.env.CDP_DEBUG === "1") console.error("[cdp] mobile done");
    console.log(JSON.stringify({ desktop, mobile }, null, 2));
  } finally {
    clearInterval(keepAlive);
    chrome.kill();
    await delay(500);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
    } catch {
      // Chromium may keep a lock on its profile for a moment after exit.
    }
    if (process.env.CDP_DEBUG === "1" && stderr.trim()) {
      console.error(stderr);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
