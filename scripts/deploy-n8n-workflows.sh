#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting Deploy..."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
N8N_SERVICE="${N8N_SERVICE:-n8n}"
REMOTE_IMPORT_DIR="/tmp/n8n-import-$(date +%s)"
KB_DIR="${KB_DIR:-knowledge-base}"

# 1. Build e testes do pacote code-first
if [ ! -f "$KB_DIR/package.json" ]; then
  echo "❌ knowledge-base package not found at $KB_DIR"
  exit 1
fi

echo "📦 Installing knowledge-base dependencies from lockfile..."
npm --prefix "$KB_DIR" ci

echo "🧪 Running knowledge-base tests..."
npm --prefix "$KB_DIR" test

for entrypoint in \
  "$KB_DIR/dist/cli/ingest.js" \
  "$KB_DIR/dist/cli/conversation.js" \
  "$KB_DIR/dist/cli/reminders.js" \
  "$KB_DIR/dist/cli/batch-flush.js" \
  "$KB_DIR/dist/cli/github-push.js" \
  "$KB_DIR/dist/cli/onboarding.js" \
  "$KB_DIR/dist/cli/query.js"
do
  if [ ! -f "$entrypoint" ]; then
    echo "❌ Missing runtime entrypoint: $entrypoint"
    exit 1
  fi
done

# 2. Encontrar Workflows adapters do knowledge-base
WORKFLOW_FILES=()
while IFS= read -r -d '' file; do
  if jq -e 'if type=="array" then .[0] else . end | has("nodes")' "$file" >/dev/null 2>&1; then
    WORKFLOW_FILES+=("$file")
  fi
done < <(find "$KB_DIR/workflows" -type f -name '*.json' -print0)

if [ ${#WORKFLOW_FILES[@]} -eq 0 ]; then
  echo "❌ No workflows found."
  exit 1
fi

echo "📦 Found ${#WORKFLOW_FILES[@]} workflows to sync."

# 3. Preparar container e diretório
docker compose -f "$COMPOSE_FILE" up -d "$N8N_SERVICE"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" mkdir -p "$REMOTE_IMPORT_DIR"

# 4. Copiar e Importar (com active=true no JSON)
TMP_DIR="$(mktemp -d)"
for wf in "${WORKFLOW_FILES[@]}"; do
  fname=$(basename "$wf")
  echo "📤 Processing: $fname"

  # Força active: true
  tmp_wf="$TMP_DIR/$fname"
  jq 'if type=="array" then map(.active = true) else .active = true end' "$wf" > "$tmp_wf"

  docker compose -f "$COMPOSE_FILE" cp "$tmp_wf" "$N8N_SERVICE:$REMOTE_IMPORT_DIR/$fname"

  echo "📥 Importing..."
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n import:workflow --input="$REMOTE_IMPORT_DIR/$fname" || echo "⚠️ Import failed for $fname"
done
rm -rf "$TMP_DIR"

# 5. Publicar todos os workflows via CLI (marca como ativo no banco)
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

# 6. RESTART — O n8n lê o banco e registra webhooks de workflows publicados
echo "🔄 Restarting n8n to register webhooks..."
docker compose -f "$COMPOSE_FILE" restart "$N8N_SERVICE"

# 7. Health Check
echo "⏳ Waiting for n8n to come back online..."
for i in $(seq 1 60); do
  # Testa saúde de fora do container (curl está no host, não no container)
  if curl -s "http://localhost:5678/healthz" >/dev/null 2>&1; then
    echo "✅ n8n is ONLINE"
    break
  fi
  sleep 2
done

# 8. Status Final
echo ""
echo "📋 Final workflow status:"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  n8n export:workflow --all 2>/dev/null | jq -r '.[] | "  \(.id) => active=\(.active) (\(.name))"' 2>/dev/null || echo "  (could not read status)"

echo ""
echo "🎉 DEPLOY COMPLETE!"
