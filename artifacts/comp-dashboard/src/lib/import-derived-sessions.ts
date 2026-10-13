import { type SessionRecord, rangesOverlap } from "@workspace/practice";
import type { Context, ImportedBillingActual } from "@workspace/practice/hub";
import type { AttendanceRow, BillingRow, LocalSnapshot } from "./retention-local";

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
  billedFees: number;
};

export type ImportedSessionOverlay = {
  context: Context;
  derivedSessions: SessionRecord[];
  importedBillingActuals: ImportedBillingActual[];
  diagnostic: ImportedSessionDiagnostic;
};

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
) => ranges.some((range) => range.start <= start && range.end >= end);

const rangeCoveredAtAll = (
  ranges: Array<{ start: string; end: string }>,
  start: string,
  end: string,
) => ranges.some((range) => range.start <= end && range.end >= start);

export function buildImportedSessionOverlay(
  context: Context,
  snapshots: LocalSnapshot[],
  teamId: number | null,
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
  const seenBillingRows = new Set<string>();
  const attendanceCoverage: Array<{ start: string; end: string }> = [];
  const attendedByClinicianDate = new Map<
    string,
    { clinicianId: number; date: string; rows: AttendanceRow[] }
  >();
  const billingActuals: ImportedBillingActual[] = [];
  let excludedNonShowRows = 0;

  for (const snapshot of snapshots) {
    if (snapshot.kind !== "attendance") continue;
    attendanceCoverage.push({
      start: snapshot.coverageStart,
      end: snapshot.coverageEnd,
    });
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
      if (row.status !== "show") {
        excludedNonShowRows++;
        continue;
      }
      const clinicianId = matches[0].id;
      const key = `${clinicianId}\u0000${row.serviceDate}`;
      const current = attendedByClinicianDate.get(key) ?? {
        clinicianId,
        date: row.serviceDate,
        rows: [],
      };
      current.rows.push(row);
      attendedByClinicianDate.set(key, current);
    }
  }
  for (const snapshot of snapshots) {
    if (snapshot.kind !== "billing") continue;
    for (const row of snapshot.rows) {
      if (seenBillingRows.has(row.sourceRowHash)) continue;
      seenBillingRows.add(row.sourceRowHash);
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
      billingActuals.push(billingActual(matches[0].id, row));
    }
  }

  const derivedSessions: SessionRecord[] = [];
  let manualOverlapCount = 0;
  let manualImportOverrideCount = 0;
  let manualImportConflictCount = 0;
  const replacedManualIds = new Set<number>();
  const attended = [...attendedByClinicianDate.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.clinicianId - b.clinicianId,
  );
  for (const item of attended) {
    const overlappingManual = context.sessions.filter(
      (record) =>
        record.clinicianId === item.clinicianId &&
        rangesOverlap(record, { start: item.date, end: item.date }),
    );
    if (overlappingManual.length) {
      const fullyCovered = overlappingManual.every((record) =>
        rangeFullyCovered(attendanceCoverage, record.start, record.end),
      );
      const coveredAtAll = overlappingManual.every((record) =>
        rangeCoveredAtAll(attendanceCoverage, record.start, record.end),
      );
      if (coveredAtAll) {
        for (const record of overlappingManual) {
          if (!replacedManualIds.has(record.id)) {
            manualImportOverrideCount += record.completed;
            if (!fullyCovered) manualImportConflictCount += item.rows.length;
          }
          replacedManualIds.add(record.id);
        }
      } else {
        manualImportConflictCount += item.rows.length;
        continue;
      }
    }
    const completed = item.rows.length;
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

  return {
    context: {
      ...context,
      sessions: [
        ...context.sessions.filter((record) => !replacedManualIds.has(record.id)),
        ...derivedSessions,
      ],
      importedBillingActuals: [
        ...(context.importedBillingActuals ?? []),
        ...billingActuals,
      ],
    },
    derivedSessions,
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
      billedFees: billingActuals.reduce(
        (sum, row) => sum + row.totalFeeCharged,
        0,
      ),
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
