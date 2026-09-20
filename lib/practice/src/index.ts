import { z } from "zod/v4";
export { z } from "zod/v4";

const DAY = 86_400_000;

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + "T00:00:00Z");
    return (
      Number(value.slice(0, 4)) > 0 &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Enter a valid calendar date.");

export function daysInclusive(start: string, end: string): number {
  return (
    Math.round(
      (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / DAY,
    ) + 1
  );
}

export const dateRangeSchema = z
  .object({ start: dateSchema, end: dateSchema })
  .refine((range) => range.start <= range.end, {
    message: "End date must be on or after the start date.",
    path: ["end"],
  });

const count = z
  .number()
  .int("Use a whole number of sessions.")
  .min(0)
  .max(10000);
export const sessionInputSchema = z
  .object({
    clinicianId: z.number().int().positive().max(2147483647),
    start: dateSchema,
    end: dateSchema,
    completed: count,
    desired: count,
    cancelled: count.nullable(),
    noShow: count.nullable(),
    scheduled: count.nullable().default(null),
    inPerson: count.nullable().default(null),
    telehealth: count.nullable().default(null),
    sourceAttachmentId: z.uuid().nullable().default(null),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.scheduled !== null && input.scheduled < input.completed)
      context.addIssue({
        code: "custom",
        path: ["scheduled"],
        message: "Scheduled sessions cannot be fewer than completed sessions.",
      });
    if (
      input.inPerson !== null &&
      input.telehealth !== null &&
      input.inPerson + input.telehealth !== input.completed
    )
      context.addIssue({
        code: "custom",
        path: ["inPerson"],
        message:
          "In-person plus telehealth must equal completed sessions when both are entered.",
      });
    for (const key of ["inPerson", "telehealth"] as const)
      if (input[key] !== null && input[key] > input.completed)
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Session-type counts cannot exceed completed sessions.",
        });
    if (input.start > input.end)
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "End date must be on or after the start date.",
      });
    if (daysInclusive(input.start, input.end) > 366)
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "A single entry cannot cover more than 366 days.",
      });
  });

export const sessionWriteSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().positive().nullable(),
    entry: sessionInputSchema,
  })
  .strict();

export type SessionInput = z.input<typeof sessionInputSchema>;
export type SessionWrite = z.input<typeof sessionWriteSchema>;
export type SessionRecord = SessionInput & {
  id: number;
  revision: number;
  updatedAt: string;
};
export type SessionHistory = {
  revision: number;
  entry: SessionRecord;
  recordedAt: string;
  actor?: string;
};

export function rangesOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string },
) {
  return a.start <= b.end && b.start <= a.end;
}

export function summarizeSessions(
  records: SessionRecord[],
  range: { start: string; end: string },
) {
  const overlapping = records.filter((record) => rangesOverlap(record, range));
  const included = overlapping.filter(
    (record) => record.start >= range.start && record.end <= range.end,
  );
  const partial = overlapping.filter((record) => !included.includes(record));
  const sum = (key: "completed" | "desired") =>
    included.reduce((total, entry) => total + entry[key], 0);
  const nullableSum = (
    key: "cancelled" | "noShow" | "scheduled" | "inPerson" | "telehealth",
  ) =>
    included.length && included.every((entry) => entry[key] != null)
      ? included.reduce((total, entry) => total + (entry[key] ?? 0), 0)
      : null;
  const completed = included.length ? sum("completed") : null;
  const desired = included.length ? sum("desired") : null;
  const coveredDays = included.reduce(
    (total, entry) => total + daysInclusive(entry.start, entry.end),
    0,
  );
  // No prorating: a partial source period is never presented as an exact actual.
  return {
    included,
    partial,
    completed,
    desired,
    cancelled: nullableSum("cancelled"),
    noShow: nullableSum("noShow"),
    scheduled: nullableSum("scheduled"),
    inPerson: nullableSum("inPerson"),
    telehealth: nullableSum("telehealth"),
    attendance:
      completed !== null && (nullableSum("scheduled") ?? 0) > 0
        ? (completed / nullableSum("scheduled")!) * 100
        : null,
    utilization:
      completed !== null && desired !== null && desired > 0
        ? (completed / desired) * 100
        : null,
    averagePerRecordedWeek:
      completed !== null && coveredDays > 0
        ? completed / (coveredDays / 7)
        : null,
    coveredDays,
    dataThrough: included.reduce<string | null>(
      (last, entry) => (!last || entry.end > last ? entry.end : last),
      null,
    ),
  };
}
