import { ConfirmButton } from "@/components/confirm-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { removePaymentAction } from "@/lib/actions";
import { formatMoney } from "@/lib/money";
import type { Currency } from "@/lib/money";
import type { Payment } from "@/lib/repo";
import { formatDate } from "@/lib/rules";

type PaymentsCardProps = { invoiceId: number; payments: Payment[]; paid: number; balance: number; currency: Currency };

/** What has been paid on a sent or paid invoice, and what is still owed. */
export function PaymentsCard({ invoiceId, payments, paid, balance, currency }: PaymentsCardProps) {
  const money = (minor: number) => formatMoney(minor, currency);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet. Use Record payment when money arrives.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((payment) => {
                const writeOff = payment.kind === "write_off";
                return (
                  <TableRow key={payment.id}>
                    <TableCell>{formatDate(payment.paidOn)}</TableCell>
                    <TableCell>{writeOff ? "Written off" : payment.note || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(payment.amount)}</TableCell>
                    <TableCell className="text-right">
                      <ConfirmButton
                        label="Remove"
                        title={writeOff ? "Remove this write-off?" : "Remove this payment?"}
                        description={`${money(payment.amount)} on ${formatDate(payment.paidOn)} is removed, and the balance and status are worked out again.`}
                        confirmLabel="Remove"
                        action={removePaymentAction.bind(null, invoiceId, payment.id)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <dl className="grid grid-cols-2 gap-y-2 tabular-nums">
          <dt className="text-muted-foreground">Paid so far</dt>
          <dd className="text-right">{money(paid)}</dd>
          <dt className="font-semibold">Balance due</dt>
          <dd className="text-right text-lg font-semibold">{money(balance)}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}
