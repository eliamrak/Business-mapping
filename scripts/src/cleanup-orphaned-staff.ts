import { db } from "@workspace/db";
import { staffMembersTable, businessGoalsTable } from "@workspace/db";
import { isNull, eq } from "drizzle-orm";

async function main() {
  const orphans = await db
    .select()
    .from(staffMembersTable)
    .where(isNull(staffMembersTable.goalId));

  if (orphans.length === 0) {
    console.log("No orphaned staff records found. Nothing to do.");
    return;
  }

  console.log(`Found ${orphans.length} orphaned staff record(s) with no goalId.`);

  const goals = await db.select({ id: businessGoalsTable.id }).from(businessGoalsTable);

  if (goals.length === 1) {
    const goalId = goals[0].id;
    const orphanIds = orphans.map((r) => r.id);

    for (const id of orphanIds) {
      await db
        .update(staffMembersTable)
        .set({ goalId, updatedAt: new Date() })
        .where(eq(staffMembersTable.id, id));
    }

    console.log(
      `Reassigned ${orphanIds.length} orphaned staff record(s) to the only existing goal (id=${goalId}).`
    );
  } else {
    const orphanIds = orphans.map((r) => r.id);

    for (const id of orphanIds) {
      await db.delete(staffMembersTable).where(eq(staffMembersTable.id, id));
    }

    console.log(
      `Deleted ${orphanIds.length} orphaned staff record(s) (multiple goals exist; cannot safely reassign).`
    );
  }

  const remaining = await db
    .select()
    .from(staffMembersTable)
    .where(isNull(staffMembersTable.goalId));

  if (remaining.length > 0) {
    console.warn(
      `WARNING: ${remaining.length} staff record(s) still have no goalId after cleanup.`
    );
    process.exit(1);
  } else {
    console.log("Cleanup complete. No orphaned staff records remain.");
  }
}

main().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
