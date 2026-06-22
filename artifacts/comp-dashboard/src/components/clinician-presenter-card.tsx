import { useMemo } from "react";
import { calculateClinicianMetrics } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";

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

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium tabular-nums ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

export function ClinicianPresenterCard({ data }: { data: ClinicianPresenterData }) {
  const metrics = useMemo(() => calculateClinicianMetrics(data), [data]);

  const classStr = String(data.classification).toLowerCase();

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
        <Row label="Sessions per week" value={String(data.sessionsPerWeek)} />
        <Row label="Weeks worked per year" value={String(data.weeksWorkedPerYear)} />
        <Row label="Annual sessions" value={String(metrics.annualSessions)} />
      </div>

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
        <p className="text-xs text-muted-foreground mt-1">
          Gross earnings before personal income taxes
        </p>
      </div>
    </div>
  );
}
