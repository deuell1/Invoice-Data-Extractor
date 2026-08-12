import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    // Race a trivial DB round-trip against a 2-second wall-clock timeout.
    // Any failure (connection error, query error, timeout) is caught below.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), 2_000),
    );
    await Promise.race([pool.query("SELECT 1"), timeout]);

    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch {
    // Do not leak the underlying error message or the connection string.
    res.status(503).json({ status: "error", detail: "database unreachable" });
  }
});

export default router;
