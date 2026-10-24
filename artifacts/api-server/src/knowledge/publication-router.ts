import { Router } from "express";
import { KnowledgeError, knowledgeScope } from "./service";
import type { KnowledgePublicationBridge } from "./publication";
/** Mounted behind existing requireAccess; no external publisher token/auth scheme is created here. */
export function createKnowledgePublicationRouter(bridge: KnowledgePublicationBridge | null, practiceId: () => string | undefined) {
  const router = Router();
  router.all("/knowledge/releases", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const context = { role: res.locals.role, principalId: res.locals.principalId };
      const scope = knowledgeScope(context.role, context.principalId, practiceId());
      if (req.method !== "POST") return res.status(405).setHeader("Allow", "POST").json({ code: "KNOWLEDGE_RELEASE_POST_REQUIRED" });
      if (!bridge) throw new KnowledgeError(503, "KNOWLEDGE_PUBLICATION_UNAVAILABLE");
      // Cookie-authenticated state changes require same-origin browser requests; external connector auth is a future gate.
      if (req.get("sec-fetch-site") !== "same-origin" || !req.is("application/json"))
        throw new KnowledgeError(403, "KNOWLEDGE_PUBLICATION_ORIGIN_REQUIRED");
      if (Object.keys(req.query).length) throw new KnowledgeError(400, "KNOWLEDGE_UNSUPPORTED_INPUT");
      return res.json(await bridge.publish(scope, context, req.body));
    } catch (error) {
      if (error instanceof KnowledgeError) return res.status(error.status).json({ code: error.code });
      return res.status(503).json({ code: "KNOWLEDGE_PUBLICATION_UNAVAILABLE" });
    }
  });
  return router;
}
