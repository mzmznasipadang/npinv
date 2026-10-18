# Mobile writes phase 4 (invoices) production deployment — 2026-10-18

The user asked for this deployment over `ssh root@naspad-server`. Commit `1eacaf7` was deployed. It is `main` with phase 4
merged (PR #7). Compared with the previous release (`e64f915`), it adds the phase 4 invoice writes, `GET /settings` and
the phase 3 deployment record. Nothing was merged by this deployment.

- Release: `invoices-20261018T021330Z-1eacaf7`.
- Image: `npinv:invoices-20261018T021330Z-1eacaf7` = `npinv:latest`, ID `sha256:2bc716915763…`.
- Previous image, kept for rollback: `npinv:before-invoices-20261018T021330Z-1eacaf7`, ID `sha256:5b06797ad848…` (the
  clients release, `e64f915`).
- Address: https://invoice.naspadstudio.id.
- **Schema:** no migration. It stays at version 7.
  - Invoice writers now stamp `updated_at` in milliseconds.
  - The 2 existing invoices keep their second-precision stamps until their next write. These still work as versions,
    because the check is an equality test.
- **Sessions:** unchanged. All 11 device sessions kept their scope (2 `write`). Nobody needs to sign in again.
- **Unchanged:** Compose (identical to the repo's `deploy/compose.yaml`), `.env`, data mounts, port binding and HTTPS
  routing. No images were pruned.

## Backups

These are kept in `/srv/npinv/backups/invoices-20261018T021330Z-1eacaf7/`. The folder has mode 700, and the files have
mode 600.

- `before.db`: a `VACUUM INTO` snapshot taken by the running app before any change.
  - `PRAGMA integrity_check` returned `ok`.
  - It holds 2 invoices (6 lines, no payments), 1 project, 4 tasks, 2 clients and 11 device sessions, at schema version 7.
- `image-before.txt`, `compose-before.yaml` and `source-before.tar.gz`: the previous image ID, Compose file and source.
- `deployed-commit.txt`: the full hash of `1eacaf7`.

The previous source directory is also kept at
`/srv/npinv/releases/invoices-20261018T021330Z-1eacaf7/source-before/`, with `build.log` next to it.

## Procedure

1. Backed up as above, and tagged the running image `before-…`.
2. Ran `git archive 1eacaf7` into `/srv/npinv/src-new` and checked that these arrived:
   - the millisecond invoice stamps in `src/lib/repo.ts`;
   - `saveInvoice` and `markSent` in `src/lib/writes.ts`;
   - the `invoices/:id/duplicate` route and `INVOICE_LIMIT = 524288` in `src/lib/mobile-api.ts`.

   `deploy/compose.yaml` matched the live Compose file. Then swapped it into place as `/srv/npinv/src`.
3. Ran `docker compose build` from `/srv/npinv`. The Turbopack build passed: "Compiled successfully in 5.1s". The new image
   was tagged with the release name, and production stayed on the old image during the build.
4. Smoke-tested the new image in a throwaway container on `127.0.0.1:3013`, using a copy of `before.db`. The container and
   the copy were then removed. The results:
   - `/login` returned 200.
   - `/api/v1/overview` returned a JSON 401 with `private, no-store` and `nosniff`.
   - Without a token, these returned 401: `POST /api/v1/invoices`, `PATCH /api/v1/invoices/1`,
     `POST /api/v1/invoices/1/send`, `POST /api/v1/invoices/1/duplicate`, `DELETE /api/v1/invoices/1` and
     `GET /api/v1/settings`. A well-formed fake token got 401 too.
   - The copy stayed at schema version 7 with integrity `ok` and unchanged counts.
   - The logs were clean.
5. Ran `docker compose up -d` without `--build`. The container was recreated, with a few seconds of downtime.

## Live verification

- **Container:** running the new image, zero restarts, clean start log.
- **Localhost:**
  - `/login` returns 200, and `/projects` without a cookie redirects (307) to `/login`.
  - `/api/v1/overview` without a token returns a JSON 401 with `private, no-store` and `nosniff`.
  - `POST /api/v1/invoices`, `POST /api/v1/invoices/1/send` and `GET /api/v1/settings` without a token return 401.
- **Live database:** schema version 7. The counts match the backup (2 invoices, 1 project, 4 tasks, 2 clients,
  11 sessions with 2 `write`), and integrity is `ok`.
- **Public HTTPS:** `/login` returns 200. `POST /api/v1/invoices` and `GET /api/v1/settings` without a token return a JSON 401.

No signed-in requests were made against production; the admin password wasn't used. These checks are left to the user:

- **App:** after installing the phase 4 build, check that New Invoice appears on Invoices and on a project's linked
  invoices, and that a draft shows Edit, Mark Sent, Duplicate and Delete.
- **Web:** signed in, creating, editing, marking sent, reverting, duplicating and deleting an invoice behaves as before.

## Rollback

```bash
ssh root@naspad-server
cd /srv/npinv
docker tag npinv:before-invoices-20261018T021330Z-1eacaf7 npinv:latest
rm -rf src && cp -a releases/invoices-20261018T021330Z-1eacaf7/source-before src
docker compose up -d
```

- **No database restore is needed for a rollback.** There is no migration. The previous image stamps invoice versions in
  seconds again, which still works.
- **The phase 4 app on the old image:**
  - invoice reads come back without `updatedAt`, so the app hides Edit and the actions section;
  - New Invoice still shows, and its form can't load (`GET /settings` is 404).
- **A full restore** of `before.db` would also remove anything written since the deploy, so use it only if the data itself
  is wrong.
