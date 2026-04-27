#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Starting Deploy..."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
N8N_SERVICE="${N8N_SERVICE:-n8n}"
REMOTE_IMPORT_DIR="/tmp/n8n-import-$(date +%s)"

# 1. Encontrar Workflows (Raiz e pasta knowledge-base)
WORKFLOW_FILES=()
# Buscamos na raiz (maxdepth 1 para evitar pastas de dados) e na knowledge-base
while IFS= read -r -d '' file; do
  if jq -e 'if type=="array" then .[0] else . end | has("nodes")' "$file" >/dev/null 2>&1; then
    WORKFLOW_FILES+=("$file")
  fi
done < <(find . -maxdepth 1 -name '*.json' -print0; find knowledge-base/ -type f -name '*.json' -print0)

if [ ${#WORKFLOW_FILES[@]} -eq 0 ]; then
  echo "❌ No workflows found."
  exit 1
fi

echo "📦 Found ${#WORKFLOW_FILES[@]} workflows to sync."

# 2. Preparar container e diretório
docker compose -f "$COMPOSE_FILE" up -d "$N8N_SERVICE"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" mkdir -p "$REMOTE_IMPORT_DIR"

# 3. Copiar e Importar
TMP_DIR="$(mktemp -d)"
for wf in "${WORKFLOW_FILES[@]}"; do
  fname=$(basename "$wf")
  echo "📤 Processing: $fname"
  
  # Força active: true no JSON antes de subir (Garante ativação automática)
  tmp_wf="$TMP_DIR/$fname"
  jq 'if type=="array" then map(.active = true) else .active = true end' "$wf" > "$tmp_wf"
  
  # Copia para o container
  docker compose -f "$COMPOSE_FILE" cp "$tmp_wf" "$N8N_SERVICE:$REMOTE_IMPORT_DIR/$fname"
  
  # Importa (Força overwrite se o ID bater)
  echo "📥 Importing..."
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" n8n import:workflow --input="$REMOTE_IMPORT_DIR/$fname" || echo "⚠️ Import failed for $fname"
done
rm -rf "$TMP_DIR"

# 4. Restart para limpar webhooks da memória
echo "🔄 Restarting n8n..."
docker compose -f "$COMPOSE_FILE" restart "$N8N_SERVICE"

# 5. Health Check — espera o n8n subir
echo "⏳ Waiting for n8n to come back online..."
for i in $(seq 1 60); do
  if docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" curl -s http://localhost:5678/healthz >/dev/null 2>&1; then
    echo "✅ n8n is ONLINE"
    break
  fi
  sleep 2
done

# 6. Ativação via REST API (mesma coisa que clicar no botão na UI)
# O CLI 'n8n update:workflow --active=true' só atualiza o banco, NÃO registra webhooks na runtime.
# A REST API faz ambos, igual ao toggle manual.
echo "⚡ Activating all workflows via REST API..."
sleep 5  # Dá tempo pro n8n inicializar completamente

# Ler credenciais de auth do ambiente
AUTH_USER="${N8N_BASIC_AUTH_USER:-}"
AUTH_PASS="${N8N_BASIC_AUTH_PASSWORD:-}"
# Fallback: ler do .env se não estiver no ambiente
if [ -z "$AUTH_USER" ] && [ -f .env ]; then
  AUTH_USER=$(grep '^N8N_BASIC_AUTH_USER=' .env | cut -d'=' -f2- | tr -d "\"'" || true)
  AUTH_PASS=$(grep '^N8N_BASIC_AUTH_PASSWORD=' .env | cut -d'=' -f2- | tr -d "\"'" || true)
fi

ALL_IDS=$(
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n export:workflow --all 2>/dev/null | jq -r '.[] | .id' 2>/dev/null || echo ""
)

if [ -z "$ALL_IDS" ]; then
  echo "⚠️  Could not read workflow IDs — check n8n logs"
else
  for id in $ALL_IDS; do
    echo "  🔄 Toggling $id (off → on)..."
    # Desativar (remove webhook da memória)
    docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
      curl -s -o /dev/null -w "%{http_code}" \
      -u "$AUTH_USER:$AUTH_PASS" \
      -X PATCH -H "Content-Type: application/json" \
      -d '{"active":false}' \
      "http://localhost:5678/rest/workflows/$id" 2>/dev/null || true
    sleep 1
    # Ativar (registra webhook na memória — igual ao botão da UI)
    result=$(docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
      curl -s -o /dev/null -w "%{http_code}" \
      -u "$AUTH_USER:$AUTH_PASS" \
      -X PATCH -H "Content-Type: application/json" \
      -d '{"active":true}' \
      "http://localhost:5678/rest/workflows/$id" 2>/dev/null || echo "000")
    if [ "$result" = "200" ]; then
      echo "    ✅ Activated (HTTP 200)"
    else
      echo "    ⚠️  HTTP $result — trying fallback CLI..."
      docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
        n8n update:workflow --id="$id" --active=true 2>&1 || true
    fi
  done
fi

# 7. Status Final
echo ""
echo "📋 Final workflow status:"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  n8n export:workflow --all 2>/dev/null | jq -r '.[] | "  \(.id) => active=\(.active) (\(.name))"' 2>/dev/null || echo "  (could not read status)"

echo ""
echo "🎉 DEPLOY COMPLETE!"