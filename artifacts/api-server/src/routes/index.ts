import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clinadminRouter from "./clinadmin";
import anthropicRouter from "./anthropic";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clinadminRouter);
router.use(anthropicRouter);

export default router;
