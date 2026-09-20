import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./seed";
import { db } from "@workspace/db";
import { staffMembersTable } from "@workspace/db";
import { isNull } from "drizzle-orm";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { authRouter, requireAccess } from "./lib/auth";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({origin: process.env.APP_ORIGIN || false, credentials:true}));
app.use(express.json({limit:"15mb"}));
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", authRouter);
app.use("/api", requireAccess, router);

if (process.env.NODE_ENV !== "production" && process.env.SEED_DEMO_DATA === "true") {
  seedIfEmpty().catch((err) => logger.error({ err }, "Failed to seed demo data"));
}

// Warn if any staff records with no goalId remain after previous cleanup
async function warnOrphanedStaff() {
  try {
    const orphans = await db
      .select({ id: staffMembersTable.id })
      .from(staffMembersTable)
      .where(isNull(staffMembersTable.goalId));
    if (orphans.length > 0) {
      logger.warn(
        { count: orphans.length, ids: orphans.map((r) => r.id) },
        "Orphaned staff records detected: staff_members rows exist with no goalId. Run `pnpm --filter @workspace/scripts cleanup-orphaned-staff` to clean them up."
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to check for orphaned staff records");
  }
}

warnOrphanedStaff();

export default app;
