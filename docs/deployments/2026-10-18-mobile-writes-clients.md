# Mobile writes phase 3 (clients) production deployment — 2026-10-18

The user asked for this deployment over `ssh root@naspad-server`. Commit `e64f915` was deployed. It is `main` with phase 3 merged (PR #5). Compared with the previous release (`c22c6d1`), it adds only the phase 3 client writes and the 2026-10-16 deployment record. Nothing was merged or pushed by this deployment.

- Release: `clients-20261018T010951Z-e64f915`.
- Image: `npinv:clients-20261018T010951Z-e64f915` = `npinv:latest`, ID `sha256:5b06797ad848…`.
- Previous image, kept for rollback: `npinv:before-clients-20261018T010951Z-e64f915`, ID `sha256:4fb58bde2fae…` (the writes release, `c22c6d1`).
- Address: https://invoice.naspadstudio.id.
- **Schema:** migration 7 ran on first database access. It adds `clients.updated_at` and stamps every existing client. It is additive: an older image ignores the column, and clients it adds get `''`, which still works as a version.
- **Sessions:** unchanged. All 11 device sessions kept their scope (2 `write`). Nobody needs to sign in again.
- **Unchanged:** Compose (identical to the repo's `deploy/compose.yaml`), `.env`, data mounts, port binding and HTTPS routing. No images were pruned.

## Backups

These are kept in `/srv/npinv/backups/clients-20261018T010951Z-e64f915/`. The folder has mode 700, and the files have mode 600.

- `before.db`: a `VACUUM INTO` snapshot taken by the running app before any change.
  - `PRAGMA integrity_check` returned `ok`.
  - It holds 2 invoices, 1 project, 4 tasks, 2 clients and 11 device sessions, at schema version 6.
- `image-before.txt`, `compose-before.yaml` and `source-before.tar.gz`: the previous image ID, Compose file and source.
- `deployed-commit.txt`: the full hash of `e64f915`.

The previous source directory is also kept at `/srv/npinv/releases/clients-20261018T010951Z-e64f915/source-before/`, with `build.log` next to it.

## Procedure

1. Backed up as above, and tagged the running image `before-…`.
2. Ran `git archive e64f915` into `/srv/npinv/src-new` and checked that these arrived:
   - migration 7 (`CLIENT_VERSIONS`) in `src/lib/db.ts`;
   - `saveClient` in `src/lib/writes.ts`;
   - the `clients/:id` routes in `src/lib/mobile-api.ts`.

   `deploy/compose.yaml` matched the live Compose file. Then swapped it into place as `/srv/npinv/src`.
3. Ran `docker compose build` from `/srv/npinv`. The Turbopack build passed: "Compiled successfully in 4.8s". The new image was tagged with the release name, and production stayed on the old image during the build.
4. Smoke-tested the new image in a throwaway container on `127.0.0.1:3013`, using a copy of `before.db`. The container and the copy were then removed. The results:
   - `/login` returned 200.
   - `/api/v1/overview` returned a JSON 401 with `private, no-store` and `nosniff`.
   - POST `/api/v1/clients` and DELETE `/api/v1/clients/1` returned 401 without a token.
   - A request with a well-formed fake token opened the database. That ran migration 7 on the copy: schema version 7, both clients stamped (none left `''`), data counts unchanged, integrity `ok`.
   - The logs were clean.
5. Ran `docker compose up -d` without `--build`. The container was recreated, with a few seconds of downtime.

## Live verification

- **Container:** running the new image, zero restarts, clean start log.
- **Localhost:**
  - `/login` returns 200, and `/projects` without a cookie redirects (307) to `/login`.
  - `/api/v1/overview` without a token returns a JSON 401 with `private, no-store` and `nosniff`. With a fake token it returns 401 too.
  - POST `/api/v1/clients` and DELETE `/api/v1/clients/1` without a token return 401.
- **Live database:** schema version 7, both clients stamped. The data counts match the backup (2 invoices, 1 project, 4 tasks, 2 clients, 11 sessions with 2 `write`), and integrity is `ok`.
- **Public HTTPS:** `/login` returns 200, and POST `/api/v1/clients` without a token returns a JSON 401.

No signed-in requests were made against production; the admin password wasn't used. These checks are left to the user:

- **App:** after installing the phase 3 build, check that Add Client, Edit and Delete appear on Clients, and that New Client works from the project form.
- **Web:** signed in, adding, editing and deleting a client behaves as before.

## Rollback

```bash
ssh root@naspad-server
cd /srv/npinv
docker tag npinv:before-clients-20261018T010951Z-e64f915 npinv:latest
rm -rf src && cp -a releases/clients-20261018T010951Z-e64f915/source-before src
docker compose up -d
```

- **No database restore is needed for a rollback.** Migration 7 is additive: the previous image ignores `clients.updated_at`.
- **The phase 3 app on the old image:** client reads come back without `updatedAt`, so the app hides client Edit and Delete. Add Client and New Client still show, and get 405 in the normal alert.
- **A full restore** of `before.db` would also remove anything written since the deploy, so use it only if the data itself is wrong.
