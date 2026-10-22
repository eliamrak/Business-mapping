export type ImportFeedback = {
  stage: "idle" | "loading" | "loaded" | "validating" | "saving" | "saved" | "duplicate" | "review" | "invalid" | "unconfirmed";
  detail?: string;
};

export function importFeedbackTitle(feedback: ImportFeedback): string {
  return {
    idle: "Ready to upload", loading: "Loading saved history", loaded: "Loaded from saved history",
    validating: "Checking your file", saving: "Saving and reconciling", saved: "Saved to practice storage",
    duplicate: "Already saved", review: "Review needed", invalid: "File not accepted", unconfirmed: "Save not confirmed",
  }[feedback.stage];
}

export function importReceipt(counts: { attendance: number; billing: number }, status: string): string {
  const rows = `Package contains ${counts.attendance.toLocaleString()} attendance rows and ${counts.billing.toLocaleString()} billing rows.`;
  return status === "duplicate"
    ? `${rows} These sources are already saved; no additional rows were added.`
    : `${rows} Server acknowledged the saved history. Package rows are not new-session totals.`;
}

export function importFailureStage(saveStarted: boolean, httpStatus?: number): ImportFeedback["stage"] {
  // A lost response or server failure may occur after the transaction commits.
  return !saveStarted || (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500) ? "invalid" : "unconfirmed";
}
