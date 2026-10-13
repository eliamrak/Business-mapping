import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportLocalBackup,
  importAttendanceCsv,
  importBillingCsv,
  importLocalBackup,
  type BillingCodeMinutes,
  type LocalSnapshot,
} from "./retention-local.ts";

type BrowserCapture = {
  channel: string;
  label: string;
  payload: string;
};

type LocalRetentionHarness = {
  snapshots: LocalSnapshot[];
  billingCodeMinutes: BillingCodeMinutes;
};

const syntheticAttendanceCsv = `Client,Clinician,Date of service,Location,Status
CID-privacy-alpha,Dr Synthetic,2026-10-01,Room A,show
CID-privacy-alpha,Dr Synthetic,2026-10-15,Room A,show
CID-privacy-beta,Dr Synthetic,2026-10-02,Room B,no show`;

const overlappingAttendanceCsv = `Client,Clinician,Date of service,Location,Status
CID-privacy-gamma,Dr Synthetic,2026-10-15,Room B,show
CID-privacy-delta,Dr Synthetic,2026-10-20,Room B,show`;

const nonOverlappingAttendanceCsv = `Client,Clinician,Date of service,Location,Status
CID-privacy-epsilon,Dr Synthetic,2026-11-01,Room C,show`;

const syntheticBillingCsv = `Date of Service,Client,Clinician,Total Fee,Billing Code
2026-10-01,CID-privacy-alpha,Dr Synthetic,150,90837
2026-10-02,CID-privacy-beta,Dr Synthetic,100,NO-SHOW`;

const sensitiveSyntheticTokens = [
  "CID-privacy-alpha",
  "CID-privacy-beta",
  "CID-privacy-gamma",
  "CID-privacy-delta",
  "CID-privacy-epsilon",
  "Dr Synthetic",
  "Room A",
  "Room B",
  "Room C",
  "90837",
  "NO-SHOW",
];

const describePayload = (value: unknown) => {
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

function installBrowserPrivacyCapture(captures: BrowserCapture[]) {
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalLocalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const originalSessionStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  const originalIndexedDb = Object.getOwnPropertyDescriptor(
    globalThis,
    "indexedDB",
  );
  const originalXmlHttpRequest = Object.getOwnPropertyDescriptor(
    globalThis,
    "XMLHttpRequest",
  );
  const originalWebSocket = Object.getOwnPropertyDescriptor(
    globalThis,
    "WebSocket",
  );
  const originalEventSource = Object.getOwnPropertyDescriptor(
    globalThis,
    "EventSource",
  );

  const record = (channel: string, label: string, payload?: unknown) => {
    captures.push({ channel, label, payload: describePayload(payload) });
  };
  const makeStorage = (name: string) => ({
    getItem(key: string) {
      record(name, `getItem:${key}`);
      return null;
    },
    setItem(key: string, value: string) {
      record(name, `setItem:${key}`, value);
    },
    removeItem(key: string) {
      record(name, `removeItem:${key}`);
    },
    clear() {
      record(name, "clear");
    },
  });

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    record("fetch", String(input), init?.body);
    return Promise.reject(new Error("Network is blocked in privacy harness."));
  }) as typeof fetch;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      sendBeacon(url: string | URL, data?: BodyInit | null) {
        record("sendBeacon", String(url), data);
        return false;
      },
    },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: makeStorage("localStorage"),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: makeStorage("sessionStorage"),
  });
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open(name: string) {
        record("indexedDB", `open:${name}`);
        throw new Error("indexedDB is blocked in privacy harness.");
      },
    },
  });
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    value: class PrivacyHarnessXmlHttpRequest {
      #method = "GET";
      #url = "";

      open(method: string, url: string | URL) {
        this.#method = method;
        this.#url = String(url);
        record("XMLHttpRequest", `${method} ${String(url)}`);
      }

      send(body?: XMLHttpRequestBodyInit | null) {
        record("XMLHttpRequest", `${this.#method} ${this.#url}`, body);
      }
    },
  });
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: class PrivacyHarnessWebSocket {
      constructor(url: string | URL) {
        record("WebSocket", String(url));
        throw new Error("WebSocket is blocked in privacy harness.");
      }
    },
  });
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: class PrivacyHarnessEventSource {
      constructor(url: string | URL) {
        record("EventSource", String(url));
        throw new Error("EventSource is blocked in privacy harness.");
      }
    },
  });

  return () => {
    globalThis.fetch = originalFetch;
    const restoreDescriptor = (
      name: string,
      descriptor?: PropertyDescriptor,
    ) => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    };
    restoreDescriptor("navigator", originalNavigator);
    restoreDescriptor("localStorage", originalLocalStorage);
    restoreDescriptor("sessionStorage", originalSessionStorage);
    restoreDescriptor("indexedDB", originalIndexedDb);
    restoreDescriptor("XMLHttpRequest", originalXmlHttpRequest);
    restoreDescriptor("WebSocket", originalWebSocket);
    restoreDescriptor("EventSource", originalEventSource);
  };
}

const snapshotState = (state: LocalRetentionHarness) =>
  JSON.stringify({
    snapshotIds: state.snapshots.map((snapshot) => snapshot.id),
    billingCodeMinutes: state.billingCodeMinutes,
  });

const restoreBackupIntoHarness = (
  state: LocalRetentionHarness,
  value: unknown,
) => {
  const parsed = importLocalBackup(value);
  state.snapshots = parsed.snapshots;
  state.billingCodeMinutes = parsed.billingCodeMinutes;
};

test("isolated local retention browser privacy harness does not leak synthetic rows", () => {
  const captures: BrowserCapture[] = [];
  const restoreBrowser = installBrowserPrivacyCapture(captures);
  try {
    const attendance = importAttendanceCsv(
      syntheticAttendanceCsv,
      "2026-10-13T00:00:00Z",
    ).snapshot;
    const billing = importBillingCsv(
      syntheticBillingCsv,
      "2026-10-13T00:00:00Z",
    ).snapshot;
    const nonOverlapping = importAttendanceCsv(
      nonOverlappingAttendanceCsv,
      "2026-10-13T00:00:00Z",
    ).snapshot;
    const state: LocalRetentionHarness = {
      snapshots: [attendance, billing],
      billingCodeMinutes: { "90837": 53 },
    };

    const exported = exportLocalBackup(
      [...state.snapshots, nonOverlapping],
      state.billingCodeMinutes,
    );
    const exportedText = JSON.stringify(exported);
    assert.match(exportedText, /CID-privacy-alpha/);

    restoreBackupIntoHarness(state, JSON.parse(exportedText));
    assert.equal(state.snapshots.length, 3);

    const beforeDuplicateRestore = snapshotState(state);
    assert.throws(
      () =>
        restoreBackupIntoHarness(
          state,
          exportLocalBackup([attendance, attendance], state.billingCodeMinutes),
        ),
      /duplicates snapshot/,
    );
    assert.equal(snapshotState(state), beforeDuplicateRestore);

    const overlapping = importAttendanceCsv(
      overlappingAttendanceCsv,
      "2026-10-13T00:00:00Z",
    ).snapshot;
    const beforeOverlapRestore = snapshotState(state);
    assert.throws(
      () =>
        restoreBackupIntoHarness(
          state,
          exportLocalBackup(
            [attendance, overlapping],
            state.billingCodeMinutes,
          ),
        ),
      /overlaps snapshot/,
    );
    assert.equal(snapshotState(state), beforeOverlapRestore);

    assert.deepEqual(captures, []);
    const capturedText = JSON.stringify(captures);
    for (const token of sensitiveSyntheticTokens)
      assert.equal(capturedText.includes(token), false, token);
  } finally {
    restoreBrowser();
  }
});
