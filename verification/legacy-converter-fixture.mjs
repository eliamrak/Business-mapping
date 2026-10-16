import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export function legacyConverterFixture(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "legacy-converter-synthetic-"));
  const core = options.corePath ?? fileURLToPath(new URL("../tools/practice-converter/Resources/converter_core.py", import.meta.url));
  const cases = [
    ["1", "Show", 125], ["30001", "Show", 151], ["30002", "Show", 210],
    ["30003", "Show", 60], ["4", "Show", 44], ["2", "Show", 25],
    ["PHONE", "Show", 0], ["90837", "Late Cancelled", 35],
    ["90837", "No Show", 0], ["90837", "Clinician cancelled", 0],
  ];
  const attendance = path.join(dir, "attendance.csv"), billing = path.join(dir, "billing.csv");
  const attendanceRows = ["Client,Client ID,Clinician,Date,Status,Billing Code,Appointment Title"];
  const billingRows = ["Client,Client ID,Clinician,Date,Total Fee,Billing Code,Appointment Title"];
  for (const [index, [code, status, fee]] of cases.entries()) {
    const common = `Synthetic Client ${index},synthetic-${index},Dr Legacy,2026-01-${String(index + 1).padStart(2, "0")}`;
    // PHONE title must not override the confirmed numeric code 4.
    const title = code === "4" || code === "PHONE" ? "Phone" : "Appointment";
    attendanceRows.push(`${common},${status},${code},${title}`);
    billingRows.push(`${common},${fee},${code},${title}`);
  }
  writeFileSync(attendance, attendanceRows.join("\n")); writeFileSync(billing, billingRows.join("\n"));
  const output = path.join(dir, "package.json");
  try {
    execFileSync(options.python ?? "python3", [core, "export", "--attendance", attendance, "--billing", billing, "--state-dir", path.join(dir, "state"), "--approve-new", "--output", output], { stdio: "pipe", env: options.env ?? process.env });
    return JSON.parse(readFileSync(output, "utf8"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
