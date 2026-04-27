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
# 🔄 Desativar → Reativar (garante re-registro dos webhooks)
# =========================
echo "Collecting workflow IDs..."
workflow_ids=$(
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
    n8n export:workflow --all 2>/dev/null | jq -r '.[].id' 2>/dev/null || echo ""
)

if [ -z "$workflow_ids" ]; then
  echo "⚠️  No workflow IDs found — nothing to activate"
else
  # Passo 1: Desativar todos (remove listeners de webhook do registro interno)
  echo "Deactivating all workflows to clear webhook registry..."
  for id in $workflow_ids; do
    echo "  Deactivating $id..."
    docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
      n8n update:workflow --id="$id" --active=false 2>&1 || echo "  ⚠️  Failed to deactivate $id"
  done
  sleep 5

  # Passo 2: Reativar todos (re-registra os listeners de webhook corretamente)
  echo "Re-activating all workflows (webhooks will be re-registered)..."
  for id in $workflow_ids; do
    echo "  Activating $id..."
    docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" \
      n8n update:workflow --id="$id" --active=true 2>&1 || echo "  ⚠️  Failed to activate $id"
  done
fi

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