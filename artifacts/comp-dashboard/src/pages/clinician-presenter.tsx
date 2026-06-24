import { useParams } from "wouter";
import { ClinicianPresenterCard } from "@/components/clinician-presenter-card";
import { Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

async function fetchByToken(token: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/api/clinicians/by-token/${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error("not_found");
  return res.json();
}

export default function ClinicianPresenterPage() {
  const { token } = useParams<{ token: string }>();

  const { data: clinician, isLoading, isError } = useQuery({
    queryKey: ["clinician-by-token", token],
    queryFn: () => fetchByToken(token!),
    enabled: !!token,
    retry: false,
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card px-6 py-3 flex items-center gap-2 shrink-0">
        <span className="text-sm font-semibold text-foreground">Comp Modeler</span>
        <span className="text-xs text-muted-foreground">· Clinician Compensation View</span>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        {isLoading && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Loading compensation details…</p>
          </div>
        )}

        {isError && (
          <div className="text-center space-y-2">
            <p className="text-sm font-medium text-destructive">Link not found or has been revoked.</p>
            <p className="text-xs text-muted-foreground">
              Ask your practice owner for an updated link.
            </p>
          </div>
        )}

        {clinician && (
          <ClinicianPresenterCard
            data={{
              label: clinician.label,
              classification: clinician.classification,
              sessionRate: clinician.sessionRate,
              sessionsPerWeek: clinician.sessionsPerWeek,
              weeksWorkedPerYear: clinician.weeksWorkedPerYear,
              preCapClinicianSplit: clinician.preCapClinicianSplit,
              preCapPracticeSplit: clinician.preCapPracticeSplit,
              capEnabled: clinician.capEnabled,
              capAmount: clinician.capAmount,
              postCapClinicianSplit: clinician.postCapClinicianSplit,
              postCapPracticeSplit: clinician.postCapPracticeSplit,
              w2EmployerFicaPct: clinician.w2EmployerFicaPct,
              futaSutaPct: clinician.futaSutaPct,
              workersCompPct: clinician.workersCompPct,
              otherEmployerBurdenPct: clinician.otherEmployerBurdenPct,
              nonClinicalHoursPerWeek: clinician.nonClinicalHoursPerWeek,
              nonClinicalHourlyRate: clinician.nonClinicalHourlyRate,
            }}
          />
        )}
      </main>

      <footer className="border-t bg-card px-6 py-3 text-center shrink-0">
        <p className="text-xs text-muted-foreground">
          Estimates are based on the schedule shown above. Actual compensation may vary.
        </p>
      </footer>
    </div>
  );
}
