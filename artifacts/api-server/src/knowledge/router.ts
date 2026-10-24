import { Router } from "express";
import { KnowledgeError, knowledgeScope, listKnowledge, type KnowledgeRepository } from "./service";

/** Mounted behind Clerk requireAccess. Injection permits isolated HTTP tests without a database. */
export function createKnowledgeRouter(repository: KnowledgeRepository, practiceId: () => string | undefined) {
  const router = Router();
  router.all("/knowledge", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const scope = knowledgeScope(res.locals.role, res.locals.principalId, practiceId());
      if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).setHeader("Allow", "GET, HEAD").json({ code: "KNOWLEDGE_READ_ONLY" });
      if (Object.keys(req.query).length || req.body && Object.keys(req.body).length)
        return res.status(400).json({ code: "KNOWLEDGE_UNSUPPORTED_INPUT" });
      return res.json({ status: "ready", sync: "not-connected", resources: await listKnowledge(repository, scope) });
    } catch (error) {
      if (error instanceof KnowledgeError) return res.status(error.status).json({ code: error.code });
      return res.status(503).json({ code: "KNOWLEDGE_UNAVAILABLE" });
    }
  });
  return router;
}
