import { customFetch } from "@workspace/api-client-react";
import type { BillingCodeMinutes, LocalSnapshot } from "@/lib/retention-local";

export type RetentionHistory = {
  snapshots: LocalSnapshot[];
  billingCodeMinutes: BillingCodeMinutes;
};

export type RetentionPackageResult = RetentionHistory & {
  status: "added" | "duplicate" | "replaced";
  warnings: string[];
};

export type RetentionBackupResult = RetentionHistory & {
  status: "restored";
};

export const getRetentionHistory = () =>
  customFetch<RetentionHistory>("/api/local-retention");

export const importRetentionPackage = (
  packageData: unknown,
  replaceOverlaps = false,
) =>
  customFetch<RetentionPackageResult>("/api/local-retention/packages", {
    method: "POST",
    body: JSON.stringify({ package: packageData, replaceOverlaps }),
  });

export const saveRetentionBillingCodeMinutes = (
  billingCodeMinutes: BillingCodeMinutes,
) =>
  customFetch<RetentionHistory>("/api/local-retention/billing-code-minutes", {
    method: "PUT",
    body: JSON.stringify({ billingCodeMinutes }),
  });

export const restoreRetentionBackup = (backup: unknown) =>
  customFetch<RetentionBackupResult>("/api/local-retention/backup", {
    method: "PUT",
    body: JSON.stringify({ backup }),
  });
