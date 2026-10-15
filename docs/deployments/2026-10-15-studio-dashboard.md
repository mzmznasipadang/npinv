# Studio Dashboard production deployment — 2026-10-15

The user explicitly requested merging into main and deploying after local
verification and review. This supersedes the earlier local-only status in
`docs/studio-dashboard-verification.md`.

- Application revision deployed: `20c0c1d`.
- Release/image tag: `npinv:studio-20261015T070027Z-20c0c1d`.
- Public login: https://invoice.naspadstudio.id/login (HTTPS 200 verified).
- Main was fast-forwarded locally after fetching origin; 114 tests and lint
  passed. The production Docker build also passed on the server's Node 24 image.
- Existing Compose configuration and localhost-only port binding were unchanged.
  No routing, credentials, or infrastructure configuration changed.

## Backups and rehearsal

The server was still running schema 2, so deployment applied migrations 3 and 4.
Before changing the running container, its image and source were preserved and
SQLite `VACUUM INTO` created a consistent backup. An isolated container with no
network access rehearsed the exact upgrade on a copy, checked every original
column of settings, clients, invoices, and invoice items, checked foreign keys
and integrity, repeated migration, and successfully restored the old backup.
There were no paid invoices requiring payment backfill in that snapshot.

Rollback artifacts remain on the deployment server:

- Directory: `/srv/npinv/backups/studio-20261015T070027Z-20c0c1d/`.
- `before.db`: initial consistent snapshot.
- `cutover.db`: fresh snapshot taken after stopping the old app immediately
  before starting the new image.
- `source-before.tar.gz` and `image-before.txt`: previous release and image ID.
- `verification.json`, `cutover-verification.json`, and
  `deployed-verification.json`: rehearsal results and legacy-data fingerprints.
- Previous image: `npinv:before-studio-20261015T070027Z-20c0c1d`.
- Previous source: `/srv/npinv/releases/source-before-studio-20261015T070027Z-20c0c1d/`.

Backups and verification files stay on the server; no customer data was committed
or printed in deployment logs. The running app remained available during image
build; it was stopped briefly for the final snapshot/container switch.

## Live verification

Authenticated requests were made inside the container using a short-lived signed
session derived from its existing environment; no credentials or session token
left the container or appeared in logs.

- Overview, Projects, Invoices, and Clients: HTTP 200 with expected page headings.
- Both legacy invoice detail and print routes: HTTP 200; print toolbar present.
- Schema version: 4. All original columns in all four legacy tables matched the
  cutover fingerprints exactly.
- Foreign-key check: empty. Integrity check: `ok`.
- Signed-out Projects: redirects to login.
- Container: running, zero restarts at verification time.
- Public HTTPS login: HTTP 200.

No test client, project, task, invoice, or payment was written into production.
The OS print dialog/saved PDF output and a separate staging deployment remain
unverified. Synthetic preview data exists only in the separate local `/tmp` DB.

## Recovery limits

Retain the old image tag and backups; do not prune them until the release is
accepted. Before recovery, stop every writer and preserve the current database
and its WAL/SHM files as a separate recovery set.

The previous app predates partial-payment tracking. Merely selecting the previous
image does not restore the old financial workflow when new payments/projects
have been entered. A full database restore to `cutover.db` also removes all later
writes. Review and reconcile those writes before any database restoration.
Follow the stopped-writer restoration procedure in the verification document;
do not run reverse/drop-table SQL on the financial database.
