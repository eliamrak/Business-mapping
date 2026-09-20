import {
  searchGoals,
  type Workspace,
  type Context,
  type GoalSearch,
} from "@workspace/practice/hub";
self.onmessage = (
  message: MessageEvent<{
    workspace: Workspace;
    context: Context;
    search: GoalSearch;
  }>,
) => {
  try {
    const { workspace, context, search } = message.data;
    self.postMessage({
      result: searchGoals(workspace, context, search, () =>
        crypto.randomUUID(),
      ),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Search failed.",
    });
  }
};
