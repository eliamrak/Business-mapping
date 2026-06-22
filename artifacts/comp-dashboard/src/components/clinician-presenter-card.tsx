import { useMemo, useState } from "react";
import { calculateClinicianMetrics } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";
import { Minus, Plus } from "lucide-react";

export interface ClinicianPresenterData {
  label: string;
  classification: string;
  sessionRate: number;
  sessionsPerWeek: number;
  weeksWorkedPerYear: number;
  preCapClinicianSplit: number;
  preCapPracticeSplit: number;
  capEnabled: boolean;
  capAmount: number;
  postCapClinicianSplit: number;
  postCapPracticeSplit: number;
  w2EmployerFicaPct: number;
  futaSutaPct: number;
  workersCompPct: number;
  otherEmployerBurdenPct: number;
  nonClinicalHoursPerWeek?: number;
  nonClinicalHourlyRate?: number;
}

function ClassificationBadge({ value }: { value: string }) {
  const label = String(value).toUpperCase();
  const cls =
    label === "W2"
      ? "bg-blue-100 text-blue-700"
      : label === "1099"
      ? "bg-purple-100 text-purple-700"
      : "bg-amber-100 text-amber-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function Row({ label, value, valueClass, sub }: { label: string; value: string; valueClass?: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0">
      <span className="text-sm text-muted-foreground">
        {label}
        {sub && <span className="block text-[11px] text-muted-foreground/60">{sub}</span>}
      </span>
      <span className={`text-sm font-medium tabular-nums ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

function SessionsStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0">
      <div>
        <span className="text-sm text-muted-foreground">Sessions per week</span>
        <span className="block text-[11px] text-primary font-medium">Adjust to model your schedule</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(1, value - 1))}
          className="h-6 w-6 rounded border flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
          aria-label="Decrease sessions"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="text-sm font-semibold tabular-nums w-5 text-center">{value}</span>
        <button
          onClick={() => onChange(Math.min(40, value + 1))}
          className="h-6 w-6 rounded border flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
          aria-label="Increase sessions"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function ClinicianPresenterCard({ data }: { data: ClinicianPresenterData }) {
  const [sessionsPerWeek, setSessionsPerWeek] = useState(data.sessionsPerWeek);

  const effectiveData = useMemo(
    () => ({ ...data, sessionsPerWeek }),
    [data, sessionsPerWeek]
  );

  const metrics = useMemo(() => calculateClinicianMetrics(effectiveData), [effectiveData]);

  const classStr = String(data.classification).toLowerCase();
  const hasNonClinical =
    (data.nonClinicalHoursPerWeek ?? 0) > 0 && (data.nonClinicalHourlyRate ?? 0) > 0;
  const nonClinicalAnnual =
    (data.nonClinicalHoursPerWeek ?? 0) * (data.nonClinicalHourlyRate ?? 0) * data.weeksWorkedPerYear;

  const scheduleChanged = sessionsPerWeek !== data.sessionsPerWeek;

  return (
    <div className="rounded-2xl border bg-card shadow-sm overflow-hidden w-full max-w-md mx-auto">
      <div className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 px-6 py-5 flex items-center gap-3 border-b">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold truncate">{data.label || "Clinician"}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Compensation Summary</p>
        </div>
        <ClassificationBadge value={data.classification} />
      </div>

      <div className="px-6 py-4 space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Schedule</p>
        <Row label="Session rate" value={formatCurrency(data.sessionRate)} />
        <SessionsStepper value={sessionsPerWeek} onChange={setSessionsPerWeek} />
        <Row label="Weeks worked per year" value={String(data.weeksWorkedPerYear)} />
        <Row
          label="Annual sessions"
          value={String(metrics.annualSessions)}
          valueClass={scheduleChanged ? "text-primary" : undefined}
        />
      </div>

      {hasNonClinical && (
        <div className="px-6 py-4 space-y-1 border-t">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Non-Clinical Hours
          </p>
          <Row
            label="Hours per week"
            value={`${data.nonClinicalHoursPerWeek} hrs @ ${formatCurrency(data.nonClinicalHourlyRate ?? 0)}/hr`}
          />
          <Row
            label="Annual non-clinical pay"
            value={formatCurrency(nonClinicalAnnual)}
            valueClass="text-slate-700"
          />
        </div>
      )}

      <div className="px-6 py-4 space-y-1 border-t">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Split Structure
        </p>
        {data.capEnabled ? (
          <>
            <Row
              label="Pre-cap clinician split"
              value={`${data.preCapClinicianSplit}% / ${data.preCapPracticeSplit}% practice`}
            />
            <Row
              label="Cap amount"
              value={formatCurrency(data.capAmount)}
            />
            <Row
              label="Post-cap clinician split"
              value={`${data.postCapClinicianSplit}% / ${data.postCapPracticeSplit}% practice`}
            />
            <div className="flex items-center justify-between py-1.5 text-xs text-muted-foreground">
              <span>Pre-cap sessions</span>
              <span className="tabular-nums">{Math.round(metrics.preCapSessions)}</span>
            </div>
            <div className="flex items-center justify-between py-1.5 text-xs text-muted-foreground">
              <span>Post-cap sessions</span>
              <span className="tabular-nums">{Math.round(metrics.postCapSessions)}</span>
            </div>
          </>
        ) : (
          <Row
            label="Clinician split"
            value={`${data.preCapClinicianSplit}% / ${data.preCapPracticeSplit}% practice`}
          />
        )}
      </div>

      {classStr === "w2" && metrics.clinicianPayrollTaxEstimate > 0 && (
        <div className="px-6 py-4 border-t space-y-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Payroll Tax Estimate
          </p>
          <Row
            label="Est. employee payroll taxes"
            value={`−${formatCurrency(metrics.clinicianPayrollTaxEstimate)}/yr`}
            valueClass="text-amber-600"
          />
          <Row
            label="Est. take-home after taxes"
            value={formatCurrency(metrics.estimatedCompAfterPayrollTaxes)}
            valueClass="text-slate-700"
          />
        </div>
      )}

      <div className="px-6 py-5 border-t bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Estimated Annual Compensation
        </p>
        <p className="text-3xl font-bold text-green-700 tabular-nums">
          {formatCurrency(metrics.clinicianCompensation)}
        </p>
        {scheduleChanged && (
          <p className="text-[11px] text-primary mt-1">
            Based on {sessionsPerWeek} sessions/wk · original was {data.sessionsPerWeek}
          </p>
        )}
        {!scheduleChanged && (
          <p className="text-xs text-muted-foreground mt-1">
            Gross earnings before personal income taxes
          </p>
        )}
      </div>
    </div>
  );
}
