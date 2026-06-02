import { Router, type IRouter } from "express";
import healthRouter from "./health";
import businessGoalsRouter from "./businessGoals";
import currentRealityRouter from "./currentReality";
import cliniciansRouter from "./clinicians";
import scenariosRouter from "./scenarios";

const router: IRouter = Router();

router.use(healthRouter);
router.use(businessGoalsRouter);
router.use(currentRealityRouter);
router.use(cliniciansRouter);
router.use(scenariosRouter);

export default router;
