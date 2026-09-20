import { randomUUID } from "node:crypto";

const base = process.env.EMC_TEST_API_URL;
if (!base || !["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error(
    "Only an explicitly selected local test API can receive sample data.",
  );
async function call(path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
const existing = await call("/clinicians");
if (existing.some((clinician) => clinician.goalId == null))
  throw new Error(
    "Unassigned clinicians already exist. Sample seeding will not overwrite them.",
  );
const end = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Indiana/Indianapolis",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const start = new Date(Date.parse(end + "T12:00:00Z") - 13 * 86400000)
  .toISOString()
  .slice(0, 10);
const samples = [
  ["Alex Morgan", 56, 70],
  ["Jordan Lee", 52, 70],
  ["Sam Rivera", 48, 60],
  ["Casey Taylor", 44, 60],
  ["Riley Chen", 40, 60],
];
for (const [label, completed, desired] of samples) {
  const clinician = await call("/clinicians", {
    label,
    roleType: "associate",
    classification: "w2",
    sessionRate: 125,
    sessionsPerWeek: desired / 2,
    notes: "Fictional local development record.",
  });
  await call("/session-records", {
    requestId: randomUUID(),
    expectedRevision: null,
    entry: {
      clinicianId: clinician.id,
      start,
      end,
      completed,
      desired,
      cancelled: 2,
      noShow: 0,
    },
  });
}
console.log(
  "Created five fictional clinicians and their session records in the isolated local database.",
);
