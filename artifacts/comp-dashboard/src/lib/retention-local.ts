import { isConsultationService, isDocumentationService, isTreatmentService, isFreePhoneService, legacyServiceDefinition, unverifiedDeletionMarker, deletionMarkerGuidance } from "@workspace/practice/hub";

export type LocalFactKind = "attendance" | "billing";
export type ReportCoverage = { start: string; end: string; complete: true };

export type AttendanceStatus =
  | "show"
  | "cancelled"
  | "no show"
  | "clinician cancelled";
export type VisitKind = "consultation";

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
  cancellationSubtype?: "late_cancelled";
  billingCode?: string | null;
  visitKind?: VisitKind;
  sourceRowHash: string;
};

export type BillingRow = {
  clientId: string;
  clinician: string;
  serviceDate: string;
  totalFeeCharged: number;
  billingCode: string | null;
  visitKind?: VisitKind;
  sourceRowHash: string;
};

export type LocalSnapshot =
  | {
      id: string;
      kind: "attendance";
      importedAt: string;
      coverageStart: string;
      coverageEnd: string;
      reportCoverage?: ReportCoverage;
      /** Derived in-memory provider scope for quiet complete periods; never an imported/persisted field. */
      coverageClinicians?: string[];
      /** Derived only: immutable original source identity for pinned billing approvals. */
      sourceSnapshotId?: string;
      sourceHash: string;
      rows: AttendanceRow[];
    }
  | {
      id: string;
      kind: "billing";
      importedAt: string;
      coverageStart: string;
      coverageEnd: string;
      reportCoverage?: ReportCoverage;
      /** Derived in-memory provider scope for quiet complete periods; never an imported/persisted field. */
      coverageClinicians?: string[];
      sourceSnapshotId?: string;
      sourceHash: string;
      rows: BillingRow[];
    };

export type BillingCodeMinutes = Record<string, number>;
export type SameDayVisitOverrides = Record<string, number>;

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

export type ClinicianClientActivityMetric = {
  clinician: string;
  coverageVerified: boolean;
  initialRetentionCoverageVerified: boolean;
  initialRetentionGapDays: number;
  retainedClients: number;
  matureNonRetainedClients: number;
  pendingInitialClients: number;
  initialRetentionDenominator: number;
  initialRetentionPct: number | null;
  endingGapDays: number;
  endingObservationCutoff: string | null;
  endingFullMonthClientEnds: number;
  endingFullMonthDenominator: number;
  averageClientEndingsPerFullMonth: number | null;
  latestSixEndingMonths: string[];
  latestSixClientEnds: number;
  averageClientEndingsPerLatestSixMonths: number | null;
  partialEndingMonth: {
    month: string;
    through: string;
    endedClients: number;
  } | null;
};

export type RoomMetric = {
  location: string;
  source: "attendance_location";
  measure: "recorded_session_counts";
  showRows: number;
  clientCancelled: number;
  noShows: number;
  clinicianCancelled: number;
};

export type LocalRetentionMetrics = {
  coverageVerified: boolean;
  coverageStart: string | null;
  coverageEnd: string | null;
  attendanceRows: number;
  billingRows: number;
  rawShowRows: number;
  derivedShowVisits: number;
  collapsedDuplicateShowRows: number;
  excludedConsultationShowRows: number;
  billingByClinician: ClinicianBillingMetric[];
  attendanceByClinician: ClinicianAttendanceMetric[];
  clientActivityByClinician: ClinicianClientActivityMetric[];
  roomCounts: RoomMetric[];
};

export type LocalClientActivityEstimate = {
  coverageVerified: boolean;
  initialRetentionCoverageVerified: boolean;
  endingEvents: { clientId: string; date: string }[];
  endingEventCoverageComplete: boolean;
  coverageStart: string;
  coverageEnd: string;
  inactivityDays: number;
  initialRetentionGapDays: number;
  returnMaturityDays: number;
  eligibleInactivityMonths: string[];
  monthlyInactiveClientTransitions: Array<{
    month: string;
    inactiveClientTransitions: number;
    activeClientsAtStart: number;
  }>;
  retainedClientPairs: number;
  matureNonRetainedClientPairs: number;
  immatureClientPairsExcluded: number;
  initialRetentionDenominator: number;
  initialRetentionRate: number | null;
  initialNonRetainedLaterReturnPairs: number;
  leftCensoredClientPairs: number;
  rightCensoredClientPairs: number;
  inactiveClientTransitions: number;
  inactiveClientReactivations: number;
  activeClientMonthDenominator: number;
  inactiveRelationshipTransitions: number;
  inactiveRelationshipReactivations: number;
  activeRelationshipMonthDenominator: number;
  averageInactiveClientTransitionsPerMonth: number | null;
  observedAttendedSessionsPerRetainedClient: number | null;
  observedAttendedSessionsPerMonth: number | null;
  estimatedMonths: number | null;
  monthlyAttritionRate: number | null;
  monthlyAttritionPct: number | null;
  latestCompleteMonth: string | null;
  activeClientsInLatestCompleteMonth: number | null;
  estimatedClientsLeavingPerMonth: number | null;
  endingGapDays: number;
  endingObservationCutoff: string;
  endingCoverageEnd: string;
  monthlyEndedClients: Array<{
    month: string;
    endedClients: number;
    establishedClientsAtStart: number;
  }>;
  partialEndingMonth: {
    month: string;
    through: string;
    endedClients: number;
  } | null;
  endingFullMonthClientEnds: number;
  endingFullMonthDenominator: number;
  averageClientEndingsPerFullMonth: number | null;
  latestSixEndingMonths: string[];
  latestSixClientEnds: number;
  averageClientEndingsPerLatestSixMonths: number | null;
  endingAttritionPct: number | null;
  endingLeftCensoredEstablishedClients: number;
};

export type SameDayShowReviewGroup = {
  key: string;
  clientId: string;
  clinician: string;
  serviceDate: string;
  locations: string[];
  rawShowRows: number;
  defaultVisitCount: number;
  confirmedVisitCount: number;
  collapsedRows: number;
  overrideApplied: boolean;
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

export type ConsultJourneyStatus =
  | "converted"
  | "missed"
  | "pending"
  | "needs_attribution";

export type ConsultJourney = {
  coverageVerified: boolean;
  clientId: string;
  consultDate: string;
  deadline: string;
  status: ConsultJourneyStatus;
  consultClinicians: string[];
  closerClinician: string | null;
  treatmentStartClinician: string | null;
  creditedClinician: string | null;
  treatmentDate: string | null;
  attributionIssue: string | null;
  attributionSource:
    | "booking_event"
    | "manual_confirmed_closer"
    | "manual_missed_owner"
    | "manual_needs_review"
    | "treatment_start_candidate"
    | "consult_owner"
    | "none";
  /** Verified scheduling event time; never inferred from appointment attendance. */
  bookingDate?: string | null;
  scheduledAppointmentDate?: string | null;
};

export type ConsultConversionMetric = {
  clinician: string | null;
  rateBasis: "observed_treatment_starts" | "confirmed_closer_credit" | "scheduled_treatment_bookings";
  observedTreatmentStarts?: number;
  consultations: number;
  converted: number;
  candidateConversions: number;
  missed: number;
  /** Clinician pending includes unresolved credit; practice pending is follow-up maturity. */
  pending: number;
  needsAttribution: number;
  internalReferralsProtected: number;
  evaluated: number;
  conversionRate: number | null;
};

export type ConsultConversionSummary = {
  measurement?: "scheduled_treatment";
  bookingEvidenceAvailable?: boolean;
  bookingLimitation?: string | null;
  coverageVerified: boolean;
  periodStart: string;
  periodEnd: string;
  asOfDate: string;
  window: "one_calendar_month";
  practice: ConsultConversionMetric;
  byClinician: ConsultConversionMetric[];
  journeys: ConsultJourney[];
};

export type ConsultAttributionOverrideInput = {
  clientId: string;
  outcome: "confirmed_closer" | "missed_owner" | "needs_review";
  clinicianName: string | null;
  archived?: boolean;
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

export type ImportedRoomRecord = {
  id: string;
  name: string;
  archived?: boolean;
  notes: string;
  planningOnly: boolean;
  start: string;
  end: string | null;
  sourceAttachmentId: string | null;
  locationId: string | null;
  weeklyHours: number;
  sessionMinutes: number;
  usablePct: number;
  telehealthUsesRoom: boolean;
  usage: "shared" | "dedicated";
  dedicatedClinicianId: number | null;
  assignments: Array<{
    clinicianId: number;
    day: number;
    startHour: number;
    endHour: number;
  }>;
  skippedWeeks: Array<{ weekStart: string; clinicianId: number }>;
  blocks: Array<{ day: number; startHour: number; endHour: number }>;
};

export type ImportedRoomsMergeResult<
  TWorkspace extends { rooms: ImportedRoomRecord[] },
> = {
  workspace: TWorkspace;
  addedRooms: ImportedRoomRecord[];
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
const normalizeBillingCode = (value: string | null) =>
  (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const cleanLocationLabel = (value: string) => value.replace(/\s+/g, " ").trim();
const normalizeLocationLabel = (value: string) =>
  cleanLocationLabel(value).toLowerCase();
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

export function sameDayVisitKey(
  row: Pick<AttendanceRow, "clientId" | "clinician" | "serviceDate">,
) {
  return rowHash([
    "same-day-visit",
    row.clientId,
    normalizeClinician(row.clinician),
    row.serviceDate,
  ]);
}

export function isPhoneConsultBillingRow(
  row: Pick<BillingRow, "billingCode" | "visitKind">,
) {
  return isConsultationService(row);
}

function isPhoneConsultAttendanceRow(
  row: Pick<AttendanceRow, "billingCode" | "visitKind">,
) {
  return isConsultationService(row);
}

function factGroupKey(
  row: Pick<
    AttendanceRow | BillingRow,
    "clientId" | "clinician" | "serviceDate"
  >,
) {
  return [
    row.clientId,
    normalizeClinician(row.clinician),
    row.serviceDate,
  ].join("\u0000");
}

function phoneOnlyConsultKeys(snapshots: readonly LocalSnapshot[]) {
  const groups = new Map<
    string,
    { phoneRows: number; treatmentRows: number }
  >();
  for (const snapshot of snapshots) {
    if (snapshot.kind !== "billing") continue;
    const seenRows = new Set<string>();
    for (const row of snapshot.rows) {
      if (isDocumentationService(row)) continue;
      if (seenRows.has(row.sourceRowHash)) continue;
      seenRows.add(row.sourceRowHash);
      const key = factGroupKey(row);
      const group = groups.get(key) ?? { phoneRows: 0, treatmentRows: 0 };
      if (isPhoneConsultBillingRow(row)) group.phoneRows++;
      else group.treatmentRows++;
      groups.set(key, group);
    }
  }
  return new Set(
    [...groups.entries()]
      .filter(([, group]) => group.phoneRows > 0 && group.treatmentRows === 0)
      .map(([key]) => key),
  );
}

export function consultAttendanceClassifier(snapshots: readonly LocalSnapshot[]) {
  const consultKeys = phoneOnlyConsultKeys(snapshots);
  const isDocumentation = documentationAttendanceClassifier(snapshots);
  const billed = new Map<string, BillingRow[]>();
  for (const snapshot of snapshots) if (snapshot.kind === "billing") for (const row of snapshot.rows) {
    const key = factGroupKey(row);
    billed.set(key, [...(billed.get(key) ?? []), row]);
  }
  const legacyTreatmentKeys = new Set([...billed].filter(([, rows]) => rows.some(row => legacyServiceDefinition(row.billingCode)?.kind === "treatment") && rows.every(row => isTreatmentService(row) || isDocumentationService(row))).map(([key]) => key));
  return (
    row: Pick<
      AttendanceRow,
      "billingCode" | "clientId" | "clinician" | "serviceDate" | "visitKind"
    >,
  ) => {
    if (isDocumentation(row)) return false;
    if (!row.billingCode?.trim() && legacyTreatmentKeys.has(factGroupKey(row))) return false;
    return isPhoneConsultAttendanceRow(row) || (!legacyServiceDefinition(row.billingCode) && consultKeys.has(factGroupKey(row)));
  };
}

export function documentationAttendanceClassifier(snapshots: readonly LocalSnapshot[]) {
  const kinds = new Map<string, { documentation: boolean; other: boolean }>();
  for (const snapshot of snapshots) if (snapshot.kind === "billing") for (const row of snapshot.rows) {
    const key = factGroupKey(row);
    const group = kinds.get(key) ?? { documentation: false, other: false };
    if (isDocumentationService(row)) group.documentation = true;
    else group.other = true;
    kinds.set(key, group);
  }
  return (row: Pick<AttendanceRow, "clientId" | "clinician" | "serviceDate" | "billingCode">) => {
    if (row.billingCode?.trim()) return isDocumentationService(row);
    const group = kinds.get(factGroupKey(row));
    return !!group?.documentation && !group.other;
  };
}

export function isPhoneOnlyConsultAttendanceRow(
  row: Pick<
    AttendanceRow,
    "billingCode" | "clientId" | "clinician" | "serviceDate" | "visitKind"
  >,
  snapshots: LocalSnapshot[],
) {
  return consultAttendanceClassifier(snapshots)(row);
}

export function treatmentAttendanceRows(
  snapshots: LocalSnapshot[],
  classificationSnapshots: readonly LocalSnapshot[] = snapshots,
) {
  const isConsult = consultAttendanceClassifier(classificationSnapshots);
  const isDocumentation = documentationAttendanceClassifier(classificationSnapshots);
  const conflicted = new Set(attendanceStatusConflicts(snapshots, classificationSnapshots).flatMap((group) => group.rows));
  const seenNonShows = new Set<string>();
  return snapshots.flatMap((snapshot) =>
    snapshot.kind === "attendance"
      ? snapshot.rows.filter(
          (row) => {
            if (isDocumentation(row) || isConsult(row) || conflicted.has(row)) return false;
            if (row.status === "show") return true;
            const key = `${factGroupKey(row)}\u0000${row.status}`;
            if (seenNonShows.has(key)) return false;
            seenNonShows.add(key);
            return true;
          },
        )
      : [],
  );
}

/** Name/date coordinates cannot establish which contradictory appointment status is authoritative. */
export function attendanceStatusConflicts(
  snapshots: LocalSnapshot[],
  classificationSnapshots: readonly LocalSnapshot[] = snapshots,
) {
  const isConsult = consultAttendanceClassifier(classificationSnapshots);
  const isDocumentation = documentationAttendanceClassifier(classificationSnapshots);
  const groups = new Map<string, { clientId: string; clinician: string; serviceDate: string; kind: "consultation" | "treatment"; rows: AttendanceRow[]; snapshotIds: string[]; statusesBySource: Map<string, Set<AttendanceStatus>> }>();
  for (const snapshot of snapshots) if (snapshot.kind === "attendance") for (const row of snapshot.rows) {
    if (isDocumentation(row)) continue;
    const kind = isConsult(row) ? "consultation" : "treatment";
    const key = `${factGroupKey(row)}\u0000${kind}`;
    const group = groups.get(key) ?? { clientId: row.clientId, clinician: row.clinician, serviceDate: row.serviceDate, kind, rows: [], snapshotIds: [], statusesBySource: new Map<string, Set<AttendanceStatus>>() };
    group.rows.push(row);
    if (!group.snapshotIds.includes(snapshot.id)) group.snapshotIds.push(snapshot.id);
    const statuses = group.statusesBySource.get(snapshot.id) ?? new Set<AttendanceStatus>();
    statuses.add(row.status);
    group.statusesBySource.set(snapshot.id, statuses);
    groups.set(key, group);
  }
  // One export may legitimately contain mixed appointments; only differing export status sets conflict.
  return [...groups.values()].filter((group) => group.snapshotIds.length > 1 && new Set([...group.statusesBySource.values()].map((statuses) => [...statuses].sort().join("|"))).size > 1)
    .map(({ statusesBySource: _statuses, ...group }) => ({ ...group, statuses: [...new Set(group.rows.map((row) => row.status))].sort() }));
}

export function phoneChargeAnomalies(snapshots: readonly LocalSnapshot[]) {
  return snapshots.flatMap((snapshot) => snapshot.kind === "billing"
    ? snapshot.rows.filter((row) => isFreePhoneService(row) && (!Number.isFinite(row.totalFeeCharged) || row.totalFeeCharged !== 0))
    : []);
}

export function treatmentBillingRows(snapshots: LocalSnapshot[]) {
  return snapshots.flatMap((snapshot) =>
    snapshot.kind === "billing"
      ? snapshot.rows.filter(isTreatmentService)
      : [],
  );
}

function showRowsBySameDayVisit(
  snapshots: LocalSnapshot[],
  asOfDate = "9999-12-31",
  classificationSnapshots: readonly LocalSnapshot[] = snapshots,
) {
  const groups = new Map<string, AttendanceRow[]>();
  const seenRows = new Set<string>();
  for (const row of treatmentAttendanceRows(snapshots, classificationSnapshots)) {
    if (
      row.status !== "show" ||
      row.serviceDate > asOfDate ||
      seenRows.has(row.sourceRowHash)
    )
      continue;
    seenRows.add(row.sourceRowHash);
    const key = sameDayVisitKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function resolvedVisitCount(
  rows: AttendanceRow[],
  overrides: SameDayVisitOverrides,
) {
  const key = rows[0] ? sameDayVisitKey(rows[0]) : "";
  const override = overrides[key];
  if (Number.isInteger(override) && override >= 1)
    return Math.min(override, rows.length);
  return rows.length ? 1 : 0;
}

export function derivedShowVisits(
  snapshots: LocalSnapshot[],
  overrides: SameDayVisitOverrides = {},
  classificationSnapshots: readonly LocalSnapshot[] = snapshots,
) {
  const visits: AttendanceRow[] = [];
  for (const rows of showRowsBySameDayVisit(snapshots, "9999-12-31", classificationSnapshots).values()) {
    visits.push(...rows.slice(0, resolvedVisitCount(rows, overrides)));
  }
  return visits;
}

export function buildSameDayShowReview(
  snapshots: LocalSnapshot[],
  overrides: SameDayVisitOverrides = {},
  asOfDate = "9999-12-31",
): SameDayShowReviewGroup[] {
  return [...showRowsBySameDayVisit(snapshots, asOfDate).values()]
    .filter(
      (rows) =>
        rows.length > 1 || overrides[sameDayVisitKey(rows[0])] !== undefined,
    )
    .map((rows) => {
      const key = sameDayVisitKey(rows[0]);
      const confirmedVisitCount = resolvedVisitCount(rows, overrides);
      return {
        key,
        clientId: rows[0].clientId,
        clinician: rows[0].clinician,
        serviceDate: rows[0].serviceDate,
        locations: [
          ...new Set(rows.map((row) => row.location || "Unassigned")),
        ].sort(),
        rawShowRows: rows.length,
        defaultVisitCount: 1,
        confirmedVisitCount,
        collapsedRows: rows.length - confirmedVisitCount,
        overrideApplied: overrides[key] !== undefined,
      };
    })
    .sort(
      (a, b) =>
        a.serviceDate.localeCompare(b.serviceDate) ||
        a.clinician.localeCompare(b.clinician) ||
        a.clientId.localeCompare(b.clientId),
    );
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

function reviewDeletionFields(rows: string[][], known: readonly string[]) {
  const headers = rows[0] ?? [];
  const unknown = headers.map((label, index) => ({ label, index, key: headerAliases.get(headerKey(label)) ?? headerKey(label) }))
    .filter(({ key }) => !known.includes(key));
  const statusColumns = headers.map((label, index) => ({ index, key: headerAliases.get(headerKey(label)) ?? headerKey(label) }))
    .filter(({ key }) => key === "billingcode" || key === "status");
  if (headers.some(unverifiedDeletionMarker) || unknown.some(({ key }) => /(?:provider|clinician).*status|status.*(?:provider|clinician)/i.test(key))
    || [...unknown, ...statusColumns].some(({ index }) => rows.slice(1).some((row) => unverifiedDeletionMarker(row[index] ?? "")))) throw new Error(deletionMarkerGuidance);
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
  if (key === "cancelled" || key === "canceled" || /^late cancel(?:led|ed|lation)?(?: by client)?$/.test(key)) return "cancelled";
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
  reviewDeletionFields(rows, [...requiredAttendanceHeaders, "location", "billingcode"]);
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
    if (unverifiedDeletionMarker(clinician)) throw new Error(deletionMarkerGuidance);
    if (!clientId || !clinician)
      throw new Error(`Row ${index + 2}: Client and Clinician are required.`);
    const serviceDate = parseServiceDate(cell(row, headers, "dateofservice"));
    const location = cell(row, headers, "location") || null;
    const rawStatus = cell(row, headers, "status");
    const status = parseStatus(rawStatus);
    const cancellationSubtype = /^late[ _-]+cancel/i.test(rawStatus.trim()) ? "late_cancelled" as const : undefined;
    const billingCode = cell(row, headers, "billingcode") || undefined;
    return {
      clientId,
      clinician,
      serviceDate,
      location,
      status,
      ...(billingCode ? { billingCode } : {}),
      ...(cancellationSubtype ? { cancellationSubtype } : {}),
      sourceRowHash: rowHash([
        "attendance",
        clientId,
        clinician,
        serviceDate,
        location,
        status,
        ...(billingCode ? [billingCode] : []),
        ...(cancellationSubtype ? [cancellationSubtype] : []),
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
  reviewDeletionFields(rows, [...requiredBillingHeaders, "billingcode"]);
  const headers = headerMap(rows[0] ?? []);
  requireHeaders(headers, requiredBillingHeaders);
  const facts = rows.slice(1).map((row, index) => {
    const clientId = cell(row, headers, "client");
    const clinician = cell(row, headers, "clinician");
    if (unverifiedDeletionMarker(clinician)) throw new Error(deletionMarkerGuidance);
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
  sameDayVisitOverrides: SameDayVisitOverrides = {},
  asOfDate = "9999-12-31",
): LocalVisitReconciliation {
  const attendanceIntervals = mergeIntervals(
    clipIntervals(
      snapshots
        .filter(
          (
            snapshot,
          ): snapshot is Extract<LocalSnapshot, { kind: "attendance" }> =>
            snapshot.kind === "attendance",
        )
        .map((snapshot) => ({
          start: snapshot.coverageStart,
          end: snapshot.coverageEnd,
        })),
      asOfDate,
    ),
  );
  const billingIntervals = mergeIntervals(
    clipIntervals(
      snapshots
        .filter(
          (snapshot): snapshot is Extract<LocalSnapshot, { kind: "billing" }> =>
            snapshot.kind === "billing",
        )
        .map((snapshot) => ({
          start: snapshot.coverageStart,
          end: snapshot.coverageEnd,
        })),
      asOfDate,
    ),
  );
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
  const coveredByAttendance = (date: string) =>
    attendanceIntervals.some(
      (interval) => interval.start <= date && interval.end >= date,
    );
  const coveredByBilling = (date: string) =>
    billingIntervals.some(
      (interval) => interval.start <= date && interval.end >= date,
    );
  for (const snapshot of snapshots) {
    if (snapshot.kind === "attendance")
      snapshot.rows
        .filter((row) => row.serviceDate <= asOfDate)
        .forEach((row) => upsert(row, "attendance"));
    else
      snapshot.rows
        .filter((row) => row.serviceDate <= asOfDate)
        .forEach((row) => upsert(row, "billing"));
  }
  const rows: LocalVisitReconciliationRow[] = [];
  let matchedVisits = 0;
  let attendanceOnlyRows = 0;
  let billingOnlyRows = 0;
  let ambiguousGroups = 0;
  let ambiguousAttendanceRows = 0;
  let ambiguousBillingRows = 0;
  let totalMatchedFeesCharged = 0;
  const conflictingStatusRows = new Set(attendanceStatusConflicts(snapshots).flatMap((group) => group.rows));
  for (const group of groups.values()) {
    const attendanceCount = group.attendanceRows.length;
    const treatmentBillingRows = group.billingRows.filter(
      isTreatmentService,
    );
    const billingCount = treatmentBillingRows.length;
    const isPhoneOnlyConsult =
      group.billingRows.length > 0 && treatmentBillingRows.length === 0;
    const treatmentAttendanceRowsForGroup = isPhoneOnlyConsult
      ? []
      : group.attendanceRows.filter(isTreatmentService);
    const treatmentAttendanceCount = treatmentAttendanceRowsForGroup.length;
    const showRows = treatmentAttendanceRowsForGroup.filter(
      (row) => row.status === "show",
    );
    const nonShowRows = treatmentAttendanceRowsForGroup.filter(
      (row) => row.status !== "show",
    );
    const derivedShowCount = showRows.length
      ? Math.max(
          1,
          Math.min(
            showRows.length,
            sameDayVisitOverrides[sameDayVisitKey(showRows[0])] ?? 1,
          ),
        )
      : 0;
    const totalFeeCharged = treatmentBillingRows.reduce(
      (sum, row) => sum + row.totalFeeCharged,
      0,
    );
    const rawTotalFeeCharged = group.billingRows.reduce(
      (sum, row) => sum + row.totalFeeCharged,
      0,
    );
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
    if (group.attendanceRows.some((row) => conflictingStatusRows.has(row))) {
      ambiguousGroups++;
      ambiguousAttendanceRows += attendanceCount;
      ambiguousBillingRows += group.billingRows.length;
      rows.push({ ...base, status: "ambiguous", totalFeeCharged: null,
        reviewReason: "Conflicting attendance statuses for the same client, clinician and date. Original sources are retained; neither upload order nor billing chooses a status." });
    } else if (isPhoneOnlyConsult) {
      rows.push({
        ...base,
        status: "matched",
        totalFeeCharged: rawTotalFeeCharged,
        reviewReason: null,
      });
    } else if (
      attendanceCount > 0 &&
      treatmentAttendanceCount === 0 &&
      billingCount === 0
    ) {
      rows.push({
        ...base,
        status: "matched",
        totalFeeCharged: null,
        reviewReason: null,
      });
    } else if (treatmentAttendanceCount > 0 && billingCount === 0) {
      attendanceOnlyRows += treatmentAttendanceCount;
      rows.push({
        ...base,
        status: "attendance_only",
        totalFeeCharged: null,
        reviewReason:
          !coveredByBilling(group.serviceDate) ||
          (nonShowRows.length && !showRows.length)
            ? null
            : "Attended visit has no billing counterpart in imported history.",
      });
    } else if (derivedShowCount > 0 && billingCount >= derivedShowCount) {
      matchedVisits += derivedShowCount;
      totalMatchedFeesCharged += totalFeeCharged;
      rows.push({
        ...base,
        status: "matched",
        totalFeeCharged,
        reviewReason: null,
      });
    } else if (derivedShowCount > billingCount) {
      ambiguousGroups++;
      ambiguousAttendanceRows += showRows.length;
      ambiguousBillingRows += billingCount;
      rows.push({
        ...base,
        status: "ambiguous",
        totalFeeCharged: billingCount ? totalFeeCharged : null,
        reviewReason:
          "Confirmed attended visits exceed billing rows for this client, clinician, and date.",
      });
    } else if (billingCount > 0 && nonShowRows.length > 0) {
      matchedVisits += billingCount;
      totalMatchedFeesCharged += totalFeeCharged;
      rows.push({
        ...base,
        status: "matched",
        totalFeeCharged,
        reviewReason: null,
      });
    } else if (billingCount > 0 && treatmentAttendanceCount === 0) {
      billingOnlyRows += billingCount;
      rows.push({
        ...base,
        status: "billing_only",
        totalFeeCharged,
        reviewReason: coveredByAttendance(group.serviceDate)
          ? "Billing row has no attendance or status counterpart inside covered attendance history."
          : null,
      });
    } else {
      ambiguousGroups++;
      ambiguousAttendanceRows += treatmentAttendanceCount;
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

function addCalendarMonth(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const endOfTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, endOfTargetMonth);
  return new Date(Date.UTC(year, month, targetDay)).toISOString().slice(0, 10);
}

function daysBetweenInclusive(start: string, end: string) {
  return (
    Math.floor(
      (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
        isoDay,
    ) + 1
  );
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

type DateInterval = { start: string; end: string };

function verifiedAttendanceIntervals(
  snapshots: LocalSnapshot[],
  asOfDate: string,
  clinician?: string,
  classificationSnapshots: readonly LocalSnapshot[] = snapshots,
): DateInterval[] {
  if (clinician === undefined) {
    const clinicians = new Set(snapshots.flatMap((snapshot) =>
      snapshot.kind === "attendance"
        ? [...snapshot.rows.filter((row) => row.serviceDate <= asOfDate).map((row) => normalizeClinician(row.clinician)),
          ...(snapshot.reportCoverage?.complete === true ? snapshot.coverageClinicians ?? [] : []).map(normalizeClinician)].filter(Boolean)
        : [],
    ));
    // Practice-wide absence needs reports for every observed clinician, including transfers.
    let common: DateInterval[] | null = null;
    for (const name of clinicians) {
      const intervals = verifiedAttendanceIntervals(snapshots, asOfDate, name, classificationSnapshots);
      common = common === null ? intervals : mergeIntervals(common.flatMap((a) =>
        intervals.flatMap((b) => {
          const start = a.start > b.start ? a.start : b.start;
          const end = a.end < b.end ? a.end : b.end;
          return start <= end ? [{ start, end }] : [];
        }),
      ));
    }
    return common ?? [];
  }
  const intervals: DateInterval[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.kind !== "attendance") continue;
    const hasDerivedScope = snapshot.reportCoverage?.complete === true
      && snapshot.coverageClinicians?.some((name) => normalizeClinician(name) === normalizeClinician(clinician));
    if (!hasDerivedScope && !snapshot.rows.some((row) => normalizeClinician(row.clinician) === normalizeClinician(clinician))) continue;
    const dates = snapshot.rows.map((row) => row.serviceDate).sort();
    try {
      const proof = validateReportCoverage(
        snapshot.reportCoverage,
        dates.length && dates[0] < snapshot.coverageStart ? dates[0] : snapshot.coverageStart,
        dates.length && dates.at(-1)! > snapshot.coverageEnd ? dates.at(-1)! : snapshot.coverageEnd,
        (reason) => { throw new Error(reason); },
      );
      if (proof) intervals.push({ start: proof.start, end: proof.end });
    } catch {
      // Invalid or stale declarations cannot certify missing attendance.
    }
  }
  let verified = mergeIntervals(clipIntervals(intervals, asOfDate));
  for (const conflict of attendanceStatusConflicts(snapshots, classificationSnapshots).filter((row) => normalizeClinician(row.clinician) === normalizeClinician(clinician))) {
    const stamp = Date.parse(conflict.serviceDate + "T12:00:00Z");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(conflict.serviceDate) || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== conflict.serviceDate) continue;
    verified = verified.flatMap((range) => conflict.serviceDate < range.start || conflict.serviceDate > range.end ? [range] : [
      ...(range.start < conflict.serviceDate ? [{ start: range.start, end: addDays(conflict.serviceDate, -1) }] : []),
      ...(range.end > conflict.serviceDate ? [{ start: addDays(conflict.serviceDate, 1), end: range.end }] : []),
    ]);
  }
  return verified;
}

function mergeIntervals(intervals: DateInterval[]) {
  const ordered = [...intervals].sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
  );
  const merged: DateInterval[] = [];
  for (const interval of ordered) {
    const current = merged.at(-1);
    if (!current || addDays(current.end, 1) < interval.start) {
      merged.push({ ...interval });
    } else if (interval.end > current.end) {
      current.end = interval.end;
    }
  }
  return merged;
}

function clipIntervals(intervals: DateInterval[], end: string) {
  return intervals
    .map((interval) => ({
      start: interval.start,
      end: interval.end < end ? interval.end : end,
    }))
    .filter((interval) => interval.start <= interval.end);
}

function intervalCoversRange(
  intervals: DateInterval[],
  start: string,
  end: string,
) {
  return intervals.some(
    (interval) => interval.start <= start && interval.end >= end,
  );
}

function coveredDaysInRange(
  intervals: DateInterval[],
  start: string,
  end: string,
) {
  return intervals.reduce((sum, interval) => {
    const overlapStart = interval.start > start ? interval.start : start;
    const overlapEnd = interval.end < end ? interval.end : end;
    if (overlapStart > overlapEnd) return sum;
    return sum + daysBetweenInclusive(overlapStart, overlapEnd);
  }, 0);
}

function completeCoverageMonths(
  intervals: DateInterval[],
  start: string,
  end: string,
) {
  const months: string[] = [];
  let month = start.slice(0, 7);
  const last = end.slice(0, 7);
  while (month <= last) {
    const startOfMonth = monthStart(month);
    const endOfMonth = monthEnd(month);
    if (
      startOfMonth >= start &&
      endOfMonth <= end &&
      intervalCoversRange(intervals, startOfMonth, endOfMonth)
    )
      months.push(month);
    month = nextMonth(month);
  }
  return months;
}

function completeInactivityMonths(
  intervals: DateInterval[],
  start: string,
  end: string,
  inactivityDays: number,
) {
  return completeCoverageMonths(intervals, start, end).filter((month) =>
    intervalCoversRange(
      intervals,
      addDays(monthStart(month), -inactivityDays),
      monthEnd(month),
    ),
  );
}

function monthsBetween(start: string, end: string) {
  const months: string[] = [];
  let month = start.slice(0, 7);
  const last = end.slice(0, 7);
  while (month <= last) {
    months.push(month);
    month = nextMonth(month);
  }
  return months;
}

function uniqueSortedDates(rows: AttendanceRow[]) {
  return [...new Set(rows.map((row) => row.serviceDate))].sort();
}

function hasCompleteLookForward(
  intervals: DateInterval[],
  date: string,
  inactivityDays: number,
) {
  const start = addDays(date, 1);
  const end = addDays(date, inactivityDays);
  if (start > end) return true;
  return intervalCoversRange(intervals, start, end);
}

function inactiveTransitionDates(
  dates: string[],
  intervals: DateInterval[],
  inactivityDays: number,
) {
  const transitions: string[] = [];
  for (let index = 0; index < dates.length; index++) {
    const current = dates[index];
    const next = dates[index + 1];
    const inactiveOn = addDays(current, inactivityDays);
    if (next && next <= inactiveOn) continue;
    if (hasCompleteLookForward(intervals, current, inactivityDays)) {
      transitions.push(inactiveOn);
    }
  }
  return transitions;
}

function initialRetentionEpisode(
  dates: string[],
  initialRetentionGapDays: number,
) {
  const initialEpisode: string[] = [];
  let laterReturnAfterInitialGap = false;
  for (const date of dates) {
    const previous = initialEpisode.at(-1);
    if (previous && date > addDays(previous, initialRetentionGapDays)) {
      laterReturnAfterInitialGap = true;
      break;
    }
    initialEpisode.push(date);
    if (initialEpisode.length >= 3) break;
  }
  return { initialEpisode, laterReturnAfterInitialGap };
}

/** Scope this label to the selected starts and their observation windows, not unrelated later activity. */
function initialRetentionWindowCovered(
  datesByClient: Map<string, string[]>, intervals: DateInterval[],
  start: string, end: string, gapDays: number,
) {
  if (start > end || !intervalCoversRange(intervals, start, end)) return false;
  for (const values of datesByClient.values()) {
    const dates = [...new Set(values)].sort();
    const first = dates[0];
    if (!first || first < start || first > end) continue;
    const { initialEpisode } = initialRetentionEpisode(dates, gapDays);
    const through = initialEpisode.length >= 3 ? initialEpisode[2] : addDays(initialEpisode.at(-1)!, gapDays);
    if (!intervalCoversRange(intervals, first, through)) return false;
  }
  return true;
}

function activeAtMonthStart(
  dates: string[],
  month: string,
  inactivityDays: number,
  requiredVisits = 1,
) {
  const start = monthStart(month);
  const priorShows = dates.filter((date) => date <= start);
  if (priorShows.length < requiredVisits) return false;
  const lastShow = priorShows.at(-1);
  return lastShow ? addDays(lastShow, inactivityDays) >= start : false;
}

function estimateObservedInactivity(
  showDatesByEntity: Map<string, string[]>,
  coverageIntervals: DateInterval[],
  eligibleMonths: string[],
  inactivityDays: number,
  requiredVisitsBeforeInactivity = 1,
) {
  const monthRows = new Map(
    eligibleMonths.map((month) => [
      month,
      { month, inactiveClientTransitions: 0, activeClientsAtStart: 0 },
    ]),
  );
  let inactiveTransitions = 0;
  let inactiveReactivations = 0;
  let activeMonthDenominator = 0;
  for (const dates of showDatesByEntity.values()) {
    const uniqueDates = [...new Set(dates)].sort();
    const transitionDates = inactiveTransitionDates(
      uniqueDates,
      coverageIntervals,
      inactivityDays,
    );
    for (const inactiveOn of transitionDates) {
      let inactiveAfterVisitIndex = -1;
      for (let index = uniqueDates.length - 1; index >= 0; index--) {
        if (addDays(uniqueDates[index], inactivityDays) === inactiveOn) {
          inactiveAfterVisitIndex = index;
          break;
        }
      }
      if (inactiveAfterVisitIndex + 1 < requiredVisitsBeforeInactivity)
        continue;
      const month = inactiveOn.slice(0, 7);
      const row = monthRows.get(month);
      if (
        !row ||
        !activeAtMonthStart(
          uniqueDates,
          month,
          inactivityDays,
          requiredVisitsBeforeInactivity,
        )
      )
        continue;
      row.inactiveClientTransitions++;
      inactiveTransitions++;
      if (uniqueDates.some((date) => date > inactiveOn))
        inactiveReactivations++;
    }
    for (const month of eligibleMonths) {
      if (
        activeAtMonthStart(
          uniqueDates,
          month,
          inactivityDays,
          requiredVisitsBeforeInactivity,
        )
      ) {
        monthRows.get(month)!.activeClientsAtStart++;
        activeMonthDenominator++;
      }
    }
  }
  return {
    inactiveTransitions,
    inactiveReactivations,
    activeMonthDenominator,
    monthlyRows: [...monthRows.values()],
    monthlyInactivityRate:
      activeMonthDenominator > 0
        ? inactiveTransitions / activeMonthDenominator
        : null,
  };
}

function estimateObservedClientEndings(
  showDatesByClient: Map<string, string[]>,
  coverageIntervals: DateInterval[],
  coverageStart: string,
  coverageEnd: string,
  endingGapDays: number,
  eventStart = coverageStart,
  eventEnd = coverageEnd,
  excludedFollowUpEvidence: readonly { clientId: string; serviceDate: string }[] = [],
) {
  const endingEvents: { clientId: string; date: string }[] = [];
  const uncertainEndings = new Map<string, string>();
  for (const [clientId, dates] of showDatesByClient) {
    const uniqueDates = [...new Set(dates)].sort();
    const finalDate = uniqueDates.at(-1);
    if (uniqueDates.length >= 3 && finalDate && excludedFollowUpEvidence.some((row) => row.clientId === clientId && row.serviceDate > finalDate))
      uncertainEndings.set(clientId, finalDate);
  }
  const uncertainMonths = new Set([...uncertainEndings.values()].map((date) => date.slice(0, 7)));
  const endingObservationCutoff = addDays(coverageEnd, -endingGapDays);
  const monthlyRows = new Map<
    string,
    { month: string; endedClients: number; establishedClientsAtStart: number }
  >();
  const fullMonths =
    endingObservationCutoff >= coverageStart
      ? monthsBetween(coverageStart, endingObservationCutoff).filter(
          (month) =>
            !uncertainMonths.has(month) &&
            monthStart(month) >= eventStart &&
            monthEnd(month) <= eventEnd &&
            monthEnd(month) <= endingObservationCutoff &&
            intervalCoversRange(
              coverageIntervals,
              monthStart(month),
              monthEnd(month),
            ) &&
            intervalCoversRange(
              coverageIntervals,
              addDays(monthStart(month), 1),
              addDays(monthEnd(month), endingGapDays),
            ),
        )
      : [];
  for (const month of fullMonths) {
    monthlyRows.set(month, {
      month,
      endedClients: 0,
      establishedClientsAtStart: 0,
    });
  }
  const cutoffMonth = endingObservationCutoff.slice(0, 7);
  const partialEndingMonth =
    !uncertainMonths.has(cutoffMonth) &&
    endingObservationCutoff >= coverageStart &&
    monthEnd(cutoffMonth) >= eventStart &&
    monthStart(cutoffMonth) <= eventEnd &&
    monthEnd(cutoffMonth) > endingObservationCutoff &&
    intervalCoversRange(
      coverageIntervals,
      monthStart(cutoffMonth),
      endingObservationCutoff,
    ) &&
    intervalCoversRange(
      coverageIntervals,
      addDays(monthStart(cutoffMonth), 1),
      addDays(endingObservationCutoff, endingGapDays),
    )
      ? {
          month: cutoffMonth,
          through: endingObservationCutoff,
          endedClients: 0,
        }
      : null;
  let endingLeftCensoredEstablishedClients = 0;
  for (const [clientId, datesForClient] of showDatesByClient) {
    const dates = [...new Set(datesForClient)].sort();
    if (dates.length < 3) continue;
    if (dates[0] === coverageStart) endingLeftCensoredEstablishedClients++;
    for (const month of fullMonths) {
      if (activeAtMonthStart(dates, month, endingGapDays, 3))
        monthlyRows.get(month)!.establishedClientsAtStart++;
    }
    const finalTreatmentDate = dates.at(-1)!;
    if (
      uncertainEndings.has(clientId) ||
      finalTreatmentDate > endingObservationCutoff ||
      !hasCompleteLookForward(
        coverageIntervals,
        finalTreatmentDate,
        endingGapDays,
      )
    )
      continue;
    const endingMonth = finalTreatmentDate.slice(0, 7);
    if (finalTreatmentDate >= eventStart && finalTreatmentDate <= eventEnd)
      endingEvents.push({ clientId, date: finalTreatmentDate });
    const row = monthlyRows.get(endingMonth);
    if (row) row.endedClients++;
    else if (
      partialEndingMonth &&
      endingMonth === partialEndingMonth.month &&
      finalTreatmentDate <= partialEndingMonth.through
    )
      partialEndingMonth.endedClients++;
  }
  const monthlyEndedClients = [...monthlyRows.values()];
  const endingFullMonthClientEnds = monthlyEndedClients.reduce(
    (sum, row) => sum + row.endedClients,
    0,
  );
  const latestSixEndingMonths = monthlyEndedClients
    .slice(-6)
    .map((row) => row.month);
  const latestSixClientEnds = monthlyEndedClients
    .slice(-6)
    .reduce((sum, row) => sum + row.endedClients, 0);
  const latestFullMonth = monthlyEndedClients.at(-1) ?? null;
  const observedEventStart = eventStart > coverageStart ? eventStart : coverageStart;
  const observedEventEnd = eventEnd < endingObservationCutoff ? eventEnd : endingObservationCutoff;
  return {
    endingEvents,
    endingEventCoverageComplete: ![...uncertainEndings.values()].some((date) => date >= observedEventStart && date <= observedEventEnd)
      && observedEventStart <= observedEventEnd && intervalCoversRange(coverageIntervals, observedEventStart, addDays(observedEventEnd, endingGapDays)),
    endingGapDays,
    endingObservationCutoff,
    endingCoverageEnd: coverageEnd,
    monthlyEndedClients,
    partialEndingMonth,
    endingFullMonthClientEnds,
    endingFullMonthDenominator: monthlyEndedClients.length,
    averageClientEndingsPerFullMonth:
      monthlyEndedClients.length > 0
        ? endingFullMonthClientEnds / monthlyEndedClients.length
        : null,
    latestSixEndingMonths,
    latestSixClientEnds,
    averageClientEndingsPerLatestSixMonths:
      latestSixEndingMonths.length > 0
        ? latestSixClientEnds / latestSixEndingMonths.length
        : null,
    endingAttritionPct:
      latestFullMonth && latestFullMonth.establishedClientsAtStart > 0
        ? (latestSixClientEnds /
            Math.max(1, latestSixEndingMonths.length) /
            latestFullMonth.establishedClientsAtStart) *
          100
        : null,
    endingLeftCensoredEstablishedClients,
  };
}

export type ClientActivityOptions = {
  /** Service classification only; these sources cannot add visits, coverage or financial actuals. */
  classificationSnapshots?: readonly LocalSnapshot[];
  /** Unresolved partial rows block absence claims but never add visits. Drop them after full source replacement. */
  excludedFollowUpEvidence?: readonly { clientId: string; serviceDate: string }[];
};

function unresolvedActivityFollowUp(shows: AttendanceRow[], options: ClientActivityOptions, asOf: string) {
  const datesByClient = new Map<string, string[]>();
  for (const row of shows) datesByClient.set(row.clientId, [...(datesByClient.get(row.clientId) ?? []), row.serviceDate]);
  return (options.excludedFollowUpEvidence ?? []).filter((row) => {
    const dates = datesByClient.get(row.clientId);
    const stamp = Date.parse(row.serviceDate + "T00:00:00Z");
    return dates && /^\d{4}-\d{2}-\d{2}$/.test(row.serviceDate) && Number.isFinite(stamp)
      && new Date(stamp).toISOString().slice(0, 10) === row.serviceDate && row.serviceDate <= asOf
      && dates.some((date) => date < row.serviceDate) && !dates.includes(row.serviceDate);
  });
}

function absenceCoverageWithoutPartialFollowUp(intervals: DateInterval[], excluded: readonly { serviceDate: string }[]) {
  return excluded.reduce<DateInterval[]>((remaining, row) => remaining.flatMap((interval) => {
    if (row.serviceDate < interval.start || row.serviceDate > interval.end) return [interval];
    return [
      ...(interval.start < row.serviceDate ? [{ start: interval.start, end: addDays(row.serviceDate, -1) }] : []),
      ...(interval.end > row.serviceDate ? [{ start: addDays(row.serviceDate, 1), end: interval.end }] : []),
    ];
  }), intervals);
}

/** Read-only evidence for period client sets; existing monthly calculations stay unchanged. */
export function periodClientAttritionEvidence(
  snapshots: LocalSnapshot[],
  asOf: string,
  window: { start: string; end: string },
  overrides: SameDayVisitOverrides = {},
  options: ClientActivityOptions = {},
  clinician?: string,
) {
  const name = clinician === undefined ? undefined : normalizeClinician(clinician);
  const scoped = name === undefined ? snapshots : snapshots.map((snapshot) => ({
    ...snapshot,
    rows: snapshot.rows.filter((row) => normalizeClinician(row.clinician) === name),
    coverageClinicians: snapshot.coverageClinicians?.filter((value) => normalizeClinician(value) === name),
  } as LocalSnapshot));
  const classification = options.classificationSnapshots ?? snapshots;
  const shows = derivedShowVisits(scoped, overrides, classification).filter((row) => row.serviceDate <= asOf);
  const excluded = unresolvedActivityFollowUp(shows, options, asOf);
  const intervals = absenceCoverageWithoutPartialFollowUp(verifiedAttendanceIntervals(scoped, asOf, clinician, classification), excluded);
  const datesByClient = new Map<string, string[]>();
  for (const row of shows) datesByClient.set(row.clientId, [...(datesByClient.get(row.clientId) ?? []), row.serviceDate]);
  for (const [id, dates] of datesByClient) datesByClient.set(id, [...new Set(dates)].sort());
  const start = intervals[0]?.start ?? window.start;
  const endings = estimateObservedClientEndings(datesByClient, intervals, start, asOf, 90, window.start, window.end, excluded);
  return { datesByClient, intervals, excluded, endingEvents: endings.endingEvents };
}

export function estimateLocalClientActivity(
  snapshots: LocalSnapshot[],
  sameDayVisitOverrides: SameDayVisitOverrides = {},
  inactivityDays = 56,
  returnMaturityDays = 56,
  initialRetentionGapDays = 28,
  asOfDate = "9999-12-31",
  endingGapDays = 90,
  eventStart = "0000-01-01",
  eventEnd = "9999-12-31",
  options: ClientActivityOptions = {},
): LocalClientActivityEstimate | null {
  const classificationSnapshots = options.classificationSnapshots ?? snapshots;
  const shows = derivedShowVisits(snapshots, sameDayVisitOverrides, classificationSnapshots)
    .filter((row) => row.serviceDate <= asOfDate)
    .sort(
      (a, b) =>
        a.serviceDate.localeCompare(b.serviceDate) ||
        a.clinician.localeCompare(b.clinician) ||
        a.clientId.localeCompare(b.clientId),
    );
  if (!shows.length) return null;
  const attendanceSnapshots = snapshots.filter(
    (snapshot): snapshot is Extract<LocalSnapshot, { kind: "attendance" }> =>
      snapshot.kind === "attendance",
  );
  const observedIntervals = mergeIntervals(
    clipIntervals(
      attendanceSnapshots.map((snapshot) => ({
        start: snapshot.coverageStart,
        end: snapshot.coverageEnd,
      })),
      asOfDate,
    ),
  );
  const excludedFollowUp = unresolvedActivityFollowUp(shows, options, asOfDate);
  const coverageIntervals = absenceCoverageWithoutPartialFollowUp(verifiedAttendanceIntervals(snapshots, asOfDate, undefined, classificationSnapshots), excludedFollowUp);
  const coverageDates = [...observedIntervals, ...coverageIntervals]
    .flatMap((interval) => [interval.start, interval.end])
    .sort();
  const coverageStart = coverageDates[0];
  const coverageEnd = coverageDates.at(-1);
  if (!coverageStart || !coverageEnd) return null;
  const practiceShowDates = new Map<string, string[]>();
  const relationshipShowDates = new Map<string, string[]>();
  for (const row of shows) {
    const key = `${normalizeClinician(row.clinician)}\u0000${row.clientId}`;
    practiceShowDates.set(row.clientId, [
      ...(practiceShowDates.get(row.clientId) ?? []),
      row.serviceDate,
    ]);
    relationshipShowDates.set(key, [
      ...(relationshipShowDates.get(key) ?? []),
      row.serviceDate,
    ]);
  }
  const retained: Array<{ first: string; retainedOn: string; count: number }> =
    [];
  let matureNonRetainedClientPairs = 0;
  let immatureClientPairsExcluded = 0;
  let initialNonRetainedLaterReturnPairs = 0;
  let leftCensoredClientPairs = 0;
  let rightCensoredClientPairs = 0;
  for (const datesForClient of practiceShowDates.values()) {
    const dates = [...new Set(datesForClient)].sort();
    const first = dates[0];
    const last = dates.at(-1)!;
    if (first === coverageStart) leftCensoredClientPairs++;
    if (!hasCompleteLookForward(coverageIntervals, last, returnMaturityDays))
      rightCensoredClientPairs++;
    const { initialEpisode, laterReturnAfterInitialGap } =
      initialRetentionEpisode(dates, initialRetentionGapDays);
    if (first < eventStart || first > eventEnd) {
      continue;
    }
    if (initialEpisode.length >= 3) {
      retained.push({
        first,
        retainedOn: initialEpisode[2],
        count: initialEpisode.length,
      });
    } else if (
      first > addDays(coverageEnd, -initialRetentionGapDays) ||
      !intervalCoversRange(
        coverageIntervals,
        first,
        addDays(initialEpisode.at(-1)!, initialRetentionGapDays),
      )
    ) {
      immatureClientPairsExcluded++;
    } else {
      matureNonRetainedClientPairs++;
      if (laterReturnAfterInitialGap) initialNonRetainedLaterReturnPairs++;
    }
  }
  const initialRetentionDenominator =
    retained.length + matureNonRetainedClientPairs;
  const initialRetentionRate =
    initialRetentionDenominator > 0
      ? retained.length / initialRetentionDenominator
      : null;
  const eligibleInactivityMonths = completeInactivityMonths(
    coverageIntervals,
    coverageStart,
    coverageEnd,
    inactivityDays,
  ).filter(
    (month) => monthEnd(month) >= eventStart && monthStart(month) <= eventEnd,
  );
  const practiceInactivity = estimateObservedInactivity(
    practiceShowDates,
    coverageIntervals,
    eligibleInactivityMonths,
    inactivityDays,
    3,
  );
  const relationshipInactivity = estimateObservedInactivity(
    relationshipShowDates,
    coverageIntervals,
    eligibleInactivityMonths,
    inactivityDays,
    3,
  );
  const observedSessions = retained.reduce((sum, item) => sum + item.count, 0);
  const observedMonthEquivalents = retained.reduce((sum, item) => {
    const days = Math.max(
      1,
      coveredDaysInRange(observedIntervals, item.first, item.retainedOn),
    );
    return sum + Math.max(1, days / averageDaysPerMonth);
  }, 0);
  const observedAttendedSessionsPerRetainedClient = retained.length
    ? observedSessions / retained.length
    : null;
  const observedAttendedSessionsPerMonth =
    retained.length && observedMonthEquivalents > 0
      ? observedSessions / observedMonthEquivalents
      : null;
  const estimatedMonths =
    observedAttendedSessionsPerRetainedClient !== null &&
    observedAttendedSessionsPerMonth !== null &&
    observedAttendedSessionsPerMonth > 0
      ? observedAttendedSessionsPerRetainedClient /
        observedAttendedSessionsPerMonth
      : null;
  if (estimatedMonths !== null && !(estimatedMonths > 0)) return null;
  const latestCompleteMonth = eligibleInactivityMonths.at(-1) ?? null;
  const activeClientsInLatestCompleteMonth = latestCompleteMonth
    ? (practiceInactivity.monthlyRows.find(
        (row) => row.month === latestCompleteMonth,
      )?.activeClientsAtStart ?? null)
    : null;
  const monthlyAttritionRate = practiceInactivity.monthlyInactivityRate;
  const clientEndings = estimateObservedClientEndings(
    practiceShowDates,
    coverageIntervals,
    coverageStart,
    coverageEnd,
    endingGapDays,
    eventStart,
    eventEnd,
    excludedFollowUp,
  );
  return {
    coverageVerified: intervalCoversRange(coverageIntervals, coverageStart, coverageEnd),
    initialRetentionCoverageVerified: initialRetentionWindowCovered(practiceShowDates, coverageIntervals, eventStart, eventEnd, initialRetentionGapDays),
    coverageStart,
    coverageEnd,
    inactivityDays,
    initialRetentionGapDays,
    returnMaturityDays,
    eligibleInactivityMonths,
    monthlyInactiveClientTransitions: practiceInactivity.monthlyRows,
    retainedClientPairs: retained.length,
    matureNonRetainedClientPairs,
    immatureClientPairsExcluded,
    initialRetentionDenominator,
    initialRetentionRate,
    initialNonRetainedLaterReturnPairs,
    leftCensoredClientPairs,
    rightCensoredClientPairs,
    inactiveClientTransitions: practiceInactivity.inactiveTransitions,
    inactiveClientReactivations: practiceInactivity.inactiveReactivations,
    activeClientMonthDenominator: practiceInactivity.activeMonthDenominator,
    inactiveRelationshipTransitions: relationshipInactivity.inactiveTransitions,
    inactiveRelationshipReactivations:
      relationshipInactivity.inactiveReactivations,
    activeRelationshipMonthDenominator:
      relationshipInactivity.activeMonthDenominator,
    averageInactiveClientTransitionsPerMonth:
      eligibleInactivityMonths.length > 0
        ? practiceInactivity.inactiveTransitions /
          eligibleInactivityMonths.length
        : null,
    observedAttendedSessionsPerRetainedClient,
    observedAttendedSessionsPerMonth,
    estimatedMonths,
    monthlyAttritionRate,
    monthlyAttritionPct:
      monthlyAttritionRate === null ? null : monthlyAttritionRate * 100,
    latestCompleteMonth,
    activeClientsInLatestCompleteMonth,
    estimatedClientsLeavingPerMonth:
      eligibleInactivityMonths.length > 0
        ? practiceInactivity.inactiveTransitions /
          eligibleInactivityMonths.length
        : null,
    ...clientEndings,
  };
}

const blankConsultMetric = (clinician: string | null): ConsultConversionMetric => ({
  clinician,
  rateBasis: clinician === null ? "observed_treatment_starts" : "confirmed_closer_credit",
  consultations: 0,
  converted: 0,
  candidateConversions: 0,
  missed: 0,
  pending: 0,
  needsAttribution: 0,
  internalReferralsProtected: 0,
  evaluated: 0,
  conversionRate: null,
});

const finishConsultMetric = (
  metric: ConsultConversionMetric,
): ConsultConversionMetric => {
  const evaluated = metric.converted + metric.missed;
  return {
    ...metric,
    evaluated,
    conversionRate: evaluated > 0 ? (metric.converted / evaluated) * 100 : null,
  };
};

/** null selects the practice; a named contributor never falls back to its rate. */
export function consultConversionForContributor(summary: ConsultConversionSummary, clinician: string | null): (ConsultConversionMetric & { benchmarkRate: number | null }) | null {
  if (clinician === null) return { ...summary.practice, benchmarkRate: null };
  const key = normalizeClinician(clinician);
  const metric = key ? summary.byClinician.find((metric) => normalizeClinician(metric.clinician ?? "") === key) : undefined;
  return metric ? { ...metric, benchmarkRate: metric.evaluated > 0 ? summary.practice.conversionRate : null } : null;
}

export type ConsultConversionOptions = {
  /** Service classification only; these sources cannot add visits or coverage. */
  classificationSnapshots?: readonly LocalSnapshot[];
  /** Scope consultation cohorts only. All clinicians' treatment and coverage evidence remains available. */
  cohortClinicianNames?: readonly string[];
  /** Excluded partial evidence can block an absence claim, never establish a conversion. */
  excludedFollowUpEvidence?: readonly { clientId: string; serviceDate: string }[];
};

/** Legacy attendance-based diagnostic. Scheduling close rates use summarizeBookingConversions. */
export function summarizeConsultConversions(
  snapshots: LocalSnapshot[],
  sameDayVisitOverrides: SameDayVisitOverrides = {},
  periodStart = "0000-01-01",
  periodEnd = "9999-12-31",
  asOfDate = "9999-12-31",
  attributionOverrides: ConsultAttributionOverrideInput[] = [],
  options: ConsultConversionOptions = {},
): ConsultConversionSummary {
  const cohortNames = options.cohortClinicianNames === undefined ? null
    : new Set(options.cohortClinicianNames.map(normalizeClinician).filter(Boolean));
  const classificationSnapshots = options.classificationSnapshots ?? snapshots;
  const coverageIntervals = verifiedAttendanceIntervals(snapshots, asOfDate, undefined, classificationSnapshots);
  const isConsult = consultAttendanceClassifier(classificationSnapshots);
  const conflictedRows = new Set(attendanceStatusConflicts(snapshots, classificationSnapshots).flatMap((group) => group.rows));
  const overridesByClient = new Map(
    attributionOverrides
      .filter((override) => !override.archived)
      .map((override) => [override.clientId.trim(), override]),
  );
  const consultRows = snapshots
    .flatMap((snapshot) =>
      snapshot.kind === "attendance"
        ? snapshot.rows.filter(
            (row) =>
              row.status === "show" && !conflictedRows.has(row) &&
              row.serviceDate <= asOfDate &&
              (cohortNames === null || cohortNames.has(normalizeClinician(row.clinician))) &&
              isConsult(row),
          )
        : [],
    )
    .sort(
      (a, b) =>
        a.clientId.localeCompare(b.clientId) ||
        a.serviceDate.localeCompare(b.serviceDate) ||
        a.clinician.localeCompare(b.clinician),
    );
  const treatmentShows = derivedShowVisits(snapshots, sameDayVisitOverrides, classificationSnapshots)
    .filter((row) => row.serviceDate <= asOfDate)
    .sort(
      (a, b) =>
        a.clientId.localeCompare(b.clientId) ||
        a.serviceDate.localeCompare(b.serviceDate) ||
        a.clinician.localeCompare(b.clinician),
    );
  const consultsByClient = new Map<string, AttendanceRow[]>();
  for (const row of consultRows) {
    consultsByClient.set(row.clientId, [
      ...(consultsByClient.get(row.clientId) ?? []),
      row,
    ]);
  }
  const treatmentsByClient = new Map<string, AttendanceRow[]>();
  for (const row of treatmentShows) {
    treatmentsByClient.set(row.clientId, [
      ...(treatmentsByClient.get(row.clientId) ?? []),
      row,
    ]);
  }
  const journeys: ConsultJourney[] = [];
  for (const [clientId, rows] of consultsByClient) {
    const sortedConsults = [...rows].sort((a, b) =>
      a.serviceDate.localeCompare(b.serviceDate),
    );
    const firstConsult = sortedConsults[0];
    if (
      !firstConsult ||
      firstConsult.serviceDate < periodStart ||
      firstConsult.serviceDate > periodEnd
    )
      continue;
    const consultDate = firstConsult.serviceDate;
    const deadline = addCalendarMonth(consultDate);
    const windowConsults = sortedConsults.filter(
      (row) => row.serviceDate >= consultDate && row.serviceDate <= deadline,
    );
    const consultClinicians = [...new Map(windowConsults.filter((row) => normalizeClinician(row.clinician))
      .map((row) => [normalizeClinician(row.clinician), row.clinician.trim().replace(/\s+/g, " ")])).values()].sort();
    const treatments = (treatmentsByClient.get(clientId) ?? []).filter(
      (row) => row.serviceDate >= consultDate && row.serviceDate <= deadline,
    );
    const firstTreatmentDate = treatments[0]?.serviceDate ?? null;
    const firstTreatmentRows = firstTreatmentDate
      ? treatments.filter((row) => row.serviceDate === firstTreatmentDate)
      : [];
    const treatmentClinicians = [
      ...new Set(firstTreatmentRows.map((row) => row.clinician).filter(Boolean)),
    ].sort();
    const converted = firstTreatmentRows.length > 0;
    const unresolvedFollowUp = !converted && options.excludedFollowUpEvidence?.some((row) => row.clientId === clientId && row.serviceDate >= consultDate && row.serviceDate <= deadline);
    const coverageVerified = !unresolvedFollowUp && intervalCoversRange(coverageIntervals, consultDate, deadline);
    const pending = !converted && (asOfDate < deadline || !coverageVerified);
    const override = overridesByClient.get(clientId);
    const treatmentStartClinician =
      converted && treatmentClinicians.length === 1 ? treatmentClinicians[0] : null;
    const manualClinician = override?.clinicianName?.trim() || null;
    const closerClinician =
      converted && override?.outcome === "confirmed_closer" && manualClinician
        ? manualClinician
        : null;
    const nonconvertedOwner =
      !converted &&
      !pending &&
      override?.outcome === "missed_owner" &&
      manualClinician
        ? manualClinician
        : null;
    const attributionIssue = converted
      ? override?.outcome === "needs_review"
        ? "Manual review marked this converted client as unresolved."
        : closerClinician
          ? null
          : treatmentClinicians.length === 1
            ? "Treatment start clinician is a candidate, not a confirmed closer."
            : treatmentClinicians.length > 1
              ? "Converted client has conflicting same-day treatment-start clinicians."
              : "Converted client is missing a treatment-start clinician candidate."
      : pending
        ? null
        : override?.outcome === "needs_review"
          ? "Manual review marked this non-converted client as unresolved."
          : nonconvertedOwner
            ? null
            : "Non-converted client is missing a single confirmed missed-consult owner.";
    const status: ConsultJourneyStatus = converted
      ? closerClinician
        ? "converted"
        : "needs_attribution"
      : pending
        ? "pending"
        : attributionIssue
          ? "needs_attribution"
          : "missed";
    journeys.push({
      coverageVerified,
      clientId,
      consultDate,
      deadline,
      status,
      consultClinicians,
      closerClinician,
      treatmentStartClinician,
      creditedClinician: converted ? closerClinician : nonconvertedOwner,
      treatmentDate: firstTreatmentDate,
      attributionIssue,
      attributionSource: closerClinician
        ? "manual_confirmed_closer"
        : override?.outcome === "needs_review"
          ? "manual_needs_review"
          : nonconvertedOwner && override?.outcome === "missed_owner"
            ? "manual_missed_owner"
            : treatmentStartClinician
              ? "treatment_start_candidate"
              : "none",
    });
  }
  const practice = blankConsultMetric(null);
  const byClinician = new Map<string, ConsultConversionMetric>();
  const clinicianMetric = (name: string) => {
    const key = normalizeClinician(name);
    const metric = byClinician.get(key) ?? blankConsultMetric(name.trim().replace(/\s+/g, " "));
    byClinician.set(key, metric);
    return metric;
  };
  for (const journey of journeys) {
    practice.consultations++;
    if (journey.treatmentDate) practice.converted++;
    else if (journey.status === "pending") practice.pending++;
    else practice.missed++;
    if (journey.status === "needs_attribution") practice.needsAttribution++;

    if (journey.status === "converted" && journey.closerClinician) {
      const metric = clinicianMetric(journey.closerClinician);
      metric.consultations++;
      metric.converted++;
      for (const clinician of journey.consultClinicians) {
        if (normalizeClinician(clinician) !== normalizeClinician(journey.closerClinician))
          clinicianMetric(clinician).internalReferralsProtected++;
      }
      continue;
    }
    if (
      journey.treatmentStartClinician &&
      journey.status === "needs_attribution"
    ) {
      const metric = clinicianMetric(journey.treatmentStartClinician);
      metric.consultations++;
      metric.candidateConversions++;
      metric.pending++;
      metric.needsAttribution++;
      for (const clinician of journey.consultClinicians) {
        if (normalizeClinician(clinician) !== normalizeClinician(journey.treatmentStartClinician))
          clinicianMetric(clinician).internalReferralsProtected++;
      }
      continue;
    }
    if (journey.status === "needs_attribution") {
      for (const clinician of journey.consultClinicians) {
        const metric = clinicianMetric(clinician);
        metric.consultations++;
        metric.pending++;
        metric.needsAttribution++;
      }
      continue;
    }
    if (journey.status === "pending") {
      for (const name of new Map(journey.consultClinicians.map((name) => [normalizeClinician(name), name])).values()) {
        const metric = clinicianMetric(name);
        metric.consultations++;
        metric.pending++;
      }
      continue;
    }
    const owner = journey.creditedClinician;
    if (!owner) continue;
    const metric = clinicianMetric(owner);
    metric.consultations++;
    metric.missed++;
  }
  return {
    coverageVerified: journeys.length > 0 && journeys.every((journey) => journey.coverageVerified),
    periodStart,
    periodEnd,
    asOfDate,
    window: "one_calendar_month",
    practice: finishConsultMetric(practice),
    byClinician: [...byClinician.values()]
      .map(finishConsultMetric)
      .sort((a, b) => (a.clinician ?? "").localeCompare(b.clinician ?? "")),
    journeys,
  };
}

export function buildLocalRetentionMetrics(
  snapshots: LocalSnapshot[],
  billingCodeMinutes: BillingCodeMinutes = {},
  sameDayVisitOverrides: SameDayVisitOverrides = {},
  followUpDays = 28,
  asOfDate = "9999-12-31",
  endingGapDays = 90,
  eventStart = "0000-01-01",
  eventEnd = "9999-12-31",
  options: ClientActivityOptions = {},
): LocalRetentionMetrics {
  const classificationSnapshots = options.classificationSnapshots ?? snapshots;
  const attendance = snapshots.flatMap((snapshot) =>
    snapshot.kind === "attendance"
      ? snapshot.rows.filter((row) => row.serviceDate <= asOfDate)
      : [],
  );
  const treatmentAttendance = treatmentAttendanceRows(snapshots, classificationSnapshots).filter(
    (row) => row.serviceDate <= asOfDate,
  );
  const derivedShows = derivedShowVisits(
    snapshots,
    sameDayVisitOverrides,
    classificationSnapshots,
  ).filter((row) => row.serviceDate <= asOfDate);
  const rawShowRows = attendance.filter((row) => row.status === "show").length;
  const treatmentShowRows = treatmentAttendance.filter(
    (row) => row.status === "show",
  ).length;
  const isConsultation = consultAttendanceClassifier(classificationSnapshots);
  const excludedConsultationShowRows = attendance.filter((row) => row.status === "show" && isConsultation(row)).length;
  const billing = snapshots.flatMap((snapshot) =>
    snapshot.kind === "billing"
      ? snapshot.rows.filter((row) => row.serviceDate <= asOfDate)
      : [],
  );
  const treatmentBilling = treatmentBillingRows(snapshots).filter(
    (row) => row.serviceDate <= asOfDate,
  );
  const allDates = [...attendance, ...billing]
    .map((row) => row.serviceDate)
    .filter((date) => date <= asOfDate)
    .sort();
  const coverageStart = allDates[0] ?? null;
  const coverageEnd = allDates[allDates.length - 1] ?? null;
  const displayLabels = new Map<string, string>();
  for (const row of [...attendance, ...billing]) {
    const key = normalizeClinician(row.clinician);
    if (!displayLabels.has(key)) displayLabels.set(key, row.clinician.trim().replace(/\s+/g, " "));
  }
  const billingByClinician = new Map<string, ClinicianBillingMetric>();
  for (const row of billing.filter((row) => !isConsultationService(row) || legacyServiceDefinition(row.billingCode)?.kind === "consultation")) {
    const clinicianKey = normalizeClinician(row.clinician);
    const metric = billingByClinician.get(clinicianKey) ?? {
      clinician: displayLabels.get(clinicianKey)!,
      billedRows: 0,
      totalFeesCharged: 0,
      configuredMinuteRows: 0,
      estimatedBillingHours: null,
    };
    metric.billedRows++;
    metric.totalFeesCharged += row.totalFeeCharged;
    const configuredMinutes = billingCodeMinutesFor(
      billingCodeMinutes,
      row.billingCode,
    );
    if (configuredMinutes !== null) {
      metric.configuredMinuteRows++;
      metric.estimatedBillingHours =
        (metric.estimatedBillingHours ?? 0) + configuredMinutes / 60;
    }
    billingByClinician.set(clinicianKey, metric);
  }
  const attendanceByClinician = new Map<string, ClinicianAttendanceMetric>();
  const showDatesByClinicianClient = new Map<string, string[]>();
  for (const row of treatmentAttendance) {
    const clinicianKey = normalizeClinician(row.clinician);
    const metric = attendanceByClinician.get(clinicianKey) ?? {
      clinician: displayLabels.get(clinicianKey)!,
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
      // Count attended volume from de-duplicated same-day visits below.
    } else if (row.status === "cancelled") metric.clientCancelled++;
    else if (row.status === "no show") metric.noShows++;
    else metric.clinicianCancelled++;
    attendanceByClinician.set(clinicianKey, metric);
  }
  for (const row of derivedShows) {
    const clinicianKey = normalizeClinician(row.clinician);
    const metric = attendanceByClinician.get(clinicianKey);
    if (!metric) continue;
    metric.shows++;
    const key = `${clinicianKey}\u0000${row.clientId}`;
    showDatesByClinicianClient.set(key, [
      ...(showDatesByClinicianClient.get(key) ?? []),
      row.serviceDate,
    ]);
  }
  const unresolvedFollowUp = unresolvedActivityFollowUp(derivedShows, options, asOfDate);
  const scopedOptions: ClientActivityOptions = { excludedFollowUpEvidence: unresolvedFollowUp };
  const coverageIntervals = absenceCoverageWithoutPartialFollowUp(verifiedAttendanceIntervals(snapshots, asOfDate, undefined, classificationSnapshots), unresolvedFollowUp);
  const coverageByClinician = new Map<string, DateInterval[]>();
  const coverageForClinician = (clinician: string) => {
    let intervals = coverageByClinician.get(clinician);
    if (!intervals) {
      const excluded = unresolvedActivityFollowUp(derivedShows.filter((row) => normalizeClinician(row.clinician) === clinician), scopedOptions, asOfDate);
      intervals = absenceCoverageWithoutPartialFollowUp(verifiedAttendanceIntervals(snapshots, asOfDate, clinician, classificationSnapshots), excluded);
      coverageByClinician.set(clinician, intervals);
    }
    return intervals;
  };
  const clinicianClientDates = new Map<string, Map<string, string[]>>();
  const clientActivityByClinician = new Map<
    string,
    ClinicianClientActivityMetric
  >();
  for (const [key, dates] of showDatesByClinicianClient) {
    const [clinician, clientId] = key.split("\u0000");
    const metric = attendanceByClinician.get(clinician);
    if (!metric) continue;
    const sorted = [...new Set(dates)].sort();
    const firstShowDate = sorted[0];
    metric.uniqueActiveClients++;
    const clinicianDates =
      clinicianClientDates.get(clinician) ?? new Map<string, string[]>();
    clinicianDates.set(clientId, sorted);
    clinicianClientDates.set(clinician, clinicianDates);
    const activity = clientActivityByClinician.get(clinician) ?? {
      clinician: metric.clinician,
      coverageVerified: false,
      initialRetentionCoverageVerified: false,
      initialRetentionGapDays: followUpDays,
      retainedClients: 0,
      matureNonRetainedClients: 0,
      pendingInitialClients: 0,
      initialRetentionDenominator: 0,
      initialRetentionPct: null,
      endingGapDays,
      endingObservationCutoff: null,
      endingFullMonthClientEnds: 0,
      endingFullMonthDenominator: 0,
      averageClientEndingsPerFullMonth: null,
      latestSixEndingMonths: [],
      latestSixClientEnds: 0,
      averageClientEndingsPerLatestSixMonths: null,
      partialEndingMonth: null,
    };
    const { initialEpisode } = initialRetentionEpisode(sorted, followUpDays);
    if (firstShowDate < eventStart || firstShowDate > eventEnd) {
      clientActivityByClinician.set(clinician, activity);
      continue;
    }
    if (initialEpisode.length >= 3) {
      metric.retainedClients++;
      activity.retainedClients++;
    } else {
      metric.firstObservedClients++;
      if (
        !intervalCoversRange(
          coverageForClinician(clinician),
          firstShowDate,
          addDays(initialEpisode.at(-1) ?? firstShowDate, followUpDays),
        )
      ) {
        metric.immatureClientsExcluded++;
        activity.pendingInitialClients++;
      } else {
        activity.matureNonRetainedClients++;
      }
    }
    activity.initialRetentionDenominator =
      activity.retainedClients + activity.matureNonRetainedClients;
    activity.initialRetentionPct =
      activity.initialRetentionDenominator > 0
        ? (activity.retainedClients / activity.initialRetentionDenominator) *
          100
        : null;
    clientActivityByClinician.set(clinician, activity);
  }
  for (const [clinician, clientDates] of clinicianClientDates) {
    const activity = clientActivityByClinician.get(clinician);
    if (!activity) continue;
    const clinicianIntervals = coverageForClinician(clinician);
    activity.initialRetentionCoverageVerified = initialRetentionWindowCovered(clientDates, clinicianIntervals, eventStart, eventEnd, followUpDays);
    const activityCoverageStart = clinicianIntervals[0]?.start;
    const activityCoverageEnd = clinicianIntervals.at(-1)?.end;
    if (!activityCoverageStart || !activityCoverageEnd) continue;
    const excludedFollowUp = unresolvedActivityFollowUp(derivedShows.filter((row) => normalizeClinician(row.clinician) === clinician), scopedOptions, asOfDate);
    const endings = estimateObservedClientEndings(
      clientDates,
      clinicianIntervals,
      activityCoverageStart,
      activityCoverageEnd,
      endingGapDays,
      eventStart,
      eventEnd,
      excludedFollowUp,
    );
    activity.endingObservationCutoff = endings.endingObservationCutoff;
    activity.endingFullMonthClientEnds = endings.endingFullMonthClientEnds;
    activity.endingFullMonthDenominator = endings.endingFullMonthDenominator;
    activity.averageClientEndingsPerFullMonth =
      endings.averageClientEndingsPerFullMonth;
    activity.latestSixEndingMonths = endings.latestSixEndingMonths;
    activity.latestSixClientEnds = endings.latestSixClientEnds;
    activity.averageClientEndingsPerLatestSixMonths =
      endings.averageClientEndingsPerLatestSixMonths;
    activity.partialEndingMonth = endings.partialEndingMonth;
    const observedDates = [...clientDates.values()].flat().sort();
    activity.coverageVerified = excludedFollowUp.length === 0 && intervalCoversRange(
      clinicianIntervals,
      observedDates[0],
      observedDates.at(-1)!,
    );
    clientActivityByClinician.set(clinician, activity);
  }
  const roomCounts = new Map<string, RoomMetric>();
  for (const row of treatmentAttendance) {
    const location = row.location || "Unassigned";
    const metric = roomCounts.get(location) ?? {
      location,
      source: "attendance_location" as const,
      measure: "recorded_session_counts" as const,
      showRows: 0,
      clientCancelled: 0,
      noShows: 0,
      clinicianCancelled: 0,
    };
    if (row.status === "show") {
      // Count attended room use from de-duplicated same-day visits below.
    } else if (row.status === "cancelled") metric.clientCancelled++;
    else if (row.status === "no show") metric.noShows++;
    else metric.clinicianCancelled++;
    roomCounts.set(location, metric);
  }
  for (const row of derivedShows) {
    const location = row.location || "Unassigned";
    const metric = roomCounts.get(location) ?? {
      location,
      source: "attendance_location" as const,
      measure: "recorded_session_counts" as const,
      showRows: 0,
      clientCancelled: 0,
      noShows: 0,
      clinicianCancelled: 0,
    };
    metric.showRows++;
    roomCounts.set(location, metric);
  }
  return {
    coverageVerified: coverageStart !== null && coverageEnd !== null &&
      intervalCoversRange(coverageIntervals, coverageStart, coverageEnd),
    coverageStart,
    coverageEnd,
    attendanceRows: attendance.length,
    billingRows: billing.length,
    rawShowRows,
    derivedShowVisits: derivedShows.length,
    collapsedDuplicateShowRows: treatmentShowRows - derivedShows.length,
    excludedConsultationShowRows,
    billingByClinician: sortByName([...billingByClinician.values()]),
    attendanceByClinician: sortByName([...attendanceByClinician.values()]),
    clientActivityByClinician: sortByName([
      ...clientActivityByClinician.values(),
    ]),
    roomCounts: sortByName([...roomCounts.values()]),
  };
}

export function localDerivedVisitDetail(metrics: {
  collapsedDuplicateShowRows: number;
  excludedConsultationShowRows: number;
}) {
  const parts: string[] = [];
  if (metrics.collapsedDuplicateShowRows > 0) {
    parts.push(
      `${metrics.collapsedDuplicateShowRows.toLocaleString()} treatment duplicate show ${
        metrics.collapsedDuplicateShowRows === 1 ? "row" : "rows"
      } collapsed`,
    );
  }
  if (metrics.excludedConsultationShowRows > 0) {
    parts.push(
      `${metrics.excludedConsultationShowRows.toLocaleString()} consultation show ${
        metrics.excludedConsultationShowRows === 1 ? "row" : "rows"
      } excluded`,
    );
  }
  return parts.length ? parts.join("; ") : "No duplicate treatment show rows";
}

export function mergeImportedLocationRooms<
  TWorkspace extends {
    settings: { forecastStart: string };
    rooms: ImportedRoomRecord[];
  },
>(
  workspace: TWorkspace,
  snapshots: LocalSnapshot[],
  createId: () => string = () => crypto.randomUUID(),
): ImportedRoomsMergeResult<TWorkspace> {
  const existingNames = new Set(
    workspace.rooms.map((room) => normalizeLocationLabel(room.name)),
  );
  const importedNames = new Map<string, string>();
  for (const snapshot of snapshots) {
    if (snapshot.kind !== "attendance") continue;
    for (const row of snapshot.rows) {
      if (!row.location) continue;
      const name = cleanLocationLabel(row.location);
      if (!name) continue;
      const key = normalizeLocationLabel(name);
      if (!key || existingNames.has(key) || importedNames.has(key)) continue;
      importedNames.set(key, name);
    }
  }
  const addedRooms = [...importedNames.values()].map(
    (name): ImportedRoomRecord => ({
      id: createId(),
      name,
      archived: false,
      notes:
        "Imported from attendance Location labels. Review whether this is a physical room, telehealth label, or other location before assigning capacity.",
      planningOnly: true,
      start: workspace.settings.forecastStart,
      end: null,
      sourceAttachmentId: null,
      locationId: null,
      weeklyHours: 0,
      sessionMinutes: 60,
      usablePct: 85,
      telehealthUsesRoom: false,
      usage: "shared",
      dedicatedClinicianId: null,
      assignments: [],
      skippedWeeks: [],
      blocks: [],
    }),
  );
  if (!addedRooms.length) return { workspace, addedRooms };
  return {
    workspace: {
      ...workspace,
      rooms: [...workspace.rooms, ...addedRooms],
    } as TWorkspace,
    addedRooms,
  };
}

export function exportLocalBackup(
  snapshots: LocalSnapshot[],
  billingCodeMinutes: BillingCodeMinutes,
  sameDayVisitOverrides: SameDayVisitOverrides = {},
) {
  return {
    format: "emc-local-retention-v1" as const,
    exportedAt: new Date().toISOString(),
    warning:
      "Contains local de-identified client IDs and row-level facts. Do not upload to the practice API.",
    snapshots,
    billingCodeMinutes,
    sameDayVisitOverrides,
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
  if (unknown.some(unverifiedDeletionMarker)) fail(deletionMarkerGuidance);
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
  if (key === "clinician" && unverifiedDeletionMarker(value)) invalidPackage(deletionMarkerGuidance);
  return value;
}

function packageNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  const value = record[key];
  if (key === "billingCode" && typeof value === "string" && unverifiedDeletionMarker(value)) invalidPackage(deletionMarkerGuidance);
  if (value === null) return null;
  if (typeof value === "string" && value.trim()) return value;
  invalidPackage(`${label} must be null or a non-empty string`);
}

function trimNullableBillingCode(value: string | null) {
  return value === null ? null : value.trim();
}

function packageOptionalVisitKind(
  record: Record<string, unknown>,
  key: string,
  label: string,
): VisitKind | undefined {
  if (!(key in record)) return undefined;
  const value = record[key];
  if (value === "consultation") return value;
  invalidPackage(`${label} must be consultation when present`);
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
    minutesByCode[code.trim()] = minutes;
  }
  return minutesByCode;
}

function billingCodeMinutesFor(
  billingCodeMinutes: BillingCodeMinutes,
  code: string | null,
) {
  if (!code) return null;
  const legacy = legacyServiceDefinition(code);
  if (legacy?.kind === "documentation") return 0;
  const direct = billingCodeMinutes[code];
  if (direct !== undefined) return direct;
  const normalizedCode = normalizeBillingCode(code);
  const match = Object.entries(billingCodeMinutes).find(
    ([configuredCode]) =>
      normalizeBillingCode(configuredCode) === normalizedCode,
  );
  return match ? match[1] : legacy?.minutes ?? null;
}

function validatePackageCollectionBase(
  value: unknown,
  label: "attendance" | "billing",
) {
  if (!isRecord(value)) invalidPackage(`${label} collection must be an object`);
  rejectUnknownKeys(
    value,
    ["coverageStart", "coverageEnd", "reportCoverage", "rowCount", "rows"],
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
  if (value.reportCoverage === null) invalidPackage("reportCoverage must be an object");
  const reportCoverage = validateReportCoverage(value.reportCoverage, coverageStart, coverageEnd, invalidPackage);
  return { coverageStart, coverageEnd, reportCoverage, rows: value.rows };
}

function validateReportCoverage(
  value: unknown,
  observedStart: string,
  observedEnd: string,
  fail: (reason: string) => never,
): ReportCoverage | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) fail("reportCoverage must be an object");
  rejectUnknownKeys(value, ["start", "end", "complete"], "reportCoverage", fail);
  for (const key of ["start", "end"] as const) {
    const date = value[key];
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      fail(`reportCoverage.${key} must be a valid date`);
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
      fail(`reportCoverage.${key} must be a valid date`);
  }
  const { start, end } = value as { start: string; end: string };
  if (value.complete !== true || start > end || start > observedStart || end < observedEnd)
    fail("reportCoverage must declare complete: true and contain the observed row span");
  return { start, end, complete: true };
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
      [
        "clientId",
        "clinician",
        "serviceDate",
        "location",
        "status",
        "cancellationSubtype",
        "billingCode",
        "visitKind",
      ],
      `attendance row ${index + 1}`,
      invalidPackage,
    );
    const status = value.status;
    if (!isAttendanceStatus(status))
      invalidPackage(`attendance row ${index + 1} has an invalid status`);
    const cancellationSubtype = value.cancellationSubtype;
    if (cancellationSubtype !== undefined && (cancellationSubtype !== "late_cancelled" || status !== "cancelled"))
      invalidPackage(`attendance row ${index + 1} has an invalid cancellation subtype`);
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
    const billingCode =
      "billingCode" in value
        ? trimNullableBillingCode(
            packageNullableString(
              value,
              "billingCode",
              `attendance row ${index + 1} billingCode`,
            ),
          )
        : undefined;
    const visitKind = packageOptionalVisitKind(
      value,
      "visitKind",
      `attendance row ${index + 1} visitKind`,
    );
    return {
      clientId,
      clinician,
      serviceDate,
      location,
      status,
      ...(cancellationSubtype ? { cancellationSubtype: cancellationSubtype as "late_cancelled" } : {}),
      ...(billingCode !== undefined ? { billingCode } : {}),
      ...(visitKind !== undefined ? { visitKind } : {}),
      sourceRowHash: rowHash([
        "attendance",
        clientId,
        clinician,
        serviceDate,
        location,
        status,
        billingCode,
        visitKind,
        ...(cancellationSubtype ? [cancellationSubtype] : []),
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
        "visitKind",
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
    const billingCode = trimNullableBillingCode(
      packageNullableString(
        value,
        "billingCode",
        `billing row ${index + 1} billingCode`,
      ),
    );
    const visitKind = packageOptionalVisitKind(
      value,
      "visitKind",
      `billing row ${index + 1} visitKind`,
    );
    return {
      clientId,
      clinician,
      serviceDate,
      totalFeeCharged,
      billingCode,
      ...(visitKind !== undefined ? { visitKind } : {}),
      sourceRowHash: rowHash([
        "billing",
        clientId,
        clinician,
        serviceDate,
        totalFeeCharged,
        billingCode,
        visitKind,
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
        ...(attendanceBase.reportCoverage ? { reportCoverage: attendanceBase.reportCoverage } : {}),
        sourceHash: attendanceSourceHash,
        rows: attendanceRows,
      },
      {
        id: `package-billing-${billingSourceHash}`,
        kind: "billing",
        importedAt: now,
        coverageStart: billingBase.coverageStart,
        coverageEnd: billingBase.coverageEnd,
        ...(billingBase.reportCoverage ? { reportCoverage: billingBase.reportCoverage } : {}),
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

function backupOptionalNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
) {
  return key in record ? backupNullableString(record, key, label) : undefined;
}

function backupOptionalVisitKind(
  record: Record<string, unknown>,
  key: string,
  label: string,
): VisitKind | undefined {
  if (!(key in record)) return undefined;
  const value = record[key];
  if (value === "consultation") return value;
  invalidBackup(`${label} must be consultation when present`);
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
  const cancellationSubtype = value.cancellationSubtype;
  if (cancellationSubtype !== undefined && (cancellationSubtype !== "late_cancelled" || status !== "cancelled"))
    invalidBackup(`attendance row ${index + 1} has an invalid cancellation subtype`);
  const billingCode =
    "billingCode" in value
      ? trimNullableBillingCode(
          backupOptionalNullableString(
            value,
            "billingCode",
            `attendance row ${index + 1} billingCode`,
          ) ?? null,
        )
      : undefined;
  const visitKind = backupOptionalVisitKind(
    value,
    "visitKind",
    `attendance row ${index + 1} visitKind`,
  );
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
    ...(cancellationSubtype ? { cancellationSubtype: cancellationSubtype as "late_cancelled" } : {}),
    ...(billingCode !== undefined ? { billingCode } : {}),
    ...(visitKind !== undefined ? { visitKind } : {}),
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
  const visitKind = backupOptionalVisitKind(
    value,
    "visitKind",
    `billing row ${index + 1} visitKind`,
  );
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
    billingCode: trimNullableBillingCode(
      backupNullableString(
        value,
        "billingCode",
        `billing row ${index + 1} billingCode`,
      ),
    ),
    ...(visitKind !== undefined ? { visitKind } : {}),
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
  const reportCoverage = validateReportCoverage(value.reportCoverage, base.coverageStart, base.coverageEnd, invalidBackup);
  const proof = reportCoverage ? { reportCoverage } : {};
  if (kind === "attendance") {
    const snapshot: LocalSnapshot = {
      ...base,
      ...proof,
      kind,
      rows: value.rows.map(validateAttendanceBackupRow),
    };
    validateSnapshotCoverage(snapshot, index);
    return snapshot;
  }
  if (kind === "billing") {
    const snapshot: LocalSnapshot = {
      ...base,
      ...proof,
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

function validateBackupSameDayVisitOverrides(
  value: unknown,
): SameDayVisitOverrides {
  if (value === undefined) return {};
  if (!isRecord(value))
    invalidBackup("sameDayVisitOverrides must be an object");
  const overrides: SameDayVisitOverrides = {};
  for (const [key, count] of Object.entries(value)) {
    if (!/^[0-9a-f]{16}$/.test(key))
      invalidBackup("same-day visit override keys must be stable IDs");
    if (
      typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 20
    )
      invalidBackup(
        "same-day visit override counts must be integers from 1 to 20",
      );
    overrides[key] = count;
  }
  return overrides;
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
    sameDayVisitOverrides: validateBackupSameDayVisitOverrides(
      value.sameDayVisitOverrides,
    ),
  };
}
