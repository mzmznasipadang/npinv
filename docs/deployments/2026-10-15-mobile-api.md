# Mobile API production deployment — 2026-10-15

The user explicitly authorized SSH to `root@naspad-server`, backup, and deployment.
The verified application commit `bf69a9d203045fd168c451ff518c76c116896a40` from
`codex/mobile-readonly` is deployed. Main was not merged or pushed.

- Release/image: `npinv:mobile-20261015T122505Z-bf69a9d`.
- Running image ID: `sha256:da7e652e56ee8d8901e885b429854c1c2dc8b6e1d2fd78333d6d16fc37ff164b`.
- App address: https://invoice.naspadstudio.id.
- Container: running, zero restarts at verification.
- Database schema: 5; existing business tables preserved exactly at cutover.
- Existing Compose, environment/password, database mounts, port binding, and
  HTTPS routing were retained. No image pruning was performed.

## Backup and deployment procedure completed

Backups remain on the server at:

`/srv/npinv/backups/mobile-20261015T122505Z-bf69a9d/`

- `before.db`: consistent SQLite VACUUM INTO snapshot taken while the old app ran.
- `cutover.db`: fresh consistent snapshot after stopping the old writer, immediately
  before applying migration 5.
- `before-fingerprint.json`, `cutover-fingerprint.json`: hashes of every row and
  column in settings, clients, projects, tasks, invoices, invoice_items, and payments.
- `source-before.tar.gz`, `compose-before.yaml`, `image-before.txt`: previous source,
  Compose file, and exact image ID.
- `rehearsal-verification.json`, `cutover-verification.json`, `live-verification.json`:
  migration, preservation, and deployed HTTP check results.
- `deployed-commit.txt`: exact deployed Git revision.

The backup directory is private; database snapshots and verification reports use
mode 0600. No customer records, passwords, or session tokens were copied locally
or printed in deployment output.

The old application image is tagged:

`npinv:before-mobile-20261015T122505Z-bf69a9d`

The previous source directory remains at:

`/srv/npinv/releases/mobile-20261015T122505Z-bf69a9d/source-before/`

Build logs, verification scripts, and the rehearsal database remain under that
release directory. The new committed source is at `/srv/npinv/src`.

The server's standard Docker build passed with its configured Turbopack builder.
An isolated container with no network rehearsed migration on the backup, verified
all seven business-table fingerprints, integrity and foreign keys, repeated the
migration, and checked restoring the original backup. The old dashboard stayed
online during the build and rehearsal.

The app was briefly stopped for the fresh snapshot, offline migration, exact
record comparison, source switch, and new-container startup. Automatic application
rollback was prepared but was not needed. Migration 5 only added device-session
storage; no existing financial/project/task records were changed.

## Live verification completed

- Signed-out mobile API: HTTP 401 JSON; protected web pages still redirect to login.
- Authenticated overview, projects, tasks, clients, invoices, and sessions: HTTP 200.
- Overview currency summaries matched independent calculations from live records.
  An existing invoice's balance and received payments matched its payment history.
- Malformed pagination and raw prototype query parameters: HTTP 400.
- Existing Overview, Projects, Invoices, Clients, and Settings pages: HTTP 200 with
  valid web authentication. Mobile devices section is present in Settings.
- Verification device sessions were created and revoked; subsequent reads returned
  401. No client, project, task, invoice, or payment was created for verification.
- Public HTTPS login: HTTP 200 with normal TLS verification.
- Public HTTPS authenticated overview, project, and invoice reads: HTTP 200.
  Bearer forwarding and DELETE session revocation work through the public proxy;
  the revoked credential then returned HTTP 401.

Credentials were derived from the existing container environment and kept in
memory inside that container. They did not appear in tool output or reports.

## Connect the iOS app

Enter `https://invoice.naspadstudio.id` as the server address, a recognizable device
name, and the existing admin password. Leave off `/api/v1`. The app stores only its
30-day device credential in Keychain. Sessions can be revoked in app device settings
or web Settings → Mobile devices.

## Recovery and remaining limits

Retain the tagged old image and backups. Before recovery, stop writers and preserve
the current database together with any WAL/SHM files. The previous app can ignore
the additive session table, so application rollback does not inherently require
restoring the database. A complete database restore would discard later writes;
review those writes before restoring any snapshot. Restore the matching old source
alongside an image rollback to keep future builds consistent.

Native simulator checks were completed separately with synthetic HTTPS data. A
physical-device login against production, iPad runtime pass, and full VoiceOver
audit remain unverified. App Store/TestFlight distribution and native business-data
editing remain outside this release.
