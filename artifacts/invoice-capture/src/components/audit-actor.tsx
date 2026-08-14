import { Badge } from "@workspace/mission-control-ds/components/ui/badge";
import { Bot, User } from "lucide-react";

/**
 * Renders who performed an audit-log action, distinguishing people from
 * automation:
 *  - actorClerkId "system-pipeline"      → "System" badge (automated step)
 *  - actorClerkId "unattributed-legacy"  → "Unknown (legacy)" muted label
 *  - anything else (a real Clerk userId) → actor name + role badge
 */
export function AuditActor({
  actorClerkId,
  actorName,
  editorRole,
}: {
  actorClerkId: string;
  actorName?: string | null;
  editorRole?: string | null;
}) {
  if (actorClerkId === "system-pipeline") {
    return (
      <Badge variant="secondary" className="gap-1 font-normal" data-testid="badge-actor-system">
        <Bot className="h-3 w-3" />
        System
      </Badge>
    );
  }

  if (actorClerkId === "unattributed-legacy") {
    return (
      <span className="text-xs text-muted-foreground italic" data-testid="label-actor-legacy">
        Unknown (legacy)
      </span>
    );
  }

  const roleLabel =
    editorRole === "AP_MANAGER" ? "Manager" : editorRole === "AP_CLERK" ? "Clerk" : null;

  return (
    <span className="inline-flex items-center gap-1.5" data-testid="label-actor-human">
      <User className="h-3 w-3 text-muted-foreground" />
      <span className="text-xs">{actorName || actorClerkId}</span>
      {roleLabel && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal" data-testid="badge-actor-role">
          {roleLabel}
        </Badge>
      )}
    </span>
  );
}
