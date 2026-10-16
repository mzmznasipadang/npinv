# Mobile writes (phases 1 and 2) production deployment — 2026-10-16

The user asked for this deployment over `ssh root@naspad-server`. Commit `c22c6d1` was deployed. It is the tip of `feat/mobile-writes`: `main` (`bc8523f`, phase 1 merged) plus exactly the phase 2 project writes (PR #3). Its tree is identical to the tested `95abb08`. NPInv `main` doesn't contain phase 2 yet; nothing was merged or pushed by this deployment.

- Release: `writes-20261016T081642Z-c22c6d1`.
- Image: `npinv:writes-20261016T081642Z-c22c6d1` = `npinv:latest`, ID `sha256:4fb58bde2fae…`.
- Previous image, kept for rollback: `npinv:before-writes-20261016T081642Z-c22c6d1`, ID `sha256:d8978ca4668c…` (the printfix release, `22077b1`).
- Address: https://invoice.naspadstudio.id.
- **Schema:** migration 6 ran on first database access. It adds the `device_sessions.scope` column and the `idempotency_keys` table. It is additive, and an older image ignores both.
- **Sessions:** all 9 existing device sessions became `read`. A phone has to sign out and back in to get edit controls.
- **Unchanged:** Compose (identical to the repo's `deploy/compose.yaml`), `.env`, data mounts, port binding and HTTPS routing. No images were pruned.

## Backups

These are kept in `/srv/npinv/backups/writes-20261016T081642Z-c22c6d1/`. The folder has mode 700, and the files have mode 600.

- `before.db`: a `VACUUM INTO` snapshot taken by the running app before any change.
  - `PRAGMA integrity_check` returned `ok`.
  - It holds 2 invoices, 1 project, 4 tasks, 2 clients and 9 device sessions, at schema version 5.
- `image-before.txt`, `compose-before.yaml` and `source-before.tar.gz`: the previous image ID, Compose file and source.
- `deployed-commit.txt`: the full hash of `c22c6d1`.

The previous source directory is also kept at `/srv/npinv/releases/writes-20261016T081642Z-c22c6d1/source-before/`, with `build.log` next to it.

## Procedure

1. Backed up as above, and tagged the running image `before-…`.
2. Ran `git archive c22c6d1` into `/srv/npinv/src-new` and checked that these arrived:
   - `src/lib/writes.ts`, `scripts/verify-mobile.mjs`, and the project routes in `src/lib/mobile-api.ts`;
   - migration 6's `idempotency_keys` table in `src/lib/db.ts`.

   `deploy/compose.yaml` matched the live Compose file. Then swapped it into place as `/srv/npinv/src`.
3. Ran `docker compose build` from `/srv/npinv`. The Turbopack build passed: "Compiled successfully in 4.9s". The new image was tagged with the release name, and production stayed on the old image during the build.
4. Smoke-tested the new image in a throwaway container on `127.0.0.1:3013`, using a copy of `before.db`. The container was then removed. The results:
   - `/login` returned 200.
   - `/api/v1/overview` returned a JSON 401 with `private, no-store`.
   - POST `/api/v1/projects` and GET `/api/v1/projects/1/archive` returned 401 without a valid token.
   - A request with a well-formed fake token opened the database. That ran migration 6 on the copy: schema version 6, `idempotency_keys` present, 9 sessions `read`, data counts unchanged, integrity `ok`.
   - The logs were clean.
   - Migrations run lazily, so the first unauthenticated checks hadn't opened the database; the fake-token request is what triggers them.
5. Ran `docker compose up -d` without `--build`. The container was recreated, with a few seconds of downtime.

## Live verification

- **Container:** running the new image, zero restarts, clean start log.
- **Localhost:**
  - `/login` returns 200, and `/projects` without a cookie redirects to `/login`.
  - `/api/v1/overview` without a token returns a JSON 401 with `private, no-store` and `nosniff`. With a fake token it returns 401 too.
  - POST `/api/v1/projects` and GET `/api/v1/projects/1/archive` without a token return 401.
- **Live database:** schema version 6, `idempotency_keys` present, all 9 sessions `read`. The data counts match the backup (2 invoices, 1 project, 4 tasks, 2 clients), and integrity is `ok`.
- **Public HTTPS:** `/login` returns 200, and POST `/api/v1/projects` without a token returns a JSON 401.

No signed-in requests were made against production; the admin password wasn't used. These checks are left to the user:

- **App:** sign out and back in on the phone (the old session is now read-only). Then check that task and project controls appear, and add, edit, archive and restore a project.
- **Web:** signed in, the dashboard behaves as before. Creating a project still lands on its page.

## Rollback

```bash
ssh root@naspad-server
cd /srv/npinv
docker tag npinv:before-writes-20261016T081642Z-c22c6d1 npinv:latest
rm -rf src && cp -a releases/writes-20261016T081642Z-c22c6d1/source-before src
docker compose up -d
```

- **No database restore is needed for a rollback.** Migration 6 is additive: the previous image ignores the `scope` column and the `idempotency_keys` table.
- **Sessions created after this deploy** keep working on the old image, which has no read-only check.
- **A full restore** of `before.db` would also remove anything written since the deploy, so use it only if the data itself is wrong.
