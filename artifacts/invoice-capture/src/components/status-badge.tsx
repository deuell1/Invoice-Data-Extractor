import { Badge } from "@/components/ui/badge";

type Status = 
  | "PENDING_EXTRACTION"
  | "EXCEPTION"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "POSTED"
  | "VOIDED";

interface StatusBadgeProps {
  status: Status | string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  switch (status) {
    case "PENDING_EXTRACTION":
      return <Badge variant="secondary" className={className} data-testid={`status-${status}`}>Extracting</Badge>;
    case "EXCEPTION":
      return <Badge variant="destructive" className={className} data-testid={`status-${status}`}>Exception</Badge>;
    case "PENDING_APPROVAL":
      return <Badge variant="default" className={`bg-amber-500 hover:bg-amber-600 text-white ${className}`} data-testid={`status-${status}`}>Needs Approval</Badge>;
    case "APPROVED":
      return <Badge variant="default" className={`bg-emerald-500 hover:bg-emerald-600 text-white ${className}`} data-testid={`status-${status}`}>Approved</Badge>;
    case "POSTED":
      return <Badge variant="outline" className={`border-emerald-500 text-emerald-600 ${className}`} data-testid={`status-${status}`}>Posted</Badge>;
    case "VOIDED":
      return <Badge variant="outline" className={`border-muted-foreground/40 text-muted-foreground line-through ${className}`} data-testid={`status-${status}`}>Voided</Badge>;
    default:
      return <Badge variant="outline" className={className} data-testid={`status-unknown`}>{status}</Badge>;
  }
}
