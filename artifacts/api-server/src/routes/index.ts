import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
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
import usersRouter from "./users";

const router: IRouter = Router();

// Health check is public — all other routes require a valid Clerk session
router.use(healthRouter);

router.use(requireAuth);

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
router.use(usersRouter);

export default router;
