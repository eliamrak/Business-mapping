type ServiceRow = { billingCode?: string | null; visitKind?: string | null };
export const legacyServiceCodes = {
  "1": { kind: "treatment", minutes: 75 },
  "2": { kind: "documentation", minutes: 0 },
  "4": { kind: "treatment", minutes: 30 },
  "30001": { kind: "treatment", minutes: 60 },
  "30002": { kind: "treatment", minutes: 90 },
  "30003": { kind: "consultation", minutes: 25 },
} as const;
export const normalizedServiceCode = (code?: string | null) => code?.trim().toLowerCase() ?? "";
export function legacyServiceDefinition(code?: string | null) {
  const key = normalizedServiceCode(code);
  return Object.hasOwn(legacyServiceCodes, key) ? legacyServiceCodes[key as keyof typeof legacyServiceCodes] : undefined;
}
export const isDocumentationService = (row: ServiceRow) => legacyServiceDefinition(row.billingCode)?.kind === "documentation";
export function isConsultationService(row: ServiceRow) {
  const known = legacyServiceDefinition(row.billingCode);
  return known ? known.kind === "consultation" : normalizedServiceCode(row.billingCode) === "phone" || row.visitKind === "consultation";
}
export const isFreePhoneService = (row: ServiceRow) => normalizedServiceCode(row.billingCode) === "phone" || (!legacyServiceDefinition(row.billingCode) && row.visitKind === "consultation");
export const isTreatmentService = (row: ServiceRow) => !isDocumentationService(row) && !isConsultationService(row);
export const isRecognizedTreatmentCode = (code?: string | null) => legacyServiceDefinition(code)?.kind === "treatment" || /^\d{5}$/.test(code?.trim() ?? "") && isTreatmentService({ billingCode: code });
