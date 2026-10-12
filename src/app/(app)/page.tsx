import Link from "next/link";
import { connection } from "next/server";
import { Plus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InvoiceTable } from "@/components/invoice-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { dashboard } from "@/lib/repo";
import { today } from "@/lib/rules";
import { cn } from "@/lib/utils";

function Tile({ label, value, hint, alert }: { label: string; value: string; hint: string; alert?: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn("text-2xl tabular-nums", alert && "text-destructive")}>{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

export default async function DashboardPage() {
  await connection();
  const { summaries, latest } = dashboard(today());

  return (
    <>
      <PageHeader title="Dashboard">
        <Button asChild>
          <Link href="/invoices/new">
            <Plus /> New invoice
          </Link>
        </Button>
      </PageHeader>

      {latest.length === 0 ? (
        <EmptyState title="No invoices yet" text="Create your first invoice to see what is outstanding, overdue and paid.">
          <Button asChild>
            <Link href="/invoices/new">
              <Plus /> New invoice
            </Link>
          </Button>
        </EmptyState>
      ) : (
        <div className="grid gap-8">
          {summaries.map((summary) => (
            <section key={summary.currency} aria-labelledby={`summary-${summary.currency}`} className="grid gap-3">
              <h2 id={`summary-${summary.currency}`} className="text-sm font-semibold text-muted-foreground">
                {summary.currency}
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <Tile
                  label="Outstanding"
                  value={formatMoney(summary.outstanding, summary.currency)}
                  hint="Sent and not yet paid"
                />
                <Tile
                  label="Overdue"
                  value={formatMoney(summary.overdue, summary.currency)}
                  hint="Sent and past the due date"
                  alert={summary.overdue > 0}
                />
                <Tile
                  label="Paid this month"
                  value={formatMoney(summary.paidThisMonth, summary.currency)}
                  hint="By payment date"
                />
              </div>
            </section>
          ))}

          <section aria-labelledby="latest" className="grid gap-3">
            <div className="flex items-center justify-between">
              <h2 id="latest" className="text-lg font-semibold">
                Latest invoices
              </h2>
              <Link href="/invoices" className="text-sm font-semibold underline underline-offset-4">
                View all
              </Link>
            </div>
            <InvoiceTable rows={latest} />
          </section>
        </div>
      )}
    </>
  );
}
