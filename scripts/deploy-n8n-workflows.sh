#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting Deploy..."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
N8N_SERVICE="${N8N_SERVICE:-n8n}"
REMOTE_IMPORT_DIR="/tmp/n8n-import-$(date +%s)"

WORKFLOW_FILES=()

is_workflow_file() {
  local file="$1"

  # Accept single workflow object: { nodes: [], connections: {} }
  if jq -e '
    type == "object"
    and (.nodes | type == "array")
    and (.connections | type == "object")
  ' "$file" >/dev/null 2>&1; then
    return 0
  fi

  # Accept export arrays containing one or more workflow objects.
  jq -e '
    type == "array"
    and length > 0
    and all(.[]; type == "object" and (.nodes | type == "array") and (.connections | type == "object"))
  ' "$file" >/dev/null 2>&1
}

while IFS= read -r -d '' file; do
  if is_workflow_file "$file"; then
    WORKFLOW_FILES+=("$file")
  fi
done < <(
  find . \
    \( -path './.git' -o -path './node_modules' -o -path './backups' -o -path './evolution-postgres-data' \) -prune \
    -o -type f -name '*.json' \
    ! -name 'package.json' \
    ! -name 'package-lock.json' \
    ! -name 'tsconfig.json' \
    -print0 2>/dev/null
)

if [ "${#WORKFLOW_FILES[@]}" -eq 0 ]; then
  echo "❌ No workflows found."
  exit 1
fi

echo "📦 Found ${#WORKFLOW_FILES[@]} workflows to sync."

docker compose -f "$COMPOSE_FILE" up -d "$N8N_SERVICE"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" mkdir -p "$REMOTE_IMPORT_DIR"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

for wf in "${WORKFLOW_FILES[@]}"; do
  fname="$(basename "$wf")"
  echo "📤 Processing: $fname"

  # Preserve original shape (object vs array), only forcing active=true.
  tmp_wf="$TMP_DIR/$fname"
  jq '
    if type == "array" then
      map(if type == "object" then .active = true else . end)
    elif type == "object" then
      .active = true
    else
      .
    end
  ' "$wf" > "$tmp_wf"

  docker compose -f "$COMPOSE_FILE" cp "$tmp_wf" "$N8N_SERVICE:$REMOTE_IMPORT_DIR/$fname"

  echo "📥 Importing..."
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n import:workflow --input="$REMOTE_IMPORT_DIR/$fname" \
    || echo "⚠️ Import failed for $fname"
done

echo "📢 Publishing all workflows..."

ALL_IDS="$(
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n export:workflow --all 2>/dev/null \
    | jq -r '.[] | .id' 2>/dev/null || true
)"

for id in $ALL_IDS; do
  echo "  Publishing $id..."
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n publish:workflow --id="$id" 2>&1 \
    || echo "  ⚠️ Failed to publish $id"
done

echo "🔄 Restarting n8n to register webhooks..."
docker compose -f "$COMPOSE_FILE" restart "$N8N_SERVICE"

echo "⏳ Waiting for n8n to come back online..."

ONLINE=false

for i in $(seq 1 60); do
  if curl -s "http://localhost:5678/healthz" >/dev/null 2>&1; then
    echo "✅ n8n is ONLINE"
    ONLINE=true
    break
  fi
  sleep 2
done

if [ "$ONLINE" != true ]; then
  echo "⚠️ n8n did not respond on /healthz after waiting."
fi

echo ""
echo "📋 Final workflow status:"

docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  n8n export:workflow --all 2>/dev/null \
  | jq -r '.[] | "  \(.id) => active=\(.active) (\(.name))"' 2>/dev/null \
  || echo "  (could not read status)"

echo ""
echo "🎉 DEPLOY COMPLETE!"
