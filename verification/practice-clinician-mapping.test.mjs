import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("./practice-clinician-mapping-diagnostic.sql", import.meta.url), "utf8").replace(/^\s*--.*$/gm, "");
test("mapping diagnostic is one scope-guarded SELECT with no patient keys or writes", () => {
  const statements = sql.split(";").map((part) => part.trim()).filter(Boolean);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^WITH /);
  assert.match(sql, /count\(\*\) FROM active_scopes\) = 1/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|create|alter|drop|truncate|copy|commit|call|set_config|dblink)\b/i);
  assert.doesNotMatch(sql, /clientId|client_id|sourceHash|source_hash/);
});
test("name normalization and prefix candidates cannot choose an identity or use wildcard labels", () => {
  assert.match(sql, /lower\(btrim\(regexp_replace\(label,/);
  assert.doesNotMatch(sql, /regexp_replace\(btrim\(/);
  assert.doesNotMatch(sql, /\bLIKE\b/i);
  assert.match(sql, /prefix_candidate_not_verified/);
  assert.match(sql, /DIAGNOSTIC_ONLY_NO_ACTIVITY_INFERENCE_OR_AUTOMATIC_CROSSWALK/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM unnest\(ARRAY\[f\.fact ->> 'clinicianId'/);
});
