import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import webhooksRouter from "./routes/webhooks";
import { logger } from "./lib/logger";

// ── CORS allowlist ────────────────────────────────────────────────────────────
// Parsed once at module load from ALLOWED_ORIGINS (comma-separated, no
// trailing slashes). When unset, defaults to rejecting all cross-origin
// requests rather than falling back to permissive.
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS;

const allowedOrigins: ReadonlySet<string> = rawAllowedOrigins
  ? new Set(rawAllowedOrigins.split(",").map((o) => o.trim()).filter(Boolean))
  : new Set();

if (!rawAllowedOrigins) {
  logger.warn(
    "CORS allowlist not configured — rejecting all cross-origin requests",
  );
}

// cors `origin` callback: pass-through same-origin / server-to-server
// requests (no Origin header); allow only explicitly listed origins otherwise.
const corsOrigin = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  if (!origin) {
    // No Origin header: same-origin browser request or non-browser caller.
    callback(null, true);
    return;
  }
  callback(null, allowedOrigins.has(origin));
};

// ─────────────────────────────────────────────────────────────────────────────

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy must be mounted before body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Baseline security headers — mounted after pinoHttp, before CORS.
// contentSecurityPolicy and frameguard are both disabled globally:
// routes/storage.ts manages its own per-response CSP (PREVIEW_CSP, tailored
// for document preview with blob:, data:, and frame-src 'self') and
// deliberately omits X-Frame-Options entirely to allow the same-origin invoice
// preview iframe. A blanket helmet CSP would override that route's header
// logic and break inline preview; frameguard's SAMEORIGIN default breaks the
// preview specifically in dev, where the frontend and API don't share an
// origin.
app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: false,
  }),
);

app.use(cors({ credentials: true, origin: corsOrigin }));

// Webhook routes must be mounted BEFORE express.json() so they receive the raw
// body that Svix needs for signature verification.  Scope the raw-body parser
// to just the webhook path so it does not interfere with any other routes.
app.use("/webhooks", express.raw({ type: "application/json" }), webhooksRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Resolve the publishable key from the incoming request host so the same
// server can serve multiple Clerk custom domains.
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
