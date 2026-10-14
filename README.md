# NPInv

Invoice dashboard for Naspad Studio: create invoices, save them as branded A4 PDFs, and track what is outstanding, overdue and paid.

- Design: `docs/superpowers/specs/2026-10-12-npinv-design.md`
- Live (tailnet only): https://naspad-server.<tailnet>.ts.net:8445

## Develop

```bash
npm install
npm run dev
```

The app opens at http://localhost:3000 and keeps its data in `data/npinv.db`, which is not committed.

```bash
npm test
```

```bash
npm run build && npm run lint
```

## Deploy

Commit first; only committed code is deployed. With the Mac on the personal tailnet, put the
server address in `deploy/.env.local` (gitignored, never committed):

```bash
NPINV_HOST=root@<server-tailscale-ip>
```

Then:

```bash
./deploy/deploy.sh
```

This copies the last commit to `/srv/npinv/src` on naspad-server and runs `docker compose up -d --build` in `/srv/npinv`.

## On the server

| What | Where |
|---|---|
| Compose project | `/srv/npinv` (`compose.yaml`, `src/`) |
| Database | `/srv/npinv/data/npinv.db` |
| Backups | `/srv/npinv/backups`, nightly at 03:20, kept 14 days |
| Port | `127.0.0.1:3003`, published by `tailscale serve` on HTTPS 8445 |
| Backup log | `journalctl -t npinv-backup` |

To restore a backup: stop the container, replace `data/npinv.db` with the snapshot, delete `data/npinv.db-wal` and `data/npinv.db-shm` if present, and start the container.
