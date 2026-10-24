import { Router } from "express";
import { createKnowledgePublicationRouter } from "../knowledge/publication-router";
import { createKnowledgeReadRouter } from "../knowledge/router";
import { postgresKnowledgePipelineStore } from "../knowledge/pipeline-store";
import { createKnowledgeRuntime } from "../knowledge/runtime";

// Deliberately disabled. No approved source configuration/provider identity exists in this app.
// Enabling requires a separately reviewed server-only configuration capability, never request input.
const runtime = createKnowledgeRuntime(postgresKnowledgePipelineStore, () => null);
const router = Router();
router.use(createKnowledgeReadRouter((scope, context) => runtime.read(scope, context), () => process.env.EMC_PRACTICE_ID));
router.use(createKnowledgePublicationRouter(null, () => process.env.EMC_PRACTICE_ID));
export default router;
