import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { invoiceSheetHtml, PRINT_CSS, printTitle } from "@/lib/invoice-print";
import { getInvoice, getSettings } from "@/lib/repo";
import type { Invoice } from "@/lib/repo";
import { printVersions } from "@/lib/rules";
import type { PrintVersion } from "@/lib/rules";
import { PrintToolbar } from "./print-toolbar";

// The page waits for its data instead of streaming a placeholder: a printed page must be complete.
export const instant = false;

type Props = PageProps<"/invoices/[id]/print">;

function load(id: string): Invoice | null {
  return /^\d{1,15}$/.test(id) ? getInvoice(Number(id)) : null;
}

const IMAGES = { icon: "/brand/icon.png", logo: "/brand/logo-navy.png" };

const LABELS: Record<PrintVersion, string> = {
  full: "Full invoice",
  payments: "With payments",
  dp: "Down payment request",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const invoice = load((await params).id);
  return { title: invoice ? printTitle(invoice) : "Invoice not found" };
}

export default async function PrintPage({ params, searchParams }: Props) {
  await connection();
  const invoice = load((await params).id);
  if (!invoice) notFound();
  const query = await searchParams;
  const auto = query.print === "1";
  const { versions, version } = printVersions(invoice.payments.length > 0, invoice.downPaymentValue > 0, query.version);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div className="print-root">
        <PrintToolbar
          auto={auto}
          backHref={`/invoices/${invoice.id}`}
          title={printTitle(invoice)}
          versions={versions.map((option) => ({
            label: LABELS[option],
            href: `/invoices/${invoice.id}/print?version=${option}`,
            current: option === version,
          }))}
        />
        {/* Shared with the mobile API; invoiceSheetHtml escapes every value it inserts. */}
        <div className="scroller" dangerouslySetInnerHTML={{ __html: invoiceSheetHtml(invoice, getSettings(), version, IMAGES) }} />
      </div>
    </>
  );
}
