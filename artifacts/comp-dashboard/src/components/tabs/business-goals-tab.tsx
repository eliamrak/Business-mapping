import { useListBusinessGoals, useCreateBusinessGoal, useDeleteBusinessGoal } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash } from "lucide-react";
import { calculateBusinessGoalOutputs } from "@/lib/calculations";
import { formatCurrency } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import { getListBusinessGoalsQueryKey } from "@workspace/api-client-react";

export default function BusinessGoalsTab() {
  const { data: goals, isLoading } = useListBusinessGoals();
  const createGoal = useCreateBusinessGoal();
  const deleteGoal = useDeleteBusinessGoal();
  const queryClient = useQueryClient();

  const handleCreate = () => {
    createGoal.mutate({
      data: {
        name: "New Business Goal",
        timeHorizon: "1year",
        ownerPayGoal: 100000,
        secondOwnerPayGoal: 0,
        annualOverheadGoal: 50000,
        businessProfitGoal: 20000,
        buildingFundGoal: 0,
        emergencyReserveGoal: 10000,
        growthFundGoal: 0,
        desiredCliniciansCount: 5,
        desiredOwnerClinicalCaseload: 10,
        notes: ""
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBusinessGoalsQueryKey() });
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteGoal.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBusinessGoalsQueryKey() });
      }
    });
  };

  if (isLoading) return <div>Loading goals...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Business Goals</h2>
          <p className="text-muted-foreground">Define and compare financial targets for the practice.</p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Goal
        </Button>
      </div>

      {(!goals || goals.length === 0) ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <Plus className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No Business Goals</h3>
          <p className="text-muted-foreground max-w-sm mt-2 mb-4">
            Create your first business goal to start planning your compensation strategy.
          </p>
          <Button onClick={handleCreate}>Create Business Goal</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {goals.map(goal => {
            const outputs = calculateBusinessGoalOutputs(goal);
            return (
              <Card key={goal.id} className="flex flex-col">
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="space-y-1">
                    <CardTitle>{goal.name}</CardTitle>
                    <p className="text-xs text-muted-foreground font-mono">{goal.timeHorizon} Horizon</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(goal.id)} className="h-8 w-8 text-destructive hover:bg-destructive/10">
                    <Trash className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm mt-4">
                    <div className="space-y-1">
                      <span className="text-muted-foreground block">Annual Business Need</span>
                      <span className="font-semibold block">{formatCurrency(outputs.totalAnnualBusinessNeed)}</span>
                    </div>
                    <div className="space-y-1">
                      <span className="text-muted-foreground block">Required Net / Clinician</span>
                      <span className="font-semibold block">{formatCurrency(outputs.requiredNetPerClinician)}</span>
                    </div>
                    <div className="space-y-1">
                      <span className="text-muted-foreground block">Desired Clinicians</span>
                      <span className="font-semibold block">{goal.desiredCliniciansCount}</span>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="bg-muted/50 border-t py-3">
                  <Button variant="outline" className="w-full">Edit Details</Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
