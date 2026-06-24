import { Router, type IRouter } from "express";
import healthRouter from "./health";
import invoicesRouter from "./invoices";
import vendorsRouter from "./vendors";
import storageRouter from "./storage";
import sourceDocumentsRouter from "./sourceDocuments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(invoicesRouter);
router.use(vendorsRouter);
router.use(storageRouter);
router.use(sourceDocumentsRouter);

export default router;
