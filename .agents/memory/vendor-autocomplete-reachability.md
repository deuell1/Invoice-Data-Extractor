---
name: Vendor autocomplete reachability
description: Why the vendor combobox must load the full vendor list, not a capped window
---

The vendor combobox ranks candidates by name, code, and aliases **client-side**.
The server `/vendors?search=` endpoint filters by `vendorName` **only** (no code, no
alias). So code/alias search depends entirely on the full vendor list being loaded
into the component.

**Rule:** the screens that mount the vendor combobox must fetch the entire vendor
master (load-all), not a capped page. A capped `limit` silently makes vendors outside
the window unreachable by *any* search term (name, code, or alias), even though the
client-side scorer supports all three.

**Why:** during Phase 1 UAT this surfaced as a Medium defect — extraction-review
loaded 500 and the exception-queue edit modal loaded 100, out of 568 vendors, so the
tail of the alphabet could not be selected at all.

**How to apply:** if the vendor master can grow past the fetch limit, either (a) move
code+alias matching into the server search and drive the combobox from the server
query, or (b) fetch all pages until complete. A static large `limit` (e.g. 1000) is a
stopgap that reintroduces truncation once the count exceeds it.
