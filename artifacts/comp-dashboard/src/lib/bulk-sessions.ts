import {
  dateSchema,
  daysInclusive,
  sessionInputSchema,
  type SessionInput,
  type SessionRecord,
  type SessionWrite,
} from "@workspace/practice";

export const MAX_BULK_PERIODS = 52;

export type BulkPeriod = { start: string; end: string };
export type BulkClinician = {
  id: number;
  label: string;
  sessionsPerWeek: number;
};
export type BulkIssue = { key: string; message: string };
export type BulkEntry = {
  key: string;
  entry: SessionInput;
  expectedRevision: number | null;
};

export const bulkCellKey = (start: string, clinicianId: number) =>
  `${start}:${clinicianId}`;

export function shiftBulkDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function buildBulkPeriods(
  firstStart: string,
  firstEnd: string,
  count: number,
): BulkPeriod[] {
  if (!dateSchema.safeParse(firstStart).success || !dateSchema.safeParse(firstEnd).success)
    throw new Error("Choose valid dates for the first period.");
  if (daysInclusive(firstStart, firstEnd) !== 14)
    throw new Error("The first period must cover 14 days, including both dates.");
  if (!Number.isInteger(count) || count < 1 || count > MAX_BULK_PERIODS)
    throw new Error(`Choose 1 to ${MAX_BULK_PERIODS} periods.`);
  return Array.from({ length: count }, (_, index) => ({
    start: shiftBulkDate(firstStart, index * 14),
    end: shiftBulkDate(firstEnd, index * 14),
  }));
}

export function parsePastedTotals(text: string): string[][] {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => line.split("\t").map((cell) => {
    const trimmed = cell.trim();
    if (trimmed === "-" || trimmed === "\u2014") return "";
    const numeric = Number(trimmed.replaceAll(",", ""));
    return trimmed && Number.isInteger(numeric) && numeric >= 0
      ? String(numeric)
      : trimmed;
  }));
}

export function planBulkSessions(
  periods: BulkPeriod[],
  clinicians: BulkClinician[],
  overrides: Record<string, string>,
  existing: SessionRecord[],
): { entries: BulkEntry[]; issues: BulkIssue[] } {
  const entries: BulkEntry[] = [];
  const issues: BulkIssue[] = [];
  for (const period of periods) {
    for (const person of clinicians) {
      const key = bulkCellKey(period.start, person.id);
      const raw = overrides[key];
      if (raw === undefined || raw.trim() === "") continue;
      if (!/^\d+$/.test(raw.trim()) || Number(raw) > 10000) {
        issues.push({ key, message: `${person.label}, ${period.start}: use a whole number from 0 to 10,000.` });
        continue;
      }
      const completed = Number(raw);
      const same = existing.find((record) =>
        record.clinicianId === person.id &&
        record.start === period.start && record.end === period.end,
      );
      if (same?.completed === completed) continue;
      if (!same && existing.some((record) =>
        record.clinicianId === person.id &&
        record.start <= period.end && record.end >= period.start,
      )) {
        issues.push({ key, message: `${person.label}, ${period.start}: an existing session period overlaps these dates.` });
        continue;
      }
      const candidate = {
        clinicianId: person.id,
        ...period,
        completed,
        desired: same?.desired ?? Math.round(person.sessionsPerWeek * 2),
        cancelled: same?.cancelled ?? null,
        noShow: same?.noShow ?? null,
        scheduled: same?.scheduled ?? null,
        inPerson: same?.inPerson ?? null,
        telehealth: same?.telehealth ?? null,
        sourceAttachmentId: same?.sourceAttachmentId ?? null,
      };
      const valid = sessionInputSchema.safeParse(candidate);
      if (!valid.success) {
        issues.push({
          key,
          message: `${person.label}, ${period.start}: ${valid.error.issues[0]?.message ?? "Check this total."} Edit this period individually if its detail counts also need changing.`,
        });
        continue;
      }
      entries.push({ key, entry: valid.data, expectedRevision: same?.revision ?? null });
    }
  }
  return { entries, issues };
}

export async function writeBulkSessions(
  entries: BulkEntry[],
  pending: Map<string, SessionWrite>,
  saveRecord: (command: SessionWrite) => Promise<unknown>,
  onProgress: (saved: number) => void,
): Promise<{ savedKeys: string[]; error: unknown | null }> {
  const savedKeys: string[] = [];
  for (let index = 0; index < entries.length; index += 4) {
    const batch = entries.slice(index, index + 4);
    const results = await Promise.allSettled(batch.map(async (item) => {
      const previous = pending.get(item.key);
      const command: SessionWrite = previous &&
        JSON.stringify(previous.entry) === JSON.stringify(item.entry) &&
        previous.expectedRevision === item.expectedRevision
        ? previous
        : {
            requestId: crypto.randomUUID(),
            expectedRevision: item.expectedRevision,
            entry: item.entry,
          };
      pending.set(item.key, command);
      await saveRecord(command);
      savedKeys.push(item.key);
      pending.delete(item.key);
      onProgress(savedKeys.length);
    }));
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected")
      return { savedKeys, error: failed.reason };
  }
  return { savedKeys, error: null };
}
