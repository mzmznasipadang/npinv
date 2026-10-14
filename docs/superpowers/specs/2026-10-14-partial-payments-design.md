# NPInv — Partial payments

Date: 2026-10-14. Extends `2026-10-12-npinv-design.md`; where the two differ, this one wins.

## 1. Purpose

Victor's clients often pay in parts:

- a down payment (DP) before work starts, then the rest on delivery, all on one invoice;
- several instalments of any amount on any date;
- now and then a short payment (transfer fees, rounding) whose small gap is written off.

The app should record each payment, show what is still owed, close the invoice by itself when it is settled, and let the printed invoice say what was paid and what is due.

**Success:** a DP request, two instalments and a short payment with a write-off can each be recorded, undone and printed; the dashboard shows balances still owed and the money that actually arrived this month; existing invoices look and add up exactly as before.

Emailing invoices is a separate project (B) and is not part of this design.

## 2. Data model (schema version 3)

**payments** (new)

- `id`, `invoice_id` (references `invoices`, `ON DELETE CASCADE`)
- `paid_on` — date, `YYYY-MM-DD`
- `amount` — integer in the invoice currency's smallest unit, `> 0`
- `kind` — `payment` or `write_off`
- `note` — free text, up to 200 characters (e.g. "DP 50%", "BCA transfer")
- `created_at`

**invoices** (new columns)

- `dp_type` — `percent` or `amount`; `dp_value` — basis points or smallest unit; `0` means no down payment requested. Same shape as the discount fields.

`status` and `paid_at` stay as columns, but from now on they are derived from the payments (section 3) and rewritten whenever payments or the total change.

**Migration**, in one transaction with the version bump (as version 2 was): create `payments`, add the two columns, and for every invoice with `status = 'paid'` insert one `payment` of its full `total` dated `paid_at` (its issue date if `paid_at` is somehow empty). If any step fails nothing is changed and the app does not start. Afterwards every invoice's status, totals and dashboard figures are the same as before the upgrade.

## 3. Rules

- **Settled** = sum of payments and write-offs. **Paid so far** = sum of payments only. **Balance** = total − settled.
- **Payments only on sent invoices.** A draft has no number and has not reached the client; a paid one has nothing left to pay. An invoice whose total is 0 cannot take payments and stays sent.
- **Status follows the payments.** A sent invoice whose balance reaches 0 becomes `paid`, and `paid_at` becomes the latest `paid_on` among its payments and write-off. A paid invoice whose balance rises above 0 (a payment removed, or the total raised) goes back to `sent` and `paid_at` is cleared.
- **Recording a payment:** date, amount, optional note. The amount must be at least the smallest unit and no more than the balance.
- **Write-off:** when a payment is less than the balance, the dialog offers "Write off the remaining Rp X". Ticked, it records the payment and then a `write_off` of exactly the remaining balance on the same date, which closes the invoice. An invoice has at most one write-off; another is refused while one exists.
- **Removing** any payment or write-off is allowed, with a confirmation, and recomputes the status.
- **Revert to draft** is allowed only while an invoice has no payments or write-off. **Mark unpaid** is removed; removing a payment does that job.
- **Editing after payments:** editing stays allowed in any status, with two limits, each reported as a field error:
  - the new total may not be below the settled amount ("Payments already cover Rp X; remove one first");
  - the currency may not change once anything is settled.
- **Down payment:** `dp_amount` = total × percentage, rounded half up, or the fixed amount. It may not exceed the total. It is a request printed on the invoice; it does not change any total or status.
- **Duplicate** copies the down payment setting, not the payments.
- **Deleting** an invoice deletes its payments.
- **Display status:** `overdue` (sent, balance above 0, due date before today) wins; otherwise `partial` (sent, paid so far above 0); otherwise the stored status. `partial` is labelled **Part paid**.
- **Dashboard,** per currency:
  - Outstanding = sum of balances of sent invoices.
  - Overdue = the same, for those past their due date.
  - Paid this month = sum of `payment` amounts whose `paid_on` is in the current month. Write-offs are not income.

All money stays in integers of the smallest unit, and every sum keeps the existing ceiling at the largest exact integer.

## 4. Screens

**Invoice page — action bar.** On a sent invoice, **Mark paid** becomes **Record payment**. Its dialog:

- Paid on — date, today by default.
- Amount — the full balance by default, so paying in full is still one confirm.
- Note — optional.
- "Write off the remaining Rp X" — a checkbox shown only while the amount is below the balance; X updates as the amount is typed.

**Invoice page — Payments card,** shown on sent and paid invoices: one row per payment or write-off (date, amount, note, "Written off" for a write-off) with a Remove button behind a confirmation, then Paid so far and **Balance due**. With no entries it says so and points at Record payment.

**Invoice form.** In Details, an "Ask for a down payment" switch with "% or amount" and a value, built like the discount controls. The Totals card adds "Down payment due" when it is set.

**Invoice list.** The **Part paid** badge. A part-paid row shows "Balance Rp X" under its total. Part-paid invoices stay under the Sent and Overdue tabs; there is no new tab.

**Dashboard.** The same three tiles; Outstanding's hint becomes "Balance still owed on sent invoices" and Paid this month's "Payments received, by payment date".

**Print / PDF.** The print toolbar gets a version picker. A version appears only when it applies:

- **Full invoice** — always; today's layout.
- **With payments** — when anything is settled: under Total, one "Paid" row per payment with its date, a "Written off" row if any, and a bold **Balance due**.
- **Down payment request** — when a down payment is set: under Total, a bold **Down payment due (50%): Rp X** (the percentage only for a percentage).

The version is a URL parameter (`?version=full|payments|dp`). Download PDF on the invoice page, and a missing or invalid parameter, choose: With payments if anything is settled, else the DP request if set, else Full invoice.

## 5. Code touched

| Area | Change |
|---|---|
| `src/lib/db.ts` | Schema version 3 migration. |
| `src/lib/money.ts` | Down payment amount, sharing the percentage-or-amount rounding with the discount. |
| `src/lib/rules.ts` | `displayStatus` learns `partial`; it needs paid-so-far and balance. |
| `src/lib/repo.ts` | `recordPayment`, `removePayment`, one status recompute used by them and by `saveInvoice`; the save limits; payments on `getInvoice`; balance on list rows; dashboard sums; `undoStatus` only sent → draft without payments; `markPaid` removed. |
| `src/lib/schemas.ts`, `invoice-form.ts` | Down payment fields; payment form parsing. |
| `src/lib/actions.ts` | `recordPaymentAction`, `removePaymentAction`; `markPaidAction` removed. |
| `src/components/` | Record payment dialog and Payments card; down payment controls; Part paid badge; balance in the table. |
| `src/app/(print)/…/print/` | Version picker and the two extra totals blocks. |
| `src/app/(app)/page.tsx` | New tile hints. |

Recording a payment checks the balance and writes inside one `BEGIN IMMEDIATE` transaction, so two payments entered at once cannot overpay. Every Server Action validates its input with zod and checks ids as today; a missing invoice or payment returns the existing "no longer exists" message.

## 6. Verification

- `node --test`:
  - balance and status after a payment, a write-off, a removal, an edit that raises or lowers the total, and a revert attempt with payments;
  - overpayment, a currency change after payment, and a write-off without a shortfall are refused;
  - dashboard sums per currency and month, with write-offs excluded from income;
  - down payment rounding and its limit;
  - the version 2 → 3 upgrade on a file, including an existing paid invoice becoming one full payment;
  - form and dialog validation.
- Local browser run on a copy of the local database: a DP request, two instalments, a short payment with a write-off, removing a payment, and each print version.
- Deploy as before: a fresh backup first, then read-only checks on live (existing totals unchanged, a paid invoice shows one payment). No payments are recorded or removed on live during verification.

## 7. Not included

Overpayments and client credit, refunds, a separate payment-method field (the note covers it), a Part paid filter tab, partial payments on drafts, and anything about emailing invoices.
