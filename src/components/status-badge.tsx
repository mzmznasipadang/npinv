import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DisplayStatus } from "@/lib/rules";

// Status colours sit outside the brand palette on purpose; the label carries the meaning too.
const STYLES: Record<DisplayStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  sent: { label: "Sent", className: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  partial: { label: "Part paid", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
  paid: { label: "Paid", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  const { label, className } = STYLES[status];
  return (
    <Badge variant="secondary" className={cn("border-transparent", className)}>
      {label}
    </Badge>
  );
}
