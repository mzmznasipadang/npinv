import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import type { InvoiceRow } from "@/lib/repo";
import { formatDate } from "@/lib/rules";

export function InvoiceTable({ rows }: { rows: InvoiceRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Number</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>Issued</TableHead>
          <TableHead>Due</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link href={`/invoices/${row.id}`} className="font-semibold underline-offset-4 hover:underline">
                {row.number ?? "Draft"}
              </Link>
            </TableCell>
            <TableCell>
              {row.billToName}
              {row.billToCompany ? (
                <span className="block text-xs text-muted-foreground">{row.billToCompany}</span>
              ) : null}
            </TableCell>
            <TableCell>{formatDate(row.issueDate)}</TableCell>
            <TableCell>{formatDate(row.dueDate)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(row.total, row.currency)}</TableCell>
            <TableCell>
              <StatusBadge status={row.display} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
