import type { LinkedFundGoal } from "./legacy-practice-goals.ts";

export function completedFundGoalStatus(goal: LinkedFundGoal | undefined, completedPeriodEnd: string | null) {
  if (!goal || goal.amount <= 0) return { met: false, message: "No fund target entered." };
  if (!completedPeriodEnd) return { met: false, message: "Waiting for a completed biweekly review." };
  if (goal.currentBalance === null || !goal.balanceDate || goal.balanceDate > completedPeriodEnd)
    return { met: false, message: "A recorded balance dated on or before the completed review is required." };
  const met = goal.currentBalance >= goal.amount;
  return { met, message: met ? `Met at completed review ending ${completedPeriodEnd}; the goal remains active.` : "Recorded balance remains below the fund target." };
}
