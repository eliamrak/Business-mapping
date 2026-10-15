import { dateRangeSchema, type SessionRecord, rangesOverlap } from "@workspace/practice";
import type { Context, ImportedBillingActual } from "@workspace/practice/hub";
import type { SessionAttendanceCoverage } from "./session-trend.ts";
import {
  isPhoneOnlyConsultAttendanceRow,
  sameDayVisitKey,
  type AttendanceRow,
  type BillingRow,
  type LocalSnapshot,
  type ReportCoverage,
  type SameDayVisitOverrides,
} from "./retention-local.ts";

export type ImportedSessionDiagnostic = {
  missingClinicianLabels: string[];
  ambiguousClinicianLabels: string[];
  manualOverlapCount: number;
  manualImportOverrideCount: number;
  manualImportConflictCount: number;
  attendedRows: number;
  derivedRecords: number;
  excludedNonShowRows: number;
  missingBillingClinicianLabels: string[];
  ambiguousBillingClinicianLabels: string[];
  billedRows: number;
  billedFees: number | null;
  billingConflictCount: number;
  rawAttendedRows: number;
  collapsedDuplicateShowRows: number;
  sameDayVisitOverrideCount: number;
};

export type ImportedSessionOverlay = {
  context: Context;
  derivedSessions: SessionRecord[];
  importedBillingActuals: ImportedBillingActual[];
  attendanceCoverage: SessionAttendanceCoverage[];
  coveredZeroSessions: SessionRecord[];
  /** Original aggregates whose uncovered portion cannot be allocated independently. */
  conflictedManualSessions: Array<SessionRecord & { status: "unknown" }>;
  attendanceObservedSpans: ImportedAttendanceObservedSpan[];
  diagnostic: ImportedSessionDiagnostic;
};

export type ImportedAttendanceObservedSpan = {
  snapshotId: string; sourceHash: string; importedAt: string;
  start: string; end: string; clinicianIds: number[];
};
export type CompleteAttendanceReportCoverage = ReportCoverage;

const normalizeLabel = (value: string) =>
  value.toLowerCase().replace(/\s+/g, " ").trim();

const dateId = (clinicianId: number, date: string, index: number) => {
  const seed = `${clinicianId}|${date}|${index}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return -1 * (1 + (hash >>> 0));
};

const rangeFullyCovered = (
  ranges: Array<{ start: string; end: string }>,
  start: string,
  end: string,
) => {
  let nextDate = start;
  for (const range of [...ranges].sort((a, b) => a.start.localeCompare(b.start))) {
    if (range.end < nextDate) continue;
    if (range.start > nextDate) return false;
    if (range.end >= end) return true;
    nextDate = new Date(Date.parse(`${range.end}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  return false;
};

const rangeCoveredAtAll = (
  ranges: Array<{ start: string; end: string }>,
  start: string,
  end: string,
) => ranges.some((range) => range.start <= end && range.end >= start);

export function buildImportedSessionOverlay(
  context: Context,
  snapshots: LocalSnapshot[],
  teamId: number | null,
  sameDayVisitOverrides: SameDayVisitOverrides = {},
  options: {
    clinicianActiveRanges?: Array<{ clinicianId: number; start: string; end: string | null }>;
    /** Workspace compensation effective dates must never restrict attendance coverage. */
    clinicianActiveRangesBasis?: "employment" | "compensation";
  } = {},
): ImportedSessionOverlay {
  const clinicians = context.clinicians.filter(
    (person) => (person.goalId ?? null) === teamId,
  );
  const cliniciansByLabel = new Map<string, typeof clinicians>();
  for (const clinician of clinicians) {
    const key = normalizeLabel(clinician.label);
    cliniciansByLabel.set(key, [
      ...(cliniciansByLabel.get(key) ?? []),
      clinician,
    ]);
  }

  const missingClinicianLabels = new Set<string>();
  const ambiguousClinicianLabels = new Set<string>();
  const missingBillingClinicianLabels = new Set<string>();
  const ambiguousBillingClinicianLabels = new Set<string>();
  const seenAttendanceRows = new Set<string>();
  const seenBillingRows = new Map<string, ImportedBillingActual>();
  const seenBillingPayloads = new Set<string>();
  const conflictingBillingHashes = new Set<string>();
  const scopedAttendanceCoverage: SessionAttendanceCoverage[] = [];
  const attendanceObservedSpans: ImportedAttendanceObservedSpan[] = [];
  const attendedByClinicianDate = new Map<
    string,
    { clinicianId: number; date: string; rows: AttendanceRow[]; visits: number }
  >();
  const sameDayShowGroups = new Map<string, AttendanceRow[]>();
  const billingActuals: ImportedBillingActual[] = [];
  let excludedNonShowRows = 0;

  for (const snapshot of snapshots) {
    if (snapshot.kind !== "attendance") continue;
    const mappedIds = new Set(snapshot.rows.flatMap((row) => {
      const matches = cliniciansByLabel.get(normalizeLabel(row.clinician)) ?? [];
      return matches.length === 1 ? [matches[0].id] : [];
    }));
    const snapshotRange = { start: snapshot.coverageStart, end: snapshot.coverageEnd };
    if (dateRangeSchema.safeParse(snapshotRange).success) attendanceObservedSpans.push({
      snapshotId: snapshot.id, sourceHash: snapshot.sourceHash, importedAt: snapshot.importedAt,
      ...snapshotRange, clinicianIds: [...mappedIds],
    });
    // The stored API bounds are min/max row dates, not a declaration of completeness.
    const declaredCoverage = snapshot.reportCoverage;
    const declaredRanges = declaredCoverage?.complete === true
      ? [declaredCoverage]
      : [];
    const verifiedRanges = declaredRanges.filter((range) =>
      dateRangeSchema.safeParse(range).success &&
      snapshot.rows.every((row) => row.serviceDate >= range.start && row.serviceDate <= range.end));
    for (const verifiedRange of verifiedRanges) {
      for (const clinicianId of mappedIds) {
        const activeRanges = options.clinicianActiveRangesBasis === "employment"
          ? options.clinicianActiveRanges?.filter((range) => range.clinicianId === clinicianId)
          : undefined;
        // Coverage includes visit-free endpoints for mapped clinicians, never absent providers.
        for (const range of activeRanges ?? [verifiedRange]) {
          const start = range.start > verifiedRange.start ? range.start : verifiedRange.start;
          const end = range.end && range.end < verifiedRange.end ? range.end : verifiedRange.end;
          if (start <= end) scopedAttendanceCoverage.push({ clinicianId, start, end });
        }
      }
    }
    for (const row of snapshot.rows) {
      if (seenAttendanceRows.has(row.sourceRowHash)) continue;
      seenAttendanceRows.add(row.sourceRowHash);
      const matches =
        cliniciansByLabel.get(normalizeLabel(row.clinician)) ?? [];
      if (matches.length === 0) {
        missingClinicianLabels.add(row.clinician);
        continue;
      }
      if (matches.length > 1) {
        ambiguousClinicianLabels.add(row.clinician);
        continue;
      }
      if (isPhoneOnlyConsultAttendanceRow(row, snapshots)) continue;
      if (row.status !== "show") {
        excludedNonShowRows++;
        continue;
      }
      const sameDayKey = sameDayVisitKey(row);
      sameDayShowGroups.set(sameDayKey, [
        ...(sameDayShowGroups.get(sameDayKey) ?? []),
        row,
      ]);
      const clinicianId = matches[0].id;
      const key = `${clinicianId}\u0000${row.serviceDate}`;
      const current = attendedByClinicianDate.get(key) ?? {
        clinicianId,
        date: row.serviceDate,
        rows: [],
        visits: 0,
      };
      current.rows.push(row);
      attendedByClinicianDate.set(key, current);
    }
  }
  for (const snapshot of snapshots) {
    if (snapshot.kind !== "billing") continue;
    for (const row of snapshot.rows) {
      const matches =
        cliniciansByLabel.get(normalizeLabel(row.clinician)) ?? [];
      if (matches.length === 0) {
        missingBillingClinicianLabels.add(row.clinician);
        continue;
      }
      if (matches.length > 1) {
        ambiguousBillingClinicianLabels.add(row.clinician);
        continue;
      }
      const actual = billingActual(matches[0].id, row);
      const payload = JSON.stringify(actual);
      if (seenBillingPayloads.has(payload)) continue;
      seenBillingPayloads.add(payload);
      const previous = seenBillingRows.get(actual.sourceRowHash);
      if (previous && (previous.clinicianId !== actual.clinicianId || previous.serviceDate !== actual.serviceDate || previous.totalFeeCharged !== actual.totalFeeCharged)) conflictingBillingHashes.add(actual.sourceRowHash);
      seenBillingRows.set(actual.sourceRowHash, actual);
      billingActuals.push(actual);
    }
  }

  const derivedSessions: SessionRecord[] = [];
  let manualOverlapCount = 0;
  let manualImportOverrideCount = 0;
  let manualImportConflictCount = 0;
  const replacedManualIds = new Set<number>();
  const conflictedManualSessions: ImportedSessionOverlay["conflictedManualSessions"] = [];
  const attended = [...attendedByClinicianDate.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.clinicianId - b.clinicianId,
  );
  let rawAttendedRows = 0;
  let collapsedDuplicateShowRows = 0;
  let sameDayVisitOverrideCount = 0;
  for (const rows of sameDayShowGroups.values()) {
    const key = sameDayVisitKey(rows[0]);
    const override = sameDayVisitOverrides[key];
    const visits =
      Number.isInteger(override) && override >= 1
        ? Math.min(override, rows.length)
        : 1;
    rawAttendedRows += rows.length;
    collapsedDuplicateShowRows += rows.length - visits;
    if (override !== undefined) sameDayVisitOverrideCount++;
    const first = rows[0];
    const matches =
      cliniciansByLabel.get(normalizeLabel(first.clinician)) ?? [];
    if (matches.length === 1) {
      const grouped = attendedByClinicianDate.get(
        `${matches[0].id}\u0000${first.serviceDate}`,
      );
      if (grouped) grouped.visits += visits;
    }
  }
  for (const record of context.sessions) {
    const coverage = scopedAttendanceCoverage.filter(range => range.clinicianId === record.clinicianId);
    const overlappingVisits = attended.filter(item => item.clinicianId === record.clinicianId &&
      rangesOverlap(record, { start: item.date, end: item.date }));
    if (!overlappingVisits.length && !rangeCoveredAtAll(coverage, record.start, record.end)) continue;
    manualOverlapCount++;
    replacedManualIds.add(record.id);
    if (rangeFullyCovered(coverage, record.start, record.end)) {
      manualImportOverrideCount += record.completed;
    } else {
      conflictedManualSessions.push({ ...record, status: "unknown" });
    }
  }
  manualImportConflictCount = attended.filter(item => conflictedManualSessions.some(record =>
    record.clinicianId === item.clinicianId && rangesOverlap(record, { start: item.date, end: item.date })
  )).reduce((sum, item) => sum + item.visits, 0);
  for (const item of attended) {
    const completed = item.visits;
    if (!completed) continue;
    derivedSessions.push({
      id: dateId(item.clinicianId, item.date, derivedSessions.length),
      clinicianId: item.clinicianId,
      start: item.date,
      end: item.date,
      completed,
      desired: completed,
      cancelled: null,
      noShow: null,
      scheduled: null,
      inPerson: null,
      telehealth: null,
      sourceAttachmentId: null,
      revision: 1,
      updatedAt: new Date(`${item.date}T12:00:00Z`).toISOString(),
    });
  }

  const retainedManual = context.sessions.filter((record) => !replacedManualIds.has(record.id));
  const coveredZeroSessions: SessionRecord[] = [];
  const knownDates = new Set(derivedSessions.map((record) => `${record.clinicianId}|${record.start}`));
  for (const range of scopedAttendanceCoverage) {
    for (let date = range.start; date <= range.end; date = new Date(Date.parse(date + "T12:00:00Z") + 86400000).toISOString().slice(0, 10)) {
      const key = `${range.clinicianId}|${date}`;
      if (knownDates.has(key) || retainedManual.some((record) => record.clinicianId === range.clinicianId && record.start <= date && record.end >= date)) continue;
      knownDates.add(key);
      coveredZeroSessions.push({
        id: dateId(range.clinicianId, date, 0), clinicianId: range.clinicianId, start: date, end: date,
        completed: 0, desired: 0, cancelled: null, noShow: null, scheduled: null, inPerson: null,
        telehealth: null, sourceAttachmentId: null, revision: 1, updatedAt: `${date}T12:00:00.000Z`,
      });
    }
  }
  return {
    context: {
      ...context,
      sessions: [
        ...retainedManual,
        ...derivedSessions,
        ...coveredZeroSessions,
      ],
      importedBillingActuals: [
        ...(context.importedBillingActuals ?? []),
        ...billingActuals,
      ],
    },
    derivedSessions,
    attendanceCoverage: scopedAttendanceCoverage,
    coveredZeroSessions,
    conflictedManualSessions,
    attendanceObservedSpans,
    importedBillingActuals: billingActuals,
    diagnostic: {
      missingClinicianLabels: [...missingClinicianLabels].sort(),
      ambiguousClinicianLabels: [...ambiguousClinicianLabels].sort(),
      manualOverlapCount,
      manualImportOverrideCount,
      manualImportConflictCount,
      attendedRows: attended.reduce((sum, item) => sum + item.rows.length, 0),
      derivedRecords: derivedSessions.length,
      excludedNonShowRows,
      missingBillingClinicianLabels: [...missingBillingClinicianLabels].sort(),
      ambiguousBillingClinicianLabels: [
        ...ambiguousBillingClinicianLabels,
      ].sort(),
      billedRows: billingActuals.length,
      billedFees: conflictingBillingHashes.size || billingActuals.some((row) => !Number.isFinite(row.totalFeeCharged)) ? null : billingActuals.reduce(
        (sum, row) => sum + row.totalFeeCharged,
        0,
      ),
      billingConflictCount: conflictingBillingHashes.size,
      rawAttendedRows,
      collapsedDuplicateShowRows,
      sameDayVisitOverrideCount,
    },
  };
}

function billingActual(
  clinicianId: number,
  row: BillingRow,
): ImportedBillingActual {
  return {
    clinicianId,
    serviceDate: row.serviceDate,
    totalFeeCharged: row.totalFeeCharged,
    sourceRowHash: row.sourceRowHash,
  };
}
