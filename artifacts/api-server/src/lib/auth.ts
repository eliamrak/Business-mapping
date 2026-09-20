import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { Router, type RequestHandler } from "express";
import { eq, and, gt } from "drizzle-orm";
import { db, hubUsersTable, hubAuthSessionsTable } from "@workspace/db";
import { z } from "@workspace/practice";

export const localPreview =
  process.env.NODE_ENV !== "production" &&
  process.env.HOST === "127.0.0.1" &&
  process.env.LOCAL_PREVIEW === "true";
const configured = () =>
  !!(process.env.EMC_OWNER_EMAIL && process.env.EMC_OWNER_PASSWORD_HASH);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const hash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
};
const verify = (password: string, encoded: string) => {
  try {
    const [salt, value] = encoded.split(":");
    if (!salt || !value || value.length !== 128) return false;
    const actual = scryptSync(password, salt, 64),
      expected = Buffer.from(value, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
};
const tokenFrom = (cookie: string | undefined) =>
  cookie?.match(/(?:^|;\s*)emc_session=([a-f0-9]{64})(?:;|$)/)?.[1];
const attempts = new Map<string, { count: number; since: number }>();
export const authRouter = Router();
authRouter.get("/auth/status", (_req, res) =>
  res.json({ localPreview, configured: configured() }),
);
authRouter.post("/auth/login", async (req, res) => {
  if (!configured())
    return res
      .status(503)
      .json({ error: "Owner authentication has not been configured." });
  const input = z
    .object({ email: z.email().max(320), password: z.string().min(1).max(256) })
    .safeParse(req.body);
  if (!input.success)
    return res.status(400).json({ error: "Enter an email and password." });
  const key = req.ip ?? "unknown",
    now = Date.now(),
    attempt = attempts.get(key);
  if (attempt && now - attempt.since < 900000 && attempt.count >= 10)
    return res
      .status(429)
      .json({ error: "Too many attempts. Try again in 15 minutes." });
  attempts.set(key, {
    since: attempt && now - attempt.since < 900000 ? attempt.since : now,
    count: attempt && now - attempt.since < 900000 ? attempt.count + 1 : 1,
  });
  if (attempts.size > 10000)
    for (const [ip, item] of attempts)
      if (now - item.since > 900000) attempts.delete(ip);
  const email = input.data.email.toLowerCase();
  let userId = "owner",
    encoded = process.env.EMC_OWNER_PASSWORD_HASH!;
  if (email !== process.env.EMC_OWNER_EMAIL?.toLowerCase()) {
    const [user] = await db
      .select()
      .from(hubUsersTable)
      .where(eq(hubUsersTable.email, email));
    if (!user || user.disabled)
      return res.status(401).json({ error: "Email or password is incorrect." });
    userId = user.id;
    encoded = user.passwordHash;
  }
  if (!verify(input.data.password, encoded))
    return res.status(401).json({ error: "Email or password is incorrect." });
  attempts.delete(key);
  const token = randomBytes(32).toString("hex");
  await db.insert(hubAuthSessionsTable).values({
    tokenHash: digest(token),
    userId,
    expiresAt: new Date(now + 12 * 3600000),
  });
  res.cookie("emc_session", token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 12 * 3600000,
    path: "/",
  });
  return res.json({ ok: true });
});
authRouter.post("/auth/logout", async (req, res) => {
  const token = tokenFrom(req.headers.cookie);
  if (token)
    await db
      .delete(hubAuthSessionsTable)
      .where(eq(hubAuthSessionsTable.tokenHash, digest(token)));
  res.clearCookie("emc_session", { path: "/" });
  return res.json({ ok: true });
});

export const requireAccess: RequestHandler = async (req, res, next) => {
  if (
    req.path === "/healthz" ||
    (req.method === "GET" && /^\/clinicians\/by-token\/[^/]+$/.test(req.path))
  )
    return next();
  if (localPreview) {
    res.locals.actor = "Local preview owner";
    res.locals.role = "owner";
    return next();
  }
  if (!configured())
    return res.status(503).json({
      error:
        "Owner authentication must be configured before this app can be used.",
      code: "AUTH_SETUP_REQUIRED",
    });
  const token = tokenFrom(req.headers.cookie);
  if (!token)
    return res
      .status(401)
      .json({ error: "Sign in to continue.", code: "SIGN_IN_REQUIRED" });
  const [session] = await db
    .select()
    .from(hubAuthSessionsTable)
    .where(
      and(
        eq(hubAuthSessionsTable.tokenHash, digest(token)),
        gt(hubAuthSessionsTable.expiresAt, new Date()),
      ),
    );
  if (!session)
    return res
      .status(401)
      .json({ error: "Your session expired. Sign in again." });
  let role = "owner",
    actor = process.env.EMC_OWNER_EMAIL!;
  if (session.userId !== "owner") {
    const [user] = await db
      .select()
      .from(hubUsersTable)
      .where(eq(hubUsersTable.id, session.userId));
    if (!user || user.disabled)
      return res.status(401).json({ error: "Access is disabled." });
    role = user.role;
    actor = user.email;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin"),
      allowed = process.env.APP_ORIGIN;
    if (!origin || !allowed || origin !== allowed)
      return res.status(403).json({
        error: "This request must come from the configured app origin.",
      });
  }
  res.locals.actor = actor;
  res.locals.role = role;
  if (
    role !== "owner" &&
    req.path !== "/auth/me" &&
    !/^\/(session-records|hub\/entry)(\/|$)/.test(req.path)
  )
    return res.status(403).json({
      error: "Owner access is required for financial and planning data.",
    });
  return next();
};
authRouter.get("/auth/me", requireAccess, (_req, res) =>
  res.json({ actor: res.locals.actor, role: res.locals.role }),
);
authRouter.get("/auth/users", requireAccess, async (_req, res) => {
  if (res.locals.role !== "owner") return res.sendStatus(403);
  return res.json(
    await db
      .select({
        id: hubUsersTable.id,
        email: hubUsersTable.email,
        name: hubUsersTable.name,
        role: hubUsersTable.role,
        disabled: hubUsersTable.disabled,
      })
      .from(hubUsersTable),
  );
});
authRouter.post("/auth/users", requireAccess, async (req, res) => {
  if (res.locals.role !== "owner") return res.sendStatus(403);
  const parsed = z
    .object({
      email: z.email(),
      name: z.string().trim().min(1).max(100),
      password: z.string().min(12).max(256),
      role: z.enum(["owner", "data_entry"]),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({
      error:
        "Use a valid email, name, role and password of at least 12 characters.",
    });
  try {
    await db.insert(hubUsersTable).values({
      id: randomUUID(),
      email: parsed.data.email.toLowerCase(),
      name: parsed.data.name,
      role: parsed.data.role,
      passwordHash: hash(parsed.data.password),
    });
    return res.status(201).json({ ok: true });
  } catch {
    return res
      .status(409)
      .json({ error: "That email already has an account." });
  }
});
authRouter.patch("/auth/users/:id", requireAccess, async (req, res) => {
  if (res.locals.role !== "owner") return res.sendStatus(403);
  const parsed = z.object({ disabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success || !z.uuid().safeParse(req.params.id).success)
    return res.status(400).json({ error: "Invalid account update." });
  const [user] = await db
    .update(hubUsersTable)
    .set({ disabled: parsed.data.disabled ? 1 : 0 })
    .where(eq(hubUsersTable.id, String(req.params.id)))
    .returning({ id: hubUsersTable.id });
  return user ? res.json(user) : res.sendStatus(404);
});
