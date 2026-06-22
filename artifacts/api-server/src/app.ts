import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./seed";
import { db } from "@workspace/db";
import { staffMembersTable } from "@workspace/db";
import { isNull } from "drizzle-orm";

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Seed demo data on startup
seedIfEmpty().catch((err) => logger.error({ err }, "Failed to seed demo data"));

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
