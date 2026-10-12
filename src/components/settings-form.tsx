"use client";

import type { ChangeEvent } from "react";
import { toast } from "sonner";
import { Field, invalid } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useServerForm } from "@/hooks/use-actions";
import { saveSettingsAction } from "@/lib/actions";
import type { SettingsFormValues } from "@/lib/schemas";

export function SettingsForm({ initial }: { initial: SettingsFormValues }) {
  const form = useServerForm(initial, async (values) => {
    const result = await saveSettingsAction(values);
    if (result.ok) toast.success("Settings saved");
    return result;
  });
  const { values, set, errors } = form;

  const bind = (name: keyof SettingsFormValues) => ({
    id: name,
    value: values[name],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(name, event.target.value),
    ...invalid(name, errors[name]),
  });

  return (
    <form onSubmit={form.onSubmit} className="grid max-w-2xl gap-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>Business</CardTitle>
          <CardDescription>Printed at the foot of every invoice.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field id="businessName" label="Business name" error={errors.businessName}>
            <Input {...bind("businessName")} />
          </Field>
          <Field id="businessAddress" label="Address" error={errors.businessAddress}>
            <Textarea rows={2} {...bind("businessAddress")} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="businessEmail" label="Email" error={errors.businessEmail}>
              <Input type="email" {...bind("businessEmail")} />
            </Field>
            <Field id="businessPhone" label="Phone" error={errors.businessPhone}>
              <Input type="tel" {...bind("businessPhone")} />
            </Field>
          </div>
          <Field id="paymentDetails" label="Payment details" error={errors.paymentDetails}>
            <Textarea rows={3} placeholder="Bank, account number, account holder" {...bind("paymentDetails")} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice defaults</CardTitle>
          <CardDescription>Used to fill in each new invoice. You can change them per invoice.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="defaultCurrency" label="Currency" error={errors.defaultCurrency}>
              <Select value={values.defaultCurrency} onValueChange={(value) => set("defaultCurrency", value)}>
                <SelectTrigger id="defaultCurrency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IDR">IDR — Rupiah</SelectItem>
                  <SelectItem value="USD">USD — US dollar</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field id="defaultDueDays" label="Due after (days)" error={errors.defaultDueDays}>
              <Input type="number" min={0} max={365} step={1} {...bind("defaultDueDays")} />
            </Field>
            <Field id="taxLabel" label="Tax label" error={errors.taxLabel}>
              <Input {...bind("taxLabel")} />
            </Field>
            <Field id="defaultTaxRate" label="Tax rate (%)" error={errors.defaultTaxRate}>
              <Input type="number" min={0} max={100} step={0.01} {...bind("defaultTaxRate")} />
            </Field>
            <Field id="invoicePrefix" label="Number prefix" error={errors.invoicePrefix}>
              <Input {...bind("invoicePrefix")} />
            </Field>
          </div>
          <Field id="defaultNotes" label="Default notes" error={errors.defaultNotes}>
            <Textarea rows={3} {...bind("defaultNotes")} />
          </Field>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={form.pending}>
          {form.pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
