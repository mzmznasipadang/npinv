# Native mobile API

All paths start with `/api/v1`. The iOS app uses the same SQLite file and financial
repository functions as the dashboard. Business-data routes are read-only except
tasks, which the app can also create, edit and delete, and projects, which it can
also create, edit, archive and restore, and clients, which it can also create, edit
and delete (see "Writes"). Device sessions use schema migrations 5 and 6, and
migration 7 gives clients a version; existing invoices, projects, tasks,
clients, and web authentication remain intact.

## Authentication

`POST /sessions` accepts JSON `{ "deviceName": "My iPhone", "password": "<entered at login>" }`.
On success it returns 201 with `{ id, deviceName, createdAt, expiresAt, scope, token }`.
New sessions have `scope: "write"`. Sessions created before migration 6 are
`"read"`: they can read, but writes return 403 until the device signs in again.
The opaque 256-bit token is returned once; SQLite stores its SHA-256 hash and a
credential binding. It expires after 30 days. The password is never stored.

Every other endpoint requires `Authorization: Bearer <token>`. Web cookies do not
provide API access. Expired, revoked, missing, or invalid credentials return 401
JSON. Changing ADMIN_PASSWORD invalidates all mobile sessions.

`GET /sessions` returns `{ data: [{ id, deviceName, createdAt, expiresAt, scope, current }] }`.
`DELETE /sessions/:id` revokes that session. Web Settings also supports listing
and revocation through authenticated Server Actions. Device labels are descriptive,
not unique hardware identifiers.

## Reads

| Path | Filters |
| --- | --- |
| `/overview` | No parameters; financial summaries (with receivables `aging`), business date, work counts, attention lists |
| `/projects` | `q`, `clientId`, `status`, `archived`, `attention`, `sort` |
| `/tasks` | `q`, `projectId`, `clientId`, `completed`, `archived`, `dueFrom`, `dueTo`, `attention=due` |
| `/clients` | `q` |
| `/invoices` | `q`, `projectId`, `clientId`, `currency`, `status`, `outstanding` |
| `/settings` | No parameters; the stored business settings (`defaultTaxRateBp` in basis points, `defaultDueDays` a number). Read-only until settings editing ships |

Collections additionally accept `page` (default 1, maximum 1,000,000) and `pageSize`
(default 25, maximum 100). The response is
`{ data: [...], pagination: { page, pageSize, total, hasMore } }`. Counts use the
same predicates as their rows; limiting/offset happen in SQL. Pages outside the
result set are empty. Page contents can change while the web dashboard is edited.

Details at `/projects/:id`, `/tasks/:id`, `/clients/:id`, and `/invoices/:id` return
`{ data: record }`, or 404. Client rows and details include `updatedAt`, the version a
client edit sends back. Invoice details include line-item IDs, payment history,
integer totals and balance, the same derived display status as the web, and
`printVersions`: the print versions this invoice offers (`full`, plus `payments` when
it has payments and `dp` when it requests a down payment).

`/invoices/:id/print` returns the invoice's print document as HTML instead of JSON. It
accepts only an optional `version` (`full`, `payments`, `dp`); an unavailable version
falls back to the invoice's default, as on the web print page.
- **Markup:** it's the sheet the web print page renders, built by the same escaped
  renderer in `src/lib/invoice-print.ts`.
- **Self-contained:** it carries the print CSS, both brand images, and the Montserrat
  latin and latin-ext subsets (`public/fonts`) inline, so it loads nothing else. Responses
  send `Content-Security-Policy: default-src 'none'; img-src data:; font-src data:;
  style-src 'unsafe-inline'`, `private, no-store, no-transform`, and `nosniff`.
  `no-transform` stops proxies such as Cloudflare from rewriting the document, for
  example replacing email addresses with "[email protected]".
- **Errors:** 401 without a device session, 404 for an unknown invoice, 400 for bad
  parameters, 405 for anything but GET. All of them are JSON, like the rest of the API.

Boolean parameters are `true`/`false`; dates are valid `YYYY-MM-DD` and ranges are
inclusive. Unknown, repeated, malformed, or out-of-range parameters return 400.
Search treats SQL wildcard characters literally. Empty `q` is allowed.

- Project statuses: `planned`, `in_progress`, `on_hold`, `completed`.
- Project `archived=true` selects archived projects; default selects current ones.
- Project attention: `overdue`, `upcoming`, `tasks`; sort: `updated`, `deadline`.
- Tasks exclude archived projects by default; `archived=true` includes them.
- Task `attention=due` matches the overview's unfinished tasks through seven days
  from the business date, excluding completed/archived projects. Additional
  completion/date filters compose with it.
- Invoice statuses: `all`, `draft`, `sent`, `overdue`, `paid`. Outstanding means a
  sent invoice with a positive remaining balance. Currencies: IDR and USD.

Overview attention sections contain at most five records but counts cover all
matching records. Its recent invoice list contains at most ten. Use the matching
filtered collection endpoint for the rest.

Each currency summary also includes `aging: { notDue, days1To30, days31To60, over60 }`:
the outstanding balance of sent invoices split by days past the due date, using the
Asia/Jakarta business date. Due today counts as not due; 60 days late is in
`days31To60`. The four add up to `outstanding`, and the last three add up to `overdue`.

An invoice detail also carries `updatedAt`, its version for edits, and `suggestedNumber`:
the next number in its issue year for a draft that has none, otherwise `null`.

Amounts are integers: whole rupiah for IDR and cents for USD. Percentages are basis
points. Dates and overdue rules follow Asia/Jakarta. Payments received exclude
write-offs; balance subtracts both, exactly as the dashboard does.

Responses are private/no-store JSON. Login requests must be JSON and at most 8 KiB;
failed password checks retain the existing 800 ms delay. Invalid requests return
400, oversized login bodies 413, unauthorized requests 401, missing records 404,
unsupported authenticated writes 405, and unexpected server failures a generic 500.

## Writes

Writes run the same shared function as the web Server Action (`src/lib/writes.ts`),
so parsing, rules and transactions are identical. The record that comes back has
the read endpoint's shape. After a successful write the route handler refreshes the
dashboard, like the Server Actions do.

| Request | Body | Success |
| --- | --- | --- |
| `POST /tasks` with `Idempotency-Key` | `{ projectId, title, dueDate, completed }` | 201 `{ data: task }` |
| `PATCH /tasks/:id` | `{ title, dueDate, completed, updatedAt }` | 200 `{ data: task }` |
| `DELETE /tasks/:id` | none | 200 `{ ok: true }` |
| `POST /projects` with `Idempotency-Key` | `{ clientId, name, description, status, startDate, deadline }` | 201 `{ data: project }` |
| `PATCH /projects/:id` | the same fields plus `updatedAt` | 200 `{ data: project }` |
| `POST /projects/:id/archive` | none | 200 `{ data: project }` |
| `POST /projects/:id/restore` | none | 200 `{ data: project }` |
| `POST /clients` with `Idempotency-Key` | `{ name, company, address, email, phone }` | 201 `{ data: client }` |
| `PATCH /clients/:id` | the same fields plus `updatedAt` | 200 `{ data: client }` |
| `DELETE /clients/:id` | none | 200 `{ ok: true }` |
| `POST /invoices` with `Idempotency-Key` | the invoice form's values (below) | 201 `{ data: invoice }` |
| `PATCH /invoices/:id` | the same plus `updatedAt` | 200 `{ data: invoice }` |
| `POST /invoices/:id/send` | `{ number, updatedAt }` | 200 `{ data: invoice }` |
| `POST /invoices/:id/revert` | none | 200 `{ data: invoice }` |
| `POST /invoices/:id/duplicate` with `Idempotency-Key` | none | 201 `{ data: invoice }`, the copy |
| `DELETE /invoices/:id` | none | 200 `{ ok: true }` |
| `POST /invoices/:id/payments` with `Idempotency-Key` | `{ paidOn, amount, note, writeOff, shownCurrency, shownBalance }` | 201 `{ data: invoice }` |
| `DELETE /invoices/:id/payments/:paymentId` | none | 200 `{ data: invoice }` |

- **Actions.** `POST /resource/:id/<action>` runs one named state change the web offers
  as its own button, and returns `200 { data }` with the record in its read shape. It needs
  no `Idempotency-Key` unless it creates a record. GET and other methods on an action
  path return 405. `/duplicate` creates a record, so it needs a key and returns 201.

- **Body.** JSON, at most 8 KiB, with exactly these keys and types; no query string.
  Values use the web form's shapes: dates are `""` for no date, and every project field
  is a string (`clientId` is a decimal string such as `"12"`), as is every client field.
  Anything else is 400.
- **Invoice bodies.** At most 512 KiB, since an invoice may have 200 lines. The keys are
  `clientId` (`""` for typed bill-to details), `projectId`, `billToName`, `billToCompany`,
  `billToAddress`, `issueDate`, `dueDate`, `currency`, `taxEnabled`, `taxRate`,
  `discountEnabled`, `discountType`, `discount`, `downPaymentEnabled`, `downPaymentType`,
  `downPayment`, `notes` and `items`, an array of `{ description, qty, unitPrice, notes }`.
  The three `…Enabled` keys are booleans; every other value is a string in the web form's
  shape (prices such as `"150.50"`, rates such as `"11"`). Each save replaces every line, in
  order. Line errors are keyed by position, such as `items.2.unitPrice`.
- **Validation.** 422 `{ message, errors: { field: message } }`, with the messages
  `parseTaskForm`, `parseProjectForm` and `parseClientForm` give the web forms. A missing client, or a
  client change on a project with linked invoices, is also 422 on `clientId`. On invoices,
  a project of another client is 422 on `projectId`, and an edit that recorded payments
  don't allow is 422 on `currency` or `items`. A total too large to store is 422
  `{ message }` with no `errors`.
- **Conflicts.** `updatedAt` is the value the app last read (tasks now include it).
  If the task has changed since, the PATCH writes nothing and returns 409. A PATCH
  never moves a task to another project. DELETE has no version check, like the web's Remove.
  A project's `updatedAt` also changes when one of its tasks is saved or deleted, and when
  it is archived or restored, so a project form opened before any of those gets 409.
  Archive and restore have no version check, like the web's buttons. A client's
  `updatedAt` changes on every save, from the web or the app. An invoice's `updatedAt`
  changes on every save, send, revert, and payment recorded or removed; send checks it,
  revert and delete don't.
- **Retries.** `Idempotency-Key` (16 to 100 letters, digits, `-` or `_`) is required on
  creates. A repeat of the same request with the same key, from the same session, returns
  the stored response with `Idempotent-Replayed: true` instead of creating again. The same
  key with a different request is 422. The request compared is the method, the whole path
  and the body, so a key used to duplicate one invoice can't replay for another. Only
  successes are stored, for 24 hours.
- **Client deletes.** No version check, like the web's Delete. A client with projects is
  refused with 422 `{ message }` and no `errors`: "This client has projects. Keep the client
  to preserve their project history." Nothing is deleted. A client with only invoices can be
  deleted: its invoices stay, with `clientId` null and their bill-to details unchanged.
- **Invoice actions.** Send assigns the number (an invoice that already has one keeps it).
  The writer's refusals are 422 `{ message }` with no `errors`: "Only a draft can be marked
  sent.", "Number … is already used by another invoice.", "Only a sent invoice can go back
  to draft." and "Remove its payments before sending it back to draft." A malformed number
  is 422 on `number`. Duplicate makes an unnumbered draft issued on the request's business
  date. Delete works in any status and removes its lines and payments.
- **Payments.** Both payment endpoints return the invoice, since a payment changes its balance,
  status and `paidAt`. `paidOn`, `amount` and `note` use the web form's shapes, `writeOff` is a
  boolean, and `shownCurrency` and `shownBalance` (an integer in the smallest unit) are what the
  app showed. If either differs from the invoice, the payment is refused with 409 and nothing is
  written. `parsePaymentForm`'s messages are 422 on their fields, in the invoice's currency. The
  writer's refusals are 422 `{ message }` with no `errors`: "Payments can only be recorded on a
  sent invoice.", "That is more than the … still owed.", "Nothing is left to write off." and
  "This invoice already has a write-off." Removing a payment has no version check, like the web's
  Remove; a payment not on that invoice is 404 "This payment no longer exists.". A retried
  payment with the same key returns the original 201, even though the balance has since changed.
- **Other statuses.** 401 without a valid session, 403 for a `read` session, 404 when the
  task, project, client or invoice is gone, 405 for other methods. Projects can't be deleted. Other
  resources still return 405 to writes.

## Rollout

Back up the SQLite file before deploying using the existing deploy procedure.
Migration 5 adds only device-session storage and runs transactionally. Migration 6
adds the session `scope` column (existing sessions become `read`) and the
`idempotency_keys` table; an older image ignores both. Migration 7 adds
`clients.updated_at` and stamps every existing client; an older image ignores it, and
clients it adds get `''`, which still works as a version. Invoice writes stamp
`updated_at` in milliseconds from phase 4 on, with no migration; older second-precision
values still work as versions, and an older image stamping seconds does too. Rolling
back the application leaves the extra table unused; restoring the complete
pre-deploy backup also removes sessions created since that backup. Do not replace
individual financial tables. Keep the backend behind the current HTTPS tailnet.

The API was deployed on 2026-10-15 at https://invoice.naspadstudio.id.
See [deployment and rollback record](deployments/2026-10-15-mobile-api.md).

## Reproducible HTTP verification

After a production build, run `node scripts/verify-mobile.mjs`. This creates a
new synthetic SQLite database in the system temporary directory, starts a local
server on a free loopback port, verifies reads/auth/revocation/web device listing,
then stops that server and removes its database. It also tests raw query keys
through Next.js Proxy, since framework normalization can differ from direct
handler tests. It never uses the normal `data/npinv.db` file.
