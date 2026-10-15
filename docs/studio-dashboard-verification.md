# Studio Dashboard verification and recovery

Local verification on 2026-10-15, Asia/Jakarta. All examples and browser records
are synthetic. No production database, credentials, infrastructure, or routing
was used or changed. The work is on `codex/studio-dashboard`.

## Automated checks

```sh
npm test
npm run lint
DATABASE_PATH=:memory: npm run build
git diff --check
```

At implementation completion: 114 tests pass; lint, route type generation,
TypeScript, and production build pass. Migration tests cover schemas 2→4 and
3→4, preservation of legacy invoice/client/settings/item/payment fields,
null project links, idempotence, foreign keys, and transactional rollback.
The first sandbox build cached a failed CSS-worker port bind. Clearing only
generated `.next/cache` and `.next/turbopack` and rebuilding with local process
permission resolved it. No build configuration change was necessary.

Repository tests cover client/project mismatches, stale forms, archived links,
duplicate-invoice rules, immutable historical snapshots on client/project edits,
task membership, checklist counts, search/filter composition, nullable dates,
seven-day boundaries, completed/archived work, and currency-separated balances.
Existing integer money, payment conflict, print variant, numbering, and Jakarta
midnight tests remain passing. There is no void invoice state in this app.

## Browser and HTTP checks

Preview command (use a new disposable path for another rehearsal):

```sh
DATABASE_PATH=/tmp/npinv-studio-review.db ADMIN_PASSWORD=synthetic-local-review npm run dev -- --hostname 127.0.0.1 --port 3100
```

Verified in the browser against that temporary database:

- Sign in, create a client, display project required-field errors, and save a
  project. Create, edit, date, complete, and reopen its task.
- Create an invoice from project details with client/project preselected;
  assign `INV-2026-001`; record Rp 500,000 against Rp 1,500,000; see the remaining
  Rp 1,000,000 in both invoice and project screens and on Overview.
- Print route displays the original client snapshot, amount, payment date,
  and remaining balance, with Full invoice / With payments controls. The OS
  print dialog and a saved PDF file were not exercised.
- Archive/restore the project; linked invoices and their partial-payment
  balance remain intact; New invoice action disappears while archived.
- Save a project deadline through the native date control and verify persistence.
  Native date input was used because this browser driver's generic fill method
  updated the displayed date without committing React's change event.
- Stop the synthetic server with typed project notes, submit, and see “Could
  not save. Your changes are still here; try again.” The text remains and the
  save button returns to its enabled state.
- Desktop Overview at 1440×1000 and mobile Overview/project details at 390×844
  were inspected. Document scroll width matches the viewport; wide financial
  tables scroll within their containers. The existing design, colors, sidebar,
  responsive controls, readable statuses, and field focus behavior are retained.
- Impeccable's mechanical detector returned no findings on changed UI targets.

HTTP checks without cookies: `/projects`, `/projects/1`, `/invoices` GETs and
POSTs for all four project/task actions on protected routes redirect to login;
project/task row counts remain unchanged. The proxy and explicit per-action
session checks are retained. The unsigned HTTP test exercises the proxy boundary;
it does not independently isolate the action-level guard from the proxy.

A development hot-reload retained an old invoice parser during integration;
restarting the dev server resolved the failed synthetic save without a source
change. The same flow subsequently succeeded on fresh modules.

## Migration and recovery rehearsal

The file-backed rehearsal is repeatable without a server or real data:

```sh
DATABASE_PATH=:memory: node --test --test-name-pattern='synthetic file database' src/lib/db.test.ts
```

It creates a unique temporary directory, enables SQLite WAL, migrates a file to
schema 3, inserts a synthetic USD invoice and partial payment, and uses SQLite
`VACUUM INTO` to create a consistent pre-migration backup. It migrates to 4,
compares payments/totals, checks nullable project links and foreign keys, closes
the writer, restores the backup, and verifies schema 3 and financial data. It
then removes only its own temporary directory. This rehearsal passed.

For staging rollout, first create a consistent SQLite backup with `VACUUM INTO`
or stop every writer before copying the database. A raw copy of a live WAL
database alone is not a complete backup. Test on a representative synthetic
schema-3 database before starting the new image, whose startup migration is
automatic. Compare invoice numbers, snapshots, items, discounts, taxes, totals,
payments, statuses, and balances before/after and run `PRAGMA foreign_key_check`.

Application rollback and database recovery are separate:

- Schema 4 is additive. Older invoice reads/writes use existing columns, but
  old client deletion can fail when new project references restrict it. A binary
  rollback is therefore not a claim that every old workflow remains supported.
- To restore the pre-migration snapshot: stop every application/writer, preserve
  the current database and WAL/SHM files as a separate recovery set, replace the
  database with the consistent backup, remove stale WAL/SHM only with all writers
  stopped, then start the compatible old image and verify numbers/balances.
- Restoring that backup discards later writes. Preserve and reconcile those
  separately if the staging/production system accepted new data after backup.
  Do not run reverse/drop-table SQL against the financial database.

## Unverified external work

No live staging destination is configured or deployed. Production backup
availability, actual public/tailnet routing, infrastructure rollback, and
Jenkins are unverified and outside this implementation. No production deploy
has been performed.

## Independent review and corrections

A fresh reviewer independently ran the 114-test suite and reviewed the complete
change. They found stale visible filter controls after Reset on both list pages,
and a possible long-name mobile overflow. The filter issue was reproduced before
fixing: Completed → Apply → Reset showed all project results while Status still
said Completed; USD → Apply → Reset similarly left Currency showing USD.
Both filter forms now remount when applied URL parameters change. Browser checks
confirm Reset and settled back/forward navigation synchronize controls and results.

A disposable 159-character unbroken project/client name reproduced the mobile
concern: document width was 4,157px on a 390px viewport. This was treated as a
functional responsive issue, then fixed with heading wrapping, constrained filter
controls, and shrinkable flex/grid content. The same fixture now measures 390px
at a 390px viewport; project Select triggers measure 358px with 356px scroll width.
The fixes passed the full 114-test suite and lint. No review findings are deferred.

Implementation decisions: the sandbox denied writes in the newly created native
worktree, so implementation used the original checkout on a feature branch;
`main` was not changed. The unused worktree was archived. Browser/mobile checks
for intermediate tasks were combined with the complete workflow at the end,
which could have discovered UI defects later; the final pass covered them. The
long-name finding was upgraded from minor after its actual viewport impact was
measured; its shared layout constraints were checked on the inspected pages.
