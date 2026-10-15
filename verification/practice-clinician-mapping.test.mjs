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

const lineage = readFileSync(new URL("./practice-identity-lineage-diagnostic.sql", import.meta.url), "utf8").replace(/^\s*--.*$/gm, "");
test("lineage diagnostic is one guarded read-only statement without person/client output", () => {
  assert.equal(lineage.split(";").filter((part) => part.trim()).length, 1);
  assert.match(lineage.trim(), /^WITH /);
  assert.doesNotMatch(lineage, /\b(insert|update|delete|create|alter|drop|truncate|copy|commit|call|set_config|dblink)\b/i);
  assert.doesNotMatch(lineage, /clientId|client_id|share_token|source_hash|sourceHash/);
  assert.match(lineage, /count\(\*\) FROM active_scopes\) = 1/);
  assert.match(lineage, /DIAGNOSTIC_ONLY_NO_MAPPING_OR_COVERAGE_AUTHORIZATION/);
  const output = lineage.slice(lineage.lastIndexOf("\nSELECT "));
  assert.doesNotMatch(output, /\bname_key\b|\blabel\b|\bclinician_id\b|\bsource_clinician_id\s*AS\b/i);
});
test("lineage diagnostic distinguishes main roster configuration copies from scenario links", () => {
  assert.match(lineage, /c\.goal_id IS NOT DISTINCT FROM t\.team_id AS selected_team/);
  assert.match(lineage, /teamSelectionExplicit/);
  assert.match(lineage, /unique_selected_team_but_globally_ambiguous_requires_confirmation/);
  assert.match(lineage, /ambiguous_within_selected_team/);
  assert.match(lineage, /LEFT JOIN roster r ON r\.id = sc\.source_clinician_id/);
  assert.match(lineage, /known_identity_column_presence/);
});
