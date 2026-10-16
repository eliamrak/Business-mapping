import { dateRangeSchema, type SessionRecord, rangesOverlap } from "@workspace/practice";
import { canonicalServicePeriod, reconcileBillingEvidence, resolveImportedProvider, bindBillingResolutions, type ImportEvidenceDeclarations, type Context, type ImportedBillingActual } from "@workspace/practice/hub";
import type { SessionAttendanceCoverage } from "./session-trend.ts";
import {
  consultAttendanceClassifier,
  attendanceStatusConflicts,
  isPhoneConsultBillingRow,
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
  attendanceStatusConflictCount: number;
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
    declarations?: ImportEvidenceDeclarations | null;
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
    cliniciansByLabel.set(key, [...new Map(context.clinicians
      .filter((person) => normalizeLabel(person.label) === key)
      .map((person) => [person.id, person])).values()]);
  }
  for (const mapping of options.declarations?.mappings ?? []) {
    const id = resolveImportedProvider(mapping.sourceLabel, context.clinicians, teamId, options.declarations);
    cliniciansByLabel.set(normalizeLabel(mapping.sourceLabel), id === null ? [] : clinicians.filter((person) => person.id === id));
  }

  const missingClinicianLabels = new Set<string>();
  const statusConflicts = attendanceStatusConflicts(snapshots);
  const conflictedRows = new Set(statusConflicts.flatMap((group) => group.rows));
  const ambiguousClinicianLabels = new Set<string>();
  const missingBillingClinicianLabels = new Set<string>();
  const ambiguousBillingClinicianLabels = new Set<string>();
  const seenAttendanceRows = new Set<string>();
  const billingEntries: { row: BillingRow; snapshotId: string }[] = [];
  const scopedAttendanceCoverage: SessionAttendanceCoverage[] = [];
  const attendanceObservedSpans: ImportedAttendanceObservedSpan[] = [];
  const attendedByClinicianDate = new Map<
    string,
    { clinicianId: number; date: string; rows: AttendanceRow[]; visits: number }
  >();
  const sameDayShowGroups = new Map<string, AttendanceRow[]>();
  const billingActuals: ImportedBillingActual[] = [];
  let excludedNonShowRows = 0;
  const isConsultation = consultAttendanceClassifier(snapshots);

  for (const snapshot of snapshots) {
    if (snapshot.kind !== "attendance") continue;
    const mappedIds = new Set([...snapshot.rows.map((row) => row.clinician), ...(snapshot.reportCoverage?.complete ? snapshot.coverageClinicians ?? [] : [])].flatMap((label) => {
      const matches = cliniciansByLabel.get(normalizeLabel(label)) ?? [];
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
      if (conflictedRows.has(row)) continue;
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
      if (isConsultation(row)) continue;
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
  for (const conflict of statusConflicts) {
    const matches = cliniciansByLabel.get(normalizeLabel(conflict.clinician)) ?? [];
    if (matches.length !== 1 || !dateRangeSchema.safeParse({ start: conflict.serviceDate, end: conflict.serviceDate }).success) continue;
    const period = canonicalServicePeriod(conflict.serviceDate);
    const retained = scopedAttendanceCoverage.flatMap((range) => range.clinicianId !== matches[0].id || range.end < period.start || range.start > period.end ? [range] : [
      ...(range.start < period.start ? [{ ...range, end: new Date(Date.parse(period.start + "T12:00:00Z") - 86400000).toISOString().slice(0, 10) }] : []),
      ...(range.end > period.end ? [{ ...range, start: new Date(Date.parse(period.end + "T12:00:00Z") + 86400000).toISOString().slice(0, 10) }] : []),
    ]);
    scopedAttendanceCoverage.splice(0, scopedAttendanceCoverage.length, ...retained);
  }
  for (const snapshot of snapshots) {
    if (snapshot.kind !== "billing") continue;
    for (const row of snapshot.rows) {
      billingEntries.push({ row, snapshotId: snapshot.sourceSnapshotId ?? snapshot.id });
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
    }
  }
  const resolutions = bindBillingResolutions(options.declarations?.billingResolutions ?? [], context.clinicians, options.declarations);
  const billingGroups = reconcileBillingEvidence(billingEntries, resolutions).filter((group) => group.rows.some((row) => cliniciansByLabel.get(normalizeLabel(row.clinician))?.length === 1));
  for (const group of billingGroups) {
    const payloads = new Set<string>();
    for (const row of group.known ? group.acceptedRows ?? [group.row] : group.rows) {
      const matches = cliniciansByLabel.get(normalizeLabel(row.clinician));
      if (matches?.length !== 1) continue;
      const payload = JSON.stringify(row);
      if (payloads.has(payload)) continue;
      payloads.add(payload);
      const clinicianId = matches[0].id;
      billingActuals.push({
        ...billingActual(clinicianId, row),
        sourceSnapshotId: billingEntries.find((entry) => entry.row === row)!.snapshotId,
        ...(!group.known ? { evidenceUnknown: true } : {}),
      });
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
  for (const actual of billingActuals) {
    if (actual.evidenceUnknown || isPhoneConsultBillingRow({ billingCode: actual.billingCode ?? null, visitKind: actual.visitKind })) continue;
    const day = attendedByClinicianDate.get(`${actual.clinicianId}\u0000${actual.serviceDate}`);
    const covered = scopedAttendanceCoverage.some((range) => range.clinicianId === actual.clinicianId && range.start <= actual.serviceDate && range.end >= actual.serviceDate);
    const charged = billingActuals.filter((row) => row.clinicianId === actual.clinicianId && row.serviceDate === actual.serviceDate && !isPhoneConsultBillingRow({ billingCode: row.billingCode ?? null, visitKind: row.visitKind }));
    const clients = new Set(day?.rows.map((row) => row.clientId.trim()));
    const billedClients = new Set(charged.map((row) => row.clientId!.trim()));
    if (covered && day && day.visits > 0 && charged.every((row) => !row.evidenceUnknown && /^\d{5}$/.test(row.billingCode?.trim() ?? "")) && clients.size === billedClients.size && [...clients].every((client) => billedClients.has(client)))
      actual.replacementSessionCount = day.visits;
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
      ...(resolutions.length ? { billingChargeResolutions: resolutions } : {}),
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
      billedFees: billingGroups.some((group) => !group.known) ? null : billingGroups.reduce(
        (sum, group) => sum + (group.acceptedRows ?? [group.row]).reduce((n, row) => n + row.totalFeeCharged, 0),
        0,
      ),
      billingConflictCount: billingGroups.filter((group) => !group.known).length,
      rawAttendedRows,
      collapsedDuplicateShowRows,
      sameDayVisitOverrideCount,
      attendanceStatusConflictCount: statusConflicts.filter((group) => cliniciansByLabel.has(normalizeLabel(group.clinician))).length,
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
    clientId: row.clientId,
    billingCode: row.billingCode,
    visitKind: row.visitKind,
  };
}
