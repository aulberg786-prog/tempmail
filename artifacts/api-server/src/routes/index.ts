import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tempmailRouter from "./tempmail";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tempmailRouter);

export default router;
