import { Router, type IRouter } from "express";
import healthRouter from "./health";
import businessGoalsRouter from "./businessGoals";
import currentRealityRouter from "./currentReality";
import cliniciansRouter from "./clinicians";
import scenariosRouter from "./scenarios";
import staffRouter from "./staff";
import sessionRecordsRouter from "./sessionRecords";
import hubRouter from "./hub";
import practiceImportsRouter from "./practiceImports";
import backupRouter from "./backup";

const router: IRouter = Router();

router.use(healthRouter);
router.use(businessGoalsRouter);
router.use(currentRealityRouter);
router.use(cliniciansRouter);
router.use(scenariosRouter);
router.use(staffRouter);
router.use(sessionRecordsRouter);
router.use(hubRouter);
router.use(practiceImportsRouter);
router.use(backupRouter);

export default router;
