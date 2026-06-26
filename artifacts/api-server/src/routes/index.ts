import { Router, type IRouter } from "express";
import healthRouter from "./health";
import invoicesRouter from "./invoices";
import vendorsRouter from "./vendors";
import storageRouter from "./storage";
import sourceDocumentsRouter from "./sourceDocuments";
import dashboardRouter from "./dashboard";
import exceptionsRouter from "./exceptions";
import importsRouter from "./imports";
import exportsRouter from "./exports";
import accuracyRouter from "./accuracy";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(invoicesRouter);
router.use(vendorsRouter);
router.use(storageRouter);
router.use(sourceDocumentsRouter);
router.use(dashboardRouter);
router.use(exceptionsRouter);
router.use(importsRouter);
router.use(exportsRouter);
router.use(accuracyRouter);
router.use(settingsRouter);

export default router;
