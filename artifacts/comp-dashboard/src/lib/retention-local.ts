export type LocalFactKind = "attendance" | "billing";

export type AttendanceStatus =
  | "show"
  | "cancelled"
  | "no show"
  | "clinician cancelled";

export type AttendanceRow = {
  clientId: string;
  clinician: string;
  serviceDate: string;
  location: string | null;
  status: AttendanceStatus;
  sourceRowHash: string;
};

export type BillingRow = {
  clientId: string;
  clinician: string;
  serviceDate: string;
  totalFeeCharged: number;
  billingCode: string | null;
  sourceRowHash: string;
};

export type LocalSnapshot =
  | {
      id: string;
      kind: "attendance";
      importedAt: string;
      coverageStart: string;
      coverageEnd: string;
      sourceHash: string;
      rows: AttendanceRow[];
    }
  | {
      id: string;
      kind: "billing";
      importedAt: string;
      coverageStart: string;
      coverageEnd: string;
      sourceHash: string;
      rows: BillingRow[];
    };

export type BillingCodeMinutes = Record<string, number>;

export type ClinicianBillingMetric = {
  clinician: string;
  billedRows: number;
  totalFeesCharged: number;
  configuredMinuteRows: number;
  estimatedBillingHours: number | null;
};

export type ClinicianAttendanceMetric = {
  clinician: string;
  shows: number;
  clientCancelled: number;
  noShows: number;
  clinicianCancelled: number;
  uniqueActiveClients: number;
  firstObservedClients: number;
  retainedClients: number;
  immatureClientsExcluded: number;
};

export type RoomMetric = {
  location: string;
  showRows: number;
  clientCancelled: number;
  noShows: number;
  clinicianCancelled: number;
};

export type LocalRetentionMetrics = {
  coverageStart: string | null;
  coverageEnd: string | null;
  attendanceRows: number;
  billingRows: number;
  billingByClinician: ClinicianBillingMetric[];
  attendanceByClinician: ClinicianAttendanceMetric[];
  roomCounts: RoomMetric[];
};

export type LocalImportResult<T extends LocalFactKind> = {
  snapshot: Extract<LocalSnapshot, { kind: T }>;
  warnings: string[];
};

export type SnapshotMergeResult =
  | { status: "added"; snapshots: LocalSnapshot[] }
  | { status: "duplicate"; snapshots: LocalSnapshot[] }
  | {
      status: "overlap";
      snapshots: LocalSnapshot[];
      existing: LocalSnapshot[];
      incoming: LocalSnapshot;
    };

const requiredAttendanceHeaders = [
  "client",
  "clinician",
  "dateofservice",
  "status",
] as const;
const requiredBillingHeaders = [
  "dateofservice",
  "client",
  "clinician",
  "totalfee",
] as const;

const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (value: string | undefined) => (value ?? "").trim();
const rowHash = (parts: unknown[]) => stableHash(JSON.stringify(parts));

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  row.push(cell);
  if (row.some((item) => item.trim()) || rows.length) rows.push(row);
  return rows.filter((items) => items.some((item) => item.trim()));
}

function headerMap(headers: string[]) {
  return new Map(headers.map((header, index) => [headerKey(header), index]));
}

function cell(row: string[], map: Map<string, number>, key: string) {
  const index = map.get(key);
  return index === undefined ? "" : clean(row[index]);
}

function requireHeaders(map: Map<string, number>, keys: readonly string[]) {
  const missing = keys.filter((key) => !map.has(key));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}.`);
}

export function parseServiceDate(value: string): string {
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  const [, year, month, day] = iso
    ? iso
    : slash
      ? [
          slash[0],
          slash[3].length === 2 ? `20${slash[3]}` : slash[3],
          slash[1],
          slash[2],
        ]
      : [];
  if (!year || !month || !day) throw new Error(`Invalid service date: ${value}.`);
  const result = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const date = new Date(`${result}T12:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== result
  )
    throw new Error(`Invalid service date: ${value}.`);
  return result;
}

function parseMoney(value: string): number {
  const amount = Number(value.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error(`Invalid Total Fee: ${value}.`);
  return amount;
}

function parseStatus(value: string): AttendanceStatus {
  const key = value.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();
  if (key === "show") return "show";
  if (key === "cancelled" || key === "canceled") return "cancelled";
  if (key === "no show" || key === "noshow") return "no show";
  if (key === "clinician cancelled" || key === "clinician canceled")
    return "clinician cancelled";
  throw new Error(`Unknown attendance status: ${value}.`);
}

function coverage(rows: Array<{ serviceDate: string }>) {
  if (!rows.length) throw new Error("No rows were imported.");
  const dates = rows.map((row) => row.serviceDate).sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

export function importAttendanceCsv(
  text: string,
  now = new Date().toISOString(),
): LocalImportResult<"attendance"> {
  const rows = parseCsv(text);
  const headers = headerMap(rows[0] ?? []);
  requireHeaders(headers, requiredAttendanceHeaders);
  const warnings: string[] = [];
  if (!headers.has("location")) warnings.push("Location column is missing; room counts will use Unassigned.");
  const facts = rows.slice(1).map((row, index) => {
    const clientId = cell(row, headers, "client");
    const clinician = cell(row, headers, "clinician");
    if (!clientId || !clinician)
      throw new Error(`Row ${index + 2}: Client and Clinician are required.`);
    const serviceDate = parseServiceDate(cell(row, headers, "dateofservice"));
    const location = cell(row, headers, "location") || null;
    const status = parseStatus(cell(row, headers, "status"));
    return {
      clientId,
      clinician,
      serviceDate,
      location,
      status,
      sourceRowHash: rowHash(["attendance", clientId, clinician, serviceDate, location, status, index]),
    };
  });
  const { start, end } = coverage(facts);
  const sourceHash = rowHash(facts.map((row) => row.sourceRowHash));
  return {
    warnings,
    snapshot: {
      id: `attendance-${sourceHash}`,
      kind: "attendance",
      importedAt: now,
      coverageStart: start,
      coverageEnd: end,
      sourceHash,
      rows: facts,
    },
  };
}

export function importBillingCsv(
  text: string,
  now = new Date().toISOString(),
): LocalImportResult<"billing"> {
  const rows = parseCsv(text);
  const headers = headerMap(rows[0] ?? []);
  requireHeaders(headers, requiredBillingHeaders);
  const facts = rows.slice(1).map((row, index) => {
    const clientId = cell(row, headers, "client");
    const clinician = cell(row, headers, "clinician");
    if (!clientId || !clinician)
      throw new Error(`Row ${index + 2}: Client and Clinician are required.`);
    const serviceDate = parseServiceDate(cell(row, headers, "dateofservice"));
    const totalFeeCharged = parseMoney(cell(row, headers, "totalfee"));
    const billingCode = cell(row, headers, "billingcode") || null;
    return {
      clientId,
      clinician,
      serviceDate,
      totalFeeCharged,
      billingCode,
      sourceRowHash: rowHash(["billing", clientId, clinician, serviceDate, totalFeeCharged, billingCode, index]),
    };
  });
  const { start, end } = coverage(facts);
  const sourceHash = rowHash(facts.map((row) => row.sourceRowHash));
  return {
    warnings: [],
    snapshot: {
      id: `billing-${sourceHash}`,
      kind: "billing",
      importedAt: now,
      coverageStart: start,
      coverageEnd: end,
      sourceHash,
      rows: facts,
    },
  };
}

const overlaps = (a: LocalSnapshot, b: LocalSnapshot) =>
  a.kind === b.kind && a.coverageStart <= b.coverageEnd && b.coverageStart <= a.coverageEnd;

export function mergeSnapshot(
  snapshots: LocalSnapshot[],
  incoming: LocalSnapshot,
): SnapshotMergeResult {
  if (snapshots.some((item) => item.kind === incoming.kind && item.sourceHash === incoming.sourceHash))
    return { status: "duplicate", snapshots };
  const overlapping = snapshots.filter((item) => overlaps(item, incoming));
  if (overlapping.length) return { status: "overlap", snapshots, existing: overlapping, incoming };
  return { status: "added", snapshots: [...snapshots, incoming] };
}

export function replaceOverlappingSnapshots(
  snapshots: LocalSnapshot[],
  incoming: LocalSnapshot,
) {
  return [...snapshots.filter((item) => !overlaps(item, incoming)), incoming];
}

function sortByName<T extends { clinician?: string; location?: string }>(items: T[]) {
  return [...items].sort((a, b) =>
    (a.clinician ?? a.location ?? "").localeCompare(b.clinician ?? b.location ?? ""),
  );
}

export function buildLocalRetentionMetrics(
  snapshots: LocalSnapshot[],
  billingCodeMinutes: BillingCodeMinutes = {},
  followUpDays = 14,
): LocalRetentionMetrics {
  const attendance = snapshots.flatMap((snapshot) =>
    snapshot.kind === "attendance" ? snapshot.rows : [],
  );
  const billing = snapshots.flatMap((snapshot) =>
    snapshot.kind === "billing" ? snapshot.rows : [],
  );
  const allDates = [...attendance, ...billing].map((row) => row.serviceDate).sort();
  const coverageStart = allDates[0] ?? null;
  const coverageEnd = allDates[allDates.length - 1] ?? null;
  const billingByClinician = new Map<string, ClinicianBillingMetric>();
  for (const row of billing) {
    const metric = billingByClinician.get(row.clinician) ?? {
      clinician: row.clinician,
      billedRows: 0,
      totalFeesCharged: 0,
      configuredMinuteRows: 0,
      estimatedBillingHours: null,
    };
    metric.billedRows++;
    metric.totalFeesCharged += row.totalFeeCharged;
    if (row.billingCode && billingCodeMinutes[row.billingCode] !== undefined) {
      metric.configuredMinuteRows++;
      metric.estimatedBillingHours =
        (metric.estimatedBillingHours ?? 0) + billingCodeMinutes[row.billingCode] / 60;
    }
    billingByClinician.set(row.clinician, metric);
  }
  const attendanceByClinician = new Map<string, ClinicianAttendanceMetric>();
  const showDatesByClinicianClient = new Map<string, string[]>();
  for (const row of attendance) {
    const metric = attendanceByClinician.get(row.clinician) ?? {
      clinician: row.clinician,
      shows: 0,
      clientCancelled: 0,
      noShows: 0,
      clinicianCancelled: 0,
      uniqueActiveClients: 0,
      firstObservedClients: 0,
      retainedClients: 0,
      immatureClientsExcluded: 0,
    };
    if (row.status === "show") {
      metric.shows++;
      const key = `${row.clinician}\u0000${row.clientId}`;
      showDatesByClinicianClient.set(key, [
        ...(showDatesByClinicianClient.get(key) ?? []),
        row.serviceDate,
      ]);
    } else if (row.status === "cancelled") metric.clientCancelled++;
    else if (row.status === "no show") metric.noShows++;
    else metric.clinicianCancelled++;
    attendanceByClinician.set(row.clinician, metric);
  }
  for (const [key, dates] of showDatesByClinicianClient) {
    const clinician = key.split("\u0000")[0];
    const metric = attendanceByClinician.get(clinician);
    if (!metric) continue;
    const sorted = dates.sort();
    metric.uniqueActiveClients++;
    if (sorted.length > 1) metric.retainedClients++;
    else {
      metric.firstObservedClients++;
      const first = new Date(`${sorted[0]}T12:00:00Z`).getTime();
      const end = coverageEnd ? new Date(`${coverageEnd}T12:00:00Z`).getTime() : first;
      if ((end - first) / 86400000 < followUpDays) metric.immatureClientsExcluded++;
    }
  }
  const roomCounts = new Map<string, RoomMetric>();
  for (const row of attendance) {
    const location = row.location || "Unassigned";
    const metric = roomCounts.get(location) ?? {
      location,
      showRows: 0,
      clientCancelled: 0,
      noShows: 0,
      clinicianCancelled: 0,
    };
    if (row.status === "show") metric.showRows++;
    else if (row.status === "cancelled") metric.clientCancelled++;
    else if (row.status === "no show") metric.noShows++;
    else metric.clinicianCancelled++;
    roomCounts.set(location, metric);
  }
  return {
    coverageStart,
    coverageEnd,
    attendanceRows: attendance.length,
    billingRows: billing.length,
    billingByClinician: sortByName([...billingByClinician.values()]),
    attendanceByClinician: sortByName([...attendanceByClinician.values()]),
    roomCounts: sortByName([...roomCounts.values()]),
  };
}

export function exportLocalBackup(snapshots: LocalSnapshot[], billingCodeMinutes: BillingCodeMinutes) {
  return {
    format: "emc-local-retention-v1" as const,
    exportedAt: new Date().toISOString(),
    warning: "Contains local de-identified client IDs and row-level facts. Do not upload to the practice API.",
    snapshots,
    billingCodeMinutes,
  };
}

export function importLocalBackup(value: unknown) {
  if (!value || typeof value !== "object")
    throw new Error("Choose a local retention backup JSON file.");
  const data = value as {
    format?: unknown;
    snapshots?: unknown;
    billingCodeMinutes?: unknown;
  };
  if (data.format !== "emc-local-retention-v1" || !Array.isArray(data.snapshots))
    throw new Error("This is not a local retention backup.");
  return {
    snapshots: data.snapshots as LocalSnapshot[],
    billingCodeMinutes:
      data.billingCodeMinutes && typeof data.billingCodeMinutes === "object"
        ? (data.billingCodeMinutes as BillingCodeMinutes)
        : {},
  };
}
