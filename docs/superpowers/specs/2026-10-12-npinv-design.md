# NPInv — Naspad Studio invoice dashboard (v1 design)

Date: 2026-10-12
Status: approved 2026-10-12, deployed

## 1. Purpose

A private web app for Naspad Studio to create invoices, export them as branded PDFs, and track what is outstanding, overdue and paid. One user (Victor), reached over Tailscale only.

**Done means:**

- An invoice can be created, edited, marked sent, marked paid, duplicated and saved as a PDF that follows the brand's Billing Statement layout.
- The dashboard shows outstanding, overdue and paid-this-month totals per currency.
- The UI uses shadcn/ui with working light and dark modes in the Naspad palette and Montserrat.
- The app runs on naspad-server at `https://naspad-server.<tailnet>.ts.net:8445`, tailnet-only, and survives a reboot.
- The code is in a private Gitea repo, `mzmznasipadang/npinv`.

## 2. Decisions already made

| Topic | Decision |
|---|---|
| Messaging | Telegram bot, deferred to v2. No WhatsApp. |
| Access | Tailnet-only, no login inside the app. Clients receive the PDF file, never a link. |
| Money | IDR by default; IDR or USD chosen per invoice; optional PPN per invoice. |
| Gitea repo | Victor creates the empty private repo in the UI and runs the first push. |
| PDF in v1 | Browser print (Save as PDF) from a print-ready page. |
| Brand source | `Naspad Studio Guideline` PDFs: colour palette, typeface, logo construction/grid/backgrounds, billing statement. |

## 3. Architecture

One Next.js application (App Router) in one container, with a SQLite database file on a mounted volume.

- **UI:** React Server Components for reads, Server Actions for writes, shadcn/ui components, Tailwind, `next-themes` for the theme toggle.
- **Database:** SQLite through Node's built-in `node:sqlite` driver, plain SQL, no ORM. If the Next bundler cannot load it, fall back to `better-sqlite3` with the same SQL.
- **Validation:** every Server Action validates its input with `zod` before touching the database.
- **Runtime:** a pinned Node 24 LTS image. Exact versions of Next, React and the base image are pinned in the lockfile and Dockerfile when the project is scaffolded.
- **Time zone:** `Asia/Jakarta` (matches the server). "Today" for due dates and "this month" on the dashboard use it.
- **No secrets in v1.** Nothing needs an `.env` file until the Telegram bot arrives.

### Code layout

| Path | Responsibility |
|---|---|
| `src/lib/db.ts` | Opens the database, applies the schema, exposes the connection. |
| `src/lib/money.ts` | Pure functions: line and invoice totals, tax, formatting, parsing. The tested core. |
| `src/lib/invoices.ts`, `clients.ts`, `settings.ts` | Queries and Server Actions for each area. |
| `src/app/(app)/…` | Dashboard, invoices, clients, settings inside the app shell. |
| `src/app/invoices/[id]/print/` | The A4 invoice page, outside the app shell. |
| `src/components/ui/` | shadcn/ui components. |
| `public/brand/` | Logo and supergraphic files. |
| `deploy/` | Server `compose.yaml`, deploy script, backup script. |

## 4. Data model

Schema is applied at startup and versioned with `PRAGMA user_version` so later changes can migrate. WAL mode and foreign keys are on.

**settings** (one row)

- `business_name`, `business_address`, `business_email`, `business_phone`
- `payment_details` — free text (bank, account number, account holder)
- `default_currency` — `IDR`
- `default_tax_rate_bp` — default PPN rate in basis points, `1100` (11%)
- `tax_label` — `PPN`
- `invoice_prefix` — `INV`
- `default_due_days` — `14`
- `default_notes`

**clients** — `id`, `name`, `company`, `address`, `email`, `phone`, `created_at`

**invoices**

- `id`, `number` (unique, empty until first sent), `client_id` (optional link)
- `bill_to_name`, `bill_to_company`, `bill_to_address` — copied from the client when chosen, then editable
- `issue_date`, `due_date`
- `currency` — `IDR` or `USD`
- `tax_rate_bp` — `0` means no tax line
- `discount_type` — `percent` or `amount`; `discount_value` — basis points for a percentage, the smallest unit for an amount; `0` means no discount line (added in schema version 2)
- `status` — `draft`, `sent` or `paid`
- `subtotal`, `discount_amount`, `tax_amount`, `total` — computed by `money.ts` on every save
- `notes`, `paid_at`, `created_at`, `updated_at`

**invoice_items** — `id`, `invoice_id`, `position`, `description`, `qty`, `unit_price`, `notes`

### Rules

- **Amounts** are integers in the currency's smallest unit: whole rupiah for IDR, cents for USD. No floating point.
- **Totals:** line = qty × unit price; subtotal = sum of lines; discount = subtotal × percentage (rounded half up) or a fixed amount no larger than the subtotal; tax = (subtotal − discount) × rate, rounded half up to the smallest unit, since PPN is charged on the discounted price; total = subtotal − discount + tax.
- **Quantity** is a whole number of at least 1.
- **Numbering:** `INV-2026-001` — prefix, year of the issue date, sequence padded to three digits. The number is assigned the first time an invoice is marked sent. It is prefilled with the next in sequence for that year and can be edited at that moment (to continue an existing series), must be unique, and never changes afterwards.
- **Status changes:** draft → sent → paid. Undo is allowed one step back (paid → sent, sent → draft); a number, once assigned, is kept.
- **Overdue** is not stored. An invoice is overdue when it is `sent` and its due date is before today.
- **Editing** is allowed in any status.
- **Deleting** is allowed in any status, with a confirmation. A numbered invoice also needs its number typed out. Deleting the latest numbered invoice lets the next one reuse its number; deleting an older one leaves a gap in the sequence. Victor chose this over a void status.
- **Duplicate** creates a new draft with the same client, items, currency, discount and tax, today's issue date and no number.
- Deleting a client keeps its invoices; they retain the copied bill-to details.

## 5. Screens

The app shell is a sidebar (logo, navigation, theme toggle) plus content area. It collapses to a drawer on narrow screens.

**Dashboard (`/`)**

- Three tiles per currency in use: Outstanding (all sent), Overdue (sent and past due), Paid this month.
- A currency with no invoices shows no tiles. Currencies are never added together.
- Latest ten invoices with number, client, due date, total and status badge.
- "New invoice" button.

**Invoices (`/invoices`)**

- Table of all invoices: number, client, issue date, due date, total, status.
- Filter by status (all, draft, sent, overdue, paid) and search by number or client.

**Invoice editor (`/invoices/new`, `/invoices/[id]`)**

- Client picker that fills the bill-to fields, which stay editable.
- Issue date, due date (prefilled from the default due days), currency.
- Line items: description, qty, unit price, notes; add, remove, reorder.
- PPN switch with rate, prefilled from settings.
- Notes, prefilled from settings.
- Live subtotal, tax and total.
- Actions: Save, Mark sent, Mark paid (with paid date, default today), undo status, Duplicate, Delete, Download PDF.

**Clients (`/clients`)** — list, add, edit, delete.

**Settings (`/settings`)** — the fields in the `settings` table.

Empty states say what to do next (for example, "No invoices yet — create your first invoice"). Validation errors appear next to the field.

## 6. Invoice page and PDF

`/invoices/[id]/print` renders one invoice as A4 and is the single source for the PDF. "Download PDF" opens it and calls the browser's print dialog; the page title is the invoice number and client, which becomes the file name.

**From the Billing Statement page of the guideline:**

- A4, 1.5 cm side margins.
- Logo (sky-blue icon, navy wordmark) 2.5 cm from the top, 1.2 cm tall.
- "To:" block with Client Name, Company, Address.
- Table columns: Items Description, Qty, Notes, Pricing. First header cell Navy with white text; the other header cells light Sky Blue with Navy text; rounded top corners; alternating light-grey rows.
- Note paragraph under the table.
- Supergraphic at low opacity in the bottom-right corner, behind the content.
- 1 cm Navy bar across the bottom edge, with a 2 cm clear zone above it.

**Additions the guideline does not show** (kept in the same style):

- Top right, level with the logo: "INVOICE", the number (or "DRAFT"), issue date, due date.
- Pricing column shows the line total, with the unit price in small text beneath it when qty is more than 1. This keeps the guideline's four columns.
- Under the table, right-aligned: Subtotal, PPN with its rate (only when tax is on), Total in Navy.
- Below the notes: payment details, then one line of business contact details from settings.

**Behaviour:**

- Always rendered in the light scheme, whatever the app theme.
- Long invoices continue onto further pages with the same margins, a repeated table header and the footer bar.
- Print CSS forces background colours on and removes the browser's own header and footer.
- Chrome is the reference browser for printing. Other browsers may differ slightly.

**Known ceiling:** browser printing cannot produce a file on the server. The v2 Telegram bot will need a server-side renderer, and at that point the template gains a second implementation or moves to one.

## 7. Theme and typography

Brand colours: Naspad Navy `#272660`, Sky Blue `#49BCE9`, Pure White `#FFFFFF`, Black `#000000`. The guideline asks for the primary colour to dominate.

| Token | Light | Dark |
|---|---|---|
| Background | White | Navy-tinted near-black |
| Card / raised surface | White | Dark navy, one step lighter than background |
| Sidebar | Navy, white text | Navy, white text |
| Primary (buttons, active state) | Navy, white text | Sky Blue, Navy text |
| Accent (highlights, focus ring) | Sky Blue, Navy text | Sky Blue, Navy text |
| Body text | Navy-tinted near-black | Near-white |
| Logo variant | Navy wordmark (white wordmark in sidebar) | White wordmark |

- Sky Blue never carries white text and is never used as text on white: both are about 2.2:1. Navy on Sky Blue is about 6.3:1; white on Navy is about 13.7:1.
- Neutral greys are navy-tinted. Every text/background pair is checked to reach at least 4.5:1.
- Status badges use muted semantic colours outside the brand palette: grey draft, blue sent, red overdue, green paid. Each badge also carries its label, so colour is never the only signal.
- Theme follows the system by default, with a toggle for light, dark and system. The choice is remembered.
- **Typeface:** Montserrat in Light (300), Medium (500), Semibold (600) and Bold (700), bundled at build time so the app makes no requests to Google. Fallback: Calibri, Arial, sans-serif. Figures in tables use tabular numerals.
- **Logo rules:** used only in the approved variants, never redrawn, recoloured, stretched or given shadows or other effects.

## 8. Brand assets

- Needed: logo with navy wordmark, logo with white wordmark, and the supergraphic, as SVG.
- First attempt: extract the vectors from the guideline PDFs with a throwaway tool that is not added to the repo or the server.
- If extraction is not clean, ask Victor for the original SVG or AI files. High-resolution PNG renders are the last resort.
- Montserrat is licensed under the SIL Open Font License, which permits bundling.

## 9. Deployment

Follows the existing pattern in `naspad-server.md`.

| Item | Value |
|---|---|
| Directory | `/srv/npinv` — `compose.yaml`, `src/` (code), `data/` (database), `backups/` |
| Container | `npinv`, built from the repo's Dockerfile, runs as uid 1000, `restart: unless-stopped`, 512 MB memory limit |
| Port | `127.0.0.1:3003` → container port 3000 |
| Exposure | `tailscale serve --bg --https=8445 http://127.0.0.1:3003` — tailnet-only |
| URL | `https://naspad-server.<tailnet>.ts.net:8445` |

- Nothing is added under the `:443` listener, which is public through Funnel.
- **Deploy script (`deploy/deploy.sh`, run on the Mac):** sends the committed code (`git archive HEAD`) over SSH into a freshly emptied `/srv/npinv/src`, copies `deploy/compose.yaml` to `/srv/npinv/compose.yaml`, and runs `docker compose up -d --build` there. Uncommitted changes are never deployed.
- **Restart or update on the server:** `cd /srv/npinv && docker compose up -d`, as for the other services.
- **Build:** on the server, which has about 2 GB of RAM free plus 3.7 GB of swap. If the build fails for memory, build the image on the Mac for `linux/amd64` and load it over SSH. Deploys avoid running while a CI job is in progress.
- **Backups:** `/usr/local/sbin/npinv-backup` runs from `/etc/cron.d` at 03:20, logging to the journal as `npinv-backup`, the same way as `gitea-backup`.
  - The host has no `sqlite3`, and none is installed. The script asks the running container to take the snapshot: `docker exec npinv node …` runs SQLite's `VACUUM INTO`, which writes a consistent copy even while the app is in use. `/srv/npinv/backups` is mounted into the container for this.
  - If the container is not running, nothing is writing, so the script copies the database files directly.
  - Snapshots are named by date and deleted after 14 days.
  - They are on the same disk as the data, like the Gitea backups.
- **Runbook:** add NPInv to the services table in `naspad-server.md`, and note the backup.
- **Tailscale SSH** re-approves logins every 12 hours, so a deploy may ask for approval in the browser.

Server changes this makes:

- A new `/srv/npinv` directory, with `data/` and `backups/` owned by uid 1000 (the host's `naspad-server` user) so the container can write to them.
- One new container and its image.
- One new `tailscale serve` listener on 8445.
- One new script in `/usr/local/sbin` and one new file in `/etc/cron.d`.
- No new host packages, and no existing service is modified.

## 10. Repository

- Local repo on branch `main`, with a repo-local git identity: the Gitea username and the Gitea account's email (not the work identity).
- Remote: `https://naspad-server.<tailnet>.ts.net/mzmznasipadang/npinv.git`, private, created empty (no README or licence) by Victor.
- First push is run by Victor in a terminal; the access token is stored by the macOS keychain helper.
- Ignored: `node_modules`, `.next`, `data/`, `.env*`.
- No CI in v1.

## 11. Verification

- `node --test` on `src/lib/money.ts` and the numbering and overdue logic: totals, tax rounding, IDR and USD formatting, next number across a year change, overdue boundary on the due date.
- Local run in the browser: create a client and an invoice in each currency, walk every status change, check the dashboard totals, check light and dark modes, check the print preview at one page and at more than one page.
- On the server: container healthy after `docker compose up`, page loads at the tailnet URL, data survives a container restart, the backup script produces a snapshot that opens.

## 12. Not in v1

- Telegram bot (v2): long polling, so no public URL is needed; sends the invoice PDF and due or overdue reminders to Victor; needs a server-side PDF renderer and a bot token in a mode-600 `.env`.
- Charts, login, multiple users.
- Emailing invoices, recurring invoices, online payments.
- Decimal quantities, a void or cancelled status, converting between currencies.
- CI, an Uptime Kuma monitor, off-box backups.

## 13. Risks

- **Server Actions behind the Tailscale proxy** may be rejected by Next's origin check until the tailnet host is listed as an allowed origin. Checked during the first deploy.
- **`node:sqlite` with the Next bundler** is the less-travelled path; `better-sqlite3` is the fallback.
- **Print layout** depends on the browser; multi-page invoices are the part most likely to need adjustment.
- **Vector extraction** of the logo may fail, which makes the original brand files a dependency.
- **Single disk:** the database and its backups share one NVMe drive with no off-box copy.

## 14. Changes made during the build

- **Logo:** Victor supplied the navy-wordmark logo as an image; it is `public/brand/logo-navy.png`. The guideline PDFs hold the icon only as an image, so `logo-white.svg` (sidebar) pairs that image with the guideline's vector wordmark, and `icon.png` is the supergraphic.
- **Loading placeholders:** every page under `src/app/(app)/` has its own `loading.tsx`. Next 16 needs the placeholder beside the page for navigation between pages to be instant.
- **Field ids** are generated per form with React `useId`, because Next keeps recently visited pages mounted but hidden and two forms could otherwise share ids.
- **Invoice table cells** are centred, as drawn on the guideline's Billing Statement page.
- **First push** was done from the session with the Gitea credential already in the macOS keychain.
- **Reboot:** not tested by rebooting the server; the container's `unless-stopped` policy and the enabled Docker service were checked instead.
- **Live check:** no invoice was marked sent on the live app during verification, so `INV-2026-001` is still free. A labelled draft was created, printed and deleted.
- **After the final review:** one invoice's total is capped at 10 trillion in the smallest unit (Rp 10 trillion or $100 billion), and dashboard sums are capped at the largest exact integer, so absurd amounts give an error instead of breaking the dashboard. Invoice numbers are stored in upper case and compared without regard to letter case. Quantity, price and rate fields are text inputs with a numeric keypad hint, because a number input changes its value when the wheel scrolls over it. The new-invoice form keeps a half-typed draft but starts again when the date or the defaults change.
- **Discount and delete (2026-10-14):** one discount per invoice, as a percentage or a fixed amount, taken off before tax. Existing databases gain the three discount columns through schema version 2, so their totals do not change. Any invoice can now be deleted; numbered ones need the number typed to confirm.
