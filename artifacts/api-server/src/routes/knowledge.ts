import { createKnowledgeReadRouter } from "../knowledge/router";
import { postgresKnowledgePipelineStore } from "../knowledge/pipeline-store";
import { createKnowledgeRuntime } from "../knowledge/runtime";

// Deliberately disabled. No approved source configuration/provider identity exists in this app.
// Enabling requires a separately reviewed server-only configuration capability, never request input.
const runtime = createKnowledgeRuntime(postgresKnowledgePipelineStore, () => null);
export default createKnowledgeReadRouter((scope, context) => runtime.read(scope, context), () => process.env.EMC_PRACTICE_ID);
