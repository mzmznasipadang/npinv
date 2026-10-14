import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { downPaymentAmount, formatMoney, lineTotal, percentToInput } from "@/lib/money";
import { getInvoice, getSettings } from "@/lib/repo";
import type { Invoice } from "@/lib/repo";
import { formatDate, printVersions } from "@/lib/rules";
import type { PrintVersion } from "@/lib/rules";
import { PrintToolbar } from "./print-toolbar";
import "./print.css";

// The page waits for its data instead of streaming a placeholder: a printed page must be complete.
export const instant = false;

type Props = PageProps<"/invoices/[id]/print">;

function load(id: string): Invoice | null {
  return /^\d{1,15}$/.test(id) ? getInvoice(Number(id)) : null;
}

function titleOf(invoice: Invoice): string {
  return `${invoice.number ?? "DRAFT"} – ${invoice.billToName}`;
}

const LABELS: Record<PrintVersion, string> = {
  full: "Full invoice",
  payments: "With payments",
  dp: "Down payment request",
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection();
  const invoice = load((await params).id);
  return { title: invoice ? titleOf(invoice) : "Invoice not found" };
}

export default async function PrintPage({ params, searchParams }: Props) {
  await connection();
  const invoice = load((await params).id);
  if (!invoice) notFound();
  const settings = getSettings();
  const query = await searchParams;
  const auto = query.print === "1";
  const { versions, version } = printVersions(invoice.payments.length > 0, invoice.downPaymentValue > 0, query.version);
  const downPayment =
    version === "dp"
      ? downPaymentAmount(invoice.total, { type: invoice.downPaymentType, value: invoice.downPaymentValue })
      : 0;
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const contact = [settings.businessName, settings.businessAddress, settings.businessEmail, settings.businessPhone]
    .map((part) => part.replace(/\s*\n\s*/g, ", ").trim())
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="print-root">
      <PrintToolbar
        auto={auto}
        backHref={`/invoices/${invoice.id}`}
        title={titleOf(invoice)}
        versions={versions.map((option) => ({
          label: LABELS[option],
          href: `/invoices/${invoice.id}/print?version=${option}`,
          current: option === version,
        }))}
      />
      <div className="scroller">
        <div className="sheet">
          <div className="super" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/icon.png" alt="" />
          </div>
          <div className="bar" aria-hidden="true" />

          <table className="frame" role="presentation">
            <thead>
              <tr>
                <td />
              </tr>
            </thead>
            <tfoot>
              <tr>
                <td />
              </tr>
            </tfoot>
            <tbody>
              <tr>
                <td>
                  <div className="top">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="logo" src="/brand/logo-navy.png" alt="Naspad Studio" />
                    <div className="meta">
                      <p className="doc">INVOICE</p>
                      <p className="num">{invoice.number ?? "DRAFT"}</p>
                      <p>Issue date: {formatDate(invoice.issueDate)}</p>
                      <p>Due date: {formatDate(invoice.dueDate)}</p>
                    </div>
                  </div>

                  <section className="to">
                    <h2>To:</h2>
                    <p>Client Name: {invoice.billToName}</p>
                    {invoice.billToCompany ? <p>Company: {invoice.billToCompany}</p> : null}
                    {invoice.billToAddress ? <p className="pre">Address: {invoice.billToAddress}</p> : null}
                  </section>

                  <table className="items">
                    <colgroup>
                      <col className="c1" />
                      <col className="c2" />
                      <col className="c3" />
                      <col className="c4" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Items Description</th>
                        <th scope="col">Qty</th>
                        <th scope="col">Notes</th>
                        <th scope="col">Pricing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.items.map((item, index) => (
                        <tr key={index}>
                          <td>{item.description}</td>
                          <td>{item.qty}</td>
                          <td>{item.notes || "-"}</td>
                          <td>
                            {money(lineTotal(item))}
                            {item.qty > 1 ? <small>@ {money(item.unitPrice)}</small> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <table className="totals">
                    <tbody>
                      <tr>
                        <th scope="row">Subtotal</th>
                        <td>{money(invoice.subtotal)}</td>
                      </tr>
                      {invoice.discountAmount > 0 ? (
                        <tr>
                          <th scope="row">
                            Discount
                            {invoice.discountType === "percent" ? ` ${percentToInput(invoice.discountValue)}%` : null}
                          </th>
                          <td>−{money(invoice.discountAmount)}</td>
                        </tr>
                      ) : null}
                      {invoice.taxRateBp > 0 ? (
                        <tr>
                          <th scope="row">
                            {settings.taxLabel} {percentToInput(invoice.taxRateBp)}%
                          </th>
                          <td>{money(invoice.taxAmount)}</td>
                        </tr>
                      ) : null}
                      <tr className="grand">
                        <th scope="row">Total</th>
                        <td>{money(invoice.total)}</td>
                      </tr>
                      {version === "payments" ? (
                        <>
                          {invoice.payments.map((payment) => (
                            <tr key={payment.id}>
                              <th scope="row">
                                {payment.kind === "write_off" ? "Written off" : "Paid"} {formatDate(payment.paidOn)}
                              </th>
                              <td>−{money(payment.amount)}</td>
                            </tr>
                          ))}
                          <tr className="grand">
                            <th scope="row">Balance due</th>
                            <td>{money(invoice.balance)}</td>
                          </tr>
                        </>
                      ) : null}
                      {version === "dp" ? (
                        <tr className="grand">
                          <th scope="row">
                            Down payment due
                            {invoice.downPaymentType === "percent"
                              ? ` (${percentToInput(invoice.downPaymentValue)}%)`
                              : null}
                          </th>
                          <td>{money(downPayment)}</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>

                  {invoice.notes ? <p className="notes pre">{invoice.notes}</p> : null}
                  {settings.paymentDetails ? (
                    <section className="pay">
                      <h2>Payment details</h2>
                      <p className="pre">{settings.paymentDetails}</p>
                    </section>
                  ) : null}
                  <p className="contact">{contact}</p>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
