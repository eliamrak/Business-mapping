import { useGetCurrentReality, useUpsertCurrentReality, useListBusinessGoals } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPercent } from "@/lib/format";
import { calculateCurrentRealityGap } from "@/lib/calculations";
import { useQueryClient } from "@tanstack/react-query";
import { getGetCurrentRealityQueryKey } from "@workspace/api-client-react";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

export default function CurrentRealityTab() {
  const { data: currentReality, isLoading: isLoadingReality } = useGetCurrentReality();
  const { data: goals, isLoading: isLoadingGoals } = useListBusinessGoals();
  const upsertReality = useUpsertCurrentReality();
  const queryClient = useQueryClient();

  const [selectedGoalId, setSelectedGoalId] = useState<string>("");

  const handleCreateEmpty = () => {
    upsertReality.mutate({
      data: {
        currentOwnerPay: 0,
        currentSecondOwnerPay: 0,
        currentAnnualOverhead: 0,
        currentBusinessProfit: 0,
        currentCashReserve: 0,
        currentBuildingFund: 0,
        currentCliniciansCount: 1,
        currentAvgSessionRate: 150,
        currentAvgSessionsPerWeek: 15,
        currentAvgWeeksWorkedPerYear: 48
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCurrentRealityQueryKey() });
      }
    });
  };

  if (isLoadingReality || isLoadingGoals) return <div>Loading...</div>;

  const selectedGoal = goals?.find(g => g.id.toString() === selectedGoalId);
  const gapAnalysis = currentReality ? calculateCurrentRealityGap(currentReality, selectedGoal) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Current Reality</h2>
          <p className="text-muted-foreground">Log your current practice metrics and compare them against goals.</p>
        </div>
      </div>

      {!currentReality ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <h3 className="text-lg font-medium">No Current Reality Profile</h3>
          <p className="text-muted-foreground max-w-sm mt-2 mb-4">
            Set up your current practice metrics to establish a baseline.
          </p>
          <Button onClick={handleCreateEmpty}>Initialize Current Reality</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Practice Baseline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block text-xs">Current Clinicians</span>
                  <span className="font-semibold block">{currentReality.currentCliniciansCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs">Avg Session Rate</span>
                  <span className="font-semibold block">{formatCurrency(currentReality.currentAvgSessionRate)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs">Business Profit</span>
                  <span className="font-semibold block">{formatCurrency(currentReality.currentBusinessProfit)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs">Annual Overhead</span>
                  <span className="font-semibold block">{formatCurrency(currentReality.currentAnnualOverhead)}</span>
                </div>
              </div>
              <Button variant="outline" className="w-full mt-4">Edit Metrics</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Goal Comparison</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {goals && goals.length > 0 ? (
                <div className="space-y-4">
                  <Select value={selectedGoalId} onValueChange={setSelectedGoalId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a goal to compare" />
                    </SelectTrigger>
                    <SelectContent>
                      {goals.map(g => (
                        <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedGoal && gapAnalysis && (
                    <div className="space-y-4 pt-4 border-t">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground block text-xs">Current Production Estimate</span>
                          <span className="font-semibold block">{formatCurrency(gapAnalysis.currentAnnualProductionEstimate)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">Current Net / Clinician</span>
                          <span className="font-semibold block">{formatCurrency(gapAnalysis.currentNetPerClinicianEstimate)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">Gap to Goal</span>
                          <span className={`font-semibold block ${gapAnalysis.gapToGoal > 0 ? 'text-destructive' : 'text-green-600'}`}>
                            {formatCurrency(gapAnalysis.gapToGoal)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">Goal Achieved</span>
                          <span className="font-semibold block">{formatPercent(gapAnalysis.percentAchieved)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>No goals found</AlertTitle>
                  <AlertDescription>
                    Create a business goal first to compare against your current reality.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
