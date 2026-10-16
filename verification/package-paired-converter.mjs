import { cpSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { legacyConverterFixture, zeroCodeConverterFixture } from "./legacy-converter-fixture.mjs";
import { importLocalPackage, treatmentAttendanceRows } from "../artifacts/comp-dashboard/src/lib/retention-local.ts";
import { summarizeReportedBilling } from "../artifacts/comp-dashboard/src/lib/reported-billing.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sha = git(["rev-parse", `${process.argv[2] ?? "HEAD"}^{commit}`]);
const converterSha = git(["rev-parse", `${process.argv[3] ?? "HEAD"}^{commit}`]);
git(["diff", "--quiet", sha, "--", "lib/practice/src", "artifacts/api-server/src", "artifacts/comp-dashboard/src", ":(exclude)**/*.test.ts"]);
git(["diff", "--quiet", converterSha, "--", "tools/practice-converter/Resources"]);
const installed = path.join(homedir(), "Applications", "Practice Converter.app");
const hash = file => createHash("sha256").update(readFileSync(file)).digest("hex");
const installedBinary = path.join(installed, "Contents/MacOS/PracticeConverter");
const originalBinaryHash = hash(installedBinary);
assert.equal(originalBinaryHash, "a8ccf4f6b896ff182cbaada93fbbd8d0fabcead78e8e6c7fc8119990c40bada4", "Installed native baseline changed; independent review is required.");
execFileSync("codesign", ["--verify", "--deep", "--strict", installed]);
const dir = mkdtempSync(path.join(tmpdir(), "practice-paired-release-"));
const candidate = path.join(dir, "Practice Converter.app");
cpSync(installed, candidate, { recursive: true, verbatimSymlinks: true });
const core = path.join(candidate, "Contents/Resources/converter_core.py");
copyFileSync(path.join(root, "tools/practice-converter/Resources/converter_core.py"), core);
execFileSync("codesign", ["--force", "--sign", "-", candidate]);
execFileSync("codesign", ["--verify", "--deep", "--strict", candidate]);
const normalizedOriginal = path.join(dir, "original-native-unsigned");
const normalizedCandidate = path.join(dir, "candidate-native-unsigned");
copyFileSync(installedBinary, normalizedOriginal);
copyFileSync(path.join(candidate, "Contents/MacOS/PracticeConverter"), normalizedCandidate);
execFileSync("codesign", ["--remove-signature", normalizedOriginal]);
execFileSync("codesign", ["--remove-signature", normalizedCandidate]);
assert.equal(hash(normalizedOriginal), hash(normalizedCandidate), "Native executable changed beyond its signature.");
unlinkSync(normalizedOriginal); unlinkSync(normalizedCandidate);
const home = path.join(candidate, "Contents/Frameworks/Python3.framework/Versions/3.9");
const payload = legacyConverterFixture({ corePath: core, python: path.join(home, "bin/python3"), env: {
  PATH: "/usr/bin:/bin", HOME: dir, TMPDIR: dir,
  PYTHONHOME: home, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1",
} });
const imported = importLocalPackage(payload);
assert.equal(treatmentAttendanceRows(imported.snapshots).filter(row => row.status === "show").length, 4);
assert.equal(summarizeReportedBilling(imported.snapshots, "2026-10-16").months[0].charges, 650);
assert.deepEqual(payload.collections.billing.rows.map(row => row.billingCode), ["1", "30001", "30002", "30003", "4", "2", "PHONE", "90837", "90837", "90837"]);
assert.equal(payload.collections.attendance.rows[7].cancellationSubtype, "late_cancelled");
const zeroPayload = zeroCodeConverterFixture({ corePath: core, python: path.join(home, "bin/python3"), env: {
  PATH: "/usr/bin:/bin", HOME: dir, TMPDIR: dir,
  PYTHONHOME: home, PYTHONDONTWRITEBYTECODE: "1", PYTHONNOUSERSITE: "1",
} });
assert.deepEqual(zeroPayload.collections.billing.rows.map(row => row.billingCode), ["0", "0", "00000", null, null]);
assert.equal(Object.hasOwn(zeroPayload.billingCodeMinutes, "0"), false);
assert.equal(summarizeReportedBilling(importLocalPackage(zeroPayload).snapshots, "2026-10-16").months[0].charges, 165);
const manifest = {
  readerCommit: sha, readerTree: git(["rev-parse", `${sha}^{tree}`]),
  converterCommit: converterSha,
  packagerSha256: hash(fileURLToPath(import.meta.url)),
  fixtureSha256: hash(path.join(root, "verification/legacy-converter-fixture.mjs")),
  candidate, parserSha256: hash(core),
  nativeBinarySha256: hash(path.join(candidate, "Contents/MacOS/PracticeConverter")),
  originalNativeBinarySha256: originalBinaryHash,
  nativeCodeUnchangedAfterSignatureRemoval: true,
  originalInstalledParserSha256: hash(path.join(installed, "Contents/Resources/converter_core.py")),
  codesign: "deep-strict-pass", bundledPythonRoundtrip: "pass", syntheticBilledFees: 650, treatmentVisits: 4,
  numericZeroRoundtrip: "pass; 0 distinct from 00000; blank/null retained; fees165; no 0 duration assumed",
  installed: false, productionReaderVerified: false,
};
writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
