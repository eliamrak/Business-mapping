import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reconcileBillingEvidence } from "../lib/practice/src/hub/billing-evidence.ts";
const sql = readFileSync(new URL("./practice-fee-case-diagnostic.sql", import.meta.url), "utf8").replace(/^\s*--.*$/gm, "");

test("fee case SQL is one bounded scope-guarded SELECT without writes or client/hash output", () => {
  assert.equal(sql.split(";").filter((part) => part.trim()).length, 1);
  assert.match(sql.trim(), /^WITH RECURSIVE /);
  assert.doesNotMatch(sql, /\b(insert|update|delete|create|alter|drop|truncate|copy|commit|call|set_config|dblink|pg_sleep)\b/i);
  assert.match(sql, /count\(\*\) FROM active_scopes\) = 1/);
  assert.match(sql, /LIMIT 20001/);
  assert.match(sql, /count\(\*\) FROM bounded_reach\) <= 20000/);
  assert.match(sql, /count\(\*\) FROM flagged\) <= 50/);
  assert.match(sql, /<= 10000/);
  assert.match(sql, /bounds\.safe AND typed\.safe/);
  const output = sql.slice(sql.lastIndexOf("\nSELECT CASE"));
  assert.doesNotMatch(output, /client_key|clientId|client_id|encounter_key|row_hash\b|source_hash|sourceRowHash|package_id|s\.id\b/);
  assert.match(output, /CASE WHEN safety\.safe THEN coalesce/);
});

test("source counters overlap, and identical repeated-source encounters differ from repeated hashes within one source", () => {
  const row = (hash, fee = 100, clientId = "synthetic-secret") => ({ clientId, clinician: "Synthetic Professional", serviceDate: "2026-01-05", billingCode: "90837", totalFeeCharged: fee, sourceRowHash: hash });
  const duplicate = reconcileBillingEvidence([{ row: row("a"), snapshotId: "source1" }, { row: row("b"), snapshotId: "source2" }])[0];
  assert.equal(duplicate.known, true);
  const ambiguous = reconcileBillingEvidence([{ row: row("a"), snapshotId: "source1" }, { row: row("b"), snapshotId: "source1" }])[0];
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(ambiguous.conflicting, false);
  const both = reconcileBillingEvidence([{ row: row("a"), snapshotId: "source1" }, { row: row("b", 125), snapshotId: "source1" }])[0];
  assert.equal(both.ambiguous, true);
  assert.equal(both.conflicting, true);
  assert.equal(both.hashConflict, false);
});

test("hash linkage is transitive across encounters; diagnostic SQL models connected components", () => {
  const rows = [
    { clientId: "secretA", clinician: "Synthetic A", serviceDate: "2026-01-01", billingCode: "90837", totalFeeCharged: 100, sourceRowHash: "same-hash" },
    { clientId: "secretB", clinician: "Synthetic B", serviceDate: "2026-01-02", billingCode: "90837", totalFeeCharged: 100, sourceRowHash: "same-hash" },
    { clientId: "secretB", clinician: "Synthetic B", serviceDate: "2026-01-02", billingCode: "90837", totalFeeCharged: 125, sourceRowHash: "other-hash" },
  ];
  const groups = reconcileBillingEvidence(rows.map((row, i) => ({ row, snapshotId: `source${i % 2}` })));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].conflicting, true);
  assert.equal(groups[0].hashConflict, true);
  assert.match(sql, /SELECT node, encounter_anchor AS other/);
  assert.match(sql, /UNION SELECT node, hash_anchor/);
  assert.match(sql, /UNION SELECT r\.node, e\.other FROM reach r JOIN edges e ON e\.node = r\.member/);
});
