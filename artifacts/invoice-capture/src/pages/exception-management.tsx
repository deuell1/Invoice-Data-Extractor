import { useState } from "react";
import { Link } from "wouter";
import {
  useListExceptions,
  getListExceptionsQueryKey,
  useGetExceptionEvents,
  getGetExceptionEventsQueryKey,
  useAssignException,
  useReviewException,
  useAddExceptionNote,
  useReturnExceptionToApproval,
  type Invoice,
  type ListExceptionsParams,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Loader2, AlertTriangle, Search, CheckCircle2, Circle, UserPlus, MessageSquarePlus,
  CheckCheck, ArrowRightCircle, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, History,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

type SortBy = "age" | "vendorName" | "totalAmount" | "confidenceScore" | "status";
type SortDir = "asc" | "desc";
type ReviewedFilter = "ALL" | "REVIEWED" | "UNREVIEWED";

const PAGE_SIZE = 10;
const DEFAULT_ACTOR = "ap.clerk";

function formatAmount(value: number | null | undefined, currency?: string) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(value);
}

function SortIcon({ col, sortBy, sortDir }: { col: SortBy; sortBy: SortBy; sortDir: SortDir }) {
  if (sortBy !== col) return <ArrowUpDown className="h-3 w-3 ml-1 text-muted-foreground/50" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
    : <ArrowDown className="h-3 w-3 ml-1 text-primary" />;
}

function EventTimeline({ invoiceId }: { invoiceId: number }) {
  const { data: events, isLoading } = useGetExceptionEvents(invoiceId, {
    query: { queryKey: getGetExceptionEventsQueryKey(invoiceId) },
  });

  if (isLoading) {
    return (
      <div className="py-3 text-center text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
        Loading activity…
      </div>
    );
  }

  if (!events || events.length === 0) {
    return <div className="py-3 text-xs text-muted-foreground text-center">No activity recorded yet.</div>;
  }

  return (
    <div className="space-y-2 max-h-56 overflow-y-auto pr-1" data-testid="exception-timeline">
      {events.map((event) => (
        <div key={event.id} className="text-xs flex gap-2 items-start border-l-2 border-muted pl-2 py-1">
          <span className="text-muted-foreground whitespace-nowrap">
            {format(new Date(event.createdAt), "MMM d HH:mm")}
          </span>
          <div className="space-y-0.5">
            <div>
              <span className="font-medium">{event.eventType.replace(/_/g, " ")}</span>
              {event.actor && <span className="text-muted-foreground ml-1">· {event.actor}</span>}
            </div>
            {event.note && <div className="text-muted-foreground">{event.note}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ManageExceptionDialog({
  invoice,
  open,
  onClose,
}: {
  invoice: Invoice;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [owner, setOwner] = useState(invoice.exceptionOwner ?? "");
  const [actor, setActor] = useState(DEFAULT_ACTOR);
  const [note, setNote] = useState("");

  const assignException = useAssignException();
  const reviewException = useReviewException();
  const addNote = useAddExceptionNote();
  const returnToApproval = useReturnExceptionToApproval();

  const isReviewed = !!invoice.exceptionReviewedAt;

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/exceptions"] });
    queryClient.invalidateQueries({ queryKey: getGetExceptionEventsQueryKey(invoice.id) });
  };

  const effectiveActor = actor.trim() || DEFAULT_ACTOR;

  const handleAssign = async () => {
    if (!owner.trim()) {
      toast({ variant: "destructive", title: "Owner required", description: "Enter an owner to assign." });
      return;
    }
    try {
      await assignException.mutateAsync({ id: invoice.id, data: { owner: owner.trim(), actor: effectiveActor } });
      toast({ title: "Assigned", description: `Exception assigned to ${owner.trim()}.` });
      refetch();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to assign owner." });
    }
  };

  const handleReview = async () => {
    try {
      await reviewException.mutateAsync({ id: invoice.id, data: { reviewed: true, actor: effectiveActor } });
      toast({ title: "Marked reviewed", description: "Exception marked as reviewed." });
      refetch();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to mark reviewed." });
    }
  };

  const handleAddNote = async () => {
    if (!note.trim()) {
      toast({ variant: "destructive", title: "Note required", description: "Enter a note to add." });
      return;
    }
    try {
      await addNote.mutateAsync({ id: invoice.id, data: { note: note.trim(), actor: effectiveActor } });
      toast({ title: "Note added", description: "Internal note recorded." });
      setNote("");
      refetch();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to add note." });
    }
  };

  const handleReturn = async () => {
    try {
      await returnToApproval.mutateAsync({ id: invoice.id, data: { actor: effectiveActor } });
      toast({ title: "Returned", description: "Exception returned to the approval queue." });
      refetch();
      onClose();
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e?.data?.error || "Failed to return to approval.",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Exception</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {invoice.documentId || invoice.invoiceNumber || `Invoice #${invoice.id}`} · {invoice.vendorName || "Unknown Vendor"}
          </p>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Amount</span>
              <div className="font-medium">{formatAmount(invoice.totalAmount, invoice.currency)}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Reason</span>
              <div className="font-medium">{invoice.exceptionReason || "Data mismatch"}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Owner</span>
              <div className="font-medium">{invoice.exceptionOwner || "Unassigned"}</div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Reviewed</span>
              <div className="font-medium">
                {isReviewed
                  ? `Yes · ${format(new Date(invoice.exceptionReviewedAt as string), "MMM d, yyyy HH:mm")}`
                  : "No"}
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="actor" className="text-xs">Actor</Label>
            <Input
              id="actor"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder={DEFAULT_ACTOR}
              data-testid="input-actor"
            />
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assign Owner</Label>
            <div className="flex gap-2">
              <Input
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="e.g. jane.doe"
                data-testid="input-owner"
              />
              <Button onClick={handleAssign} disabled={assignException.isPending} data-testid="button-assign">
                {assignException.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
                Assign
              </Button>
            </div>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add Note</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add an internal note about this exception…"
              rows={3}
              data-testid="input-note"
            />
            <div className="flex justify-end">
              <Button variant="outline" onClick={handleAddNote} disabled={addNote.isPending} data-testid="button-add-note">
                {addNote.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquarePlus className="mr-2 h-4 w-4" />}
                Add Note
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              variant="outline"
              onClick={handleReview}
              disabled={reviewException.isPending || isReviewed}
              data-testid="button-review"
            >
              {reviewException.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
              {isReviewed ? "Reviewed" : "Mark Reviewed"}
            </Button>
            <Button
              onClick={handleReturn}
              disabled={returnToApproval.isPending}
              data-testid="button-return-approval"
            >
              {returnToApproval.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightCircle className="mr-2 h-4 w-4" />}
              Return to Approval
            </Button>
            <Link href={`/invoices/${invoice.id}`}>
              <Button variant="secondary" data-testid="button-review-data">Review Data</Button>
            </Link>
          </div>

          <div className="space-y-2 border-t pt-4">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <History className="h-3.5 w-3.5" />
              Activity Timeline
            </Label>
            <EventTimeline invoiceId={invoice.id} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ExceptionManagement() {
  const [reason, setReason] = useState("");
  const [owner, setOwner] = useState("");
  const [reviewed, setReviewed] = useState<ReviewedFilter>("ALL");
  const [sortBy, setSortBy] = useState<SortBy>("age");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [managing, setManaging] = useState<Invoice | null>(null);

  const queryParams: ListExceptionsParams = {
    reason: reason || undefined,
    owner: owner || undefined,
    reviewed: reviewed === "ALL" ? undefined : reviewed === "REVIEWED",
    sortBy,
    sortDir,
    page,
    limit: PAGE_SIZE,
  };

  const { data: res, isLoading } = useListExceptions(queryParams, {
    query: { queryKey: getListExceptionsQueryKey(queryParams) },
  });

  const totalPages = Math.max(1, Math.ceil((res?.total ?? 0) / PAGE_SIZE));

  const handleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
    setPage(1);
  };

  const SortableHead = ({ col, children, className }: { col: SortBy; children: React.ReactNode; className?: string }) => (
    <TableHead
      className={cn("cursor-pointer select-none hover:bg-muted/30 transition-colors", className)}
      onClick={() => handleSort(col)}
      data-testid={`sort-${col}`}
    >
      <span className="flex items-center">
        {children}
        <SortIcon col={col} sortBy={sortBy} sortDir={sortDir} />
      </span>
    </TableHead>
  );

  return (
    <div className="space-y-6 flex flex-col h-full">
      <div className="shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-destructive flex items-center gap-2">
          <AlertTriangle className="h-6 w-6" />
          Exception Management
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Assign, review, and resolve invoices in exception</p>
      </div>

      <Card className="flex-1 flex flex-col min-h-0 border-destructive/20">
        <CardContent className="p-4 shrink-0 border-b">
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Reason contains</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8 h-9"
                  placeholder="e.g. tie-out"
                  value={reason}
                  onChange={(e) => { setReason(e.target.value); setPage(1); }}
                  data-testid="filter-reason"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Owner</Label>
              <Input
                className="h-9"
                placeholder="e.g. jane.doe"
                value={owner}
                onChange={(e) => { setOwner(e.target.value); setPage(1); }}
                data-testid="filter-owner"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reviewed</Label>
              <Select value={reviewed} onValueChange={(v) => { setReviewed(v as ReviewedFilter); setPage(1); }}>
                <SelectTrigger className="h-9" data-testid="filter-reviewed"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="REVIEWED">Reviewed</SelectItem>
                  <SelectItem value="UNREVIEWED">Not reviewed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sort by</Label>
              <Select value={sortBy} onValueChange={(v) => { setSortBy(v as SortBy); setPage(1); }}>
                <SelectTrigger className="h-9" data-testid="filter-sort"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="age">Age</SelectItem>
                  <SelectItem value="vendorName">Vendor</SelectItem>
                  <SelectItem value="totalAmount">Amount</SelectItem>
                  <SelectItem value="confidenceScore">Confidence</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>

        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead>Document ID</TableHead>
                <SortableHead col="vendorName">Vendor</SortableHead>
                <SortableHead col="totalAmount">Amount</SortableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Reviewed</TableHead>
                <SortableHead col="age">Age</SortableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : res?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <p>No exceptions match these filters.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                res?.data?.map((invoice) => {
                  const isReviewed = !!invoice.exceptionReviewedAt;
                  return (
                    <TableRow key={invoice.id} data-testid={`row-exception-${invoice.id}`}>
                      <TableCell className="font-medium">{invoice.documentId || invoice.invoiceNumber || "—"}</TableCell>
                      <TableCell>{invoice.vendorName || "—"}</TableCell>
                      <TableCell>{formatAmount(invoice.totalAmount, invoice.currency)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-destructive border-destructive/50 bg-destructive/5">
                          {invoice.exceptionReason || "Data mismatch"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {invoice.exceptionOwner || <span className="text-muted-foreground">Unassigned</span>}
                      </TableCell>
                      <TableCell>
                        {isReviewed ? (
                          <span className="flex items-center gap-1 text-emerald-600 text-sm">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Reviewed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-muted-foreground text-sm">
                            <Circle className="h-3.5 w-3.5" /> No
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                        {formatDistanceToNow(new Date(invoice.createdAt), { addSuffix: true })}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setManaging(invoice)}
                          data-testid={`button-manage-${invoice.id}`}
                        >
                          Manage
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>

        {(res?.total ?? 0) > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t shrink-0 text-sm text-muted-foreground">
            <span>
              {res?.total ?? 0} exception{res?.total !== 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                data-testid="button-prev-page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm">Page {page} of {totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                data-testid="button-next-page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {managing && (
        <ManageExceptionDialog
          invoice={managing}
          open={true}
          onClose={() => setManaging(null)}
        />
      )}
    </div>
  );
}
