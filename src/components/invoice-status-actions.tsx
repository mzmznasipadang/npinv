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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAction, useServerForm } from "@/hooks/use-actions";
import {
  deleteInvoiceAction,
  duplicateInvoiceAction,
  markSentAction,
  recordPaymentAction,
  revertToDraftAction,
} from "@/lib/actions";
import { blankPaymentValues } from "@/lib/invoice-form";
import { formatMoney, parseAmount } from "@/lib/money";
import type { Currency } from "@/lib/money";
import type { Status } from "@/lib/rules";
import type { PaymentFormValues } from "@/lib/schemas";

export type InvoiceStatusProps = {
  id: number;
  status: Status;
  number: string | null;
  suggestedNumber: string;
  today: string;
  /** What is still owed, in the smallest unit. */
  balance: number;
  currency: Currency;
  /** True when any payment or write-off is recorded; an invoice with some cannot go back to draft. */
  hasPayments: boolean;
  /** True while the form holds unsaved changes; the actions act on what is saved, so they wait. */
  dirty: boolean;
};

export function InvoiceStatusActions({
  id,
  status,
  number,
  suggestedNumber,
  today,
  balance,
  currency,
  hasPayments,
  dirty,
}: InvoiceStatusProps) {
  const { pending, run } = useAction();
  const blocked = dirty || pending;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      {status === "draft" ? (
        <MarkSentDialog id={id} number={number} suggestedNumber={suggestedNumber} disabled={blocked} />
      ) : null}
      {status === "sent" ? (
        <RecordPaymentDialog id={id} balance={balance} currency={currency} today={today} disabled={blocked} />
      ) : null}
      {status === "sent" && !hasPayments ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={blocked}
          onClick={() => run(() => revertToDraftAction(id), () => toast.success("Reverted to draft"))}
        >
          <Undo2 /> Revert to draft
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
      {/* A numbered invoice may be on record with the client, so deleting one takes its number typed out. */}
      <ConfirmButton
        label="Delete"
        title={number ? `Delete ${number}?` : "Delete this draft?"}
        description={
          number
            ? "The invoice is removed for good and no longer counts on the dashboard. If it is the latest, its number goes to the next invoice; otherwise the sequence keeps a gap. This cannot be undone."
            : "The draft is removed for good. This cannot be undone."
        }
        confirmLabel={number ? "Delete invoice" : "Delete draft"}
        confirmText={number ?? undefined}
        action={() => deleteInvoiceAction(id)}
        disabled={blocked}
      >
        <Trash2 />
      </ConfirmButton>
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

type RecordPaymentProps = { id: number; balance: number; currency: Currency; today: string; disabled: boolean };

function RecordPaymentDialog({ id, balance, currency, today, disabled }: RecordPaymentProps) {
  const [open, setOpen] = useState(false);
  const initial = blankPaymentValues(balance, currency, today);

  /** What the typed amount leaves owing, or 0 while it is not a valid amount below the balance. */
  function leftOver(values: PaymentFormValues): number {
    const amount = parseAmount(values.amount, currency);
    return amount !== null && amount > 0 && amount < balance ? balance - amount : 0;
  }

  const form = useServerForm(initial, async (values) => {
    const writeOff = values.writeOff && leftOver(values) > 0;
    const result = await recordPaymentAction(id, { currency, balance }, { ...values, writeOff });
    if (result?.ok) {
      setOpen(false);
      toast.success("Payment recorded");
    }
    return result;
  });
  const { values, set, errors } = form;
  const rest = leftOver(values);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(initial);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" disabled={disabled}>
          <Wallet /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={form.onSubmit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              {formatMoney(balance, currency)} is still owed. The payment date decides which month it counts in.
            </DialogDescription>
          </DialogHeader>
          <Field id="payment-paid-on" label="Paid on" error={errors.paidOn}>
            <Input
              id="payment-paid-on"
              type="date"
              value={values.paidOn}
              onChange={(event) => set("paidOn", event.target.value)}
              {...invalid("payment-paid-on", errors.paidOn)}
            />
          </Field>
          <Field id="payment-amount" label={`Amount (${currency})`} error={errors.amount}>
            <Input
              id="payment-amount"
              inputMode="decimal"
              autoComplete="off"
              value={values.amount}
              onChange={(event) => set("amount", event.target.value)}
              {...invalid("payment-amount", errors.amount)}
            />
          </Field>
          <Field id="payment-note" label="Note (optional)" error={errors.note}>
            <Input
              id="payment-note"
              autoComplete="off"
              placeholder="e.g. DP 50%, BCA transfer"
              value={values.note}
              onChange={(event) => set("note", event.target.value)}
              {...invalid("payment-note", errors.note)}
            />
          </Field>
          {rest > 0 ? (
            <div className="flex items-center gap-3">
              <Switch
                id="payment-write-off"
                checked={values.writeOff}
                onCheckedChange={(checked) => set("writeOff", checked)}
              />
              <Label htmlFor="payment-write-off">Write off the remaining {formatMoney(rest, currency)}</Label>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={form.pending}>
              {form.pending ? "Saving…" : "Record payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
