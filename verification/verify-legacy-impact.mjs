import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const { Client } = createRequire(new URL("../lib/db/package.json", import.meta.url))("pg");

export async function verifyLegacyImpact(url) {
  const target = new URL(url);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/isolated_schema");
  const client = new Client({ connectionString: url });
  const sql = readFileSync(new URL("./legacy-code-impact.sql", import.meta.url), "utf8");
  const labels = ["Erin Mrakovich", "Elia Mrakovich", "Natalie Rieke", "Michele Teague", "Jessica Cockrum", "Jessica Yates"];
  await client.connect();
  try {
    const count = await client.query("SELECT (SELECT count(*) FROM business_goals)+(SELECT count(*) FROM clinicians)+(SELECT count(*) FROM practice_import_snapshots)+(SELECT count(*) FROM practice_import_packages)+(SELECT count(*) FROM practice_import_declarations) AS n");
    assert.equal(Number(count.rows[0].n), 0, "Fixture writes require the runner's new empty database.");
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("INSERT INTO business_goals(id,name) VALUES(1,'Synthetic impact-only goal')");
    for (const [index, label] of labels.entries()) await client.query("INSERT INTO clinicians(id,label,goal_id) VALUES($1,$2,1)", [index + 8, label]);
    const mappings = labels.map((label, index) => ({ sourceLabel: index === 0 ? "Private Provider Alias" : label, clinicianId: index + 8, clinicianLabel: label, teamId: 1 }));
    await client.query("INSERT INTO practice_import_declarations(practice_id,account_id,revision,data,confirmed_by) VALUES('synthetic-impact','synthetic-impact',1,$1,'synthetic-owner')", [JSON.stringify({ mappings })]);
    const packageId = randomUUID();
    await client.query("INSERT INTO practice_import_packages(id,practice_id,account_id,package_id,content_hash,exported_at,imported_by) VALUES($1,'synthetic-impact','synthetic-impact','synthetic-impact-package','synthetic-content',now(),'synthetic-owner')", [packageId]);
    const attendance = [], billing = [];
    for (const [index, code] of [0, "0", "00000", "4", "2", "30003", "1", "30001", "30002", "", null, undefined].entries()) {
      const base = { clientId: `private-synthetic-client-${index}`, clinician: "Private Provider Alias", serviceDate: index === 1 || index === 9 ? "2026-01-05" : "2026-01-20", billingCode: code };
      attendance.push({ ...base, status: "show", sourceRowHash: `private-source-hash-a${index}` });
      billing.push({ ...base, totalFeeCharged: (index + 1) * 11, sourceRowHash: `private-source-hash-b${index}` });
    }
    delete attendance[3].billingCode; attendance[3].visitKind = "consultation";
    billing.push({ ...billing[3], billingCode: "2", totalFeeCharged: 5, sourceRowHash: "private-source-hash-linked-doc" });
    billing.push({ ...billing[0] });
    billing.push({ ...billing[0], clinician: "Unmapped Private Provider", clientId: "private-outsider", totalFeeCharged: 9999, sourceRowHash: "private-outside-hash" });
    for (const [kind, rows] of [["attendance", attendance], ["billing", billing]]) await client.query("INSERT INTO practice_import_snapshots(id,package_import_id,practice_id,account_id,kind,coverage_start,coverage_end,source_hash,row_count,rows) VALUES($1,$2,'synthetic-impact','synthetic-impact',$3,'2026-01-01','2026-01-31',$4,$5,$6)", [randomUUID(), packageId, kind, `synthetic-${kind}`, rows.length, JSON.stringify(rows)]);
    const rows = (await client.query(sql)).rows;
    assert.ok(rows.every(row => row.scope_ready));
    const detail = (code, type, kind = "billing") => rows.find(row => row.record_kind === "code-detail" && row.scope_label === "Erin Mrakovich" && row.window_label === "January_15_28" && row.code === code && row.source_code_type === type && row.kind === kind);
    assert.equal(Number(detail("0", "number").raw_rows), 2);
    assert.equal(Number(detail("0", "number").distinct_source_hashes), 1);
    assert.equal(Number(detail("0", "number").raw_fees_not_reconciled), 22);
    assert.equal(detail("0", "number").after_class, "unclassified");
    assert.equal(detail("00000", "string").code, "00000");
    assert.equal(detail("2", "string", "attendance").after_class, "documentation");
    assert.equal(Number(detail("2", "string", "attendance").after_show_candidates), 0);
    assert.equal(detail("30003", "string", "attendance").after_class, "consultation");
    const linked = rows.find(row => row.record_kind === "code-detail" && row.scope_label === "Erin Mrakovich" && row.window_label === "January_15_28" && row.kind === "attendance" && row.before_class === "consultation");
    assert.equal(Number(linked.after_show_candidates), 1);
    assert.equal(rows.filter(row => row.record_kind === "scope-summary" && row.window_label === "January_15_28").length, 8);
    assert.equal(Number(rows.find(row => row.record_kind === "scope-summary" && row.window_label === "January_15_28" && row.scope_label.startsWith("Outside")).raw_fees_not_reconciled), 9999);
    assert.doesNotMatch(JSON.stringify(rows), /private-synthetic-client|Private Provider Alias|Unmapped Private Provider|private-source-hash|private-outsider|synthetic-impact/);
    await client.query("INSERT INTO practice_import_packages(id,practice_id,account_id,package_id,content_hash,exported_at,imported_by) VALUES($1,'second-synthetic-scope','second-synthetic-scope','second-package','synthetic-content',now(),'synthetic-owner')", [randomUUID()]);
    const blocked = (await client.query(sql)).rows;
    assert.equal(blocked.length, 24);
    assert.ok(blocked.every(row => row.scope_ready === false && row.raw_rows === null));
    return { status: "pass", controls: "populated scope/type/date/classification/fee/dedup/privacy and multi-practice fail-closed", writesRolledBack: true };
  } finally { await client.query("ROLLBACK"); await client.end(); }
}
