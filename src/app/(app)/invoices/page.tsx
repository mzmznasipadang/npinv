import Form from "next/form";
import Link from "next/link";
import { connection } from "next/server";
import { Plus, Search } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { InvoiceTable } from "@/components/invoice-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listInvoices } from "@/lib/repo";
import { today } from "@/lib/rules";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
] as const;

type FilterValue = (typeof FILTERS)[number]["value"];

export default async function InvoicesPage({ searchParams }: PageProps<"/invoices">) {
  await connection();
  const params = await searchParams;
  const status: FilterValue = FILTERS.find((filter) => filter.value === params.status)?.value ?? "all";
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const rows = listInvoices({ status, q }, today());
  const filtered = status !== "all" || q !== "";

  function hrefFor(value: FilterValue): string {
    const search = new URLSearchParams();
    if (value !== "all") search.set("status", value);
    if (q) search.set("q", q);
    const query = search.toString();
    return query ? `/invoices?${query}` : "/invoices";
  }

  return (
    <>
      <PageHeader title="Invoices">
        <Button asChild>
          <Link href="/invoices/new">
            <Plus /> New invoice
          </Link>
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
          {FILTERS.map((filter) => (
            <Button key={filter.value} asChild size="sm" variant={filter.value === status ? "default" : "outline"}>
              <Link href={hrefFor(filter.value)} aria-current={filter.value === status ? "page" : undefined}>
                {filter.label}
              </Link>
            </Button>
          ))}
        </nav>
        <Form action="/invoices" className="flex gap-2">
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Number or client"
            aria-label="Search invoices"
            className="w-56"
          />
          <Button type="submit" variant="outline" size="icon" aria-label="Search">
            <Search />
          </Button>
        </Form>
      </div>

      {rows.length > 0 ? (
        <InvoiceTable rows={rows} />
      ) : filtered ? (
        <EmptyState title="No invoices match" text="Try another status, or clear the search." />
      ) : (
        <EmptyState title="No invoices yet" text="Create your first invoice and it will appear here.">
          <Button asChild>
            <Link href="/invoices/new">
              <Plus /> New invoice
            </Link>
          </Button>
        </EmptyState>
      )}
    </>
  );
}
