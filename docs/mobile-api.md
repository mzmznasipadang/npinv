# Native mobile API

All paths start with `/api/v1`. The iOS app uses the same SQLite file and financial
repository functions as the dashboard. Business-data routes are read-only except
tasks, which the app can also create, edit and delete, and projects, which it can
also create, edit, archive and restore (see "Writes"). Device
sessions use schema migrations 5 and 6; existing invoices, projects, tasks,
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

Collections additionally accept `page` (default 1, maximum 1,000,000) and `pageSize`
(default 25, maximum 100). The response is
`{ data: [...], pagination: { page, pageSize, total, hasMore } }`. Counts use the
same predicates as their rows; limiting/offset happen in SQL. Pages outside the
result set are empty. Page contents can change while the web dashboard is edited.

Details at `/projects/:id`, `/tasks/:id`, `/clients/:id`, and `/invoices/:id` return
`{ data: record }`, or 404. Invoice details include line-item IDs, payment history,
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

- **Actions.** `POST /resource/:id/<action>` runs one named state change the web offers
  as its own button, and returns `200 { data }` with the record in its read shape. It needs
  no `Idempotency-Key` unless it creates a record. GET and other methods on an action
  path return 405.

- **Body.** JSON, at most 8 KiB, with exactly these keys and types; no query string.
  Values use the web form's shapes: dates are `""` for no date, and every project field
  is a string (`clientId` is a decimal string such as `"12"`). Anything else is 400.
- **Validation.** 422 `{ message, errors: { field: message } }`, with the messages
  `parseTaskForm` and `parseProjectForm` give the web forms. A missing client, or a
  client change on a project with linked invoices, is also 422 on `clientId`.
- **Conflicts.** `updatedAt` is the value the app last read (tasks now include it).
  If the task has changed since, the PATCH writes nothing and returns 409. A PATCH
  never moves a task to another project. DELETE has no version check, like the web's Remove.
  A project's `updatedAt` also changes when one of its tasks is saved or deleted, and when
  it is archived or restored, so a project form opened before any of those gets 409.
  Archive and restore have no version check, like the web's buttons.
- **Retries.** `Idempotency-Key` (16 to 100 letters, digits, `-` or `_`) is required on
  creates. A repeat of the same request with the same key, from the same session, returns
  the stored response with `Idempotent-Replayed: true` instead of creating again. The same
  key with a different request is 422. Only successes are stored, for 24 hours.
- **Other statuses.** 401 without a valid session, 403 for a `read` session, 404 when the
  task or project is gone, 405 for other methods. Projects can't be deleted. Other
  resources still return 405 to writes.

## Rollout

Back up the SQLite file before deploying using the existing deploy procedure.
Migration 5 adds only device-session storage and runs transactionally. Migration 6
adds the session `scope` column (existing sessions become `read`) and the
`idempotency_keys` table; an older image ignores both. Rolling
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
