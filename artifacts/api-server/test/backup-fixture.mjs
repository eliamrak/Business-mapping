import { createHash } from "node:crypto";

// Synthetic database-shaped records shared by route and PostgreSQL recovery tests.
export const importBackupTables = [
  "practice_import_packages",
  "practice_import_snapshots",
  "practice_import_declarations",
  "practice_import_audit",
];

const uuid = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const timestamp = "2026-10-17T00:00:00+00:00";

export function syntheticImportBackup(clinicianId = 1, teamId = 1, clinicianLabel = "Synthetic Backup Clinician") {
  const scope = { practice_id: "synthetic-backup", account_id: "synthetic-backup" };
  const historicalLabel = "Synthetic Former Clinician";
  const attendanceHash = "a".repeat(64), billingHash = "b".repeat(64);
  const billingId = `billing-${billingHash}`;
  const historicalProviderId = uuid(90);
  const approvalRows = Array.from({ length: 5 }, (_, index) => {
    const serviceDate = `2026-10-0${index + 1}`;
    const clientId = `synthetic-backup-client-${index}`;
    const label = index === 4 ? historicalLabel : clinicianLabel;
    const charges = [135, 150].map((amount, chargeIndex) => ({ amount,
      anchor: { snapshotId: billingId, sourceRowHash: `synthetic-charge-${index}-${chargeIndex}` } }));
    return { serviceDate, clientId, label, charges };
  });
  const overrideKey = createHash("sha256").update(JSON.stringify([
    "same-day-visit", approvalRows[0].clientId,
    clinicianLabel.toLowerCase().replace(/\s+/g, " ").trim(), approvalRows[0].serviceDate,
  ])).digest("hex").slice(0, 16);
  const packages = [1, 2].map((number) => ({
    id: uuid(number), ...scope, package_id: `synthetic-backup-package-${number}`,
    content_hash: String(number).repeat(64), exported_at: timestamp,
    imported_at: timestamp, imported_by: "synthetic-owner@example.test",
    billing_code_minutes: { "90837": 53 },
    same_day_visit_overrides: number === 1 ? { [overrideKey]: 2 } : {},
    active: number === 1 ? 1 : 0,
  }));
  const coverage = { start: "2026-10-01", end: "2026-10-05", complete: true };
  const snapshots = [
    { id: uuid(10), package_import_id: uuid(1), ...scope, kind: "attendance",
      source_hash: attendanceHash, rows: approvalRows.map((row, index) => ({
        clientId: row.clientId, clinician: row.label, serviceDate: row.serviceDate,
        status: "show", location: "Synthetic Room", sourceRowHash: `synthetic-visit-${index}`,
      })), active: 1 },
    { id: uuid(11), package_import_id: uuid(1), ...scope, kind: "billing",
      source_hash: billingHash, rows: approvalRows.flatMap((row) => row.charges.map((charge) => ({
        clientId: row.clientId, clinician: row.label, serviceDate: row.serviceDate,
        billingCode: "90837", totalFeeCharged: charge.amount, sourceRowHash: charge.anchor.sourceRowHash,
      }))), active: 1 },
    { id: uuid(12), package_import_id: uuid(2), ...scope, kind: "billing",
      source_hash: "c".repeat(64), rows: [{ clientId: "synthetic-archived-client",
        clinician: clinicianLabel, serviceDate: "2026-10-01", billingCode: "90837",
        totalFeeCharged: 100, sourceRowHash: "synthetic-archived-charge" }], active: 0 },
  ];
  snapshots[0].rows.push({ ...snapshots[0].rows[0], sourceRowHash: "synthetic-extra-visit" });
  const storedSnapshots = snapshots.map((row) => ({ ...row, coverage_start: coverage.start, coverage_end: coverage.end,
    report_coverage: coverage, row_count: row.rows.length, created_at: timestamp }));
  const declarations = [{ ...scope, revision: 2, data: { version: 1,
    mappings: [{ sourceLabel: clinicianLabel, clinicianId, clinicianLabel, teamId }],
    sourceSets: [
      { kind: "attendance", snapshotIds: [`attendance-${attendanceHash}`], clinicianIds: [clinicianId], ...coverage },
      { kind: "billing", snapshotIds: [billingId], clinicianIds: [clinicianId], ...coverage },
    ],
  }, confirmed_at: timestamp, confirmed_by: "synthetic-owner@example.test" }];
  const audits = approvalRows.map((row, index) => ({
    id: uuid(20 + index), ...scope, package_id: `billing-resolution:${uuid(40 + index)}`,
    action: "accept-billing-charge-exception", actor: "synthetic-owner@example.test",
    detail: { oldRevision: index, revision: index + 1, rawRowCount: 2,
      basis: "owner-confirmation", affectsAttendance: false,
      resolution: { id: uuid(40 + index), approvalToken: String(index + 1).repeat(64),
        ...(index === 4 ? { historicalProviderId } : { clinicianId }),
        clinicianLabel: row.label, clientId: row.clientId, serviceDate: row.serviceDate,
        billingCode: "90837", visitKind: "", charges: row.charges,
        confirmedAt: "2026-10-17T00:00:00Z", approvalNote: "Synthetic backup approval" },
    }, created_at: timestamp,
  }));
  audits.push({ id: uuid(30), ...scope, package_id: "historical-billing-providers",
    action: "confirm-historical-billing-providers", actor: "synthetic-owner@example.test",
    detail: { version: 1, declarationRevision: 2, providers: [{ id: historicalProviderId,
      sourceLabel: historicalLabel, sourceSets: [{ snapshotIds: [billingId], ...coverage }] }] },
    created_at: timestamp });
  return { practice_import_packages: packages, practice_import_snapshots: storedSnapshots,
    practice_import_declarations: declarations, practice_import_audit: audits };
}
