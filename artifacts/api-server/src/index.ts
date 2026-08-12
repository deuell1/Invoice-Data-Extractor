import app from "./app";
import { logger } from "./lib/logger";
import { assertFkCoverage, warnVendorAuditOrphans } from "./lib/fkCoverageCheck";
import { logExtractionBootInfo } from "./services/extractionService";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind to the port FIRST so the health probe can respond immediately.
//
// Startup DB checks (assertFkCoverage, warnVendorAuditOrphans) must not run
// before app.listen() in a production deployment. On a fresh production DB the
// tables do not exist yet — Replit applies the dev→prod schema diff only after
// the health probe succeeds, so running DB queries before the probe is answered
// creates a chicken-and-egg: empty DB → query fails → server exits → probe
// never succeeds → schema never applied.
//
// By listening first we break the cycle: the probe succeeds, the schema is
// applied, and the DB checks run against a populated database.
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Post-listen startup checks. assertFkCoverage verifies that every FK
  // referencing invoice_capture(id) and vendor_id(id) is explicitly handled
  // in the corresponding hard-delete transaction. If a gap is found (e.g. a
  // new child table was added without updating the delete transaction), the
  // server exits with a clear remediation message rather than silently
  // returning 409s during smoke-test cleanup.
  assertFkCoverage()
    .then(() => warnVendorAuditOrphans())
    .then(() => {
      logExtractionBootInfo();
    })
    .catch((startupErr) => {
      logger.error(
        { err: startupErr },
        startupErr instanceof Error ? startupErr.message : String(startupErr),
      );
      process.exit(1);
    });
});
