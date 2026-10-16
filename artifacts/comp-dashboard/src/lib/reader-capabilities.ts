import { z } from "@workspace/practice";
import { legacyServiceCodes } from "@workspace/practice/hub";

const schema = z.object({
  readerProtocol: z.literal("legacy-codes-late-cancellation-v1"),
  packageFormat: z.literal("emc-practice-local-import-package"),
  packageVersion: z.literal(1),
  cancellationSubtypes: z.array(z.literal("late_cancelled")).length(1),
  billingCodeEncoding: z.literal("string-or-null"),
  unclassifiedZero: z.object({ storedCode: z.literal("0"), defaultMinutes: z.null(), equivalentToFiveZeros: z.literal(false) }),
  serviceCodes: z.record(z.string(), z.object({ kind: z.string(), minutes: z.number() })),
});

export function compatibleReaderCapabilities(value: unknown) {
  const parsed = schema.safeParse(value);
  return parsed.success && Object.entries(legacyServiceCodes).every(([code, definition]) =>
    parsed.data.serviceCodes[code]?.kind === definition.kind && parsed.data.serviceCodes[code]?.minutes === definition.minutes);
}
