import { useState, useMemo, useRef, useEffect } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Vendor } from "@workspace/api-client-react";

// ─── Scoring ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.max(ta.size, tb.size);
}

function scoreCandidate(query: string, candidate: string): number {
  if (!query || !candidate) return 0;
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;
  if (c === q) return 1.0;
  if (c.startsWith(q)) return 0.9;
  if (q.startsWith(c)) return 0.85;
  if (c.includes(q)) return 0.75;
  if (q.includes(c)) return 0.7;
  const overlap = tokenOverlap(q, c);
  if (overlap > 0) return 0.5 + overlap * 0.2;
  const qTokens = q.split(" ").filter(Boolean);
  if (qTokens.some((t) => c.includes(t) && t.length > 2)) return 0.35;
  return 0;
}

type MatchedOn = "name" | "code" | "alias";

function bestScore(query: string, vendor: Vendor): { score: number; matchedOn: MatchedOn; alias?: string } {
  let best: { score: number; matchedOn: MatchedOn; alias?: string } = {
    score: scoreCandidate(query, vendor.vendorName),
    matchedOn: "name",
    alias: undefined,
  };
  const codeScore = scoreCandidate(query, vendor.vendorCode);
  if (codeScore > best.score) best = { score: codeScore, matchedOn: "code", alias: undefined };
  for (const alias of vendor.aliases ?? []) {
    const s = scoreCandidate(query, alias);
    if (s > best.score) best = { score: s, matchedOn: "alias", alias };
  }
  return best;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface VendorComboboxProps {
  value: string;
  onSelect: (vendorId: string) => void;
  vendors: Vendor[];
  vendorRawName?: string;
  className?: string;
  disabled?: boolean;
  triggerClassName?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

const MAX_UNFILTERED = 120;

export function VendorCombobox({
  value,
  onSelect,
  vendors,
  vendorRawName = "",
  className,
  triggerClassName,
  disabled = false,
}: VendorComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedVendor = vendors.find((v) => v.id.toString() === value);

  // Reset search query whenever the selected vendor changes externally.
  useEffect(() => {
    setQuery("");
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // Scroll the highlighted item into view when keyboard navigating.
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null;
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Full ranked list for the current query (or pre-ranked by vendorRawName when
  // the search box is empty, so the most likely match floats to the top).
  const ranked = useMemo(() => {
    const searchTerm = query.trim() || vendorRawName;
    if (!searchTerm) {
      return vendors
        .slice(0, MAX_UNFILTERED)
        .map((v) => ({ vendor: v, score: 0, matchedOn: "name" as const, alias: undefined as string | undefined }));
    }
    return vendors
      .map((v) => {
        const { score, matchedOn, alias } = bestScore(searchTerm, v);
        return { vendor: v, score, matchedOn, alias };
      })
      .sort((a, b) => b.score - a.score);
  }, [query, vendors, vendorRawName]);

  // Split into "best matches" (score ≥ 0.3) and "all others" only when the
  // user is actively typing; show a single pre-ranked group otherwise.
  const { suggested, rest } = useMemo(() => {
    if (!query.trim()) return { suggested: [] as typeof ranked, rest: ranked };
    return {
      suggested: ranked.filter((r) => r.score >= 0.3),
      rest: ranked.filter((r) => r.score < 0.3),
    };
  }, [ranked, query]);

  const flatList = useMemo(() => [...suggested, ...rest], [suggested, rest]);

  const handleSelect = (vendorId: string) => {
    onSelect(vendorId);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleClear = () => {
    onSelect("");
    setQuery("");
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
        setActiveIndex(0);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, flatList.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (flatList[activeIndex]) handleSelect(flatList[activeIndex].vendor.id.toString());
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
        break;
      case "Tab":
        setOpen(false);
        setQuery("");
        break;
    }
  };

  // While the dropdown is open we show what the user is typing. When it's
  // closed we always show the controlled vendor name so the field reads like a
  // normal text field.
  const displayValue = open ? query : (selectedVendor?.vendorName ?? "");

  const renderItem = (item: typeof ranked[number], flatIdx: number) => {
    const { vendor, matchedOn, alias } = item;
    const isSelected = vendor.id.toString() === value;
    const isActive = flatIdx === activeIndex;
    return (
      <div
        key={vendor.id}
        data-idx={flatIdx}
        role="option"
        aria-selected={isSelected}
        onPointerDown={(e) => {
          e.preventDefault();
          handleSelect(vendor.id.toString());
        }}
        onMouseEnter={() => setActiveIndex(flatIdx)}
        className={cn(
          "flex items-center justify-between gap-3 px-3 py-2 cursor-pointer text-sm",
          isActive && "bg-accent text-accent-foreground",
          !isActive && "hover:bg-accent/50",
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Check
            className={cn("h-3.5 w-3.5 shrink-0 text-primary", isSelected ? "opacity-100" : "opacity-0")}
          />
          <div className="min-w-0">
            <div className="truncate font-medium leading-tight">{vendor.vendorName}</div>
            {matchedOn === "alias" && alias && (
              <div className="text-xs text-muted-foreground truncate">alias: {alias}</div>
            )}
            {matchedOn === "code" && (
              <div className="text-xs text-muted-foreground truncate">code match</div>
            )}
          </div>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 font-mono">{vendor.vendorCode}</span>
      </div>
    );
  };

  const suggestedOffset = 0;
  const restOffset = suggested.length;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* ── Inline input ─────────────────────────────────────────────── */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          data-testid="select-vendor"
          disabled={disabled}
          value={displayValue}
          placeholder={open ? "Search vendor name, code, or alias…" : "Select vendor…"}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-8 text-sm shadow-sm transition-colors",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            triggerClassName,
          )}
        />
        {/* Clear button — only shown when a vendor is selected */}
        {selectedVendor && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={(e) => { e.preventDefault(); handleClear(); }}
            aria-label="Clear vendor selection"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus:outline-none"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* ── Dropdown list ────────────────────────────────────────────── */}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md overflow-y-auto max-h-72"
        >
          {flatList.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground select-none">
              No vendors found.
            </div>
          ) : (
            <>
              {query.trim() ? (
                <>
                  {suggested.length > 0 && (
                    <div>
                      <div className="sticky top-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-popover border-b select-none">
                        Best matches
                      </div>
                      {suggested.map((item, i) => renderItem(item, suggestedOffset + i))}
                    </div>
                  )}
                  {rest.length > 0 && (
                    <div>
                      <div className="sticky top-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-popover border-b border-t select-none">
                        All vendors
                      </div>
                      {rest.map((item, i) => renderItem(item, restOffset + i))}
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <div className="sticky top-0 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-popover border-b select-none">
                    {vendorRawName ? "Suggested — based on extracted name" : "All vendors"}
                  </div>
                  {ranked.map((item, i) => renderItem(item, i))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
