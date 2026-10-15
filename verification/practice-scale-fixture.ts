import { emptyWorkspace, type Context, type ImportDeclarations } from "../lib/practice/src/hub/index.ts";
import type { AttendanceRow, BillingRow, LocalSnapshot } from "../artifacts/comp-dashboard/src/lib/retention-local.ts";

/** Invented records matching production volume only. Never a production seed. */
export function practiceScaleFixture(options: { distinctClients?: boolean } = {}) {
  const start = "2025-07-01", end = "2026-10-12", asOf = "2026-10-15";
  const date = (i: number, days = 469) => new Date(Date.parse(start + "T00:00:00Z") + (Math.floor(i / 6) % days) * 86400000).toISOString().slice(0, 10);
  const person = { id: 1, label: "Synthetic provider 1", goalId: 1, classification: "1099", sessionRate: 100, sessionsPerWeek: 20,
    weeksWorkedPerYear: 48, capEnabled: false, capAmount: 0, preCapClinicianSplit: 60, preCapPracticeSplit: 40,
    postCapClinicianSplit: 80, postCapPracticeSplit: 20, w2EmployerFicaPct: 0, futaSutaPct: 0, workersCompPct: 0, otherEmployerBurdenPct: 0 };
  const clinicians = Array.from({ length: 36 }, (_, i) => ({ ...person, id: i + 1, label: `Synthetic provider ${i % 6 + 1}`, goalId: Math.floor(i / 6) + 1 }));
  const client = (i: number) => `synthetic-client-${options.distinctClients ? i : Math.floor(i / 6) % 120}`;
  const attendance: AttendanceRow[] = Array.from({ length: 4300 }, (_, i) => ({ clientId: client(i),
    clinician: `Synthetic provider ${i % 6 + 1}`, serviceDate: date(i), location: "Synthetic room", status: "show", sourceRowHash: `synthetic-attendance-${i}` }));
  const billing: BillingRow[] = Array.from({ length: 3293 }, (_, i) => ({ clientId: client(i),
    clinician: `Synthetic provider ${i % 6 + 1}`, serviceDate: date(i, 467), billingCode: i < 276 ? "PHONE" : "90837", totalFeeCharged: i < 276 ? 0 : 75, sourceRowHash: `synthetic-billing-${i}` }));
  const snapshots: LocalSnapshot[] = [];
  for (const [kind, rows] of [["attendance", attendance], ["billing", billing]] as const) for (const half of [0, 1]) {
    const selected = rows.filter((_, i) => i % 2 === half);
    const dates = selected.map((row) => row.serviceDate).sort();
    const sourceHash = String(snapshots.length + 1).repeat(16);
    snapshots.push({ id: `${kind}-${sourceHash}`, kind, sourceHash, importedAt: asOf + "T00:00:00Z", coverageStart: dates[0], coverageEnd: dates.at(-1)!, rows: selected } as LocalSnapshot);
  }
  const workspace = emptyWorkspace("2026-10-01");
  Object.assign(workspace.settings, { teamId: 1, teamSelectionExplicit: true, defaultInPersonPct: 0, organicClientsPerMonth: 0, horizonMonths: 12 });
  const sessions = Array.from({ length: 107 }, (_, i) => {
    const day = Math.floor(i / 6) * 14;
    const start = new Date(Date.parse("2026-01-01T00:00:00Z") + day * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.parse(start + "T00:00:00Z") + 13 * 86400000).toISOString().slice(0, 10);
    return { id: i + 1, clinicianId: i % 6 + 1, start, end, completed: 10 + i % 7, desired: 20,
      cancelled: null, noShow: null, scheduled: null, inPerson: null, telehealth: null, sourceAttachmentId: null,
      revision: 1, updatedAt: asOf + "T00:00:00Z" };
  });
  const context: Context = { clinicians, staff: [], sessions };
  const declarations: ImportDeclarations = { version: 1,
    mappings: clinicians.slice(0, 6).map((row) => ({ sourceLabel: row.label, clinicianLabel: row.label, clinicianId: row.id, teamId: 1 })),
    sourceSets: (["attendance", "billing"] as const).map((kind) => ({ kind, start, end: kind === "attendance" ? end : "2026-10-10", complete: true,
      snapshotIds: snapshots.filter((row) => row.kind === kind).map((row) => row.id), clinicianIds: [1, 2, 3, 4, 5, 6] })) };
  return { workspace, context, snapshots, declarations, asOf, start, end };
}
