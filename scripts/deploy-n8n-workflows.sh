#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
N8N_SERVICE="${N8N_SERVICE:-n8n}"
REMOTE_IMPORT_DIR="${REMOTE_IMPORT_DIR:-/tmp/n8n-workflows-import}"
N8N_API_URL="${N8N_API_URL:-http://localhost:5678}"

# =========================
# 📂 Encontrar workflows válidos
# =========================
mapfile -d '' WORKFLOW_FILES < <(
  find . -type f -name '*.json' \
    ! -path './backups/*' \
    ! -name 'workflows-*.json' \
    -print0 | sort -z
)

echo "Found ${#WORKFLOW_FILES[@]} workflow(s)"

# =========================
# 🐳 Garantir container
# =========================
docker compose -f "$COMPOSE_FILE" up -d "$N8N_SERVICE"

# =========================
# 🔥 REMOVER TODOS (API)
# =========================
echo "Removing ALL workflows"

workflow_ids=$(
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n export:workflow --all | jq -r '.[].id'
)

for id in $workflow_ids; do
  echo "Deleting $id"
  curl -s -X DELETE "$N8N_API_URL/rest/workflows/$id" \
    -H "Content-Type: application/json" >/dev/null || true
done

# =========================
# 📁 Preparar diretório
# =========================
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  sh -lc "rm -rf '$REMOTE_IMPORT_DIR' && mkdir -p '$REMOTE_IMPORT_DIR'"

TMP_DIR="$(mktemp -d)"

# =========================
# 📤 Copiar + corrigir JSON
# =========================
for workflow_file in "${WORKFLOW_FILES[@]}"; do
  clean_name="${workflow_file#./}"
  target_file="$REMOTE_IMPORT_DIR/${clean_name//\//__}"
  tmp_file="$TMP_DIR/$(basename "$target_file")"

  echo "Processing $clean_name"

  # força ativo (somente objetos válidos)
  jq 'if type=="object" then .active = true else . end' \
    "$workflow_file" > "$tmp_file"

  docker compose -f "$COMPOSE_FILE" cp "$tmp_file" "$N8N_SERVICE:$target_file"
done

# =========================
# 📥 Importar
# =========================
for workflow_file in "${WORKFLOW_FILES[@]}"; do
  clean_name="${workflow_file#./}"
  target_file="$REMOTE_IMPORT_DIR/${clean_name//\//__}"

  echo "Importing $clean_name"

  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n import:workflow --input="$target_file"
done

# =========================
# ✅ Ativar via API
# =========================
workflow_ids=$(
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n export:workflow --all | jq -r '.[].id'
)

for id in $workflow_ids; do
  echo "Activating $id"
  curl -s -X PATCH "$N8N_API_URL/rest/workflows/$id" \
    -H "Content-Type: application/json" \
    -d '{"active": true}' >/dev/null || true
done

# =========================
# 🧪 Verificação
# =========================
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  n8n export:workflow --all \
  | jq -r '.[] | "\(.id) => active=\(.active)"'

rm -rf "$TMP_DIR"

echo "✅ DONE"