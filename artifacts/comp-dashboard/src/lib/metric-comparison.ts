export type ComparisonRow = {
  id: string;
  label: string;
  value: number | null | undefined;
  detail?: string;
  practice?: boolean;
  goal?: number | null;
  capacity?: number | null;
  period?: { start: string; end: string };
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function hasUniqueClinicianIdentity(clinicians: { id: number; label: string; goalId?: number | null }[], label: string, teamId?: number | null) {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
  const ids = new Set(clinicians.filter((person) => (teamId === undefined || (person.goalId ?? null) === teamId) && normalize(person.label) === normalize(label)).map((person) => person.id));
  return ids.size === 1;
}

export function metricComparison(rows: ComparisonRow[], percentage = false) {
  const ordered = [...rows].sort((a, b) => Number(!!a.practice) - Number(!!b.practice));
  const practice = ordered.find((row) => row.practice);
  const benchmark = practice?.value;
  const scale = percentage ? 100 : Math.max(1, ...ordered.flatMap((row) => [row.value, row.goal, row.capacity].filter(finite)));
  const position = (value: number) => Math.min(100, Math.max(0, value / scale * 100));
  return ordered.map((row) => ({ ...row,
    value: finite(row.value) ? row.value : null,
    width: finite(row.value) ? position(row.value) : null,
    benchmarkPosition: !row.practice && finite(benchmark) && ((!row.period && !practice?.period)
      || !!row.period && !!practice?.period && row.period.start === practice.period.start && row.period.end === practice.period.end) ? position(benchmark) : null,
    goalPosition: finite(row.goal) ? position(row.goal) : null,
    capacityPosition: finite(row.capacity) ? position(row.capacity) : null,
  }));
}
