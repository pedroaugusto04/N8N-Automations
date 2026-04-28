#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting Deploy..."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
N8N_SERVICE="${N8N_SERVICE:-n8n}"
REMOTE_IMPORT_DIR="/tmp/n8n-import-$(date +%s)"

# 1. Encontrar workflows JSON válidos no projeto
WORKFLOW_FILES=()

while IFS= read -r -d '' file; do
  if jq -e 'type=="object" and has("nodes")' "$file" >/dev/null 2>&1; then
    WORKFLOW_FILES+=("$file")
  fi
done < <(
  find . -type f -name '*.json' \
    ! -path './node_modules/*' \
    ! -path './.git/*' \
    ! -path './backups/*' \
    ! -path './evolution-data/*' \
    ! -path './kb-postgres-data/*' \
    ! -path './evolution-postgres-data/*' \
    ! -name 'package.json' \
    ! -name 'package-lock.json' \
    ! -name 'tsconfig.json' \
    -print0
)

if [ ${#WORKFLOW_FILES[@]} -eq 0 ]; then
  echo "❌ No workflows found."
  exit 1
fi

echo "📦 Found ${#WORKFLOW_FILES[@]} workflows to sync."

# 2. Preparar container e diretório
docker compose -f "$COMPOSE_FILE" up -d "$N8N_SERVICE"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" mkdir -p "$REMOTE_IMPORT_DIR"

# 3. Copiar e importar workflows com active=true
TMP_DIR="$(mktemp -d)"

for wf in "${WORKFLOW_FILES[@]}"; do
  fname=$(basename "$wf")
  echo "📤 Processing: $fname"

  tmp_wf="$TMP_DIR/$fname"

  jq '.active = true' "$wf" > "$tmp_wf"

  docker compose -f "$COMPOSE_FILE" cp "$tmp_wf" "$N8N_SERVICE:$REMOTE_IMPORT_DIR/$fname"

  echo "📥 Importing..."
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n import:workflow --input="$REMOTE_IMPORT_DIR/$fname" || echo "⚠️ Import failed for $fname"
done

rm -rf "$TMP_DIR"

# 4. Publicar todos os workflows
echo "📢 Publishing all workflows..."

ALL_IDS=$(
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n export:workflow --all 2>/dev/null | jq -r '.[] | .id' 2>/dev/null || echo ""
)

for id in $ALL_IDS; do
  echo "  Publishing $id..."
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n publish:workflow --id="$id" 2>&1 || echo "  ⚠️ Failed to publish $id"
done

# 5. Reiniciar n8n
echo "🔄 Restarting n8n to register webhooks..."
docker compose -f "$COMPOSE_FILE" restart "$N8N_SERVICE"

# 6. Health check
echo "⏳ Waiting for n8n to come back online..."

for i in $(seq 1 60); do
  if curl -s "http://localhost:5678/healthz" >/dev/null 2>&1; then
    echo "✅ n8n is ONLINE"
    break
  fi
  sleep 2
done

# 7. Status final
echo ""
echo "📋 Final workflow status:"

docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  n8n export:workflow --all 2>/dev/null | jq -r '.[] | "  \(.id) => active=\(.active) (\(.name))"' 2>/dev/null || echo "  (could not read status)"

echo ""
echo "🎉 DEPLOY COMPLETE!"