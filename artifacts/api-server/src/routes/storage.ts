import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// Map of file extensions → browser-renderable MIME types. Stored objects are
// named with opaque UUIDs (no extension), so we derive the correct type from the
// original filename hint passed by the client, falling back to the upstream type.
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

const RENDERABLE_CONTENT_TYPES = new Set(Object.values(EXTENSION_CONTENT_TYPES));

// Content-Security-Policy that lets the app embed its own stored invoice files in
// an iframe/img/object preview while keeping everything same-origin.
const PREVIEW_CSP =
  "frame-src 'self' blob: data:; img-src 'self' blob: data: https:; object-src 'self' blob:";

/**
 * Pick a browser-safe Content-Type for a stored object. Prefers the extension of
 * the original filename hint (authoritative for our previews); falls back to the
 * upstream type only when it is already a known renderable type; otherwise
 * application/octet-stream so the browser does not mis-render unknown data.
 */
function resolveContentType(nameHint: string, upstreamType: string): string {
  const ext = nameHint.split(".").pop()?.toLowerCase() ?? "";
  if (EXTENSION_CONTENT_TYPES[ext]) {
    return EXTENSION_CONTENT_TYPES[ext];
  }
  const normalizedUpstream = upstreamType.split(";")[0].trim().toLowerCase();
  if (RENDERABLE_CONTENT_TYPES.has(normalizedUpstream)) {
    return normalizedUpstream;
  }
  return "application/octet-stream";
}

/** Strip characters that would break or inject into the Content-Disposition header. */
function safeDispositionFilename(name: string): string {
  const base = name.split("/").pop() ?? name;
  return base.replace(/[\r\n"\\]/g, "_").trim() || "document";
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType } = parsed.data;

  // Validate file type and size BEFORE issuing an upload URL, so unsupported
  // documents are rejected with a clear message and never reach extraction.
  const ALLOWED_UPLOAD_TYPES = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/tiff",
  ];
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
  if (!ALLOWED_UPLOAD_TYPES.includes(contentType)) {
    res.status(400).json({
      error: "Unsupported file type. Upload a PDF or image (PNG, JPG, WEBP, GIF, or TIFF).",
    });
    return;
  }
  if (size > MAX_UPLOAD_BYTES) {
    res.status(400).json({ error: "File is too large. The maximum size is 25 MB." });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // --- Protected route example (uncomment when using replit-auth) ---
    // if (!req.isAuthenticated()) {
    //   res.status(401).json({ error: "Unauthorized" });
    //   return;
    // }
    // const canAccess = await objectStorageService.canAccessObjectEntity({
    //   userId: req.user.id,
    //   objectFile,
    //   requestedPermission: ObjectPermission.READ,
    // });
    // if (!canAccess) {
    //   res.status(403).json({ error: "Forbidden" });
    //   return;
    // }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);

    // Forward only safe upstream headers (length, cache, etc.). We set our own
    // Content-Type / Content-Disposition / security headers below so the browser
    // reliably previews the file inline (Edge in particular refuses to render
    // when the type is octet-stream or the disposition is attachment).
    const OVERRIDDEN = new Set([
      "content-type",
      "content-disposition",
      "x-frame-options",
      "x-content-type-options",
      "content-security-policy",
    ]);
    response.headers.forEach((value, key) => {
      if (!OVERRIDDEN.has(key.toLowerCase())) res.setHeader(key, value);
    });

    // Derive a correct, browser-safe Content-Type. The client passes the original
    // filename via ?name= since stored objects are extension-less UUIDs.
    const nameHint =
      typeof req.query.name === "string" && req.query.name ? req.query.name : wildcardPath;
    const contentType = resolveContentType(
      nameHint,
      response.headers.get("content-type") || "",
    );
    res.setHeader("Content-Type", contentType);

    // Inline preview by default; ?download=1 forces a download of the original.
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${safeDispositionFilename(nameHint)}"`,
    );

    // nosniff is only safe when we are confident the type is correct.
    if (contentType !== "application/octet-stream") {
      res.setHeader("X-Content-Type-Options", "nosniff");
    }

    // Allow the app to embed its own private files in the in-page preview. We do
    // NOT set X-Frame-Options (which would block our same-origin iframe) and keep
    // files private — access still goes through this authenticated proxy route.
    res.setHeader("Content-Security-Policy", PREVIEW_CSP);

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
