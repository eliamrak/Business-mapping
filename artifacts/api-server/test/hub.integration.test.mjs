import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, scryptSync } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import {
  emptyWorkspace,
  categorySchema,
  periodSchema,
  transactionSchema,
  campaignSchema,
  proposalSchema,
  eventSchema,
  clinicianSettingSchema,
} from "../../../lib/practice/src/hub/index.ts";
const require = createRequire(new URL("../package.json", import.meta.url));
const { Client } = createRequire(
  new URL("../../../lib/db/package.json", import.meta.url),
)("pg");
const ExcelJS = require("exceljs");
const source = process.env.EMC_TEST_DATABASE_URL;
if (!source || !["127.0.0.1", "localhost"].includes(new URL(source).hostname))
  throw new Error(
    "Set EMC_TEST_DATABASE_URL to the local schema-source database. This suite creates its own disposable test database.",
  );
let admin,
  child,
  base,
  cookie,
  entryCookie,
  state,
  clinician,
  period,
  category,
  campaign,
  testDatabaseUrl,
  log = "";
const databaseName = `emc_hub_test_${Date.now()}_${process.pid}`;
const ownerEmail = "owner@example.test",
  password = randomBytes(24).toString("hex"),
  entryPassword = randomBytes(24).toString("hex");
async function call(
  path,
  body,
  method = body ? "POST" : "GET",
  auth = cookie,
  origin = base,
) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(auth ? { cookie: auth } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}
async function save(data = state.data, extra = {}) {
  const result = await call("/hub", {
    requestId: randomUUID(),
    expectedRevision: state.revision,
    action: "Integration update",
    data,
    ...extra,
  });
  if (result.status === 200) state = result.data;
  return result;
}
before(async () => {
  const adminUrl = new URL(source);
  adminUrl.pathname = "/postgres";
  admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName}`);
  const url = new URL(source);
  url.pathname = `/${databaseName}`;
  testDatabaseUrl = url.toString();
  const schema = execFileSync(
    "pg_dump",
    ["--schema-only", "--no-owner", "--no-privileges", source],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1"], {
    input: schema,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const port = await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const p = server.address().port;
      server.close(() => resolve(p));
    });
  });
  base = `http://127.0.0.1:${port}`;
  const salt = randomBytes(16).toString("hex"),
    encoded = salt + ":" + scryptSync(password, salt, 64).toString("hex");
  child = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], {
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      NODE_ENV: "development",
      HOST: "127.0.0.1",
      PORT: String(port),
      LOCAL_PREVIEW: "false",
      SEED_DEMO_DATA: "false",
      EMC_OWNER_EMAIL: ownerEmail,
      EMC_OWNER_PASSWORD_HASH: encoded,
      APP_ORIGIN: base,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => (log += data));
  child.stderr.on("data", (data) => (log += data));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await call("/healthz")).status === 200) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw new Error(log);
  }
  assert.equal((await call("/hub", undefined, "GET", null)).status, 401);
  const login = await call("/auth/login", { email: ownerEmail, password });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
  state = (await call("/hub")).data;
  assert.equal(state.revision, 0);
  clinician = (
    await call("/clinicians", {
      label: "123",
      sessionRate: 150,
      classification: "1099",
    })
  ).data;
  category = categorySchema.parse({
    id: randomUUID(),
    name: "Office",
    kind: "facility",
  });
  period = periodSchema.parse({
    id: randomUUID(),
    name: "First period",
    start: "2026-09-01",
    end: "2026-09-14",
  });
  campaign = campaignSchema.parse({
    id: randomUUID(),
    name: "Search",
    source: "Google",
    method: "cpl",
    start: "2026-09-01",
    monthlySpend: 1000,
  });
  const data = emptyWorkspace("2026-09-01");
  data.categories = [category];
  data.periods = [period];
  data.campaigns = [campaign];
  assert.equal((await save(data)).status, 200);
});
after(async () => {
  if (child && child.exitCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await exited;
  }
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await admin.end();
  }
});
test("workspace saves are idempotent, revision-guarded and preserve numeric-looking names", async () => {
  const context = await call("/hub/context");
  assert.equal(context.data.clinicians[0].label, "123");
  assert.equal(context.data.clinicians[0].classification, "1099");
  const requestId = randomUUID(),
    expectedRevision = state.revision,
    data = structuredClone(state.data);
  data.settings.practiceName = "Saved workspace";
  const first = await save(data, { requestId, expectedRevision });
  assert.equal(first.status, 200);
  const retry = await call("/hub", {
    requestId,
    expectedRevision,
    action: "Integration update",
    data,
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.revision, first.data.revision);
  assert.equal(
    (await save(state.data, { expectedRevision: expectedRevision })).status,
    409,
  );
  assert.equal((await save({ ...state.data, categories: [] })).status, 409);
});
test("finalization and corrections retain history and require a new explicit reason", async () => {
  let data = structuredClone(state.data);
  data.periods[0].status = "finalized";
  assert.equal((await save(data)).status, 400);
  data.periods[0].revenue = 1000;
  data.periods[0].earnedRevenue = 1200;
  data.periods[0].expensesComplete = true;
  assert.equal((await save(data)).status, 200);
  data = structuredClone(state.data);
  data.transactions.push(
    transactionSchema.parse({
      id: randomUUID(),
      periodId: period.id,
      categoryId: category.id,
      date: period.start,
      description: "Rent correction",
      amount: 200,
    }),
  );
  assert.equal((await save(data)).status, 409);
  data.periods[0].correctionReason =
    "Add omitted rent expense from the reviewed source.";
  assert.equal((await save(data)).status, 200);
  const history = await call("/hub/history");
  assert.ok(history.data.length >= 4);
  assert.equal(history.data[0].actor, ownerEmail);
});
test("proposal approval is reviewed, atomic, repeat-safe and retains its baseline", async () => {
  const event = eventSchema.parse({
    id: randomUUID(),
    name: "Google increase",
    date: "2026-11-01",
    field: "marketing.spend",
    targetId: campaign.id,
    value: 2000,
  });
  const proposal = proposalSchema.parse({
    id: randomUUID(),
    name: "Pilot",
    changes: [event],
  });
  const data = structuredClone(state.data);
  data.proposals.push(proposal);
  assert.equal((await save(data)).status, 200);
  const body = {
    requestId: randomUUID(),
    expectedRevision: state.revision,
    changeIds: [event.id],
  };
  const approved = await call(`/hub/proposals/${proposal.id}/approve`, body);
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  state = approved.data;
  assert.equal(state.data.events.length, 1);
  assert.ok(state.data.proposals[0].baseline.after.length);
  const repeat = await call(`/hub/proposals/${proposal.id}/approve`, body);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.revision, state.revision);
  assert.equal(
    (
      await call(`/hub/proposals/${proposal.id}/approve`, {
        ...body,
        requestId: randomUUID(),
        expectedRevision: state.revision,
      })
    ).status,
    409,
  );
});
test("CSV and XLSX attachments retain bytes and produce bounded review previews", async () => {
  const data = structuredClone(state.data);
  data.periods.push(
    periodSchema.parse({
      id: randomUUID(),
      name: "Open period",
      start: "2026-09-15",
      end: "2026-09-28",
    }),
  );
  assert.equal((await save(data)).status, 200);
  const p = state.data.periods.at(-1);
  const upload = async (name, bytes) => {
    const id = randomUUID();
    const res = await call("/hub/attachments", {
      id,
      periodId: p.id,
      name,
      data: Buffer.from(bytes).toString("base64"),
    });
    assert.equal(res.status, 201);
    return id;
  };
  const csv = await upload(
    "budget.csv",
    'name,amount\n"Software, admin",125.50\n',
  );
  const preview = await call(`/hub/attachments/${csv}/preview`);
  assert.equal(preview.data.sheets[0].rows[1][0], "Software, admin");
  const duplicate = await call("/hub/attachments", {
    id: randomUUID(),
    periodId: p.id,
    name: "renamed.csv",
    data: Buffer.from('name,amount\n"Software, admin",125.50\n').toString(
      "base64",
    ),
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.id, csv);
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Budget").addRows([
    ["name", "amount"],
    ["Rent", 1200],
  ]);
  const xlsx = await upload("budget.xlsx", await workbook.xlsx.writeBuffer());
  assert.equal(
    (await call(`/hub/attachments/${xlsx}/preview`)).data.sheets[0].rows[1][1],
    "1200",
  );
  const backup = await call("/hub/export");
  assert.equal(backup.data.attachments.length, 2);
  assert.equal(backup.data.format, "emc-hub-v1");
  assert.deepEqual(backup.data.data, state.data);
  const exported = await call("/hub/export-csv", {
    rows: [{ name: "=1+2", amount: 5 }],
  });
  assert.ok(exported.data.includes("'=1+2"));
});
test("owner-only boundaries and the restricted data-entry workflow are enforced server-side", async () => {
  assert.equal(
    (
      await call("/auth/users", {
        email: "entry@example.test",
        name: "Test entry",
        password: entryPassword,
        role: "data_entry",
      })
    ).status,
    201,
  );
  const login = await call("/auth/login", {
    email: "entry@example.test",
    password: entryPassword,
  });
  entryCookie = login.headers.get("set-cookie").split(";")[0];
  for (const path of [
    "/hub",
    "/hub/context",
    "/hub/export",
    "/clinicians",
    "/staff",
    "/business-goals",
    "/auth/users",
  ])
    assert.equal(
      (await call(path, undefined, "GET", entryCookie)).status,
      403,
      path,
    );
  const info = await call("/hub/entry", undefined, "GET", entryCookie);
  assert.equal(info.status, 200);
  assert.equal(info.data.settings, undefined);
  assert.equal(info.data.clinicians[0].sessionRate, undefined);
  assert.equal(
    (await call("/session-records?goalId=999", undefined, "GET", entryCookie))
      .status,
    403,
  );
  const p = info.data.periods[0],
    entry = {
      clinicianId: clinician.id,
      start: p.start,
      end: p.end,
      completed: 20,
      desired: 30,
      cancelled: 1,
      noShow: 0,
      scheduled: 25,
      inPerson: 12,
      telehealth: 8,
    };
  assert.equal(
    (
      await call(
        "/session-records",
        { requestId: randomUUID(), expectedRevision: null, entry },
        "POST",
        entryCookie,
      )
    ).status,
    200,
  );
  const savedSessions = await call(
    "/session-records?goalId=unassigned",
    undefined,
    "GET",
    entryCookie,
  );
  assert.equal(savedSessions.status, 200);
  assert.equal(savedSessions.data[0].scheduled, 25);
  const sessionHistory = await call(
    `/session-records/${savedSessions.data[0].id}/history`,
    undefined,
    "GET",
    entryCookie,
  );
  assert.equal(sessionHistory.status, 200);
  assert.ok(sessionHistory.data[0].actor.includes("entry@example.test"));
  assert.equal(
    (
      await call(
        "/session-records",
        {
          requestId: randomUUID(),
          expectedRevision: null,
          entry: { ...entry, start: period.start, end: period.end },
        },
        "POST",
        entryCookie,
      )
    ).status,
    403,
  );
  const funnel = {
    id: randomUUID(),
    periodId: p.id,
    campaignId: campaign.id,
    spend: 500,
    leads: 20,
    scheduled: 10,
    attended: 8,
    clients: 5,
    firstSessions: 4,
  };
  assert.equal(
    (
      await call(
        "/hub/entry/funnel",
        {
          requestId: randomUUID(),
          expectedRevision: info.data.revision,
          entry: funnel,
        },
        "POST",
        entryCookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(
        "/hub",
        {
          requestId: randomUUID(),
          expectedRevision: state.revision,
          action: "Bad origin",
          data: state.data,
        },
        "POST",
        cookie,
        "https://untrusted.example",
      )
    ).status,
    403,
  );
  state = (await call("/hub")).data;
});
test("legacy clinician sharing, copying, staff salary/hourly mode and scenario workflows remain functional", async () => {
  const link = await call(`/clinicians/${clinician.id}/generate-link`, {});
  const token = link.data.shareToken;
  assert.equal(
    (await call(`/clinicians/by-token/${token}`, undefined, "GET", null))
      .status,
    200,
  );
  assert.equal(
    (await call(`/clinicians/${clinician.id}/revoke-link`, {})).status,
    200,
  );
  assert.equal(
    (await call(`/clinicians/by-token/${token}`, undefined, "GET", null))
      .status,
    404,
  );
  const copy = await call(`/clinicians/${clinician.id}/duplicate`, {});
  assert.equal(copy.status, 201);
  assert.equal(copy.data.shareToken, null);
  const goal = await call("/business-goals", { name: "Legacy test" });
  assert.equal(goal.status, 201);
  const moved = await call("/clinicians/copy-to-goal", {
    ids: [clinician.id],
    toGoalId: goal.data.id,
  });
  assert.equal(moved.status, 201);
  assert.equal(moved.data[0].goalId, goal.data.id);
  const staff = await call("/staff", {
    label: "Admin",
    annualSalary: 52000,
    goalId: goal.data.id,
  });
  assert.equal(staff.status, 201);
  const hourly = await call(
    `/staff/${staff.data.id}`,
    { annualSalary: null, hourlyRate: 25, hoursPerWeek: 20 },
    "PATCH",
  );
  assert.equal(hourly.status, 200);
  assert.equal(hourly.data.annualSalary, null);
  assert.equal(hourly.data.hourlyRate, 25);
  const scenario = await call("/scenarios", {
    name: "Legacy scenario",
    businessGoalId: goal.data.id,
  });
  assert.equal(scenario.status, 201);
  assert.equal(
    (
      await call(`/scenarios/${scenario.data.id}/clinicians`, {
        label: "Scenario clinician",
        sessionRate: 160,
      })
    ).status,
    201,
  );
  const duplicated = await call(`/scenarios/${scenario.data.id}/duplicate`, {});
  assert.equal(duplicated.status, 201);
  assert.equal(duplicated.data.clinicians[0].sessionRate, 160);
  assert.equal(
    (await call(`/scenarios/${duplicated.data.id}`, undefined, "DELETE"))
      .status,
    204,
  );
});

test("clinicians referenced by the connected plan cannot be deleted", async () => {
  const person = (
    await call("/clinicians", {
      label: "Protected plan clinician",
      sessionRate: 100,
    })
  ).data;
  const data = structuredClone(state.data);
  data.clinicians.push(
    clinicianSettingSchema.parse({
      id: randomUUID(),
      clinicianId: person.id,
      start: "2026-09-01",
      desiredWeeklySessions: 20,
    }),
  );
  assert.equal((await save(data)).status, 200);
  assert.equal(
    (await call(`/clinicians/${person.id}`, undefined, "DELETE")).status,
    409,
  );
  const invalid = structuredClone(state.data);
  invalid.clinicians.push(
    clinicianSettingSchema.parse({
      id: randomUUID(),
      clinicianId: 2147483647,
      start: "2026-09-01",
      desiredWeeklySessions: 10,
    }),
  );
  assert.equal((await save(invalid)).status, 409);
});
test("imported sessions retain their source attachment through later corrections", async () => {
  const p = state.data.periods.find((p) => p.status !== "finalized"),
    file = (await call("/hub/attachments")).data[0];
  const person = (
    await call("/clinicians", { label: "Import test", sessionRate: 100 })
  ).data;
  const entry = {
    clinicianId: person.id,
    start: p.start,
    end: p.end,
    completed: 10,
    desired: 20,
    cancelled: null,
    noShow: null,
    sourceAttachmentId: file.id,
  };
  const created = await call("/session-records", {
    requestId: randomUUID(),
    expectedRevision: null,
    entry,
  });
  assert.equal(created.status, 200);
  assert.equal(created.data.sourceAttachmentId, file.id);
  const corrected = await call("/session-records", {
    requestId: randomUUID(),
    expectedRevision: 1,
    entry: { ...entry, completed: 11, sourceAttachmentId: null },
  });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.data.sourceAttachmentId, file.id);
  const invalid = await call("/session-records", {
    requestId: randomUUID(),
    expectedRevision: 2,
    entry: { ...entry, sourceAttachmentId: randomUUID() },
  });
  assert.equal(invalid.status, 400);
});
test("full database backup restores hub, attachments, audit, sessions and legacy records", async () => {
  const restoreName = databaseName + "_restore",
    restoreUrl = new URL(testDatabaseUrl);
  restoreUrl.pathname = "/" + restoreName;
  const dump = execFileSync(
    "pg_dump",
    ["--no-owner", "--no-privileges", testDatabaseUrl],
    { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 },
  );
  await admin.query(`CREATE DATABASE ${restoreName}`);
  const original = new Client({ connectionString: testDatabaseUrl }),
    restored = new Client({ connectionString: restoreUrl.toString() });
  try {
    execFileSync("psql", [restoreUrl.toString(), "-v", "ON_ERROR_STOP=1"], {
      input: dump,
      stdio: ["pipe", "pipe", "pipe"],
    });
    await original.connect();
    await restored.connect();
    for (const table of [
      "hub_workspaces",
      "hub_history",
      "hub_attachments",
      "clinicians",
      "staff_members",
      "scenarios",
      "session_records",
      "session_record_history",
    ]) {
      const sql = `SELECT * FROM ${table} ORDER BY id`;
      assert.deepEqual(
        (await restored.query(sql)).rows,
        (await original.query(sql)).rows,
        table,
      );
    }
  } finally {
    await original.end();
    await restored.end();
    await admin.query(`DROP DATABASE ${restoreName} WITH (FORCE)`);
  }
});

test("business-data backup excludes access credentials and refuses nonempty restoration", async () => {
  const backup = await call("/hub/backup");
  assert.equal(backup.status, 200);
  assert.equal(backup.data.format, "emc-business-data-v1");
  assert.ok(backup.data.tables.clinicians.length);
  assert.ok(backup.data.tables.session_record_history.length);
  assert.equal(backup.data.tables.hub_users, undefined);
  assert.equal(backup.data.tables.hub_auth_sessions, undefined);
  assert.equal(
    (await call("/hub/backup", undefined, "GET", entryCookie)).status,
    403,
  );
  const preview = await call("/hub/backup/preview", backup.data);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.canRestore, false);
  assert.equal(preview.data.token, null);
  assert.equal(
    (
      await call("/hub/backup/preview", {
        ...backup.data,
        schema: "0".repeat(64),
      })
    ).status,
    400,
  );
  const incomplete = structuredClone(backup.data);
  delete incomplete.tables.clinicians;
  assert.equal((await call("/hub/backup/preview", incomplete)).status, 400);
});

test("numbered migrations upgrade a legacy-only database and can be inspected safely on repeat", async () => {
  const name = databaseName + "_legacy";
  const url = new URL(testDatabaseUrl);
  url.pathname = "/" + name;
  await admin.query(`CREATE DATABASE ${name}`);
  const connection = new Client({ connectionString: url.toString() });
  try {
    const dump = execFileSync(
      "pg_dump",
      [
        "--no-owner",
        "--no-privileges",
        "--exclude-table=hub_*",
        "--exclude-table=session_*",
        testDatabaseUrl,
      ],
      { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 },
    );
    execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1"], {
      input: dump,
      stdio: ["pipe", "pipe", "pipe"],
    });
    await connection.connect();
    const before = (
      await connection.query("SELECT * FROM clinicians ORDER BY id")
    ).rows;
    const env = {
      ...process.env,
      DATABASE_URL: url.toString(),
      EMC_DATABASE_BACKUP_VERIFIED: "true",
    };
    const inspection = execFileSync(
      process.execPath,
      ["scripts/migrate-hub.mjs"],
      { env, encoding: "utf8" },
    );
    assert.match(inspection, /001_session_records/);
    execFileSync(process.execPath, ["scripts/migrate-hub.mjs", "--apply"], {
      env,
      stdio: "pipe",
    });
    const repeated = execFileSync(
      process.execPath,
      ["scripts/migrate-hub.mjs"],
      { env, encoding: "utf8" },
    );
    assert.deepEqual(JSON.parse(repeated).pending, []);
    assert.deepEqual(
      (await connection.query("SELECT * FROM clinicians ORDER BY id")).rows,
      before,
    );
    assert.ok(
      (
        await connection.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='session_records' AND column_name='source_attachment_id'",
        )
      ).rowCount,
    );
  } finally {
    await connection.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
  }
});

test("reviewed business-data recovery restores every application table atomically into a disposable empty app", async () => {
  const original = (await call("/hub/backup")).data;
  const database = new Client({ connectionString: testDatabaseUrl });
  await database.connect();
  const tables = [
    "business_goals",
    "current_reality",
    "clinicians",
    "staff_members",
    "scenarios",
    "scenario_clinicians",
    "scenario_staff_members",
    "hub_workspaces",
    "hub_attachments",
    "session_records",
    "session_record_history",
    "hub_history",
  ];
  try {
    await database.query(
      `TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`,
    );
    const broken = structuredClone(original);
    broken.tables.clinicians[0].goal_id = 2147483647;
    const badPreview = await call("/hub/backup/preview", broken);
    assert.equal(badPreview.data.canRestore, true);
    const badRestore = await call("/hub/backup/restore", {
      token: badPreview.data.token,
      digest: badPreview.data.digest,
      confirmation: "RESTORE EMPTY APP",
    });
    assert.equal(badRestore.status, 409);
    for (const name of tables)
      assert.equal(
        Number(
          (await database.query(`SELECT count(*) AS n FROM ${name}`)).rows[0].n,
        ),
        0,
        name,
      );
    const preview = await call("/hub/backup/preview", original);
    assert.equal(preview.data.canRestore, true);
    assert.equal(
      (
        await call("/hub/backup/restore", {
          token: preview.data.token,
          digest: preview.data.digest,
          confirmation: "",
        })
      ).status,
      400,
    );
    const restored = await call("/hub/backup/restore", {
      token: preview.data.token,
      digest: preview.data.digest,
      confirmation: "RESTORE EMPTY APP",
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.data));
    assert.deepEqual((await call("/hub/backup")).data.tables, original.tables);
    assert.equal(
      (
        await call("/hub/backup/restore", {
          token: preview.data.token,
          digest: preview.data.digest,
          confirmation: "RESTORE EMPTY APP",
        })
      ).status,
      409,
    );
    const created = await call("/clinicians", {
      label: "After recovery",
      sessionRate: 100,
    });
    assert.equal(created.status, 201);
    assert.ok(
      created.data.id >
        Math.max(...original.tables.clinicians.map((c) => c.id)),
    );
  } finally {
    await database.end();
  }
});
