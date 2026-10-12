#!/usr/bin/env bash
# Deploys the last commit to naspad-server. Run on the Mac, from anywhere in the repo.
# The Mac must be on the personal tailnet. Uncommitted changes are not deployed.
set -euo pipefail

HOST="${NPINV_HOST:-root@100.99.222.72}"
cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "Note: uncommitted changes are NOT deployed; deploying $(git rev-parse --short HEAD)." >&2
fi

echo "==> Sending $(git rev-parse --short HEAD) to $HOST"
ssh -o ConnectTimeout=10 "$HOST" '
  set -e
  rm -rf /srv/npinv/src
  mkdir -p /srv/npinv/src /srv/npinv/data /srv/npinv/backups
  chown 1000:1000 /srv/npinv/data /srv/npinv/backups
'
git archive HEAD | ssh "$HOST" 'tar -x -C /srv/npinv/src'

echo "==> Building and starting"
ssh "$HOST" '
  set -e
  cp /srv/npinv/src/deploy/compose.yaml /srv/npinv/compose.yaml
  cd /srv/npinv
  docker compose up -d --build
  docker image prune -f >/dev/null
'

echo "==> Waiting for the app"
ssh "$HOST" '
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null http://127.0.0.1:3003/; then echo "npinv is up"; exit 0; fi
    sleep 2
  done
  echo "npinv did not come up; last log lines:" >&2
  docker logs --tail 30 npinv >&2
  exit 1
'
