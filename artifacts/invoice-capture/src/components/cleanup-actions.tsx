import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useVoidInvoice,
  useDeleteInvoice,
  useRemoveSourceDocument,
  useDeleteSourceDocument,
  getListInvoicesQueryKey,
  getGetInvoiceStatsQueryKey,
  getGetInvoiceQueryKey,
  getGetInvoiceAuditLogQueryKey,
  getGetSourceDocumentQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/utils";
import { Ban, Trash2, Loader2 } from "lucide-react";

/** Invalidate every query whose data can be affected by a cleanup action. */
function useInvalidateCleanupQueries() {
  const queryClient = useQueryClient();
  return (opts?: { invoiceId?: number; sourceDocumentId?: number }) => {
    queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetInvoiceStatsQueryKey() });
    if (opts?.invoiceId != null) {
      queryClient.invalidateQueries({ queryKey: getGetInvoiceQueryKey(opts.invoiceId) });
      queryClient.invalidateQueries({ queryKey: getGetInvoiceAuditLogQueryKey(opts.invoiceId) });
    }
    if (opts?.sourceDocumentId != null) {
      queryClient.invalidateQueries({ queryKey: getGetSourceDocumentQueryKey(opts.sourceDocumentId) });
    }
  };
}

// ─── Removal (void) dialog ───────────────────────────────────────────────────

interface RemovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: (reason: string, note: string) => void;
}

function RemovalDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: RemovalDialogProps) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setReason("");
      setNote("");
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="dialog-removal">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="removal-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="removal-reason"
              placeholder="e.g. Duplicate upload, wrong vendor, test data"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="input-removal-reason"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="removal-note">Note (optional)</Label>
            <Textarea
              id="removal-note"
              placeholder="Add any extra context…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="input-removal-note"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || reason.trim().length === 0}
            onClick={() => onConfirm(reason.trim(), note.trim())}
            data-testid="button-confirm-removal"
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Hard-delete dialog (type-to-confirm) ────────────────────────────────────

interface HardDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  pending: boolean;
  onConfirm: () => void;
}

function HardDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  pending,
  onConfirm,
}: HardDeleteDialogProps) {
  const [confirmText, setConfirmText] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (!next) setConfirmText("");
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="dialog-hard-delete">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="hard-delete-confirm">
            Type <span className="font-mono font-semibold">DELETE</span> to confirm
          </Label>
          <Input
            id="hard-delete-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            data-testid="input-hard-delete-confirm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || confirmText !== "DELETE"}
            onClick={onConfirm}
            data-testid="button-confirm-hard-delete"
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Permanently delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invoice cleanup actions ─────────────────────────────────────────────────

interface InvoiceCleanupActionsProps {
  invoiceId: number;
  status: string;
  /** Render style: inline buttons (detail page) or compact icon buttons (rows). */
  variant?: "buttons" | "compact";
  /** Called after a successful void or delete (e.g. to navigate away). */
  onVoided?: () => void;
  onDeleted?: () => void;
}

export function InvoiceCleanupActions({
  invoiceId,
  status,
  variant = "buttons",
  onVoided,
  onDeleted,
}: InvoiceCleanupActionsProps) {
  const { toast } = useToast();
  const invalidate = useInvalidateCleanupQueries();
  const [voidOpen, setVoidOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const voidInvoice = useVoidInvoice();
  const deleteInvoice = useDeleteInvoice();

  const isVoided = status === "VOIDED";
  const isPosted = status === "POSTED";

  const handleVoid = async (reason: string, note: string) => {
    try {
      await voidInvoice.mutateAsync({ id: invoiceId, data: { reason, note: note || null } });
      toast({ title: "Invoice voided", description: "It's been removed from active queues." });
      setVoidOpen(false);
      invalidate({ invoiceId });
      onVoided?.();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not void", description: getApiErrorMessage(e) || "Please try again." });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteInvoice.mutateAsync({ id: invoiceId, data: { confirm: true } });
      toast({ title: "Invoice deleted", description: "The record was permanently removed." });
      setDeleteOpen(false);
      invalidate({ invoiceId });
      onDeleted?.();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not delete", description: getApiErrorMessage(e) || "Please try again." });
    }
  };

  const compact = variant === "compact";

  return (
    <>
      {!isVoided && (
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          onClick={() => setVoidOpen(true)}
          data-testid={`button-void-invoice-${invoiceId}`}
        >
          <Ban className={compact ? "h-4 w-4" : "mr-2 h-4 w-4"} />
          {!compact && "Void"}
        </Button>
      )}
      {!isPosted && (
        <Button
          variant="ghost"
          size={compact ? "sm" : "default"}
          className="text-destructive hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
          data-testid={`button-delete-invoice-${invoiceId}`}
        >
          <Trash2 className={compact ? "h-4 w-4" : "mr-2 h-4 w-4"} />
          {!compact && "Delete"}
        </Button>
      )}

      <RemovalDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title="Void this invoice?"
        description="Voided invoices are hidden from active queues, KPIs, exports and duplicate checks. You can still view them with the Show removed filter. This does not delete any data."
        confirmLabel="Void invoice"
        pending={voidInvoice.isPending}
        onConfirm={handleVoid}
      />
      <HardDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Permanently delete this invoice?"
        description="This permanently removes the invoice and its history. This cannot be undone — intended for test data cleanup. Posted invoices cannot be deleted."
        pending={deleteInvoice.isPending}
        onConfirm={handleDelete}
      />
    </>
  );
}

// ─── Source-document cleanup actions ─────────────────────────────────────────

interface SourceDocumentCleanupActionsProps {
  sourceDocumentId: number;
  /** True when any child invoice is posted (hard delete is blocked). */
  hasPostedChild: boolean;
  onRemoved?: () => void;
  onDeleted?: () => void;
  children?: ReactNode;
}

export function SourceDocumentCleanupActions({
  sourceDocumentId,
  hasPostedChild,
  onRemoved,
  onDeleted,
}: SourceDocumentCleanupActionsProps) {
  const { toast } = useToast();
  const invalidate = useInvalidateCleanupQueries();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const removeSourceDocument = useRemoveSourceDocument();
  const deleteSourceDocument = useDeleteSourceDocument();

  const handleRemove = async (reason: string, note: string) => {
    try {
      await removeSourceDocument.mutateAsync({
        id: sourceDocumentId,
        data: { reason, note: note || null },
      });
      toast({ title: "File removed", description: "All of its invoices were voided." });
      setRemoveOpen(false);
      invalidate({ sourceDocumentId });
      onRemoved?.();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not remove", description: getApiErrorMessage(e) || "Please try again." });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteSourceDocument.mutateAsync({ id: sourceDocumentId, data: { confirm: true } });
      toast({ title: "File deleted", description: "The file and all its invoices were permanently removed." });
      setDeleteOpen(false);
      invalidate({ sourceDocumentId });
      onDeleted?.();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not delete", description: getApiErrorMessage(e) || "Please try again." });
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRemoveOpen(true)}
          data-testid="button-remove-source"
        >
          <Ban className="mr-2 h-4 w-4" />
          Remove file
        </Button>
        {!hasPostedChild && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            data-testid="button-delete-source"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </Button>
        )}
      </div>

      <RemovalDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Remove this file?"
        description="This voids every invoice detected in this file and hides them from active queues, KPIs, exports and duplicate checks. No data is deleted."
        confirmLabel="Remove file"
        pending={removeSourceDocument.isPending}
        onConfirm={handleRemove}
      />
      <HardDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Permanently delete this file?"
        description="This permanently removes the uploaded file, every invoice detected in it, and their history. This cannot be undone — intended for test data cleanup."
        pending={deleteSourceDocument.isPending}
        onConfirm={handleDelete}
      />
    </>
  );
}
