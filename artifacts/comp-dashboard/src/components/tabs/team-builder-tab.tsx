import { useListClinicians, useCreateClinician, useDeleteClinician } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash, User } from "lucide-react";
import { calculateClinicianMetrics } from "@/lib/calculations";
import { formatCurrency, formatPercent } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { getListCliniciansQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";

export default function TeamBuilderTab() {
  const { data: clinicians, isLoading } = useListClinicians();
  const createClinician = useCreateClinician();
  const deleteClinician = useDeleteClinician();
  const queryClient = useQueryClient();

  const handleCreate = () => {
    createClinician.mutate({
      data: {
        label: "New Clinician",
        roleType: "associate",
        classification: "w2",
        sessionRate: 175,
        sessionsPerWeek: 20,
        weeksWorkedPerYear: 48,
        capEnabled: true,
        capAmount: 50000,
        preCapClinicianSplit: 60,
        preCapPracticeSplit: 40,
        postCapClinicianSplit: 75,
        postCapPracticeSplit: 25,
        w2EmployerFicaPct: 7.65,
        futaSutaPct: 1.0,
        workersCompPct: 0.5,
        otherEmployerBurdenPct: 0,
        notes: ""
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey() });
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteClinician.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCliniciansQueryKey() });
      }
    });
  };

  if (isLoading) return <div>Loading clinicians...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Team Builder</h2>
          <p className="text-muted-foreground">Manage clinician profiles and compensation models.</p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Add Clinician
        </Button>
      </div>

      {(!clinicians || clinicians.length === 0) ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <User className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No Clinicians</h3>
          <p className="text-muted-foreground max-w-sm mt-2 mb-4">
            Build your team by adding clinician profiles.
          </p>
          <Button onClick={handleCreate}>Add Clinician</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {clinicians.map(clinician => {
            const metrics = calculateClinicianMetrics({
              ...clinician,
              classification: String(clinician.classification)
            });
            
            return (
              <Card key={clinician.id} className="flex flex-col">
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="space-y-1">
                    <CardTitle>{clinician.label}</CardTitle>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="secondary" className="uppercase text-[10px] tracking-wider">{clinician.roleType}</Badge>
                      <Badge variant="outline" className="uppercase text-[10px] tracking-wider">{clinician.classification}</Badge>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(clinician.id)} className="h-8 w-8 text-destructive hover:bg-destructive/10">
                    <Trash className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm mt-2">
                    <div>
                      <span className="text-muted-foreground block text-xs">Annual Production</span>
                      <span className="font-semibold block">{formatCurrency(metrics.annualProduction)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">Clinician Comp</span>
                      <span className="font-semibold block text-green-600">{formatCurrency(metrics.clinicianCompensation)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">Practice Net</span>
                      <span className="font-semibold block text-primary">{formatCurrency(metrics.practiceNetBeforeOverhead)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">Split (Pre / Post)</span>
                      <span className="font-mono text-xs block mt-1">
                        {clinician.preCapClinicianSplit}/{clinician.preCapPracticeSplit}
                        {clinician.capEnabled && ` → ${clinician.postCapClinicianSplit}/${clinician.postCapPracticeSplit}`}
                      </span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="bg-muted/50 border-t py-3">
                  <Button variant="outline" className="w-full">Edit Profile</Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
