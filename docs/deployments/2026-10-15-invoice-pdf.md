# Invoice PDF endpoint production deployment — 2026-10-15

The user asked for this deployment over `ssh root@naspad-server`. Commit `e1b653f`
(`feat: serve the shared invoice print document to the mobile app`) from branch
`codex/mobile-readonly` was deployed. Nothing was merged or pushed.

- Release: `pdf-20261015T150613Z-e1b653f`.
- Image: `npinv:pdf-20261015T150613Z-e1b653f` = `npinv:latest`, ID
  `sha256:a1d59dbc40a4deacbbe412145a8ec0483b5049840a88e93ba27378cecd8d7fa8`.
- Previous image, kept for rollback: `npinv:before-pdf-20261015T150613Z-e1b653f`, ID
  `sha256:3da8bf47335f…` (the aging release, `832a719`).
- Address: https://invoice.naspadstudio.id.
- No schema change or migration. Compose, `.env`, data mounts, port binding and HTTPS
  routing are unchanged. No images were pruned.

## Backups

These are kept in `/srv/npinv/backups/pdf-20261015T150613Z-e1b653f/`. The folder has
mode 700, and the files have mode 600.

- `before.db`: a `VACUUM INTO` snapshot taken by the running app before any change.
  `PRAGMA integrity_check` returned `ok`, and it holds 3 invoices.
- `image-before.txt`, `compose-before.yaml` and `source-before.tar.gz`: the previous image
  ID, Compose file and source.
- `deployed-commit.txt`: the full hash of `e1b653f`.

The previous source directory is also kept at
`/srv/npinv/releases/pdf-20261015T150613Z-e1b653f/source-before/`, with `build.log` next to it.

## Procedure

1. Backed up as above, and tagged the running image `before-…`.
2. Ran `git archive e1b653f` into `/srv/npinv/src-new` and checked that
   `src/lib/invoice-print.ts`, all four files in `public/fonts/` and `deploy/compose.yaml`
   arrived, and that `print.css` was gone. Then swapped it into place as `/srv/npinv/src`.
3. Ran `docker compose build` from `/srv/npinv`, so the `.env` build arguments still
   apply. The server's Turbopack build passed: "Compiled successfully in 15.0s". The new
   image was tagged with the release name. Production stayed on the old image during
   the build.
4. Smoke-tested the new image in a throwaway container on `127.0.0.1:3013`, using a copy
   of `before.db`. The container was then removed. The results:
   - `/login` returned 200.
   - `/invoices/1/print` redirected unauthenticated requests to `/login`.
   - `/api/v1/invoices/1/print` returned a JSON 401 with `private, no-store`.
   - The fonts were present, the new code was in the server bundle, and the logs were clean.
5. Ran `docker compose up -d` without `--build`. The container restarted, a few seconds
   of downtime.

## Live verification

- **Container:** running the new image, zero restarts, clean start log.
- **Localhost:**
  - `/login` returns 200.
  - `/invoices/1/print` without a cookie redirects to `/login`; the web login is still
    enforced.
  - `/api/v1/invoices/1/print` and `/api/v1/overview` without a token return a JSON 401
    with `private, no-store` and `nosniff`.
- **Public HTTPS:** `/login` returns 200, and `/api/v1/invoices/1/print` returns a JSON 401
  with `private, no-store`.
- **Inside the container:** `/app/public/fonts` has the four files, and the server bundle
  contains the new endpoint's CSP.

No signed-in requests were made against production; the admin password wasn't used.
These checks are left to the user:

- **Web print page:** signed in, open an invoice's print preview in Chrome. Check that it
  looks as before, that large totals stay on one line, and that the navy bar and faded
  logo appear on every page.
- **App:** with the new NPiOS build, open a sent invoice and tap **View PDF**. Pick a
  version, then check the Montserrat text and the per-page bar and supergraphic, and that
  Share works.

## Rollback

```bash
ssh root@naspad-server
cd /srv/npinv
docker tag npinv:before-pdf-20261015T150613Z-e1b653f npinv:latest
rm -rf src && cp -a releases/pdf-20261015T150613Z-e1b653f/source-before src
docker compose up -d
```

No database restore is needed, because this release changed no data. Older app builds
ignore `printVersions`, and the new build hides the PDF control when it's missing.

## Follow-up: Cloudflare email fix — release `printfix-20261015T151731Z-22077b1`

In the app's PDF, the contact email showed as "[email protected]". Cloudflare's email
obfuscation rewrote the address as the print document passed through it, and the
document runs no scripts to restore it. Commit `22077b1` adds `no-transform` to the
print response's `Cache-Control`.

- Image: `npinv:printfix-20261015T151731Z-22077b1` = `npinv:latest`, ID
  `sha256:d8978ca4668c…`.
- Rollback image: `npinv:before-printfix-20261015T151731Z-22077b1` (the PDF release above).
- Backups: in `/srv/npinv/backups/printfix-20261015T151731Z-22077b1/`. The `before.db`
  integrity check returned `ok`, and it holds 3 invoices.
- The procedure was the same as above. The Turbopack build passed, and the smoke-test
  container passed.
- Live checks:
  - zero restarts and a clean log;
  - `/login` returns 200, and the web print page redirects to login when signed out;
  - the API print route returns a JSON 401 when signed out;
  - the live bundle contains `no-store, no-transform`;
  - public `/login` returns 200.
- In the iOS app, signed in by the user, a fresh PDF of a live draft invoice now shows
  the real contact email.

Rollback:

```bash
cd /srv/npinv
docker tag npinv:before-printfix-20261015T151731Z-22077b1 npinv:latest
rm -rf src && cp -a releases/printfix-20261015T151731Z-22077b1/source-before src
docker compose up -d
```
