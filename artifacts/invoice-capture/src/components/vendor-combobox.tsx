import { useState, useMemo, useRef, useEffect } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
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
  // partial word match
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search input when the popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery("");
    }
  }, [open]);

  // Derive sorted list of vendors for the current query (or pre-ranked by
  // vendorRawName when the input is empty).
  const ranked = useMemo(() => {
    const searchTerm = query.trim() || vendorRawName;

    if (!searchTerm) {
      return vendors.map((v) => ({ vendor: v, score: 0, matchedOn: "name" as const, alias: undefined as string | undefined }));
    }

    return vendors
      .map((v) => {
        const { score, matchedOn, alias } = bestScore(searchTerm, v);
        return { vendor: v, score, matchedOn, alias };
      })
      .sort((a, b) => b.score - a.score);
  }, [query, vendors, vendorRawName]);

  // Split into "good matches" (score ≥ 0.3) and "others" when there's a query.
  const { suggested, rest } = useMemo(() => {
    const term = query.trim();
    if (!term) return { suggested: [], rest: ranked };
    const suggested = ranked.filter((r) => r.score >= 0.3);
    const rest = ranked.filter((r) => r.score < 0.3);
    return { suggested, rest };
  }, [ranked, query]);

  const selectedVendor = vendors.find((v) => v.id.toString() === value);

  const handleSelect = (vendorId: string) => {
    onSelect(vendorId);
    setOpen(false);
  };

  const renderItem = ({ vendor, matchedOn, alias }: typeof ranked[number]) => {
    const isSelected = vendor.id.toString() === value;
    return (
      <CommandItem
        key={vendor.id}
        value={vendor.id.toString()}
        onSelect={handleSelect}
        className="flex items-center justify-between gap-2"
        keywords={[vendor.vendorName, vendor.vendorCode, ...(vendor.aliases ?? [])]}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Check className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
          <div className="min-w-0">
            <div className="truncate font-medium text-sm">{vendor.vendorName}</div>
            {matchedOn === "alias" && alias && (
              <div className="text-xs text-muted-foreground truncate">alias: {alias}</div>
            )}
          </div>
        </div>
        <span className="text-xs text-muted-foreground shrink-0 font-mono">{vendor.vendorCode}</span>
      </CommandItem>
    );
  };

  return (
    <div className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            data-testid="select-vendor"
            className={cn(
              "w-full justify-between font-normal",
              !selectedVendor && "text-muted-foreground",
              triggerClassName,
            )}
          >
            <span className="truncate">
              {selectedVendor ? selectedVendor.vendorName : "Select vendor…"}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="p-0 w-[--radix-popover-trigger-width]"
          align="start"
          sideOffset={4}
        >
          <Command shouldFilter={false}>
            <CommandInput
              ref={inputRef}
              placeholder="Search vendor name, code, or alias…"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No vendors found.</CommandEmpty>

              {query.trim() ? (
                <>
                  {suggested.length > 0 && (
                    <CommandGroup heading="Best matches">
                      {suggested.map(renderItem)}
                    </CommandGroup>
                  )}
                  {rest.length > 0 && (
                    <CommandGroup heading="All vendors">
                      {rest.map(renderItem)}
                    </CommandGroup>
                  )}
                </>
              ) : (
                <CommandGroup heading={vendorRawName ? "Suggested (based on extracted name)" : "All vendors"}>
                  {ranked.map(renderItem)}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
