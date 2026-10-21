#!/usr/bin/env bash
# Mobile Phase 9: prove the production image is unaffected by the mobile workspace.
# Usage: scripts/verify-docker-image.sh [image-tag]   (builds the image if the tag is missing)
set -euo pipefail

IMAGE="${1:-lilchess:verify}"
cd "$(dirname "$0")/.."

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker build -t "$IMAGE" .
fi

fail() { echo "FAIL: $1" >&2; exit 1; }
run() { docker run --rm --entrypoint sh "$IMAGE" -c "$1"; }

echo "== mobile packages are absent from the image"
for path in /app/mobile /app/node_modules/mobile /app/web/dist-native /app/node_modules/@capacitor; do
  run "test ! -e $path" || fail "$path must not exist in the production image"
done
run "ls /app/node_modules | grep -i capacitor" >/dev/null 2>&1 && fail "a capacitor package is installed in the image"

echo "== server, shared and web assets are present"
for path in /app/server/dist/index.js /app/shared/dist /app/web/dist/index.html /app/server/dist/db/migrations; do
  run "test -e $path" || fail "$path is missing from the image"
done

echo "== no signing material or native projects"
run "find /app -path /app/node_modules -prune -o \( -name '*.jks' -o -name '*.keystore' -o -name '*.mobileprovision' -o -name 'key.properties' -o -name 'android' -o -name 'ios' \) -print | grep ." \
  >/dev/null 2>&1 && fail "native project or signing files found in the image"

echo "== server boots, migrates a fresh database and answers the mobile health contract"
CID="$(docker run -d -p 127.0.0.1:0:3000 "$IMAGE")"
trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
PORT="$(docker port "$CID" 3000/tcp | head -n1 | sed 's/.*://')"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" -o /tmp/lilchess-health.json 2>/dev/null; then break; fi
  sleep 1
done
[ -s /tmp/lilchess-health.json ] || { docker logs "$CID" >&2; fail "server did not answer /api/health"; }
node -e '
  const h = JSON.parse(require("fs").readFileSync("/tmp/lilchess-health.json", "utf8"));
  if (h.ok !== true || h.app !== "lilchess" || !Number.isInteger(h.apiVersion) || !h.features) process.exit(1);
' || fail "health response does not satisfy the mobile compatibility contract"

echo "== the web client is still served"
curl -fsS "http://127.0.0.1:$PORT/" | grep -qi "<div id=" || fail "web index was not served"

echo "OK: $IMAGE is unaffected by the mobile workspace"
