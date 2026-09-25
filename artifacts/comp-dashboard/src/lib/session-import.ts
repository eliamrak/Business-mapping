import {
  dateSchema,
  daysInclusive,
  sessionInputSchema,
  type SessionInput,
  type SessionRecord,
} from "@workspace/practice";
import type { Clinician } from "@workspace/practice/hub";

export type ImportColumn = {
  index: number;
  name: string;
  sheetGoal: number | null;
  suggestedId: number | null;
};
export type ImportPeriod = {
  row: number;
  label: string;
  start: string;
  end: string;
  counts: Record<number, number | null>;
  errors: string[];
};
export type SessionSheet = {
  columns: ImportColumn[];
  periods: ImportPeriod[];
  years: number[];
  headerRow: number;
};
export type ImportPlan = {
  entries: SessionInput[];
  errors: string[];
  duplicateCount: number;
  conflictCount: number;
  skippedCount: number;
  periodCount: number;
};

const normalized = (value: string) =>
  value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

function isoDate(month: string, day: string, year: string): string {
  const fullYear = Number(year) < 100 ? 2000 + Number(year) : Number(year);
  const iso = `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return dateSchema.safeParse(iso).success ? iso : "";
}

function readPeriod(value: string): { start: string; end: string } | null {
  const match = value.match(
    /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-\u2013\u2014]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/,
  );
  if (!match) return null;
  return {
    start: isoDate(match[1], match[2], match[3]),
    end: isoDate(match[4], match[5], match[6]),
  };
}

function readCount(value: string): number | null | undefined {
  const text = value.trim();
  if (!text || text === "-" || text === "\u2014") return null;
  const number = Number(text.replaceAll(",", ""));
  return Number.isInteger(number) && number >= 0 && number <= 10000
    ? number
    : undefined;
}

function matchingClinician(name: string, clinicians: Clinician[]): number | null {
  const key = normalized(name);
  const exact = clinicians.filter((person) => normalized(person.label) === key);
  if (exact.length === 1) return exact[0].id;
  const firstName = clinicians.filter(
    (person) => normalized(person.label.split(/\s+/)[0]) === key,
  );
  return firstName.length === 1 ? firstName[0].id : null;
}

export function inspectSessionSheet(
  rows: string[][],
  clinicians: Clinician[],
  selectedHeaderRow?: number,
): SessionSheet {
  const dateColumn = Array.from({ length: Math.min(8, Math.max(...rows.slice(0, 60).map((row) => row.length), 1)) }, (_, i) => i)
    .map((index) => ({
      index,
      count: rows.slice(0, 60).filter((row) => readPeriod(row[index] ?? "")).length,
    }))
    .sort((a, b) => b.count - a.count)[0];
  if (!dateColumn || dateColumn.count === 0)
    throw new Error("No biweekly date ranges were found in this worksheet.");
  const firstPeriodRow = rows.findIndex((row) => readPeriod(row[dateColumn.index] ?? ""));
  const headerRow = selectedHeaderRow ?? firstPeriodRow - 1;
  if (headerRow < 0 || headerRow >= firstPeriodRow)
    throw new Error("Choose the row with clinician names above the first date range.");
  const goalRow = rows.find((row) =>
    /^(goal average|desired average|goal sessions)$/i.test(
      (row[dateColumn.index] ?? "").trim(),
    ),
  );
  const columns: ImportColumn[] = (rows[headerRow] ?? []).flatMap((name, index) => {
    if (index <= dateColumn.index || !name?.trim()) return [];
    const key = name.trim();
    if (/^(period|date|average|total)$/i.test(key)) return [];
    const goal = readCount(goalRow?.[index] ?? "");
    return [{
      index,
      name: key,
      sheetGoal: typeof goal === "number" ? goal : null,
      suggestedId: matchingClinician(key, clinicians),
    }];
  });
  if (!columns.length) throw new Error("No clinician columns were found in the header row.");
  const periods: ImportPeriod[] = [];
  for (let rowIndex = firstPeriodRow; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const dates = readPeriod(row[dateColumn.index] ?? "");
    if (!dates) continue;
    const counts: Record<number, number | null> = {};
    const errors: string[] = [];
    let hasValues = false;
    for (const column of columns) {
      const raw = row[column.index] ?? "";
      const count = readCount(raw);
      if (count === undefined) {
        errors.push(`${column.name}: enter a whole number or leave it blank.`);
        hasValues = true;
      } else if (count !== null) {
        counts[column.index] = count;
        hasValues = true;
      } else counts[column.index] = null;
    }
    if (!hasValues) continue;
    if (!dates.start || !dates.end || dates.start > dates.end)
      errors.push("Correct the start and end dates.");
    else if (daysInclusive(dates.start, dates.end) !== 14)
      errors.push("This range is not 14 days. Check both dates.");
    periods.push({
      row: rowIndex + 1,
      label: row[dateColumn.index] ?? "",
      ...dates,
      counts,
      errors,
    });
  }
  if (!periods.length) throw new Error("No completed session totals were found.");
  return {
    columns,
    periods,
    years: [...new Set(periods.filter((p) => p.end).map((p) => Number(p.end.slice(0, 4))))].sort(),
    headerRow: headerRow + 1,
  };
}

export function planSessionImport(
  sheet: SessionSheet,
  year: number,
  mappings: Record<number, number | "skip" | null>,
  corrections: Record<number, { start: string; end: string }>,
  goalSource: "sheet" | "practice",
  clinicians: Clinician[],
  existing: SessionRecord[],
): ImportPlan {
  const errors: string[] = [];
  const entries: SessionInput[] = [];
  let duplicateCount = 0;
  let conflictCount = 0;
  let skippedCount = 0;
  const periods = sheet.periods.filter((period) => {
    const dates = corrections[period.row] ?? period;
    return Number(dates.end.slice(0, 4)) === year;
  });
  const usedIds = new Set<number>();
  for (const column of sheet.columns) {
    if (!periods.some((period) => typeof period.counts[column.index] === "number")) continue;
    const mapped = mappings[column.index];
    if (mapped === "skip") continue;
    if (mapped === null || mapped === undefined) {
      errors.push(`Choose a clinician or explicitly skip ${column.name}.`);
      continue;
    }
    if (usedIds.has(mapped)) errors.push(`${column.name} maps to a clinician already used by another column.`);
    if (!clinicians.some((person) => person.id === mapped))
      errors.push(`${column.name} no longer matches a clinician in this team.`);
    usedIds.add(mapped);
  }
  for (const period of periods) {
    const { start, end } = corrections[period.row] ?? period;
    if (!dateSchema.safeParse(start).success || !dateSchema.safeParse(end).success ||
        start > end || daysInclusive(start, end) !== 14) {
      errors.push(`Row ${period.row}: correct the 14-day date range (${period.label}).`);
      continue;
    }
    if (period.errors.some((error) => !error.includes("date") && !error.includes("range"))) {
      errors.push(`Row ${period.row}: ${period.errors.join(" ")}`);
      continue;
    }
    for (const column of sheet.columns) {
      const completed = period.counts[column.index];
      if (completed === null || completed === undefined) continue;
      const clinicianId = mappings[column.index];
      if (clinicianId === "skip") {
        skippedCount++;
        continue;
      }
      const person = clinicians.find((candidate) => candidate.id === clinicianId);
      if (!person) continue;
      const desired = goalSource === "sheet" && column.sheetGoal !== null
        ? column.sheetGoal
        : Math.round((person.sessionsPerWeek * daysInclusive(start, end)) / 7);
      const result = sessionInputSchema.safeParse({
        clinicianId: person.id,
        start,
        end,
        completed,
        desired,
        cancelled: null,
        noShow: null,
        scheduled: null,
        inPerson: null,
        telehealth: null,
        sourceAttachmentId: null,
      });
      if (!result.success) {
        errors.push(`Row ${period.row}, ${column.name}: ${result.error.issues.map((issue) => issue.message).join(" ")}`);
        continue;
      }
      const exact = existing.find((record) =>
        record.clinicianId === person.id && record.start === start && record.end === end,
      );
      if (exact) {
        if (exact.completed === completed && exact.desired === desired) duplicateCount++;
        else conflictCount++;
        continue;
      }
      if (existing.some((record) =>
        record.clinicianId === person.id && record.start <= end && record.end >= start,
      ) || entries.some((entry) =>
        entry.clinicianId === person.id && entry.start <= end && entry.end >= start,
      )) {
        errors.push(`Row ${period.row}, ${column.name}: these dates overlap another entry.`);
        continue;
      }
      entries.push(result.data);
    }
  }
  return { entries, errors, duplicateCount, conflictCount, skippedCount, periodCount: periods.length };
}
