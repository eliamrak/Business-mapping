import {
  randomBytes,
  scryptSync,
  randomUUID,
} from "node:crypto";
import { Router, type RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, hubUsersTable } from "@workspace/db";
import { z } from "@workspace/practice";

const hash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
};

export const authRouter = Router();
authRouter.get("/auth/status", (_req, res) =>
  res.json({ localPreview: false, configured: true, provider: "clerk" }),
);

export const requireAccess: RequestHandler = async (req, res, next) => {
  if (
    req.path === "/healthz" ||
    (req.method === "GET" && /^\/clinicians\/by-token\/[^/]+$/.test(req.path))
  )
    return next();

  const auth = getAuth(req);
  if (!auth.isAuthenticated || !auth.userId)
    return res
      .status(401)
      .json({ error: "Sign in to continue.", code: "SIGN_IN_REQUIRED" });

  const claims = auth.sessionClaims as Record<string, unknown> | null;
  const email =
    typeof claims?.email === "string" ? claims.email.toLowerCase() : null;
  const ownerEmail = process.env.EMC_OWNER_EMAIL?.trim().toLowerCase();
  let role = "owner";
  let actor = email ?? auth.userId;
  if (!email || email !== ownerEmail) {
    const [user] = await db
      .select()
      .from(hubUsersTable)
      .where(eq(hubUsersTable.email, email ?? ""));
    if (!user || user.disabled)
      return res.status(403).json({
        error: "This Google account has not been invited to the dashboard.",
        code: "INVITATION_REQUIRED",
      });
    role = user.role;
    actor = user.email;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.get("origin"),
      allowed = process.env.APP_ORIGIN;
    if (allowed && (!origin || origin !== allowed))
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
