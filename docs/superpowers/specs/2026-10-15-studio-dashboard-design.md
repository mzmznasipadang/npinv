# Studio Dashboard: repository discovery and proposed design

Date: 2026-10-15 (Asia/Jakarta). Status: proposed; application code unchanged.

Product brief: `/Users/naspadstudio/Documents/NPMail/STUDIO_DASHBOARD_SPEC.md`.
The brief supplies product requirements; its starter prompt and suggested sequence
are supporting material, not separate commands to deploy or operate infrastructure.

## Outcome and constraints

Extend NPInv so one studio operator can track clients, projects, small task
checklists, and invoices in one application. Preserve existing invoice URLs,
historical bill-to snapshots, numbering, integer money arithmetic, payments,
discounts, taxes, and print variants. Keep the current stack and design.
Production deployment, Jenkins, and server changes are outside this work.

## Discovery and baseline

- Next.js 16.4 App Router, React 19, TypeScript, Tailwind, and shared Radix/shadcn
  components. Cache Components and partial prefetching are enabled. Dynamic pages
  currently call `connection()` before accessing SQLite.
- `src/lib/db.ts`: Node SQLite, WAL, foreign keys, transactional migrations using
  `PRAGMA user_version`; current version is 3. Development data lives in
  `data/npinv.db`. No ORM or migration service is needed.
- `src/lib/repo.ts`: clients, invoice snapshots/items, settings, and payments.
  Invoice states are draft, sent, and paid. Overdue and part-paid are derived.
  There is no void state, so this extension will not introduce one.
- Payments and write-offs already determine outstanding balances. Dashboard
  summaries already separate IDR and USD. Reuse these calculations.
- PDF export already exists through browser printing of the branded A4 print
  route, including full invoice, payments, and down-payment variants. No separate
  PDF generator or payment engine is required.
- `src/lib/rules.ts` already uses Asia/Jakarta for today. Reuse its date helpers;
  no timezone setting or conversion model is necessary for this release.
- Authentication is a single environment password with signed session cookies,
  enforced by `src/proxy.ts`. There are no user ownership or workspace columns.
- Server Actions currently rely on the proxy. Installed Next.js forms guidance
  explicitly requires authentication inside each action. New entry points and
  existing actions touched by this feature should verify the existing session
  directly, without replacing the identity system. Protect new reads before
  loading data; never cache authenticated database content as public output.
- Existing controlled forms, `Field`, `useServerForm`, confirmations, toasts,
  tables, cards, status text, and loading skeletons are reusable.
- Deployment is a standalone Docker image with a persistent SQLite volume.
  README describes tailnet access, whereas the brief names a public hostname.
  Actual hosting was not checked; no routing changes are necessary locally.
- Baseline: `npm test` passes 97 tests; `npm run lint` and `npm run build` pass.
  Working tree was clean before discovery. No production database was inspected.

## Approach

Recommend an additive extension of the current repository and components.
A project-only release would be smaller but would leave the requested
project-to-invoice workflow incomplete. A separate dashboard application would
duplicate client/authentication data and conflict with the brief.

### Data and invariants

Add migration 4 with `projects`, `tasks`, and nullable `invoices.project_id`.
Projects have an integer ID, required client foreign key, name, description,
one of planned/in_progress/on_hold/completed, optional start/deadline dates,
an archive timestamp, and created/updated timestamps. Archiving is independent
of status; exclude archived records from default operational lists and summaries.
Allow restoring archived projects. Do not offer project deletion in this release.

Tasks have an integer ID, required project foreign key, title, completion flag,
optional due date, and timestamps. Order unfinished tasks first, then due date
(undated last), then ID. Task changes update their project's updated timestamp.

Use `ON DELETE RESTRICT` for project-to-client and invoice-to-project foreign
keys. Existing client deletion continues to work when no projects reference the
client; otherwise return a clear error instead of removing project context.
Tasks may cascade on project deletion at the database level because no financial
records cascade from projects. Index project client/status/deadline, task
project/completion/due date, and invoice project/client relationships.

Validate positive safe-integer IDs, real dates, deadline >= start date when both
exist, nonempty trimmed titles/names, bounded text, and enum values on the server.
Validate task membership for every task mutation. Use transactions for checks
that must remain true through writes.

An invoice's selected project must exist and belong to its selected client.
Reject mismatches rather than silently changing either relationship. Permit
unlinking and legacy invoices with a null project. Prevent changing a project's
client while invoices reference it. Client edits and project status/archive
changes must never rewrite invoice snapshots, money, status, or payments.
An archived project stays visible on existing invoices and can retain an existing
link, but is unavailable for new links or creating invoices from that project.
Invoice duplication preserves a project link only if the project is unarchived;
otherwise the new draft is unlinked, with the original invoice unchanged.

### Routes and workflow

- `/`: rename Dashboard to Overview; retain currency-separated financial
  summaries and add active projects, unfinished overdue projects, upcoming
  deadlines, due tasks, and attention lists. Show project content even when
  there are no invoices. Include New project and New invoice actions.
- `/projects`: search project/client name; filter status, archived, client,
  overdue, and upcoming; sort deadline or updated time. Show client, readable
  status, deadline/overdue indication, and completed/total tasks.
- `/projects/new` and `/projects/[id]`: project form, archive/restore actions,
  task add/edit/complete/delete, and linked invoices via the existing invoice
  table. New invoice links to `/invoices/new?projectId=<id>`.
- `/invoices/new`: validate the optional project query parameter and prefill
  project, client, and the client's current bill-to fields. Invoice editing
  keeps saved bill-to snapshots. Changing project selection must not implicitly
  refresh a saved invoice's historical customer fields.
- `/invoices` and `/invoices/[id]`: add project filtering and selection; show a
  link to project details. Preserve existing list filters and print URLs.
- `/clients`: expose each client's projects and invoices through filtered list
  links; retain current client editing. Add `clientId` invoice filtering using
  the actual client relationship rather than matching historical name text.
- Navigation: Overview, Projects, Invoices, Clients, Settings.

Reuse the existing visual language, responsive sidebar, labeled controlled
inputs, focus styles, empty states, confirmations, and loading components.
Preserve entered values on failed saves and show field-level relationship errors.

### Overview calculations

Use one Jakarta calendar date for the whole request. Active means unarchived
and in_progress. Overdue projects have a deadline before today and are neither
completed nor archived. Due tasks are unfinished tasks on unarchived projects
that are not completed; include overdue tasks and dates through today + 7 days.
Upcoming projects use the same seven-day window and omit completed/archived
projects. Undated work is not overdue. Completed projects retain their checklist
history; completing a project does not complete its tasks or settle invoices.

Expose matching query filters for overview links, including a due-tasks view
within the projects list so the task summary opens the same underlying set.
Financial summaries reuse existing repository calculations; drafts and paid
invoices contribute no collectible balance. Never combine currencies.

## Delivery and verification

1. Add and test the migration and project/task repository operations, including
   legacy invoice preservation, foreign keys, archive behavior, and client rules.
2. Add authenticated project/task actions, validation, and list/detail forms.
3. Extend invoice schema parsing, repository writes, form round trips, project
   selection, creation prefills, client filters, and relationship navigation.
4. Extend Overview and navigation using real queries and shared date rules.
5. Run tests, lint, build, and desktop/mobile workflow checks. Cover failed saves,
   keyboard use, unauthenticated reads/actions, stale/missing records, mismatched
   clients, archived links, payment regression, multiple currencies, missing
   dates, and Jakarta midnight boundaries.
6. Document a synthetic staging rehearsal and backup recovery. Migrate a
   representative legacy database copy and compare pre/post invoice snapshots,
   items, payments, numbers, totals, and statuses; run foreign-key checks and
   repeat migration to establish idempotence. Test recovery using a synthetic
   database, never the live development or production file.

The migration runs at application startup, as today. Back up before rollout.
Application rollback may run against the additive schema but must be rehearsed;
older client deletion can fail when new project references exist. Database
rollback means restoring the pre-migration backup with all writers stopped,
which loses subsequent writes unless separately recovered. Document those
limits explicitly rather than attempting destructive reverse SQL.

No staging destination or credentials are established in this repository.
Local synthetic verification can proceed; report a live staging deployment as
unverified until a destination is supplied and that separate action is authorized.
