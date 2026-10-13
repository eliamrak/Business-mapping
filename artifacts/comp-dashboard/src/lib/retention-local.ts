export type LocalFactKind = "attendance" | "billing";

export type AttendanceStatus =
  | "show"
  | "cancelled"
  | "no show"
  | "clinician cancelled";

const attendanceStatuses: readonly AttendanceStatus[] = [
  "show",
  "cancelled",
  "no show",
  "clinician cancelled",
];

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

export type LocalClientActivityEstimate = {
  coverageStart: string;
  coverageEnd: string;
  retainedClientPairs: number;
  matureNonRetainedClientPairs: number;
  immatureClientPairsExcluded: number;
  leftCensoredClientPairs: number;
  rightCensoredClientPairs: number;
  observedAttendedSessionsPerRetainedClient: number;
  observedAttendedSessionsPerMonth: number;
  estimatedMonths: number;
  monthlyAttritionRate: number;
  monthlyAttritionPct: number;
  latestCompleteMonth: string | null;
  activeClientsInLatestCompleteMonth: number | null;
  estimatedClientsLeavingPerMonth: number | null;
};

export type LocalVisitReconciliationStatus =
  | "matched"
  | "attendance_only"
  | "billing_only"
  | "ambiguous";

export type LocalVisitReconciliationRow = {
  key: string;
  status: LocalVisitReconciliationStatus;
  clientId: string;
  clinician: string;
  serviceDate: string;
  attendanceRows: AttendanceRow[];
  billingRows: BillingRow[];
  totalFeeCharged: number | null;
  reviewReason: string | null;
};

export type LocalVisitReconciliation = {
  matchedVisits: number;
  attendanceOnlyRows: number;
  billingOnlyRows: number;
  ambiguousGroups: number;
  ambiguousAttendanceRows: number;
  ambiguousBillingRows: number;
  totalMatchedFeesCharged: number;
  rows: LocalVisitReconciliationRow[];
};

export type LocalImportResult<T extends LocalFactKind> = {
  snapshot: Extract<LocalSnapshot, { kind: T }>;
  warnings: string[];
};

export type LocalPackageImport = {
  packageId: string;
  exportedAt: string;
  snapshots: LocalSnapshot[];
  billingCodeMinutes: BillingCodeMinutes;
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

export type PackageMergeResult =
  | {
      status: "added";
      snapshots: LocalSnapshot[];
      billingCodeMinutes: BillingCodeMinutes;
      warnings: string[];
    }
  | {
      status: "duplicate";
      snapshots: LocalSnapshot[];
      billingCodeMinutes: BillingCodeMinutes;
      warnings: string[];
    }
  | {
      status: "blocked";
      snapshots: LocalSnapshot[];
      billingCodeMinutes: BillingCodeMinutes;
      reason: string;
      warnings: string[];
    }
  | {
      status: "overlap";
      snapshots: LocalSnapshot[];
      billingCodeMinutes: BillingCodeMinutes;
      existing: LocalSnapshot[];
      incoming: LocalSnapshot[];
      warnings: string[];
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

const headerKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (value: string | undefined) => (value ?? "").trim();
const rowHash = (parts: unknown[]) => stableHash(JSON.stringify(parts));
const normalizeClinician = (value: string) =>
  value.toLowerCase().replace(/\s+/g, " ").trim();
const headerAliases = new Map([
  ["randomid", "client"],
  ["date", "dateofservice"],
]);

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
  const map = new Map<string, number>();
  headers.forEach((header, index) => {
    const key = headerAliases.get(headerKey(header)) ?? headerKey(header);
    if (!map.has(key)) map.set(key, index);
  });
  return map;
}

function cell(row: string[], map: Map<string, number>, key: string) {
  const index = map.get(key);
  return index === undefined ? "" : clean(row[index]);
}

function requireHeaders(map: Map<string, number>, keys: readonly string[]) {
  const missing = keys.filter((key) => !map.has(key));
  if (missing.length)
    throw new Error(`Missing required columns: ${missing.join(", ")}.`);
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
  if (!year || !month || !day)
    throw new Error(`Invalid service date: ${value}.`);
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
  const key = value
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (key === "show") return "show";
  if (key === "cancelled" || key === "canceled") return "cancelled";
  if (key === "no show" || key === "noshow") return "no show";
  if (key === "clinician cancelled" || key === "clinician canceled")
    return "clinician cancelled";
  throw new Error(`Unknown attendance status: ${value}.`);
}

function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return (
    typeof value === "string" &&
    attendanceStatuses.includes(value as AttendanceStatus)
  );
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
  if (!headers.has("location"))
    warnings.push(
      "Location column is missing; room counts will use Unassigned.",
    );
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
      sourceRowHash: rowHash([
        "attendance",
        clientId,
        clinician,
        serviceDate,
        location,
        status,
        index,
      ]),
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
      sourceRowHash: rowHash([
        "billing",
        clientId,
        clinician,
        serviceDate,
        totalFeeCharged,
        billingCode,
        index,
      ]),
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
  a.kind === b.kind &&
  a.coverageStart <= b.coverageEnd &&
  b.coverageStart <= a.coverageEnd;

export function mergeSnapshot(
  snapshots: LocalSnapshot[],
  incoming: LocalSnapshot,
): SnapshotMergeResult {
  if (
    snapshots.some(
      (item) =>
        item.kind === incoming.kind && item.sourceHash === incoming.sourceHash,
    )
  )
    return { status: "duplicate", snapshots };
  const overlapping = snapshots.filter((item) => overlaps(item, incoming));
  if (overlapping.length)
    return { status: "overlap", snapshots, existing: overlapping, incoming };
  return { status: "added", snapshots: [...snapshots, incoming] };
}

export function replaceOverlappingSnapshots(
  snapshots: LocalSnapshot[],
  incoming: LocalSnapshot,
) {
  return [...snapshots.filter((item) => !overlaps(item, incoming)), incoming];
}

const snapshotOverlapsAny = (
  snapshot: LocalSnapshot,
  incoming: LocalSnapshot[],
) => incoming.some((item) => overlaps(snapshot, item));

function replacementWarnings(
  existing: LocalSnapshot[],
  incoming: LocalSnapshot[],
) {
  const warnings: string[] = [];
  for (const current of existing) {
    for (const next of incoming) {
      if (!overlaps(current, next)) continue;
      if (
        current.coverageStart < next.coverageStart ||
        current.coverageEnd > next.coverageEnd
      )
        warnings.push(
          `Replacing the ${current.kind} snapshot for ${current.coverageStart} to ${current.coverageEnd} will remove dates outside the incoming ${next.coverageStart} to ${next.coverageEnd} range.`,
        );
    }
  }
  return warnings;
}

export function mergeLocalPackage(
  snapshots: LocalSnapshot[],
  billingCodeMinutes: BillingCodeMinutes,
  incoming: LocalPackageImport,
): PackageMergeResult {
  const uniqueIncoming = uniqueIncomingSnapshots(snapshots, incoming.snapshots);
  const warnings = [...incoming.warnings];
  if (!uniqueIncoming.length)
    return { status: "duplicate", snapshots, billingCodeMinutes, warnings };
  const existing = snapshots.filter((snapshot) =>
    snapshotOverlapsAny(snapshot, uniqueIncoming),
  );
  if (existing.length)
    return {
      status: "overlap",
      snapshots,
      billingCodeMinutes,
      existing,
      incoming: uniqueIncoming,
      warnings: [...warnings, ...replacementWarnings(existing, uniqueIncoming)],
    };
  return {
    status: "added",
    snapshots: [...snapshots, ...uniqueIncoming],
    billingCodeMinutes: {
      ...billingCodeMinutes,
      ...incoming.billingCodeMinutes,
    },
    warnings,
  };
}

function snapshotKey(snapshot: Pick<LocalSnapshot, "kind" | "sourceHash">) {
  return `${snapshot.kind}\u0000${snapshot.sourceHash}`;
}

function uniqueIncomingSnapshots(
  snapshots: LocalSnapshot[],
  incoming: LocalSnapshot[],
) {
  const existing = new Set(snapshots.map(snapshotKey));
  return incoming.filter((snapshot) => !existing.has(snapshotKey(snapshot)));
}

export function buildLocalVisitReconciliation(
  snapshots: LocalSnapshot[],
): LocalVisitReconciliation {
  const groups = new Map<
    string,
    {
      clientId: string;
      clinician: string;
      serviceDate: string;
      attendanceRows: AttendanceRow[];
      billingRows: BillingRow[];
    }
  >();
  const upsert = (row: AttendanceRow | BillingRow, kind: LocalFactKind) => {
    const key = [
      row.clientId,
      normalizeClinician(row.clinician),
      row.serviceDate,
    ].join("\u0000");
    const group = groups.get(key) ?? {
      clientId: row.clientId,
      clinician: row.clinician,
      serviceDate: row.serviceDate,
      attendanceRows: [],
      billingRows: [],
    };
    if (kind === "attendance") group.attendanceRows.push(row as AttendanceRow);
    else group.billingRows.push(row as BillingRow);
    groups.set(key, group);
  };
  for (const snapshot of snapshots) {
    if (snapshot.kind === "attendance")
      snapshot.rows.forEach((row) => upsert(row, "attendance"));
    else snapshot.rows.forEach((row) => upsert(row, "billing"));
  }
  const rows: LocalVisitReconciliationRow[] = [];
  let matchedVisits = 0;
  let attendanceOnlyRows = 0;
  let billingOnlyRows = 0;
  let ambiguousGroups = 0;
  let ambiguousAttendanceRows = 0;
  let ambiguousBillingRows = 0;
  let totalMatchedFeesCharged = 0;
  for (const group of groups.values()) {
    const attendanceCount = group.attendanceRows.length;
    const billingCount = group.billingRows.length;
    const base = {
      key: [
        group.clientId,
        normalizeClinician(group.clinician),
        group.serviceDate,
        group.attendanceRows.map((row) => row.sourceRowHash).join("|"),
        group.billingRows.map((row) => row.sourceRowHash).join("|"),
      ].join("\u0000"),
      clientId: group.clientId,
      clinician: group.clinician,
      serviceDate: group.serviceDate,
      attendanceRows: group.attendanceRows,
      billingRows: group.billingRows,
    };
    if (attendanceCount === 1 && billingCount === 1) {
      matchedVisits++;
      totalMatchedFeesCharged += group.billingRows[0].totalFeeCharged;
      rows.push({
        ...base,
        status: "matched",
        totalFeeCharged: group.billingRows[0].totalFeeCharged,
        reviewReason: null,
      });
    } else if (attendanceCount > 0 && billingCount === 0) {
      attendanceOnlyRows += attendanceCount;
      rows.push({
        ...base,
        status: "attendance_only",
        totalFeeCharged: null,
        reviewReason: "Missing billing counterpart in imported history.",
      });
    } else if (billingCount > 0 && attendanceCount === 0) {
      billingOnlyRows += billingCount;
      rows.push({
        ...base,
        status: "billing_only",
        totalFeeCharged: null,
        reviewReason: "Missing attendance counterpart in imported history.",
      });
    } else {
      ambiguousGroups++;
      ambiguousAttendanceRows += attendanceCount;
      ambiguousBillingRows += billingCount;
      rows.push({
        ...base,
        status: "ambiguous",
        totalFeeCharged: null,
        reviewReason:
          "Multiple rows share this client, clinician, and date; review before pairing.",
      });
    }
  }
  rows.sort(
    (a, b) =>
      a.serviceDate.localeCompare(b.serviceDate) ||
      a.clinician.localeCompare(b.clinician) ||
      a.clientId.localeCompare(b.clientId) ||
      a.status.localeCompare(b.status),
  );
  return {
    matchedVisits,
    attendanceOnlyRows,
    billingOnlyRows,
    ambiguousGroups,
    ambiguousAttendanceRows,
    ambiguousBillingRows,
    totalMatchedFeesCharged,
    rows,
  };
}

export function replaceOverlappingPackageSnapshots(
  snapshots: LocalSnapshot[],
  billingCodeMinutes: BillingCodeMinutes,
  incoming: LocalSnapshot[],
  packageBillingCodeMinutes: BillingCodeMinutes = {},
) {
  const existing = snapshots.filter((snapshot) =>
    snapshotOverlapsAny(snapshot, incoming),
  );
  return {
    snapshots: [
      ...snapshots.filter(
        (snapshot) => !snapshotOverlapsAny(snapshot, incoming),
      ),
      ...incoming,
    ],
    billingCodeMinutes: { ...billingCodeMinutes, ...packageBillingCodeMinutes },
    warnings: replacementWarnings(existing, incoming),
  };
}

function sortByName<T extends { clinician?: string; location?: string }>(
  items: T[],
) {
  return [...items].sort((a, b) =>
    (a.clinician ?? a.location ?? "").localeCompare(
      b.clinician ?? b.location ?? "",
    ),
  );
}

const isoDay = 86_400_000;
const averageDaysPerMonth = 365.25 / 12;

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * isoDay)
    .toISOString()
    .slice(0, 10);
}

function daysBetweenInclusive(start: string, end: string) {
  return Math.floor(
    (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
      isoDay,
  ) + 1;
}

function monthStart(month: string) {
  return `${month}-01`;
}

function monthEnd(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

function nextMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
}

function completeCoverageMonths(start: string, end: string) {
  const months: string[] = [];
  let month = start.slice(0, 7);
  const last = end.slice(0, 7);
  while (month <= last) {
    if (monthStart(month) >= start && monthEnd(month) <= end)
      months.push(month);
    month = nextMonth(month);
  }
  return months;
}

export function estimateLocalClientActivity(
  snapshots: LocalSnapshot[],
  maturityDays = 14,
): LocalClientActivityEstimate | null {
  const shows = snapshots
    .flatMap((snapshot) => snapshot.kind === "attendance" ? snapshot.rows : [])
    .filter((row) => row.status === "show")
    .sort((a, b) =>
      a.serviceDate.localeCompare(b.serviceDate) ||
      a.clinician.localeCompare(b.clinician) ||
      a.clientId.localeCompare(b.clientId),
    );
  if (!shows.length) return null;
  const coverageDates = snapshots
    .filter((snapshot) => snapshot.kind === "attendance")
    .flatMap((snapshot) => [snapshot.coverageStart, snapshot.coverageEnd])
    .sort();
  const coverageStart = coverageDates[0];
  const coverageEnd = coverageDates.at(-1);
  if (!coverageStart || !coverageEnd) return null;
  const pairShows = new Map<string, AttendanceRow[]>();
  for (const row of shows) {
    const key = `${normalizeClinician(row.clinician)}\u0000${row.clientId}`;
    pairShows.set(key, [...(pairShows.get(key) ?? []), row]);
  }
  const maturityCutoff = addDays(coverageEnd, -maturityDays);
  const retained: Array<{ first: string; last: string; count: number }> = [];
  let matureNonRetainedClientPairs = 0;
  let immatureClientPairsExcluded = 0;
  let leftCensoredClientPairs = 0;
  let rightCensoredClientPairs = 0;
  for (const rows of pairShows.values()) {
    const sorted = [...rows].sort((a, b) =>
      a.serviceDate.localeCompare(b.serviceDate),
    );
    const first = sorted[0].serviceDate;
    const last = sorted.at(-1)!.serviceDate;
    if (first === coverageStart) leftCensoredClientPairs++;
    if (last > maturityCutoff) rightCensoredClientPairs++;
    const hasLaterShow = sorted.some((row) => row.serviceDate > first);
    if (hasLaterShow) {
      retained.push({ first, last, count: sorted.length });
    } else if (first > maturityCutoff) {
      immatureClientPairsExcluded++;
    } else {
      matureNonRetainedClientPairs++;
    }
  }
  if (!retained.length) return null;
  const observedSessions = retained.reduce((sum, item) => sum + item.count, 0);
  const observedMonthEquivalents = retained.reduce((sum, item) => {
    const days = Math.max(1, daysBetweenInclusive(item.first, item.last));
    return sum + Math.max(1, days / averageDaysPerMonth);
  }, 0);
  const observedAttendedSessionsPerRetainedClient =
    observedSessions / retained.length;
  const observedAttendedSessionsPerMonth =
    observedSessions / observedMonthEquivalents;
  if (!(observedAttendedSessionsPerMonth > 0)) return null;
  const estimatedMonths =
    observedAttendedSessionsPerRetainedClient /
    observedAttendedSessionsPerMonth;
  if (!(estimatedMonths > 0)) return null;
  const completeMonths = completeCoverageMonths(coverageStart, coverageEnd);
  const latestCompleteMonth = completeMonths.at(-1) ?? null;
  const activeClientsInLatestCompleteMonth = latestCompleteMonth
    ? new Set(
        shows
          .filter((row) => row.serviceDate.slice(0, 7) === latestCompleteMonth)
          .map((row) => `${normalizeClinician(row.clinician)}\u0000${row.clientId}`),
      ).size
    : null;
  const monthlyAttritionRate = 1 / estimatedMonths;
  return {
    coverageStart,
    coverageEnd,
    retainedClientPairs: retained.length,
    matureNonRetainedClientPairs,
    immatureClientPairsExcluded,
    leftCensoredClientPairs,
    rightCensoredClientPairs,
    observedAttendedSessionsPerRetainedClient,
    observedAttendedSessionsPerMonth,
    estimatedMonths,
    monthlyAttritionRate,
    monthlyAttritionPct: monthlyAttritionRate * 100,
    latestCompleteMonth,
    activeClientsInLatestCompleteMonth,
    estimatedClientsLeavingPerMonth:
      activeClientsInLatestCompleteMonth === null
        ? null
        : activeClientsInLatestCompleteMonth * monthlyAttritionRate,
  };
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
  const allDates = [...attendance, ...billing]
    .map((row) => row.serviceDate)
    .sort();
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
        (metric.estimatedBillingHours ?? 0) +
        billingCodeMinutes[row.billingCode] / 60;
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
    const firstShowDate = sorted[0];
    metric.uniqueActiveClients++;
    if (sorted.some((date) => date > firstShowDate)) metric.retainedClients++;
    else {
      metric.firstObservedClients++;
      const first = new Date(`${firstShowDate}T12:00:00Z`).getTime();
      const end = coverageEnd
        ? new Date(`${coverageEnd}T12:00:00Z`).getTime()
        : first;
      if ((end - first) / 86400000 < followUpDays)
        metric.immatureClientsExcluded++;
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

export function exportLocalBackup(
  snapshots: LocalSnapshot[],
  billingCodeMinutes: BillingCodeMinutes,
) {
  return {
    format: "emc-local-retention-v1" as const,
    exportedAt: new Date().toISOString(),
    warning:
      "Contains local de-identified client IDs and row-level facts. Do not upload to the practice API.",
    snapshots,
    billingCodeMinutes,
  };
}

const maxSafeFee = Number.MAX_SAFE_INTEGER;
const maxBillingCodeMinutes = 24 * 60;

function invalidBackup(reason: string): never {
  throw new Error(`Invalid local retention backup: ${reason}.`);
}

function invalidPackage(reason: string): never {
  throw new Error(`Invalid Practice import package: ${reason}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  fail: (reason: string) => never,
) {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unknown.length)
    fail(`${label} contains unsupported fields: ${unknown.join(", ")}`);
}

function packageString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim())
    invalidPackage(`${label} must be a non-empty string`);
  return value;
}

function packageNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (value === null) return null;
  if (typeof value === "string" && value.trim()) return value;
  invalidPackage(`${label} must be null or a non-empty string`);
}

function packageServiceDate(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = packageString(record, key, label);
  try {
    if (parseServiceDate(value) === value) return value;
  } catch {
    // Fall through to the package-specific error below.
  }
  invalidPackage(`${label} must be a valid YYYY-MM-DD date`);
}

function packageTimestamp(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = packageString(record, key, label);
  if (!Number.isFinite(new Date(value).getTime()))
    invalidPackage(`${label} must be a valid timestamp`);
  return value;
}

function packageNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
  min: number,
  max: number,
) {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    invalidPackage(`${label} must be a number from ${min} to ${max}`);
  return value;
}

function packageInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
  min: number,
  max: number,
) {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    invalidPackage(`${label} must be an integer from ${min} to ${max}`);
  return value;
}

function validateBillingCodeMinutesValue(
  value: unknown,
  fail: (reason: string) => never,
): BillingCodeMinutes {
  if (value === undefined) return {};
  if (!isRecord(value)) fail("billingCodeMinutes must be an object");
  const minutesByCode: BillingCodeMinutes = {};
  for (const [code, minutes] of Object.entries(value)) {
    if (!code.trim()) fail("billing code keys must be non-empty");
    if (
      typeof minutes !== "number" ||
      !Number.isFinite(minutes) ||
      minutes <= 0 ||
      minutes > maxBillingCodeMinutes
    )
      fail(
        `billing-code minutes for ${code} must be from 1 to ${maxBillingCodeMinutes}`,
      );
    minutesByCode[code] = minutes;
  }
  return minutesByCode;
}

function validatePackageCollectionBase(
  value: unknown,
  label: "attendance" | "billing",
) {
  if (!isRecord(value)) invalidPackage(`${label} collection must be an object`);
  rejectUnknownKeys(
    value,
    ["coverageStart", "coverageEnd", "rowCount", "rows"],
    `${label} collection`,
    invalidPackage,
  );
  const coverageStart = packageServiceDate(
    value,
    "coverageStart",
    `${label}.coverageStart`,
  );
  const coverageEnd = packageServiceDate(
    value,
    "coverageEnd",
    `${label}.coverageEnd`,
  );
  if (coverageStart > coverageEnd)
    invalidPackage(`${label} coverage dates are reversed`);
  const rowCount = packageInteger(
    value,
    "rowCount",
    `${label}.rowCount`,
    1,
    1_000_000,
  );
  if (!Array.isArray(value.rows))
    invalidPackage(`${label}.rows must be an array`);
  if (value.rows.length !== rowCount)
    invalidPackage(`${label}.rowCount must match rows.length`);
  return { coverageStart, coverageEnd, rows: value.rows };
}

function validatePackageCoverage(
  rows: Array<{ serviceDate: string }>,
  coverageStart: string,
  coverageEnd: string,
  label: "attendance" | "billing",
) {
  const dates = rows.map((row) => row.serviceDate).sort();
  if (!dates.length) invalidPackage(`${label} rows must not be empty`);
  if (coverageStart !== dates[0] || coverageEnd !== dates[dates.length - 1])
    invalidPackage(`${label} coverage does not match its rows`);
}

function validatePackageAttendanceRows(rows: unknown[]) {
  return rows.map((value, index): AttendanceRow => {
    if (!isRecord(value))
      invalidPackage(`attendance row ${index + 1} must be an object`);
    rejectUnknownKeys(
      value,
      ["clientId", "clinician", "serviceDate", "location", "status"],
      `attendance row ${index + 1}`,
      invalidPackage,
    );
    const status = value.status;
    if (!isAttendanceStatus(status))
      invalidPackage(`attendance row ${index + 1} has an invalid status`);
    const clientId = packageString(
      value,
      "clientId",
      `attendance row ${index + 1} clientId`,
    );
    const clinician = packageString(
      value,
      "clinician",
      `attendance row ${index + 1} clinician`,
    );
    const serviceDate = packageServiceDate(
      value,
      "serviceDate",
      `attendance row ${index + 1} serviceDate`,
    );
    const location = packageNullableString(
      value,
      "location",
      `attendance row ${index + 1} location`,
    );
    return {
      clientId,
      clinician,
      serviceDate,
      location,
      status,
      sourceRowHash: rowHash([
        "attendance",
        clientId,
        clinician,
        serviceDate,
        location,
        status,
        index,
      ]),
    };
  });
}

function validatePackageBillingRows(rows: unknown[]) {
  return rows.map((value, index): BillingRow => {
    if (!isRecord(value))
      invalidPackage(`billing row ${index + 1} must be an object`);
    rejectUnknownKeys(
      value,
      [
        "clientId",
        "clinician",
        "serviceDate",
        "totalFeeCharged",
        "billingCode",
      ],
      `billing row ${index + 1}`,
      invalidPackage,
    );
    const clientId = packageString(
      value,
      "clientId",
      `billing row ${index + 1} clientId`,
    );
    const clinician = packageString(
      value,
      "clinician",
      `billing row ${index + 1} clinician`,
    );
    const serviceDate = packageServiceDate(
      value,
      "serviceDate",
      `billing row ${index + 1} serviceDate`,
    );
    const totalFeeCharged = packageNumber(
      value,
      "totalFeeCharged",
      `billing row ${index + 1} totalFeeCharged`,
      0,
      maxSafeFee,
    );
    const billingCode = packageNullableString(
      value,
      "billingCode",
      `billing row ${index + 1} billingCode`,
    );
    return {
      clientId,
      clinician,
      serviceDate,
      totalFeeCharged,
      billingCode,
      sourceRowHash: rowHash([
        "billing",
        clientId,
        clinician,
        serviceDate,
        totalFeeCharged,
        billingCode,
        index,
      ]),
    };
  });
}

export function importLocalPackage(
  value: unknown,
  now = new Date().toISOString(),
): LocalPackageImport {
  if (!isRecord(value))
    throw new Error("Choose a Practice import package JSON file.");
  rejectUnknownKeys(
    value,
    [
      "format",
      "version",
      "packageId",
      "exportedAt",
      "collections",
      "billingCodeMinutes",
    ],
    "Practice import package",
    invalidPackage,
  );
  if (
    value.format !== "emc-practice-local-import-package" ||
    value.version !== 1
  )
    throw new Error("This is not a supported Practice import package.");
  const packageId = packageString(value, "packageId", "packageId");
  const exportedAt = packageTimestamp(value, "exportedAt", "exportedAt");
  if (!isRecord(value.collections))
    invalidPackage("collections must be an object");
  rejectUnknownKeys(
    value.collections,
    ["attendance", "billing"],
    "collections",
    invalidPackage,
  );
  const attendanceBase = validatePackageCollectionBase(
    value.collections.attendance,
    "attendance",
  );
  const billingBase = validatePackageCollectionBase(
    value.collections.billing,
    "billing",
  );
  const attendanceRows = validatePackageAttendanceRows(attendanceBase.rows);
  const billingRows = validatePackageBillingRows(billingBase.rows);
  validatePackageCoverage(
    attendanceRows,
    attendanceBase.coverageStart,
    attendanceBase.coverageEnd,
    "attendance",
  );
  validatePackageCoverage(
    billingRows,
    billingBase.coverageStart,
    billingBase.coverageEnd,
    "billing",
  );
  const attendanceSourceHash = rowHash(
    attendanceRows.map((row) => row.sourceRowHash),
  );
  const billingSourceHash = rowHash(
    billingRows.map((row) => row.sourceRowHash),
  );
  return {
    packageId,
    exportedAt,
    warnings: [],
    billingCodeMinutes: validateBillingCodeMinutesValue(
      value.billingCodeMinutes,
      invalidPackage,
    ),
    snapshots: [
      {
        id: `package-attendance-${attendanceSourceHash}`,
        kind: "attendance",
        importedAt: now,
        coverageStart: attendanceBase.coverageStart,
        coverageEnd: attendanceBase.coverageEnd,
        sourceHash: attendanceSourceHash,
        rows: attendanceRows,
      },
      {
        id: `package-billing-${billingSourceHash}`,
        kind: "billing",
        importedAt: now,
        coverageStart: billingBase.coverageStart,
        coverageEnd: billingBase.coverageEnd,
        sourceHash: billingSourceHash,
        rows: billingRows,
      },
    ],
  };
}

function backupString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim())
    invalidBackup(`${label} must be a non-empty string`);
  return value;
}

function backupNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (value === null) return null;
  if (typeof value === "string" && value.trim()) return value;
  invalidBackup(`${label} must be null or a non-empty string`);
}

function backupServiceDate(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = backupString(record, key, label);
  try {
    if (parseServiceDate(value) === value) return value;
  } catch {
    // Fall through to the backup-specific error below.
  }
  invalidBackup(`${label} must be a valid YYYY-MM-DD date`);
}

function backupTimestamp(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = backupString(record, key, label);
  if (!Number.isFinite(new Date(value).getTime()))
    invalidBackup(`${label} must be a valid timestamp`);
  return value;
}

function backupNumber(
  record: Record<string, unknown>,
  key: string,
  label: string,
  min: number,
  max: number,
) {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    invalidBackup(`${label} must be a number from ${min} to ${max}`);
  return value;
}

function validateAttendanceBackupRow(
  value: unknown,
  index: number,
): AttendanceRow {
  if (!isRecord(value))
    invalidBackup(`attendance row ${index + 1} must be an object`);
  const status = value.status;
  if (!isAttendanceStatus(status))
    invalidBackup(`attendance row ${index + 1} has an invalid status`);
  return {
    clientId: backupString(
      value,
      "clientId",
      `attendance row ${index + 1} clientId`,
    ),
    clinician: backupString(
      value,
      "clinician",
      `attendance row ${index + 1} clinician`,
    ),
    serviceDate: backupServiceDate(
      value,
      "serviceDate",
      `attendance row ${index + 1} serviceDate`,
    ),
    location: backupNullableString(
      value,
      "location",
      `attendance row ${index + 1} location`,
    ),
    status,
    sourceRowHash: backupString(
      value,
      "sourceRowHash",
      `attendance row ${index + 1} sourceRowHash`,
    ),
  };
}

function validateBillingBackupRow(value: unknown, index: number): BillingRow {
  if (!isRecord(value))
    invalidBackup(`billing row ${index + 1} must be an object`);
  return {
    clientId: backupString(
      value,
      "clientId",
      `billing row ${index + 1} clientId`,
    ),
    clinician: backupString(
      value,
      "clinician",
      `billing row ${index + 1} clinician`,
    ),
    serviceDate: backupServiceDate(
      value,
      "serviceDate",
      `billing row ${index + 1} serviceDate`,
    ),
    totalFeeCharged: backupNumber(
      value,
      "totalFeeCharged",
      `billing row ${index + 1} totalFeeCharged`,
      0,
      maxSafeFee,
    ),
    billingCode: backupNullableString(
      value,
      "billingCode",
      `billing row ${index + 1} billingCode`,
    ),
    sourceRowHash: backupString(
      value,
      "sourceRowHash",
      `billing row ${index + 1} sourceRowHash`,
    ),
  };
}

function validateSnapshotCoverage(
  snapshot: LocalSnapshot,
  snapshotIndex: number,
) {
  if (snapshot.coverageStart > snapshot.coverageEnd)
    invalidBackup(`snapshot ${snapshotIndex + 1} coverage dates are reversed`);
  const rowDates = snapshot.rows.map((row) => row.serviceDate).sort();
  if (!rowDates.length)
    invalidBackup(`snapshot ${snapshotIndex + 1} has no rows`);
  if (
    snapshot.coverageStart !== rowDates[0] ||
    snapshot.coverageEnd !== rowDates[rowDates.length - 1]
  )
    invalidBackup(
      `snapshot ${snapshotIndex + 1} coverage does not match its rows`,
    );
}

function validateBackupSnapshot(value: unknown, index: number): LocalSnapshot {
  if (!isRecord(value))
    invalidBackup(`snapshot ${index + 1} must be an object`);
  const kind = value.kind;
  const base = {
    id: backupString(value, "id", `snapshot ${index + 1} id`),
    importedAt: backupTimestamp(
      value,
      "importedAt",
      `snapshot ${index + 1} importedAt`,
    ),
    coverageStart: backupServiceDate(
      value,
      "coverageStart",
      `snapshot ${index + 1} coverageStart`,
    ),
    coverageEnd: backupServiceDate(
      value,
      "coverageEnd",
      `snapshot ${index + 1} coverageEnd`,
    ),
    sourceHash: backupString(
      value,
      "sourceHash",
      `snapshot ${index + 1} sourceHash`,
    ),
  };
  if (!Array.isArray(value.rows))
    invalidBackup(`snapshot ${index + 1} rows must be an array`);
  if (kind === "attendance") {
    const snapshot: LocalSnapshot = {
      ...base,
      kind,
      rows: value.rows.map(validateAttendanceBackupRow),
    };
    validateSnapshotCoverage(snapshot, index);
    return snapshot;
  }
  if (kind === "billing") {
    const snapshot: LocalSnapshot = {
      ...base,
      kind,
      rows: value.rows.map(validateBillingBackupRow),
    };
    validateSnapshotCoverage(snapshot, index);
    return snapshot;
  }
  invalidBackup(`snapshot ${index + 1} has an invalid kind`);
}

function validateBackupBillingCodeMinutes(value: unknown): BillingCodeMinutes {
  return validateBillingCodeMinutesValue(value, invalidBackup);
}

function validateBackupSnapshotCollection(snapshots: LocalSnapshot[]) {
  for (let index = 0; index < snapshots.length; index++) {
    const snapshot = snapshots[index];
    for (let priorIndex = 0; priorIndex < index; priorIndex++) {
      const prior = snapshots[priorIndex];
      if (snapshot.kind !== prior.kind) continue;
      if (snapshot.sourceHash === prior.sourceHash)
        invalidBackup(
          `snapshot ${index + 1} duplicates snapshot ${priorIndex + 1}`,
        );
      if (overlaps(snapshot, prior))
        invalidBackup(
          `snapshot ${index + 1} overlaps snapshot ${priorIndex + 1}`,
        );
    }
  }
}

export function importLocalBackup(value: unknown) {
  if (!isRecord(value))
    throw new Error("Choose a local retention backup JSON file.");
  if (
    value.format !== "emc-local-retention-v1" ||
    !Array.isArray(value.snapshots)
  )
    throw new Error("This is not a local retention backup.");
  backupTimestamp(value, "exportedAt", "exportedAt");
  const snapshots = value.snapshots.map(validateBackupSnapshot);
  validateBackupSnapshotCollection(snapshots);
  return {
    snapshots,
    billingCodeMinutes: validateBackupBillingCodeMinutes(
      value.billingCodeMinutes,
    ),
  };
}
