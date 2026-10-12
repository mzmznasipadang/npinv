"use client";

import { useId, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, invalid } from "@/components/field";
import { InvoiceStatusActions } from "@/components/invoice-status-actions";
import type { InvoiceStatusProps } from "@/components/invoice-status-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useServerForm } from "@/hooks/use-actions";
import { saveInvoiceAction } from "@/lib/actions";
import { blankItem } from "@/lib/invoice-form";
import { formatMoney, invoiceTotals, parseAmount, parsePercent } from "@/lib/money";
import type { Currency, Line, Totals } from "@/lib/money";
import type { Client } from "@/lib/repo";
import type { InvoiceFormValues, ItemFormValues } from "@/lib/schemas";

type InvoiceFormProps = {
  /** Null for a new invoice. */
  invoiceId: number | null;
  initial: InvoiceFormValues;
  clients: Client[];
  taxLabel: string;
  /** Present for a saved invoice; drives the status bar. */
  status?: Omit<InvoiceStatusProps, "dirty">;
};

type TextField = "billToName" | "billToCompany" | "billToAddress" | "issueDate" | "dueDate" | "taxRate" | "notes";

const NO_CLIENT = "none";
const QTY = /^[1-9]\d{0,5}$/;
const ITEM_GRID = "md:grid-cols-[minmax(0,1fr)_5rem_9rem_minmax(0,10rem)_8rem_6.5rem]";

/** Totals for what is typed so far, or null while any amount is not yet valid. */
function liveTotals(values: InvoiceFormValues, currency: Currency): Totals | null {
  const lines: Line[] = [];
  for (const item of values.items) {
    const unitPrice = parseAmount(item.unitPrice, currency);
    if (unitPrice === null || !QTY.test(item.qty.trim())) return null;
    lines.push({ qty: Number(item.qty), unitPrice });
  }
  const taxRateBp = values.taxEnabled ? parsePercent(values.taxRate) : 0;
  if (taxRateBp === null) return null;
  try {
    return invoiceTotals(lines, taxRateBp);
  } catch {
    return null;
  }
}

function ItemCell({ id, error, children }: { id: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function InvoiceForm({ invoiceId, initial, clients, taxLabel, status }: InvoiceFormProps) {
  const [saved, setSaved] = useState(initial);
  // Next keeps recently visited routes mounted but hidden, so two copies of a form can be
  // in the document at once. Field ids are made unique per form instance.
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const form = useServerForm(initial, async (values) => {
    const result = await saveInvoiceAction(invoiceId, values);
    if (result?.ok) {
      setSaved(values);
      toast.success("Invoice saved");
    }
    return result;
  });
  const { values, set, setValues, errors } = form;
  const currency: Currency = values.currency === "USD" ? "USD" : "IDR";
  const totals = liveTotals(values, currency);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const money = (minor: number | undefined) => (minor === undefined ? "—" : formatMoney(minor, currency));

  const bind = (name: TextField) => ({
    id: fid(name),
    value: values[name],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(name, event.target.value),
    ...invalid(fid(name), errors[name]),
  });

  function chooseClient(value: string) {
    const client = clients.find((candidate) => String(candidate.id) === value);
    setValues((current) =>
      client
        ? {
            ...current,
            clientId: String(client.id),
            billToName: client.name,
            billToCompany: client.company,
            billToAddress: client.address,
          }
        : { ...current, clientId: "" },
    );
  }

  function setItem(index: number, key: keyof ItemFormValues, value: string) {
    setValues((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, [key]: value } : item)),
    }));
  }

  function addItem() {
    setValues((current) => ({ ...current, items: [...current.items, blankItem()] }));
  }

  function removeItem(index: number) {
    setValues((current) => ({ ...current, items: current.items.filter((_, i) => i !== index) }));
  }

  function moveItem(index: number, by: -1 | 1) {
    setValues((current) => {
      const target = index + by;
      if (target < 0 || target >= current.items.length) return current;
      const items = [...current.items];
      [items[index], items[target]] = [items[target], items[index]];
      return { ...current, items };
    });
  }

  return (
    <div className="grid gap-6">
      {status ? <InvoiceStatusActions {...status} dirty={dirty} /> : null}

      <form onSubmit={form.onSubmit} className="grid gap-6" noValidate>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Bill to</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field id={fid("clientId")} label="Saved client" error={errors.clientId}>
                <Select value={values.clientId === "" ? NO_CLIENT : values.clientId} onValueChange={chooseClient}>
                  <SelectTrigger id={fid("clientId")} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CLIENT}>None — type the details below</SelectItem>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={String(client.id)}>
                        {client.company ? `${client.name} — ${client.company}` : client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id={fid("billToName")} label="Client name" error={errors.billToName}>
                <Input autoComplete="off" {...bind("billToName")} />
              </Field>
              <Field id={fid("billToCompany")} label="Company" error={errors.billToCompany}>
                <Input autoComplete="off" {...bind("billToCompany")} />
              </Field>
              <Field id={fid("billToAddress")} label="Address" error={errors.billToAddress}>
                <Textarea rows={2} {...bind("billToAddress")} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id={fid("issueDate")} label="Issue date" error={errors.issueDate}>
                  <Input type="date" {...bind("issueDate")} />
                </Field>
                <Field id={fid("dueDate")} label="Due date" error={errors.dueDate}>
                  <Input type="date" {...bind("dueDate")} />
                </Field>
              </div>
              <Field id={fid("currency")} label="Currency" error={errors.currency}>
                <Select value={currency} onValueChange={(value) => set("currency", value)}>
                  <SelectTrigger id={fid("currency")} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IDR">IDR — Rupiah</SelectItem>
                    <SelectItem value="USD">USD — US dollar</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex items-center gap-3">
                <Switch
                  id={fid("taxEnabled")}
                  checked={values.taxEnabled}
                  onCheckedChange={(checked) => set("taxEnabled", checked)}
                />
                <Label htmlFor={fid("taxEnabled")}>Add {taxLabel}</Label>
              </div>
              {values.taxEnabled ? (
                <Field id={fid("taxRate")} label={`${taxLabel} rate (%)`} error={errors.taxRate}>
                  <Input type="number" min={0} max={100} step={0.01} {...bind("taxRate")} />
                </Field>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className={`hidden gap-2 text-sm text-muted-foreground md:grid ${ITEM_GRID}`} aria-hidden="true">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit price</span>
              <span>Notes</span>
              <span className="text-right">Amount</span>
              <span />
            </div>

            {values.items.map((item, index) => {
              const path = (key: keyof ItemFormValues) => `items.${index}.${key}`;
              const id = (key: keyof ItemFormValues) => fid(path(key));
              const cell = (key: keyof ItemFormValues, label: string) => ({
                id: id(key),
                "aria-label": `${label}, item ${index + 1}`,
                placeholder: label,
                value: item[key],
                onChange: (event: ChangeEvent<HTMLInputElement>) => setItem(index, key, event.target.value),
                ...invalid(id(key), errors[path(key)]),
              });
              const unitPrice = parseAmount(item.unitPrice, currency);
              const amount = unitPrice !== null && QTY.test(item.qty.trim()) ? Number(item.qty) * unitPrice : undefined;

              return (
                <div key={index} className={`grid gap-2 rounded-md border p-3 md:items-start md:border-0 md:p-0 ${ITEM_GRID}`}>
                  <ItemCell id={id("description")} error={errors[path("description")]}>
                    <Input autoComplete="off" {...cell("description", "Description")} />
                  </ItemCell>
                  <ItemCell id={id("qty")} error={errors[path("qty")]}>
                    <Input type="number" min={1} step={1} {...cell("qty", "Qty")} />
                  </ItemCell>
                  <ItemCell id={id("unitPrice")} error={errors[path("unitPrice")]}>
                    <Input type="number" min={0} step={currency === "IDR" ? 1 : 0.01} {...cell("unitPrice", "Unit price")} />
                  </ItemCell>
                  <ItemCell id={id("notes")} error={errors[path("notes")]}>
                    <Input autoComplete="off" {...cell("notes", "Notes")} />
                  </ItemCell>
                  <p className="py-1.5 text-right tabular-nums" aria-label={`Amount, item ${index + 1}`}>
                    {money(amount)}
                  </p>
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move item ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => moveItem(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Move item ${index + 1} down`}
                      disabled={index === values.items.length - 1}
                      onClick={() => moveItem(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove item ${index + 1}`}
                      disabled={values.items.length === 1}
                      onClick={() => removeItem(index)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}

            {errors.items ? (
              <p role="alert" className="text-sm text-destructive">
                {errors.items}
              </p>
            ) : null}
            <div>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus /> Add item
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <Field id={fid("notes")} label="Printed under the items" error={errors.notes}>
                <Textarea rows={4} {...bind("notes")} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-y-2 tabular-nums">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="text-right">{money(totals?.subtotal)}</dd>
                {values.taxEnabled ? (
                  <>
                    <dt className="text-muted-foreground">
                      {taxLabel} {values.taxRate}%
                    </dt>
                    <dd className="text-right">{money(totals?.taxAmount)}</dd>
                  </>
                ) : null}
                <dt className="font-semibold">Total</dt>
                <dd className="text-right text-lg font-semibold">{money(totals?.total)}</dd>
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={form.pending}>
            {form.pending ? "Saving…" : invoiceId === null ? "Create invoice" : "Save changes"}
          </Button>
          {dirty && invoiceId !== null ? <span className="text-sm text-muted-foreground">Unsaved changes</span> : null}
        </div>
      </form>
    </div>
  );
}
