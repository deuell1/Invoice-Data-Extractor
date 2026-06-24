---
name: Stored-object inline preview headers
description: Why the storage proxy must override Content-Type/Disposition for in-browser invoice previews.
---

Uploaded invoice files are stored under opaque, **extension-less UUID** object keys (`uploads/<uuid>`), and the GCS-stored `Content-Type` is unreliable (often `application/octet-stream`). The `/storage/objects/*` proxy must therefore NOT just forward upstream headers.

To make in-page iframe/img previews work (Microsoft Edge in particular refuses to render `application/octet-stream` or `Content-Disposition: attachment`), the proxy:
- derives Content-Type from the original filename passed by the client via `?name=` (mapping pdf/png/jpg/jpeg/webp/gif/tiff), falling back to upstream only if it's already renderable, else octet-stream;
- serves `Content-Disposition: inline` (and `attachment` when `?download=1`);
- sets `X-Content-Type-Options: nosniff` only when the type is confidently known;
- does NOT set `X-Frame-Options` (would block the app's own same-origin iframe);
- skips forwarding upstream content-type/disposition/security headers so its own win.

Client builds the URL with each path segment URL-encoded (filenames contain spaces, `#`, `%`, etc.) plus `?name=`.

**Why:** Edge treats octet-stream/attachment as a download, so the preview pane went blank; the correct MIME + inline disposition fixes it cross-browser.
**How to apply:** Any new file-preview surface must use the same `?name=`-driven proxy URL; don't expose signed URLs or serve files from a public bucket. Note: this MVP has no auth framework, so the proxy route is intentionally unauthenticated until an auth integration is added — re-enable the commented ACL/`isAuthenticated` checks then.
