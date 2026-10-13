import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dashboardRoot = path.join(repoRoot, "artifacts/comp-dashboard");
const playwrightPackageDir =
  process.env.PLAYWRIGHT_PACKAGE_DIR ?? "/tmp/local-retention-browser-harness";

const dashboardRequire = createRequire(
  path.join(dashboardRoot, "package.json"),
);
const playwrightRequire = createRequire(
  path.join(playwrightPackageDir, "package.json"),
);

const { createServer } = await import(dashboardRequire.resolve("vite"));
const react = (await import(dashboardRequire.resolve("@vitejs/plugin-react")))
  .default;
const { chromium } = playwrightRequire("playwright");

const syntheticAttendanceCsv = `Client,Clinician,Date of service,Location,Status
CID-browser-alpha,Dr Browser,2026-10-01,Room Browser A,show
CID-browser-alpha,Dr Browser,2026-10-15,Room Browser A,show
CID-browser-beta,Dr Browser,2026-10-02,Room Browser B,no show`;

const syntheticBillingCsv = `Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-browser-alpha,Dr Browser,150,90837
2026-10-02,CID-browser-beta,Dr Browser,100,NO-SHOW`;

const syntheticTokens = [
  "CID-browser-alpha",
  "CID-browser-beta",
  "Dr Browser",
  "Room Browser A",
  "Room Browser B",
  "90837",
  "NO-SHOW",
];

const browserExecutableCandidates = [
  process.env.PLAYWRIGHT_BROWSER_EXECUTABLE_PATH,
  "/Users/eliam/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

const browserExecutablePath = browserExecutableCandidates.find((candidate) =>
  existsSync(candidate),
);

if (!browserExecutablePath) {
  throw new Error(
    "No browser executable found. Set PLAYWRIGHT_BROWSER_EXECUTABLE_PATH or install Playwright browsers.",
  );
}

const makeFile = (name, mimeType, text) => ({
  name,
  mimeType,
  buffer: Buffer.from(text),
});

const normalize = (value) => value.replace(/\s+/g, " ").trim();

async function installBrowserSinkCapture(page) {
  await page.evaluate(() => {
    const events = [];
    const describePayload = (value) => {
      if (value === undefined || value === null) return "";
      if (typeof value === "string") return value;
      if (value instanceof URLSearchParams) return value.toString();
      if (value instanceof Blob)
        return `[Blob size=${value.size} type=${value.type}]`;
      if (value instanceof ArrayBuffer)
        return `[ArrayBuffer byteLength=${value.byteLength}]`;
      if (ArrayBuffer.isView(value))
        return `[ArrayBufferView byteLength=${value.byteLength}]`;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };
    const record = (channel, label, payload) => {
      events.push({
        channel,
        label: String(label),
        payload: describePayload(payload),
      });
    };

    window.__localRetentionPrivacyEvents = events;

    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      record(
        "fetch",
        typeof input === "string" ? input : input.url,
        init?.body,
      );
      return originalFetch(input, init);
    };

    const originalBeacon = navigator.sendBeacon?.bind(navigator);
    if (originalBeacon) {
      navigator.sendBeacon = (url, data) => {
        record("sendBeacon", url, data);
        return originalBeacon(url, data);
      };
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
      this.__localRetentionPrivacyRequest = `${method} ${String(url)}`;
      record("XMLHttpRequest.open", this.__localRetentionPrivacyRequest);
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function send(body) {
      record(
        "XMLHttpRequest.send",
        this.__localRetentionPrivacyRequest ?? "unknown",
        body,
      );
      return originalSend.call(this, body);
    };

    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;
    Storage.prototype.setItem = function setItem(key, value) {
      record(
        this === window.localStorage ? "localStorage" : "sessionStorage",
        `setItem:${key}`,
        value,
      );
      return originalSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function removeItem(key) {
      record(
        this === window.localStorage ? "localStorage" : "sessionStorage",
        `removeItem:${key}`,
      );
      return originalRemoveItem.call(this, key);
    };
    Storage.prototype.clear = function clear() {
      record(
        this === window.localStorage ? "localStorage" : "sessionStorage",
        "clear",
      );
      return originalClear.call(this);
    };

    if (window.indexedDB) {
      const originalIndexedOpen = window.indexedDB.open.bind(window.indexedDB);
      window.indexedDB.open = (name, version) => {
        record("indexedDB", `open:${name}`);
        return originalIndexedOpen(name, version);
      };
    }

    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = class PrivacyHarnessWebSocket extends OriginalWebSocket {
      constructor(url, protocols) {
        record("WebSocket", url);
        super(url, protocols);
      }
    };

    const OriginalEventSource = window.EventSource;
    window.EventSource = class PrivacyHarnessEventSource extends (
      OriginalEventSource
    ) {
      constructor(url, config) {
        record("EventSource", url);
        super(url, config);
      }
    };
  });
}

async function readPrivacyEvents(page) {
  return await page.evaluate(() => window.__localRetentionPrivacyEvents ?? []);
}

async function summaryText(page) {
  return normalize(await page.locator(".pw-retention-summary").textContent());
}

async function importFile(page, inputIndex, file) {
  await page.locator("input[type=file]").nth(inputIndex).setInputFiles(file);
}

async function waitForBodyText(page, text) {
  await page.waitForFunction(
    (expected) => document.body.textContent?.includes(expected),
    text,
  );
}

function createOverlappingBackup(backup) {
  const attendance = backup.snapshots.find(
    (snapshot) => snapshot.kind === "attendance",
  );
  assert.ok(attendance, "Expected attendance snapshot in backup.");
  const overlap = JSON.parse(JSON.stringify(attendance));
  overlap.id = `${attendance.id}-overlap`;
  overlap.sourceHash = `${attendance.sourceHash}-overlap`;
  overlap.rows = overlap.rows.map((row, index) => ({
    ...row,
    clientId: `${row.clientId}-overlap`,
    sourceRowHash: `${row.sourceRowHash}-overlap-${index}`,
  }));
  return { ...backup, snapshots: [attendance, overlap] };
}

const server = await createServer({
  configFile: false,
  root: dashboardRoot,
  base: "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.join(dashboardRoot, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.LOCAL_RETENTION_BROWSER_PORT ?? 4397),
    strictPort: false,
    hmr: false,
    fs: {
      strict: true,
      allow: [dashboardRoot],
    },
  },
});

let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  const port =
    typeof address === "object" && address
      ? address.port
      : server.config.server.port;
  const url = `http://127.0.0.1:${port}/test-harness/local-retention-browser-harness.html`;

  browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutablePath,
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const operationRequests = [];
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('section[aria-label="Local retention workspace"]');

  page.on("request", (request) => {
    operationRequests.push({
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      postData: request.postData() ?? "",
    });
  });
  await installBrowserSinkCapture(page);

  await importFile(
    page,
    0,
    makeFile("attendance.csv", "text/csv", syntheticAttendanceCsv),
  );
  await waitForBodyText(page, "Loaded 3 attendance rows");
  await importFile(
    page,
    1,
    makeFile("billing.csv", "text/csv", syntheticBillingCsv),
  );
  await waitForBodyText(page, "Loaded 2 billing rows");
  await page.getByLabel("Billing code").fill("90837");
  await page.getByLabel("Default minutes").fill("53");
  await page.getByRole("button", { name: "Add" }).click();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /Download backup/ }).click(),
  ]);
  const downloadedPath = await download.path();
  assert.ok(downloadedPath, "Expected Playwright download path.");
  const backupText = await fs.readFile(downloadedPath, "utf8");
  const backup = JSON.parse(backupText);
  assert.match(backupText, /CID-browser-alpha/);

  await importFile(
    page,
    2,
    makeFile("restore.json", "application/json", backupText),
  );
  await waitForBodyText(page, "Restored 2 local snapshots from backup.");
  const stableSummary = await summaryText(page);
  assert.match(stableSummary, /Attendance rows\s*3/);
  assert.match(stableSummary, /Billed rows\s*2/);

  const duplicateBackup = {
    ...backup,
    snapshots: [backup.snapshots[0], backup.snapshots[0]],
  };
  await importFile(
    page,
    2,
    makeFile(
      "duplicate-restore.json",
      "application/json",
      JSON.stringify(duplicateBackup),
    ),
  );
  await waitForBodyText(page, "duplicates snapshot");
  assert.equal(await summaryText(page), stableSummary);

  await importFile(
    page,
    2,
    makeFile(
      "overlap-restore.json",
      "application/json",
      JSON.stringify(createOverlappingBackup(backup)),
    ),
  );
  await waitForBodyText(page, "overlaps snapshot");
  assert.equal(await summaryText(page), stableSummary);

  const browserSinkEvents = await readPrivacyEvents(page);
  const requestText = JSON.stringify(operationRequests);
  const sinkText = JSON.stringify(browserSinkEvents);
  for (const token of syntheticTokens) {
    assert.equal(requestText.includes(token), false, token);
    assert.equal(sinkText.includes(token), false, token);
  }
  assert.deepEqual(operationRequests, []);
  assert.deepEqual(browserSinkEvents, []);
  assert.equal(await page.evaluate(() => window.localStorage.length), 0);
  assert.equal(await page.evaluate(() => window.sessionStorage.length), 0);

  console.log(
    JSON.stringify(
      {
        status: "passed",
        url,
        browserExecutablePath,
        operationRequests,
        browserSinkEvents,
        stableSummary,
        downloadedBackupBytes: Buffer.byteLength(backupText),
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server.close();
}
