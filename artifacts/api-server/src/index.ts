import app from "./app";
import { logger } from "./lib/logger";
import { assertFkCoverage, warnVendorAuditOrphans } from "./lib/fkCoverageCheck";

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

// Run startup assertions before accepting traffic.
// assertFkCoverage verifies that every FK referencing invoice_capture(id) and
// vendor_id(id) is explicitly handled in the corresponding hard-delete
// transaction. If a new child table is added without updating the transaction,
// the server refuses to start with a clear remediation message.
assertFkCoverage()
  .then(() => warnVendorAuditOrphans())
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
