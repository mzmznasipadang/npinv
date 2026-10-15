# Studio Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox syntax for tracking.

**Goal:** Extend NPInv with client projects, task checklists, optional invoice links, and an accurate studio overview.

**Architecture:** Keep SQLite migrations and synchronous repository transactions. Add a focused project repository and Server Actions alongside the existing invoice code; reuse the shared forms, tables, date helpers, and money calculations. Protect reads and actions with the existing signed session.

**Tech Stack:** Next.js 16.4 App Router, React 19, TypeScript, Node SQLite, Zod, Tailwind, Radix/shadcn, node:test.

**Spec:** `docs/superpowers/specs/2026-10-15-studio-dashboard-design.md` (approved 2026-10-15).

## Global Constraints

- Preserve existing invoice URLs, historical bill-to snapshots, numbering, integer money arithmetic, payments, discounts, taxes, and print variants.
- Keep the current stack and design.
- Production deployment, Jenkins, and server changes are outside this work.
- Use one Jakarta calendar date for the whole request.
- Never combine currencies.
- No new dependencies, identity provider, ownership model, or public data cache.
- Read relevant installed guides under `node_modules/next/dist/docs/` before code changes; asynchronous params, Cache Components, authentication, Server Actions, and forms are relevant.
- Run tests with `DATABASE_PATH=:memory:`; use synthetic temporary files for migration/recovery checks. Do not migrate real data during implementation checks.

## Review Focus

- A project or client changes after an invoice form opens: reject invalid links atomically and preserve the entered invoice (Tasks 2, 4).
- An archived project already has invoices: retain history, prevent new links, and unlink new duplicate drafts (Tasks 2, 4).
- Multiple matching invoices/tasks inflate project task counts through joins: count tasks independently (Tasks 2, 6).
- A malformed or repeated URL parameter reaches a dynamic page: reject invalid IDs and normalize filters without throwing or broadening a targeted query (Tasks 3–5).
- Network/server failure after typing: retain values, clear pending state, and expose a useful retry message without swallowing redirects (Tasks 3–5).

## File boundaries

- `src/lib/db.ts`: append migration 4; keep the transaction/version mechanism.
- `src/lib/projects.ts`: project/task types, queries, writes, relationship errors, and work summaries. Use the existing DB connection/transaction helpers; no generic repository abstraction.
- `src/lib/project-schemas.ts`: project/task form parsing and URL-filter normalization; reuse `Parsed` and `FormState` types.
- `src/lib/project-actions.ts`: authenticated project/task mutations and invalidation.
- `src/lib/session.ts`: server-side session requirement using existing cookie verification.
- `src/lib/repo.ts`: invoice project reads/writes/filtering, shared relationship error, and safe client deletion only.
- `src/lib/schemas.ts`, `src/lib/invoice-form.ts`: optional project form field and round trips.
- `src/components/project-form.tsx`, `task-checklist.tsx`, `project-table.tsx`, `project-status.tsx`: focused UI using current components.
- `src/app/(app)/projects/`: list, new, detail, and loading routes.
- Existing Overview, invoice/client routes, sidebar, invoice form, and form hook: integration.
- `src/lib/*.test.ts`: meaningful logic/regression tests, using existing test command.
- `docs/studio-dashboard-verification.md`: local evidence, staging rehearsal, and recovery limits; update README links.

## Task 1: Additive schema and legacy migration proof

**Files:** Modify `src/lib/db.ts`, `src/lib/db.test.ts`.

**Interfaces:** `migrate(db: DatabaseSync, target?: number): void` stays unchanged; latest version becomes 4.

- [ ] Add a failing test starting at schema 3 with synthetic draft, sent, paid, partial-payment, discounted, IDR, and USD invoices. Capture `SELECT *` for invoices, items, payments, clients, and settings before migrating.
- [ ] Assert after migration that all old columns/values are identical, every project link is null, `PRAGMA foreign_key_check` is empty, and a second migration changes nothing. Keep the version-2 payment-backfill test, updating its expected latest version to 4.
- [ ] Run `npm test`; expect the new schema assertions to fail before implementation.
- [ ] Append migration 4: projects with required `client_id REFERENCES clients(id) ON DELETE RESTRICT`, name, description, checked status, nullable start/deadline/archive, timestamps; tasks with required project FK, title, checked integer completed flag, nullable due date, timestamps. Task FK uses cascade; invoice project FK is nullable with restrict. Add relationship and filter indexes named for their tables/columns.
- [ ] Test client/project deletion restrictions, task cascade without invoice cascade, and rollback when migration 4 encounters a preexisting conflicting table. Assert schema stays at 3 on failure.
- [ ] Run `npm test`; expect all migration and existing invoice tests to pass. Commit this task after verification.

## Task 2: Project/task repository and validation

**Files:** Create `src/lib/projects.ts`, `src/lib/project-schemas.ts`, `src/lib/projects.test.ts`, `src/lib/project-schemas.test.ts`; modify `src/lib/repo.ts`, `src/lib/repo.test.ts`.

**Interfaces:**
- `ProjectStatus = 'planned' | 'in_progress' | 'on_hold' | 'completed'`.
- `ProjectInput = { clientId: number; name: string; description: string; status: ProjectStatus; startDate: string | null; deadline: string | null }`.
- `Project = ProjectInput & { id: number; clientName: string; archivedAt: string | null; updatedAt: string; taskCount: number; completedTaskCount: number }`.
- `TaskInput = { title: string; dueDate: string | null; completed: boolean }`; `Task = TaskInput & { id: number; projectId: number }`.
- `ProjectFilter = { q?: string; status?: ProjectStatus; archived?: boolean; clientId?: number; attention?: 'overdue' | 'upcoming' | 'tasks'; sort?: 'deadline' | 'updated' }`.
- `listProjects(filter: ProjectFilter, todayDate: string): Project[]`; `getProject(id: number): Project | null`; `saveProject(id: number | null, input: ProjectInput): number`; `setProjectArchived(id: number, archived: boolean): void`.
- `listTasks(projectId: number): Task[]`; `saveTask(projectId: number, id: number | null, input: TaskInput): number`; `deleteTask(projectId: number, id: number): boolean`.
- Define `ProjectConflictError` in `repo.ts` with `field: string` and a readable message. Import it and `NotFoundError` into `projects.ts`; invoice integration uses direct SQL for link checks so `repo.ts` never imports `projects.ts`.
- `ProjectFormValues = { clientId: string; name: string; description: string; status: string; startDate: string; deadline: string }`; `TaskFormValues = { title: string; dueDate: string; completed: boolean }`. `parseProjectForm(values: unknown): Parsed<ProjectInput>` and `parseTaskForm(values: unknown): Parsed<TaskInput>`.
- `parseProjectFilter(params: Record<string, string | string[] | undefined>): Parsed<ProjectFilter>` and `parseRecordId(value: unknown): number | null`; invalid nonempty relation filters produce an explicit invalid-filter state in routes, never an unrestricted list.

- [ ] Add failing tests for create/edit, missing client/project, task membership, task ordering, exact task counts, literal `%`/`_` searches, all status/archive/date filters, and deterministic sort ties (ID descending after updated time).
- [ ] Add parser tests: blank names/titles; project name <=200, description <=2000, task title <=300 characters; positive safe-integer IDs; real optional dates; deadline before start rejected; malformed payloads and repeated query parameters handled explicitly.
- [ ] Run `npm test`; confirm failures name the missing exports/behavior.
- [ ] Implement the interfaces. Use transactional relationship checks, prepared parameters, and independent task-count subqueries. Blank dates become null. Deadline sorts undated projects last. Task writes update project timestamps, and archived/completed projects retain history.
- [ ] Make `repo.deleteClient` throw a readable `ProjectConflictError` for a client with projects; callers must handle it in Task 3. Allow changing a project's client only when no invoice references it. Test that archive/status changes leave linked invoice snapshots, balances, status, items, and payments unchanged once links exist in Task 4.
- [ ] Run `npm test`; expect pass. Commit the repository and validation task.

## Task 3: Authenticated actions and project/task screens

**Files:** Create `src/lib/session.ts`, `src/lib/project-actions.ts`; create project components and `/projects` routes listed above, including loading files. Modify `src/lib/actions.ts`, `src/hooks/use-actions.ts`, `src/components/app-sidebar.tsx`.

**Interfaces:**
- `requireSession(): Promise<void>` in `session.ts` reads cookies and uses existing `verifySession`; redirect to `/login` before any protected read/write when invalid.
- `saveProjectAction(id: number | null, values: ProjectFormValues): Promise<FormState>` redirects new records to details; saved edits return `{ ok: true }`.
- `archiveProjectAction(id: number, archived: boolean): Promise<FormState>`.
- `saveTaskAction(projectId: number, id: number | null, values: TaskFormValues): Promise<FormState>`; `deleteTaskAction(projectId: number, id: number): Promise<FormState>`.
- `ProjectForm({ project, clients })`, `TaskChecklist({ projectId, tasks })`, `ProjectTable({ projects, todayDate })`, and `ProjectStatusBadge({ status, archived })` consume the repository types; `project` is nullable for creation.

- [ ] Read installed auth/forms/data-security guides; add server-session checks at every new action and new data-reading route, and to existing actions in `actions.ts` (including client deletion handling). Retain proxy and existing cookie behavior.
- [ ] Add action validation for IDs and errors; catch only expected conflicts/missing records, revalidate the root layout after successful writes, and preserve Next redirects outside generic error catches.
- [ ] Build list/new/detail screens using existing components and controlled forms. Include status/client/archive/attention filters, search, sorting, task counts, optional dates, field errors, archive/restore confirmation, task CRUD, and useful no-client/no-project states.
- [ ] Add Projects navigation. Keep current sidebar behavior and existing routes. Render archived records as readable history with Restore and no new-invoice action.
- [ ] If improving failed-network feedback in `useServerForm`, retain values and return pending state to idle; rethrow framework control-flow errors using the installed Next guidance. Add a focused check for this behavior instead of swallowing all thrown errors.
- [ ] Run `npm test`, `npm run lint`, `npm run build`. Start a dev instance with a temporary synthetic SQLite file and verify signed-out direct GET/POST requests cannot read/mutate projects/tasks; signed-in valid session can. Verify desktop/mobile creation, errors, edit, tasks, archive, restore, and keyboard operation. Record actual evidence.
- [ ] Commit the project/task UI and authenticated actions.

## Task 4: Invoice relationship and regression coverage

**Files:** Modify `src/lib/repo.ts`, `src/lib/repo.test.ts`, `src/lib/schemas.ts`, `src/lib/schemas.test.ts`, `src/lib/invoice-form.ts`; extend `src/lib/projects.test.ts`.

**Interfaces:**
- Add `projectId: number | null` to `InvoiceInput`, persisted `Invoice`, and invoice row output. Update all typed fixtures and form defaults rather than making stored output optional.
- Add `projectId: string` to `InvoiceFormValues` and parse blank as null. Accept omitted projectId as null at the browser parser boundary for older open forms; repository input remains explicit.
- Extend `InvoiceFilter` with `projectId?: number`, `clientId?: number`, `currency?: Currency`, and `outstanding?: boolean`. Outstanding means sent with positive balance; filters compose with status/search.
- `saveInvoice` keeps its signature and throws `ProjectConflictError('projectId', message)` for invalid, mismatched, or newly archived links. `duplicateInvoice` preserves only unarchived project links.

- [ ] Add failing tests for nullable legacy links, project/client mismatch with no partial writes, missing project/client, archived new links, unchanged archived links on edits, unlinking, and duplication rules. Verify failed updates retain original items/payments.
- [ ] Test project reassignment after invoice creation, unchanged invoice history after client edits and project archive/completion, and stale invoice forms saved after a project's client/archive state changes.
- [ ] Add parser/form round-trip tests and project/client/currency/outstanding filter tests. Update existing fixtures with null projectId; retain the legacy missing-client behavior for invoices without a project.
- [ ] Run `npm test` to confirm the new behavior fails before implementation.
- [ ] Extend prepared insert/update/select statements and validate links inside the invoice transaction. Use current saved invoice link when deciding whether an archived link is unchanged. Keep all money, payment, numbering, and snapshot calculations intact; no project joins in financial sums.
- [ ] Run `npm test`; expect existing and new regressions to pass. Commit the invoice model integration.

## Task 5: Invoice and client navigation integration

**Files:** Modify `src/components/invoice-form.tsx`, `src/lib/actions.ts`, invoice list/new/detail routes, clients route, and project detail route.

**Interfaces:** `InvoiceForm` receives `projects: Project[]` containing selectable unarchived projects plus any current archived link. New invoice route reads asynchronous `searchParams.projectId` using the installed Next conventions.

- [ ] Add project selection to invoice forms, filtered to the chosen client; changing client clears an incompatible project. Display field errors and a linked-project detail link. Do not rewrite saved bill-to fields when selecting a project.
- [ ] Prefill a new invoice from a validated unarchived project's actual client and current bill-to fields. Missing, malformed, repeated, and archived requested project IDs show a clear unavailable/invalid state, rather than silently creating an unrelated draft. Key forms by initial values so navigating between project-prefilled URLs resets correctly.
- [ ] Handle `ProjectConflictError` in invoice/client actions as field errors or readable messages. Render linked invoices and New invoice on project details. Add client Projects/Invoices links using actual client IDs.
- [ ] Extend invoice list project/client/currency/outstanding filters. Preserve all filters in status links and searches; show the selected project/client context and a clear reset action. Invalid nonempty IDs must not fall back to an unrestricted list.
- [ ] Run tests/lint/build; verify create client → project → tasks → linked invoice → send/payment → print at desktop/mobile widths using synthetic records. Verify changing current client details leaves saved bill-to snapshots intact. Verify failed-save values and project-switch navigation.
- [ ] Commit the invoice/client workflow integration.

## Task 6: Overview, migration recovery, and final evidence

**Files:** Modify `src/lib/projects.ts`, `src/lib/projects.test.ts`, `src/app/(app)/page.tsx`, `src/components/app-sidebar.tsx`, README; create `docs/studio-dashboard-verification.md`.

**Interfaces:** `workSummary(todayDate: string): { activeCount: number; overdueCount: number; dueTaskCount: number; overdue: Project[]; upcoming: Project[]; tasks: (Task & { projectName: string })[] }`. Counts cover the entire eligible set; displayed lists may show the first 5. Project `attention=tasks` filters projects having those same due tasks.

- [ ] Add failing tests for today vs yesterday, exactly seven days vs eight, absent dates, completed/archived projects, unfinished/completed tasks, and projects with multiple tasks/invoices. Check summaries and list filters identify the same records. Retain Jakarta-midnight date-helper coverage.
- [ ] Implement summary queries from source records without stored counters. Rename Dashboard to Overview, add New project, project/task tiles and short attention lists, and preserve existing per-currency money summaries. Do not hide project content when invoices are empty.
- [ ] Link active/overdue/upcoming/task summaries to matching project filters. Link outstanding/overdue currency tiles to invoice filters including currency; preserve existing payment-month meaning.
- [ ] Run `npm test`, `npm run lint`, `npm run build`, `git diff --check`; compare totals, statuses, linked data, and print variants. Confirm no production credentials/data entered fixtures or logs.
- [ ] Rehearse a schema-3 file backup → schema-4 migration → foreign-key/snapshot comparison → restored backup on temporary synthetic files with writers stopped. Record exact commands/results and application-vs-database rollback limits. Do not claim a live staging deploy; record missing staging destination as unverified.
- [ ] Complete one batched desktop/mobile review of Overview and principal workflow, fix concrete defects in one batch, and confirm once. Document what passed and any remaining limitations. Commit final integration and evidence.

## Execution review

The six tasks depend on shared types and transaction rules; execute in order.
Recommend native execution in this session to keep those interfaces consistent.
Before implementation, the user reviews this plan and chooses native or
subagent-driven execution, as required by the writing-plans handoff.
