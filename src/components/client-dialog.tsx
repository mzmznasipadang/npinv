"use client";

import { useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { useServerForm } from "@/hooks/use-actions";
import { saveClientAction } from "@/lib/actions";
import type { Client } from "@/lib/repo";
import type { ClientFormValues } from "@/lib/schemas";

const EMPTY: ClientFormValues = { name: "", company: "", address: "", email: "", phone: "" };

/** Add or edit a client. `children` is the button that opens the dialog. */
export function ClientDialog({ client, children }: { client?: Client; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const initial: ClientFormValues = client
    ? { name: client.name, company: client.company, address: client.address, email: client.email, phone: client.phone }
    : EMPTY;
  const form = useServerForm(initial, async (values) => {
    const result = await saveClientAction(client?.id ?? null, values);
    if (result.ok) {
      setOpen(false);
      toast.success(client ? "Client updated" : "Client added");
    }
    return result;
  });
  const { values, set, errors } = form;
  const prefix = client ? `client-${client.id}` : "client-new";

  const bind = (name: keyof ClientFormValues) => ({
    id: `${prefix}-${name}`,
    value: values[name],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(name, event.target.value),
    ...invalid(`${prefix}-${name}`, errors[name]),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(initial);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <form onSubmit={form.onSubmit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{client ? "Edit client" : "New client"}</DialogTitle>
            <DialogDescription>Used to fill in the “To” block of an invoice.</DialogDescription>
          </DialogHeader>
          <Field id={`${prefix}-name`} label="Client name" error={errors.name}>
            <Input autoComplete="off" {...bind("name")} />
          </Field>
          <Field id={`${prefix}-company`} label="Company" error={errors.company}>
            <Input autoComplete="off" {...bind("company")} />
          </Field>
          <Field id={`${prefix}-address`} label="Address" error={errors.address}>
            <Textarea rows={2} {...bind("address")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${prefix}-email`} label="Email" error={errors.email}>
              <Input type="email" autoComplete="off" {...bind("email")} />
            </Field>
            <Field id={`${prefix}-phone`} label="Phone" error={errors.phone}>
              <Input type="tel" autoComplete="off" {...bind("phone")} />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={form.pending}>
              {form.pending ? "Saving…" : "Save client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
