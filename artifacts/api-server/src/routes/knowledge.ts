import { createKnowledgeRouter } from "../knowledge/router";
import { knowledgeRepository } from "../knowledge/repository";
export default createKnowledgeRouter(knowledgeRepository, () => process.env.EMC_PRACTICE_ID);
