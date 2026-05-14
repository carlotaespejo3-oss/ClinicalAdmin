import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clinadminRouter from "./clinadmin";
import anthropicRouter from "./anthropic";
import deferralsRouter from "./deferrals";
import archivedRouter from "./archived";
import acknowledgedRouter from "./acknowledged";
import userTasksRouter from "./userTasks";
import linkedDocTasksRouter from "./linkedDocTasks";
import promptedTasksRouter from "./promptedTasks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clinadminRouter);
router.use(anthropicRouter);
router.use(deferralsRouter);
router.use(archivedRouter);
router.use(acknowledgedRouter);
router.use(userTasksRouter);
router.use(linkedDocTasksRouter);
router.use(promptedTasksRouter);

export default router;
