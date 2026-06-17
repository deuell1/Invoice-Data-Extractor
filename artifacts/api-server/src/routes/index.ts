import { Router, type IRouter } from "express";
import healthRouter from "./health";
import invoicesRouter from "./invoices";
import vendorsRouter from "./vendors";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(invoicesRouter);
router.use(vendorsRouter);
router.use(storageRouter);

export default router;
