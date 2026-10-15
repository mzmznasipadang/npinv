# Native mobile API

All paths start with `/api/v1`. The iOS app uses the same SQLite file and financial
repository functions as the dashboard. Business-data routes accept GET only.
Device sessions use schema migration 5; existing invoices, projects, tasks,
clients, and web authentication remain intact.

## Authentication

`POST /sessions` accepts JSON `{ "deviceName": "My iPhone", "password": "<entered at login>" }`.
On success it returns 201 with `{ id, deviceName, createdAt, expiresAt, token }`.
The opaque 256-bit token is returned once; SQLite stores its SHA-256 hash and a
credential binding. It expires after 30 days. The password is never stored.

Every other endpoint requires `Authorization: Bearer <token>`. Web cookies do not
provide API access. Expired, revoked, missing, or invalid credentials return 401
JSON. Changing ADMIN_PASSWORD invalidates all mobile sessions.

`GET /sessions` returns `{ data: [{ id, deviceName, createdAt, expiresAt, current }] }`.
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
integer totals and balance, and the same derived display status as the web.

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

## Rollout

Back up the SQLite file before deploying using the existing deploy procedure.
Migration 5 adds only device-session storage and runs transactionally. Rolling
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
