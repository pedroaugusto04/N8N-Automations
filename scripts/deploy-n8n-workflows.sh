#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting Ultra-Stable Deploy..."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
N8N_SERVICE="${N8N_SERVICE:-n8n}"
REMOTE_IMPORT_DIR="/tmp/n8n-import-$(date +%s)"

# 1. Encontrar Workflows (apenas arquivos que tenham 'nodes')
WORKFLOW_FILES=()
find_json=$(find . -type f -name '*.json' ! -path '*/.*' ! -path '*/node_modules/*' ! -name 'package*.json')

for f in $find_json; do
  if jq -e 'if type=="array" then .[0] else . end | has("nodes")' "$f" >/dev/null 2>&1; then
    WORKFLOW_FILES+=("$f")
  fi
done

if [ ${#WORKFLOW_FILES[@]} -eq 0 ]; then
  echo "❌ No workflows found."
  exit 1
fi

echo "📦 Found ${#WORKFLOW_FILES[@]} workflows to sync."

# 2. Preparar container e diretório
docker compose -f "$COMPOSE_FILE" up -d "$N8N_SERVICE"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" mkdir -p "$REMOTE_IMPORT_DIR"

# 3. Copiar e Importar
for wf in "${WORKFLOW_FILES[@]}"; do
  fname=$(basename "$wf")
  echo "📤 Processing: $fname"
  
  # Copia para o container
  docker compose -f "$COMPOSE_FILE" cp "$wf" "$N8N_SERVICE:$REMOTE_IMPORT_DIR/$fname"
  
  # Importa (Força overwrite se o ID bater)
  echo "📥 Importing..."
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" n8n import:workflow --input="$REMOTE_IMPORT_DIR/$fname" || echo "⚠️ Import failed for $fname, but continuing..."
done

# 4. Ativação e Refresh Global via RESTART
echo "🔄 Refreshing webhooks via global restart..."
docker compose -f "$COMPOSE_FILE" restart "$N8N_SERVICE"

# 5. Health Check
echo "⏳ Waiting for n8n to wake up..."
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" curl -s http://localhost:5678/healthz >/dev/null 2>&1; then
    echo "✅ n8n is ONLINE"
    break
  fi
  sleep 2
done

echo "🎉 DEPLOY COMPLETE!"