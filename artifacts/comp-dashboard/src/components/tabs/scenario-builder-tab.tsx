import { useListScenarios, useCreateScenario, useDeleteScenario } from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash, GitMerge } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListScenariosQueryKey } from "@workspace/api-client-react";

export default function ScenarioBuilderTab() {
  const { data: scenarios, isLoading } = useListScenarios();
  const createScenario = useCreateScenario();
  const deleteScenario = useDeleteScenario();
  const queryClient = useQueryClient();

  const handleCreate = () => {
    createScenario.mutate({
      data: {
        name: "New Scenario",
        notes: ""
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteScenario.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListScenariosQueryKey() });
      }
    });
  };

  if (isLoading) return <div>Loading scenarios...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Scenario Builder</h2>
          <p className="text-muted-foreground">Create different practice configurations to compare.</p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create Scenario
        </Button>
      </div>

      {(!scenarios || scenarios.length === 0) ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <GitMerge className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium">No Scenarios</h3>
          <p className="text-muted-foreground max-w-sm mt-2 mb-4">
            Create your first scenario to start modeling different practice setups.
          </p>
          <Button onClick={handleCreate}>Create Scenario</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {scenarios.map(scenario => {
            return (
              <Card key={scenario.id} className="flex flex-col">
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div className="space-y-1">
                    <CardTitle>{scenario.name}</CardTitle>
                    <p className="text-xs text-muted-foreground">Last updated {new Date(scenario.updatedAt).toLocaleDateString()}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(scenario.id)} className="h-8 w-8 text-destructive hover:bg-destructive/10">
                    <Trash className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent className="flex-1 space-y-4">
                  <p className="text-sm text-muted-foreground">{scenario.notes || "No notes."}</p>
                </CardContent>
                <CardFooter className="bg-muted/50 border-t py-3">
                  <Button variant="outline" className="w-full">Open Scenario</Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
