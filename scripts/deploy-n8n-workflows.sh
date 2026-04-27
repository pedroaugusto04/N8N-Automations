#!/usr/bin/env bash
set -euo pipefail

echo "Deploy script started..."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
N8N_SERVICE="${N8N_SERVICE:-n8n}"
REMOTE_IMPORT_DIR="${REMOTE_IMPORT_DIR:-/tmp/n8n-workflows-import}"

# Extrair variaveis do .env com seguranca
get_env_val() {
  grep "^$1=" .env | cut -d'=' -f2- | sed "s/^'//;s/'$//;s/^\"//;s/\"$//" || true
}

if [ -f .env ]; then
  echo "Loading config from .env..."
  N8N_BASIC_AUTH_ACTIVE_ENV=$(get_env_val N8N_BASIC_AUTH_ACTIVE) || true
  N8N_BASIC_AUTH_USER_ENV=$(get_env_val N8N_BASIC_AUTH_USER) || true
  N8N_BASIC_AUTH_PASSWORD_ENV=$(get_env_val N8N_BASIC_AUTH_PASSWORD) || true
  N8N_PATH_ENV=$(get_env_val N8N_PATH) || true

  [ -n "$N8N_BASIC_AUTH_ACTIVE_ENV" ] && N8N_BASIC_AUTH_ACTIVE="$N8N_BASIC_AUTH_ACTIVE_ENV"
  [ -n "$N8N_BASIC_AUTH_USER_ENV" ] && N8N_BASIC_AUTH_USER="$N8N_BASIC_AUTH_USER_ENV"
  [ -n "$N8N_BASIC_AUTH_PASSWORD_ENV" ] && N8N_BASIC_AUTH_PASSWORD="$N8N_BASIC_AUTH_PASSWORD_ENV"
  [ -n "$N8N_PATH_ENV" ] && N8N_PATH="$N8N_PATH_ENV"
fi

N8N_BASE_URL="${N8N_API_URL:-http://localhost:5678}"
N8N_PATH_PREFIX="${N8N_PATH:-/}"

# Garantir que o path comece e termine com /
[[ ! "$N8N_PATH_PREFIX" =~ ^/ ]] && N8N_PATH_PREFIX="/$N8N_PATH_PREFIX"
[[ ! "$N8N_PATH_PREFIX" =~ /$ ]] && N8N_PATH_PREFIX="$N8N_PATH_PREFIX/"
N8N_PATH_PREFIX="${N8N_PATH_PREFIX//\/\///}"

# URL Final da API n8n
N8N_API_URL="${N8N_BASE_URL%/}$N8N_PATH_PREFIX"

# Credenciais de Auth
AUTH_FLAGS=""
if [ "${N8N_BASIC_AUTH_ACTIVE:-false}" = "true" ] && [ -n "${N8N_BASIC_AUTH_USER:-}" ]; then
  AUTH_FLAGS="--user $N8N_BASIC_AUTH_USER:$N8N_BASIC_AUTH_PASSWORD"
fi

# =========================
# 📂 Encontrar candidatos válidos
# =========================
mapfile -d '' ALL_JSON_FILES < <(
  find . -type f -name '*.json' \
    ! -path '*/node_modules/*' \
    ! -path '*/.git/*' \
    ! -path '*/backups/*' \
    ! -name 'package.json' \
    ! -name 'package-lock.json' \
    ! -name 'tsconfig.json' \
    ! -name '*.map' \
    -print0 | sort -z
)

WORKFLOW_FILES=()

echo "Scanning for valid n8n workflows..."

for f in "${ALL_JSON_FILES[@]}"; do
  if jq -e 'if type=="array" then .[0] else . end | has("nodes")' "$f" >/dev/null 2>&1; then
    WORKFLOW_FILES+=("$f")
  else
    echo "Skipping non-workflow: $f"
  fi
done

if [ "${#WORKFLOW_FILES[@]}" -eq 0 ]; then
  echo "No valid workflows found" >&2
  exit 1
fi

echo "Found ${#WORKFLOW_FILES[@]} valid workflow(s)"

# =========================
# 🐳 Garantir container
# =========================
docker compose -f "$COMPOSE_FILE" up -d "$N8N_SERVICE"

# (Deleção global removida para manter Webhooks consistentes entre deploys)

# =========================
# 📁 Preparar diretório
# =========================
echo "Preparing remote directory $REMOTE_IMPORT_DIR..."
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  sh -lc "rm -rf '$REMOTE_IMPORT_DIR' && mkdir -p '$REMOTE_IMPORT_DIR'"

TMP_DIR="$(mktemp -d)"

# =========================
# 📤 Copiar + forçar active
# =========================
for workflow_file in "${WORKFLOW_FILES[@]}"; do
  clean_name="${workflow_file#./}"
  target_file="$REMOTE_IMPORT_DIR/${clean_name//\//__}"
  tmp_file="$TMP_DIR/$(basename "$target_file")"

  # Força active=false no import para evitar conflito de Webhook 'ghost'
  # O n8n só registra o webhook corretamente se ele for ATIVADO após o import.
  jq 'if type=="array" then map(.active = false) else .active = false end' "$workflow_file" > "$tmp_file"
  docker compose -f "$COMPOSE_FILE" cp "$tmp_file" "$N8N_SERVICE:$target_file"
done

# =========================
# 🔄 Limpeza Prévia e Desativação (Evita conflitos de Webhook)
# =========================
echo "Scanning existing workflows for conflicts..."
existing_workflows=$(
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n export:workflow --all 2>/dev/null || echo "[]"
)

for workflow_file in "${WORKFLOW_FILES[@]}"; do
  # Extrair nome e ID do arquivo local
  local_name=$(jq -r 'if type=="array" then .[0].name else .name end' "$workflow_file")
  local_id=$(jq -r 'if type=="array" then .[0].id else .id end' "$workflow_file")

  # Procurar por conflito de nome no n8n (mesmo nome, ID diferente)
  conflicting_id=$(echo "$existing_workflows" | jq -r --arg name "$local_name" --arg id "$local_id" '.[] | select(.name == $name and .id != $id) | .id')

  if [ -n "$conflicting_id" ]; then
    echo "⚠️  Conflict detected: Workflow '$local_name' exists with different ID ($conflicting_id). Deleting old one..."
    for cid in $conflicting_id; do
      docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
        n8n delete:workflow --id="$cid" || true
    done
  fi
done

# Desativar todos os IDs atuais no n8n para liberar portas/memória
echo "Deactivating all current workflows to clear registry..."
current_ids=$(echo "$existing_workflows" | jq -r '.[].id' 2>/dev/null || echo "")
for id in $current_ids; do
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n update:workflow --id="$id" --active=false >/dev/null 2>&1 || true
done
sleep 2

# =========================
# 📥 Importar (Overwrite mode)
# =========================
echo "Importing workflows into n8n..."
for workflow_file in "${WORKFLOW_FILES[@]}"; do
  clean_name="${workflow_file#./}"
  target_file="$REMOTE_IMPORT_DIR/${clean_name//\//__}"
  echo "Importing $clean_name"
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n import:workflow --input="$target_file"
done

# =========================
# ✅ Ativação Final
# =========================
echo "Activating workflows..."
all_ids=$(
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n export:workflow --all 2>/dev/null | jq -r '.[].id' 2>/dev/null || echo ""
)

for id in $all_ids; do
  echo "  Activating $id..."
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n update:workflow --id="$id" --active=true >/dev/null 2>&1 || echo "Warning: Failed to activate $id"
done

# =========================
# ⏳ Verificação final de saúde
# =========================
echo "Waiting for n8n API to be ready..."
for i in $(seq 1 30); do
  if curl -s "$N8N_API_URL/healthz" >/dev/null 2>&1; then
    echo "✅ n8n API is UP"
    break
  fi
  echo -n "."
  sleep 1
done

echo ""
echo "Final status of workflows:"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
  n8n export:workflow --all \
  | jq -r '.[] | "\(.id) => active=\(.active) (\(.name))"'

# =========================
# 🧹 Cleanup
# =========================
rm -rf "$TMP_DIR"

echo "✅ DEPLOY COMPLETE: All workflows synced, activated and webhooks refreshed!"