import { downPaymentAmount, formatMoney, lineTotal, percentToInput } from "./money.ts";
import type { Invoice, Settings } from "./repo.ts";
import { formatDate } from "./rules.ts";
import type { PrintVersion } from "./rules.ts";

// The printed invoice, shared by the web print page and the mobile API so both produce the same document.
// It builds HTML strings rather than JSX so the API (and its node:test suite) can use it without React.

/** Where the two brand images come from: site paths on the web, data URIs in the self-contained API document. */
export type PrintImages = { icon: string; logo: string };
/** Montserrat (public/fonts) as data URIs for the API document; the web page gets the same font from next/font. */
export type PrintFonts = { latin: string; latinExt: string };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" };

/** Escapes text for HTML content and attribute values. Every value below goes through it. */
export function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

export function printTitle(invoice: Invoice): string {
  return `${invoice.number ?? "DRAFT"} – ${invoice.billToName}`;
}

/** The A4 sheet: the same markup the web print page has always rendered. */
export function invoiceSheetHtml(invoice: Invoice, settings: Settings, version: PrintVersion, images: PrintImages): string {
  const e = escapeHtml;
  const money = (minor: number) => e(formatMoney(minor, invoice.currency));
  const contact = [settings.businessName, settings.businessAddress, settings.businessEmail, settings.businessPhone]
    .map((part) => part.replace(/\s*\n\s*/g, ", ").trim())
    .filter(Boolean)
    .join(" · ");
  const items = invoice.items
    .map(
      (item) =>
        `<tr><td>${e(item.description)}</td><td>${e(item.qty)}</td><td>${e(item.notes || "-")}</td><td>${money(lineTotal(item))}` +
        `${item.qty > 1 ? `<small>@ ${money(item.unitPrice)}</small>` : ""}</td></tr>`,
    )
    .join("");
  const row = (label: string, value: string, grand = false) =>
    `<tr${grand ? ' class="grand"' : ""}><th scope="row">${label}</th><td>${value}</td></tr>`;
  let totals = row("Subtotal", money(invoice.subtotal));
  if (invoice.discountAmount > 0) {
    const percent = invoice.discountType === "percent" ? ` ${e(percentToInput(invoice.discountValue))}%` : "";
    totals += row(`Discount${percent}`, `−${money(invoice.discountAmount)}`);
  }
  if (invoice.taxRateBp > 0) {
    totals += row(`${e(settings.taxLabel)} ${e(percentToInput(invoice.taxRateBp))}%`, money(invoice.taxAmount));
  }
  totals += row("Total", money(invoice.total), true);
  if (version === "payments") {
    for (const payment of invoice.payments) {
      const label = `${payment.kind === "write_off" ? "Written off" : "Paid"} ${e(formatDate(payment.paidOn))}`;
      totals += row(label, `−${money(payment.amount)}`);
    }
    totals += row("Balance due", money(invoice.balance), true);
  }
  if (version === "dp") {
    const portion = { type: invoice.downPaymentType, value: invoice.downPaymentValue };
    const percent = invoice.downPaymentType === "percent" ? ` (${e(percentToInput(invoice.downPaymentValue))}%)` : "";
    totals += row(`Down payment due${percent}`, money(downPaymentAmount(invoice.total, portion)), true);
  }
  return (
    `<div class="sheet"><div class="super" aria-hidden="true"><img src="${e(images.icon)}" alt=""/></div>` +
    `<div class="bar" aria-hidden="true"></div>` +
    `<table class="frame" role="presentation"><thead><tr><td></td></tr></thead><tfoot><tr><td></td></tr></tfoot><tbody><tr><td>` +
    `<div class="top"><img class="logo" src="${e(images.logo)}" alt="Naspad Studio"/><div class="meta">` +
    `<p class="doc">INVOICE</p><p class="num">${e(invoice.number ?? "DRAFT")}</p>` +
    `<p>Issue date: ${e(formatDate(invoice.issueDate))}</p><p>Due date: ${e(formatDate(invoice.dueDate))}</p></div></div>` +
    `<section class="to"><h2>To:</h2><p>Client Name: ${e(invoice.billToName)}</p>` +
    `${invoice.billToCompany ? `<p>Company: ${e(invoice.billToCompany)}</p>` : ""}` +
    `${invoice.billToAddress ? `<p class="pre">Address: ${e(invoice.billToAddress)}</p>` : ""}</section>` +
    `<table class="items"><colgroup><col class="c1"/><col class="c2"/><col class="c3"/><col class="c4"/></colgroup>` +
    `<thead><tr><th scope="col">Items Description</th><th scope="col">Qty</th><th scope="col">Notes</th><th scope="col">Pricing</th></tr></thead>` +
    `<tbody>${items}</tbody></table>` +
    `<table class="totals"><tbody>${totals}</tbody></table>` +
    `${invoice.notes ? `<p class="notes pre">${e(invoice.notes)}</p>` : ""}` +
    `${settings.paymentDetails ? `<section class="pay"><h2>Payment details</h2><p class="pre">${e(settings.paymentDetails)}</p></section>` : ""}` +
    `<p class="contact">${e(contact)}</p></td></tr></tbody></table></div>`
  );
}

// Stands in for the Tailwind preflight that the web page gets from globals.css, which the print styles rely on.
const PRINT_RESET = `*,::before,::after{box-sizing:border-box;margin:0;padding:0;border:0 solid}
html{line-height:1.5;-webkit-text-size-adjust:100%;font-family:Montserrat,Calibri,Arial,sans-serif}
h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}
img{display:block;vertical-align:middle;max-width:100%;height:auto}
table{text-indent:0;border-color:inherit;border-collapse:collapse}
small{font-size:80%}
`;

// The same subsets and ranges next/font/google uses on the web; both files are variable fonts covering weights 100–900.
const LATIN_EXT_RANGE =
  "u+0100-02ba,u+02bd-02c5,u+02c7-02cc,u+02ce-02d7,u+02dd-02ff,u+0304,u+0308,u+0329,u+1d00-1dbf,u+1e00-1e9f,u+1ef2-1eff,u+2020,u+20a0-20ab,u+20ad-20c4,u+2113,u+2c60-2c7f,u+a720-a7ff";
const LATIN_RANGE =
  "u+00??,u+0131,u+0152-0153,u+02bb-02bc,u+02c6,u+02da,u+02dc,u+0304,u+0308,u+0329,u+2000-206f,u+20ac,u+2122,u+2191,u+2193,u+2212,u+2215,u+feff,u+fffd";
function fontFaces(fonts: PrintFonts): string {
  const face = (src: string, range: string) =>
    `@font-face{font-family:Montserrat;font-style:normal;font-weight:100 900;src:url(${src}) format("woff2");unicode-range:${range}}`;
  return face(fonts.latinExt, LATIN_EXT_RANGE) + face(fonts.latin, LATIN_RANGE);
}

/** A standalone document for the mobile app, which turns it into a PDF. Fonts and images are inline. */
export function invoicePrintDocument(
  invoice: Invoice,
  settings: Settings,
  version: PrintVersion,
  images: PrintImages,
  fonts: PrintFonts,
): string {
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(printTitle(invoice))}</title>` +
    `<style>${fontFaces(fonts)}${PRINT_RESET}${PRINT_CSS}</style></head><body><div class="print-root"><div class="scroller">` +
    `${invoiceSheetHtml(invoice, settings, version, images)}</div></div></body></html>`
  );
}

export const PRINT_CSS = `@page {
  size: A4;
  margin: 0;
}

.print-root {
  --navy: #272660;
  --sky: #49bce9;
  min-height: 100svh;
  padding: 16px;
  background: #e9eaf2;
  color: #000;
  font-size: 9pt;
  font-weight: 500;
  line-height: 1.45;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Screen-only controls */
.print-root .toolbar {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-bottom: 16px;
  font-size: 14px;
}
.print-root .toolbar a,
.print-root .toolbar button {
  padding: 8px 14px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
}
.print-root .toolbar a {
  color: var(--navy);
  background: #fff;
  border: 1px solid #c9cbe0;
}
.print-root .toolbar button {
  color: #fff;
  background: var(--navy);
  border: 1px solid var(--navy);
}
.print-root .toolbar .versions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.print-root .toolbar a[aria-current="page"] {
  color: #fff;
  background: var(--navy);
  border-color: var(--navy);
}
.print-root .toolbar :focus-visible {
  outline: 3px solid var(--sky);
  outline-offset: 2px;
}

.print-root .scroller {
  overflow-x: auto;
}

/* The page */
.print-root .sheet {
  position: relative;
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 2px 16px rgb(20 20 58 / 0.18);
}

/* Supergraphic: the icon image, placed as on the guideline's Billing Statement page.
   The box starts 82.9 mm from the top of an A4 page and ends at the footer bar. */
.print-root .super {
  position: absolute;
  z-index: 0;
  right: 0;
  bottom: 1cm;
  left: 0;
  height: 204.1mm;
  overflow: hidden;
  pointer-events: none;
}
.print-root .super img {
  position: absolute;
  top: 0;
  left: 34.6%;
  width: 220.7%;
  max-width: none;
  height: auto;
  opacity: 0.15;
}

.print-root .bar {
  position: absolute;
  z-index: 2;
  right: 0;
  bottom: 0;
  left: 0;
  height: 1cm;
  background: var(--navy);
}

/* The outer table's header and footer rows repeat on every printed page,
   which reserves the top margin and the clear zone above the bar. */
.print-root .frame {
  position: relative;
  z-index: 1;
  width: 100%;
  border-collapse: collapse;
}
.print-root .frame > thead > tr > td {
  height: 2.5cm;
  padding: 0;
}
.print-root .frame > tfoot > tr > td {
  height: 3cm;
  padding: 0;
}
.print-root .frame > tbody > tr > td {
  padding: 0 1.5cm;
  vertical-align: top;
}

.print-root .top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.print-root .logo {
  width: auto;
  max-width: none;
  height: 1.2cm;
}
.print-root .meta {
  text-align: right;
}
.print-root .meta .doc {
  color: var(--navy);
  font-size: 13pt;
  font-weight: 600;
  letter-spacing: 0.12em;
}
.print-root .meta .num {
  margin-bottom: 0.15cm;
  font-size: 10pt;
  font-weight: 600;
}

.print-root h2 {
  margin: 0 0 0.3cm;
  color: var(--navy);
  font-size: 10pt;
  font-weight: 600;
}
.print-root .pre {
  white-space: pre-line;
}
.print-root .to {
  margin-top: 1.2cm;
}

.print-root .items {
  width: 100%;
  margin-top: 1.2cm;
  table-layout: fixed;
  border-spacing: 0;
  border-collapse: separate;
}
.print-root .items .c1 {
  width: 36.8%;
}
.print-root .items .c2 {
  width: 14.6%;
}
.print-root .items .c3 {
  width: 24.2%;
}
.print-root .items .c4 {
  width: 24.4%;
}
.print-root .items th {
  height: 0.85cm;
  padding: 0 0.25cm;
  color: var(--navy);
  font-weight: 500;
  text-align: center;
  background: #92d7f2;
  border-right: 1px solid #fff;
  border-bottom: 0.75pt solid #000;
}
.print-root .items th:first-child {
  color: #fff;
  background: var(--navy);
  border-top-left-radius: 0.18cm;
}
.print-root .items th:last-child {
  border-right: 0;
  border-top-right-radius: 0.18cm;
}
.print-root .items td {
  height: 0.85cm;
  padding: 0.15cm 0.25cm;
  text-align: center;
  vertical-align: middle;
  overflow-wrap: anywhere;
  background: #fff;
  border-right: 1px solid #fff;
}
.print-root .items td:last-child {
  border-right: 0;
}
.print-root .items tbody tr:nth-child(odd) td {
  background: #ededed;
}
.print-root .items tr {
  break-inside: avoid;
}
.print-root .items small {
  display: block;
  color: #555;
  font-size: 7.5pt;
}

.print-root .totals {
  width: 48.6%;
  margin: 0.4cm 0 0 auto;
  border-collapse: collapse;
  break-inside: avoid;
}
.print-root .totals th {
  padding: 0.12cm 0.25cm;
  font-weight: 500;
  text-align: left;
}
.print-root .totals td {
  padding: 0.12cm 0.25cm;
  font-variant-numeric: tabular-nums;
  text-align: right;
  /* An amount never splits across lines ("Rp" above the number); the label wraps instead. */
  white-space: nowrap;
}
.print-root .totals .grand th,
.print-root .totals .grand td {
  color: var(--navy);
  font-size: 11pt;
  font-weight: 700;
  border-top: 1pt solid var(--navy);
}

.print-root .notes {
  margin-top: 0.9cm;
  break-inside: avoid;
}
.print-root .pay {
  margin-top: 0.7cm;
  break-inside: avoid;
}
.print-root .contact {
  margin-top: 0.7cm;
  color: #555;
  font-size: 8pt;
  break-inside: avoid;
}

@media print {
  html,
  body {
    background: #fff !important;
  }
  .print-root {
    min-height: 0;
    padding: 0;
    background: #fff;
  }
  .print-root .toolbar {
    display: none;
  }
  .print-root .scroller {
    overflow: visible;
  }
  .print-root .sheet {
    width: auto;
    min-height: 0;
    margin: 0;
    overflow: visible;
    box-shadow: none;
  }
  /* Fixed elements repeat on every printed page. */
  .print-root .super,
  .print-root .bar {
    position: fixed;
  }
}
`;
