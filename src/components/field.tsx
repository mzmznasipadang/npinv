import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldProps = { id: string; label: string; error?: string; className?: string; children: ReactNode };

export function Field({ id, label, error, className, children }: FieldProps) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Props that tie an input to the error shown by its Field. */
export function invalid(id: string, error: string | undefined) {
  return error ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
}
