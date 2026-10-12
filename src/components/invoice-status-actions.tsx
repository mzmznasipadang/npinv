"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Copy, Download, Send, Trash2, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { ConfirmButton } from "@/components/confirm-button";
import { Field, invalid } from "@/components/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-actions";
import {
  deleteInvoiceAction,
  duplicateInvoiceAction,
  markPaidAction,
  markSentAction,
  undoStatusAction,
} from "@/lib/actions";
import type { Status } from "@/lib/rules";

export type InvoiceStatusProps = {
  id: number;
  status: Status;
  number: string | null;
  suggestedNumber: string;
  today: string;
  /** True while the form holds unsaved changes; the actions act on what is saved, so they wait. */
  dirty: boolean;
};

export function InvoiceStatusActions({ id, status, number, suggestedNumber, today, dirty }: InvoiceStatusProps) {
  const { pending, run } = useAction();
  const blocked = dirty || pending;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      {status === "draft" ? (
        <MarkSentDialog id={id} number={number} suggestedNumber={suggestedNumber} disabled={blocked} />
      ) : null}
      {status === "sent" ? <MarkPaidDialog id={id} today={today} disabled={blocked} /> : null}
      {status === "sent" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={blocked}
          onClick={() => run(() => undoStatusAction(id), () => toast.success("Reverted to draft"))}
        >
          <Undo2 /> Revert to draft
        </Button>
      ) : null}
      {status === "paid" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={blocked}
          onClick={() => run(() => undoStatusAction(id), () => toast.success("Marked unpaid"))}
        >
          <Undo2 /> Mark unpaid
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={blocked}
        onClick={() => run(() => duplicateInvoiceAction(id))}
      >
        <Copy /> Duplicate
      </Button>
      {dirty ? (
        <Button type="button" variant="outline" size="sm" disabled>
          <Download /> Download PDF
        </Button>
      ) : (
        <Button asChild variant="outline" size="sm">
          <a href={`/invoices/${id}/print?print=1`} target="_blank" rel="noopener">
            <Download /> Download PDF
          </a>
        </Button>
      )}
      {status === "draft" && number === null ? (
        <ConfirmButton
          label="Delete"
          title="Delete this draft?"
          description="The draft is removed for good. This cannot be undone."
          confirmLabel="Delete draft"
          action={() => deleteInvoiceAction(id)}
          disabled={blocked}
        >
          <Trash2 />
        </ConfirmButton>
      ) : null}
      {dirty ? <p className="w-full text-sm text-muted-foreground">Save your changes to use these actions.</p> : null}
    </div>
  );
}

type MarkSentProps = { id: number; number: string | null; suggestedNumber: string; disabled: boolean };

function MarkSentDialog({ id, number, suggestedNumber, disabled }: MarkSentProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(number ?? suggestedNumber);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function confirm(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await markSentAction(id, value);
      if (!result) return;
      if (result.ok) {
        setOpen(false);
        toast.success("Marked sent");
      } else {
        setError(result.errors?.number ?? result.message ?? "Something went wrong.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setValue(number ?? suggestedNumber);
          setError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={disabled}>
          <Send /> Mark sent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={confirm} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Mark as sent</DialogTitle>
            <DialogDescription>
              {number
                ? "This invoice keeps the number it already has."
                : "The number is assigned now and cannot be changed afterwards."}
            </DialogDescription>
          </DialogHeader>
          <Field id="invoice-number" label="Invoice number" error={error}>
            <Input
              id="invoice-number"
              value={value}
              readOnly={number !== null}
              autoComplete="off"
              onChange={(event) => setValue(event.target.value)}
              {...invalid("invoice-number", error)}
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Mark sent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MarkPaidDialog({ id, today, disabled }: { id: number; today: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(today);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function confirm(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await markPaidAction(id, value);
      if (!result) return;
      if (result.ok) {
        setOpen(false);
        toast.success("Marked paid");
      } else {
        setError(result.errors?.paidAt ?? result.message ?? "Something went wrong.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setValue(today);
          setError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={disabled}>
          <Wallet /> Mark paid
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={confirm} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Mark as paid</DialogTitle>
            <DialogDescription>The date the payment arrived. It decides which month the total counts in.</DialogDescription>
          </DialogHeader>
          <Field id="paid-at" label="Paid on" error={error}>
            <Input
              id="paid-at"
              type="date"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              {...invalid("paid-at", error)}
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Mark paid"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
