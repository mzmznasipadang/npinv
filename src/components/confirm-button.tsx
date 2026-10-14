"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Field } from "@/components/field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-actions";
import type { FormState } from "@/lib/schemas";

type ConfirmButtonProps = {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<FormState>;
  disabled?: boolean;
  /** When set, the confirm button stays disabled until this text is typed. */
  confirmText?: string;
  children?: ReactNode;
};

/** A button that asks before running a destructive Server Action. `children` is an optional icon. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  action,
  disabled,
  confirmText,
  children,
}: ConfirmButtonProps) {
  const { pending, run } = useAction();
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const unconfirmed = confirmText !== undefined && typed.trim().toUpperCase() !== confirmText.toUpperCase();
  return (
    <AlertDialog onOpenChange={() => setTyped("")}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled || pending}>
          {children}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {confirmText !== undefined ? (
          <Field id={inputId} label={`Type ${confirmText} to confirm`}>
            <Input id={inputId} value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
          </Field>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={unconfirmed} onClick={() => run(action)}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
