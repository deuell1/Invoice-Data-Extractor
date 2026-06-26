# Phase 1 UAT — Microsoft Edge Inline Rendering Checklist

Manual verification of inline document rendering in **Microsoft Edge** (the one
Phase 1 item that cannot be driven from the automated environment). The
underlying configuration has been verified in code and over the wire; this
checklist confirms the live browser experience.

## Pre-verified configuration (already confirmed)

These were confirmed by inspecting the code and the storage response headers, so
the manual pass below should succeed:

- The review screen renders **PDFs inline** in an `<iframe>` and **JPG/PNG inline**
  in an `<img>` — not as download links.
- Multi-invoice PDFs open at the invoice's first page via a `#page=N` fragment.
- Document URLs use the **private server-proxy** route (`/storage/objects/...`).
  No signed/public URLs are exposed in the UI; files stay private.
- Storage responses send: `Content-Type: application/pdf` (or image type),
  `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, a
  `Content-Security-Policy` allowing `frame-src/img-src 'self' blob: data:`, and
  **no `X-Frame-Options`** header (so the iframe is not blocked).
- The **Open** and **Download** buttons are present only as fallbacks; Download
  uses `Content-Disposition: attachment` (`?download=1`).

## Manual steps in Microsoft Edge

Open the app in Edge (current stable channel) and sign in / load the invoice
list, then verify each item. Mark PASS/FAIL and note the Edge version.

> Edge version tested: `__________`   Date: `__________`   Tester: `__________`

| # | Check | Expected | Result (PASS/FAIL) | Notes |
|---|---|---|---|---|
| 1 | Open a **PDF** invoice in the review screen | PDF renders **inline** in the viewer pane (no separate tab needed) | | |
| 2 | Open a **JPG** invoice | Image renders **inline** in the viewer pane | | |
| 3 | Open a **PNG** invoice | Image renders **inline** in the viewer pane | | |
| 4 | Open an invoice split from a **multi-invoice PDF** | Viewer opens/jumps to the **correct page** for that invoice | | |
| 5 | Observe layout while reviewing | Document viewer stays **beside the extracted data** (side-by-side) | | |
| 6 | Locate Open / Download controls | Present as **fallback only**; not required to read the document | | |
| 7 | Complete a review end-to-end | Review can be finished **without opening the document in a separate tab** | | |
| 8 | Click **Download** | File downloads as an attachment (original file) | | |
| 9 | Confirm privacy | Document loads through the app proxy; **no signed/public URL** is visible in the address bar or page source | | |

## If any inline check FAILS

Do **not** switch to public/signed URLs. Instead:

1. Confirm the storage response headers in Edge DevTools → Network:
   - `Content-Type` matches the file (`application/pdf`, `image/jpeg`, `image/png`).
   - `Content-Disposition: inline` (for the viewer request, not the download one).
   - `X-Content-Type-Options: nosniff` present.
   - **No** `X-Frame-Options` header.
   - `Content-Security-Policy` permits framing/images from `'self' blob: data:`.
2. Fix the **response headers** (in `artifacts/api-server/src/routes/storage.ts`)
   or the **preview component** (`artifacts/invoice-capture/src/pages/extraction-review.tsx`)
   as needed — keep files private and keep the server-proxy access path.
3. Re-run this checklist.

## Recording the result

Update **section 2 (area 16) and section 7** of `Phase1_UAT_Exit_Report.md`:
- If all inline checks (1–7, 9) PASS → mark **Edge runtime verification closed**.
- If any inline check FAILS → keep the item **OPEN** and log a defect.
