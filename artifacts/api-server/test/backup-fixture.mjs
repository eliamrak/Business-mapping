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

export function syntheticStaleImportBackup(...args) {
  const fixture = syntheticImportBackup(...args);
  const original = fixture.practice_import_snapshots.find((row) => row.kind === "billing" && row.active === 1);
  original.active = 0;
  const replacementPackage = { ...structuredClone(fixture.practice_import_packages[0]),
    id: uuid(3), package_id: "synthetic-replacement-package", content_hash: "d".repeat(64) };
  fixture.practice_import_packages.push(replacementPackage);
  fixture.practice_import_snapshots.push({ ...structuredClone(original), id: uuid(13),
    package_import_id: replacementPackage.id, source_hash: "d".repeat(64), active: 1,
    rows: original.rows.map((row) => ({ ...row, totalFeeCharged: row.totalFeeCharged + 10,
      sourceRowHash: `replacement-${row.sourceRowHash}` })) });
  return fixture;
}

export function syntheticHistoricalFactsBackup(...args) {
  const fixture = syntheticImportBackup(...args);
  const label = "(deleted) Synthetic Former Clinician";
  const billing = fixture.practice_import_snapshots.find((row) => row.kind === "billing" && row.active === 1);
  const attendance = fixture.practice_import_snapshots.find((row) => row.kind === "attendance");
  const fifth = fixture.practice_import_audit[4].detail.resolution;
  const originalLabel = fifth.clinicianLabel;
  fifth.clinicianLabel = label;
  fixture.practice_import_audit.at(-1).detail.providers[0].sourceLabel = label;
  for (const snapshot of fixture.practice_import_snapshots)
    for (const row of snapshot.rows) if (row.clinician === originalLabel) row.clinician = label;
  const codes = ["", null, "0", "unclassified", "   "];
  billing.rows.push(...codes.map((billingCode, index) => ({ clientId: `synthetic-adjustment-${index}`,
    clinician: label, serviceDate: "2026-10-03", billingCode, totalFeeCharged: -(index + 1) * 5,
    sourceRowHash: `synthetic-signed-adjustment-${index}` })));
  billing.row_count = billing.rows.length;
  attendance.rows.push({ clientId: "synthetic-historical-cancellation", clinician: label,
    serviceDate: "2026-10-03", location: null, status: "cancelled", cancellationSubtype: "late_cancelled",
    billingCode: "", sourceRowHash: "synthetic-historical-cancellation" });
  attendance.row_count = attendance.rows.length;
  return fixture;
}

// Each mutation starts from a valid backup; never loosen runtime schemas to admit it.
export const invalidImportBackupCases = [
  ["declarations mappings are a string", (tables) => { tables.practice_import_declarations[0].data.mappings = "broken"; }],
  ["declarations include an unsupported approval field", (tables) => { tables.practice_import_declarations[0].data.billingResolutions = []; }],
  ["declarations have a nonpositive revision", (tables) => { tables.practice_import_declarations[0].revision = 0; }],
  ["declarations repeat their composite key", (tables) => { tables.practice_import_declarations.push(structuredClone(tables.practice_import_declarations[0])); }],
  ["billing journal has a revision gap", (tables) => { tables.practice_import_audit.splice(1, 1); }],
  ["billing journal repeats a revision", (tables) => { tables.practice_import_audit[1].detail.revision = 1; }],
  ["billing journal repeats a resolution ID", (tables) => { tables.practice_import_audit[1].detail.resolution.id = tables.practice_import_audit[0].detail.resolution.id; }],
  ["billing journal repeats an approval token", (tables) => { tables.practice_import_audit[1].detail.resolution.approvalToken = tables.practice_import_audit[0].detail.resolution.approvalToken; }],
  ["billing journal has malformed detail", (tables) => { tables.practice_import_audit[0].detail = "broken"; }],
  ["billing resolution has only one charge", (tables) => { tables.practice_import_audit[0].detail.resolution.charges.pop(); }],
  ["historical journal has malformed providers", (tables) => { tables.practice_import_audit.at(-1).detail.providers = "broken"; }],
  ["historical journal exceeds the declaration revision", (tables) => { tables.practice_import_audit.at(-1).detail.declarationRevision = 3; }],
  ["historical journal repeats a registry revision", (tables) => {
    const row = structuredClone(tables.practice_import_audit.at(-1)); row.id = uuid(31); tables.practice_import_audit.push(row);
  }],
  ["historical journal repurposes a provider UUID", (tables) => {
    const row = structuredClone(tables.practice_import_audit.at(-1)); row.id = uuid(31);
    row.detail.declarationRevision = 1; row.detail.providers[0].sourceLabel = "Different Synthetic Former";
    tables.practice_import_audit.push(row);
  }],
  ["snapshot rows are a string", (tables) => { tables.practice_import_snapshots[0].rows = "broken"; }],
  ["snapshot row count disagrees with rows", (tables) => { tables.practice_import_snapshots[0].row_count++; }],
  ["attendance row has an invalid status", (tables) => { tables.practice_import_snapshots[0].rows[0].status = "unknown"; }],
  ["attendance row has an impossible service date", (tables) => { tables.practice_import_snapshots[0].rows[0].serviceDate = "2026-02-30"; }],
  ["billing row has a string fee", (tables) => { tables.practice_import_snapshots[1].rows[0].totalFeeCharged = "broken"; }],
  ["billing row has an object fee", (tables) => { tables.practice_import_snapshots[1].rows[0].totalFeeCharged = { amount: 100 }; }],
  ["billing row has an object code", (tables) => { tables.practice_import_snapshots[1].rows[0].billingCode = { code: "90837" }; }],
  ["snapshot proof is incomplete", (tables) => { tables.practice_import_snapshots[0].report_coverage.complete = false; }],
  ["archived snapshot rows are malformed", (tables) => { tables.practice_import_snapshots[2].rows = [null]; }],
  ["same-day override key is not 16 hex digits", (tables) => { tables.practice_import_packages[0].same_day_visit_overrides = { "synthetic-override": 2 }; }],
  ["same-day override is out of range", (tables) => { const settings = tables.practice_import_packages[0].same_day_visit_overrides; settings[Object.keys(settings)[0]] = 21; }],
  ["billing minutes are not numeric", (tables) => { tables.practice_import_packages[0].billing_code_minutes = { "90837": "broken" }; }],
  ["billing minutes exceed the supported range", (tables) => { tables.practice_import_packages[0].billing_code_minutes = { "90837": 1441 }; }],
  ["snapshot references a missing package", (tables) => { tables.practice_import_snapshots[0].package_import_id = uuid(99); }],
  ["snapshot and package practice scopes disagree", (tables) => { tables.practice_import_snapshots[0].practice_id = "different-synthetic-practice"; }],
  ["snapshot and package account scopes disagree", (tables) => { tables.practice_import_snapshots[0].account_id = "different-synthetic-account"; }],
  ["journal scope changes break revision continuity", (tables) => { tables.practice_import_audit[0].account_id = "different-synthetic-account"; }],
  ["packages repeat their primary key", (tables) => { tables.practice_import_packages.push(structuredClone(tables.practice_import_packages[0])); }],
  ["packages repeat their scoped package identity", (tables) => {
    const row = structuredClone(tables.practice_import_packages[0]); row.id = uuid(99); tables.practice_import_packages.push(row);
  }],
  ["snapshots repeat their primary key", (tables) => { tables.practice_import_snapshots.push(structuredClone(tables.practice_import_snapshots[0])); }],
  ["audit rows repeat their primary key", (tables) => { tables.practice_import_audit[1].id = tables.practice_import_audit[0].id; }],
  ["snapshot service date exceeds its stored range", (tables) => { tables.practice_import_snapshots[0].rows[0].serviceDate = "2026-10-06"; }],
  ["report proof excludes its snapshot range", (tables) => { tables.practice_import_snapshots[0].report_coverage.start = "2026-10-02"; }],
  ["archived package settings are malformed", (tables) => { tables.practice_import_packages[1].billing_code_minutes = "broken"; }],
  ["declarations outside the configured reader scope are malformed", (tables) => {
    const row = structuredClone(tables.practice_import_declarations[0]); row.practice_id = "synthetic-historical-other";
    row.account_id = "synthetic-historical-other"; row.data.mappings = "broken"; tables.practice_import_declarations.push(row);
  }],
];
