#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
N8N_SERVICE="${N8N_SERVICE:-n8n}"
REMOTE_IMPORT_DIR="${REMOTE_IMPORT_DIR:-/tmp/n8n-workflows-import}"
N8N_API_URL="${N8N_API_URL:-http://localhost:5678}"

# =========================
# 🔍 Dependências
# =========================
for cmd in docker jq curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd is required" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

# =========================
# 📂 Encontrar TODOS JSONs
# =========================
mapfile -d '' WORKFLOW_FILES < <(
  find . -type f -name '*.json' -print0 | sort -z
)

if [ "${#WORKFLOW_FILES[@]}" -eq 0 ]; then
  echo "No workflow JSON files found" >&2
  exit 1
fi

echo "Found ${#WORKFLOW_FILES[@]} workflow(s)"

# =========================
# 🐳 Garantir container
# =========================
container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$N8N_SERVICE")"

if [ -z "$container_id" ]; then
  echo "Starting $N8N_SERVICE"
  docker compose -f "$COMPOSE_FILE" up -d "$N8N_SERVICE"
  sleep 5
  container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$N8N_SERVICE")"
fi

if [ -z "$container_id" ]; then
  echo "Could not find container" >&2
  exit 1
fi

# =========================
# 🔥 REMOVER TODOS
# =========================
echo "Removing ALL workflows"

docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  n8n export:workflow --all \
  | jq -r '.[]?.id' \
  | while read -r id; do
      [ -n "$id" ] || continue
      echo "Deleting $id"
      docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
        n8n delete:workflow --id="$id" || true
    done

# =========================
# 📁 Preparar diretório
# =========================
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  sh -lc "rm -rf '$REMOTE_IMPORT_DIR' && mkdir -p '$REMOTE_IMPORT_DIR'"

# =========================
# 📤 Copiar + FORÇAR ACTIVE
# =========================
TMP_DIR="$(mktemp -d)"

for workflow_file in "${WORKFLOW_FILES[@]}"; do
  clean_name="${workflow_file#./}"
  target_file="$REMOTE_IMPORT_DIR/${clean_name//\//__}"
  tmp_file="$TMP_DIR/$(basename "$target_file")"

  echo "Processing $clean_name"

  # 🔥 força active=true
  jq '.active = true' "$workflow_file" > "$tmp_file"

  docker compose -f "$COMPOSE_FILE" cp "$tmp_file" "$N8N_SERVICE:$target_file"
done

# =========================
# 📥 Importar
# =========================
echo "Importing workflows"

for workflow_file in "${WORKFLOW_FILES[@]}"; do
  clean_name="${workflow_file#./}"
  target_file="$REMOTE_IMPORT_DIR/${clean_name//\//__}"

  echo "Importing $clean_name"

  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n import:workflow --input="$target_file"
done

# =========================
# 🔁 Esperar API subir
# =========================
echo "Waiting API..."

for i in $(seq 1 30); do
  if curl -s "$N8N_API_URL/healthz" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# =========================
# ✅ FORÇAR ATIVAÇÃO VIA API
# =========================
echo "Forcing activation via API"

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
# 🧪 Validação
# =========================
echo "Validating activation"

docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  n8n export:workflow --all \
  | jq -r '.[] | "\(.id) => active=\(.active)"'

# =========================
# 🧹 Cleanup
# =========================
rm -rf "$TMP_DIR"

echo "✅ DONE: all workflows imported and ACTIVE"