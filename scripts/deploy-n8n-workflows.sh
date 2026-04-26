#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
N8N_SERVICE="${N8N_SERVICE:-n8n}"
REMOTE_IMPORT_DIR="${REMOTE_IMPORT_DIR:-/tmp/n8n-workflows-import}"
BACKUP_DIR="${BACKUP_DIR:-./backups/n8n-workflows}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required on the VPS" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required on the VPS" >&2
  exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

mapfile -d '' WORKFLOW_FILES < <(
  {
    find . -maxdepth 1 -type f -name '*.json' -print0
    find ./knowledge-base -maxdepth 1 -type f -name 'knowledge-base-*.json' -print0
  } | sort -z
)

if [ "${#WORKFLOW_FILES[@]}" -eq 0 ]; then
  echo "No workflow JSON files found to import" >&2
  exit 1
fi

echo "Found ${#WORKFLOW_FILES[@]} workflow file(s)"

container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$N8N_SERVICE")"
if [ -z "$container_id" ]; then
  echo "Starting $N8N_SERVICE service"
  docker compose -f "$COMPOSE_FILE" up -d "$N8N_SERVICE"
  container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$N8N_SERVICE")"
fi

if [ -z "$container_id" ]; then
  echo "Could not resolve container for service: $N8N_SERVICE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
backup_path="$BACKUP_DIR/workflows-$(date -u +%Y%m%dT%H%M%SZ).json"
echo "Exporting current workflows to $backup_path"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" n8n export:workflow --all > "$backup_path"

echo "Preparing import directory inside the n8n container"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" sh -lc "rm -rf '$REMOTE_IMPORT_DIR' && mkdir -p '$REMOTE_IMPORT_DIR'"

for workflow_file in "${WORKFLOW_FILES[@]}"; do
  clean_name="${workflow_file#./}"
  target_file="$REMOTE_IMPORT_DIR/${clean_name//\//__}"
  echo "Copying $clean_name"
  docker compose -f "$COMPOSE_FILE" cp "$workflow_file" "$N8N_SERVICE:$target_file"
done

project_arg=()
if [ -n "${N8N_IMPORT_PROJECT_ID:-}" ]; then
  project_arg=(--projectId="$N8N_IMPORT_PROJECT_ID")
fi

echo "Importing workflows into n8n"
for workflow_file in "${WORKFLOW_FILES[@]}"; do
  clean_name="${workflow_file#./}"
  target_file="$REMOTE_IMPORT_DIR/${clean_name//\//__}"
  echo "Importing $clean_name"
  docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" n8n import:workflow --input="$target_file" "${project_arg[@]}"
done

echo "Restarting $N8N_SERVICE so active workflows and webhooks are reloaded"
docker compose -f "$COMPOSE_FILE" restart "$N8N_SERVICE"

echo "Waiting for $N8N_SERVICE to become ready"
for attempt in $(seq 1 30); do
  container_id="$(docker compose -f "$COMPOSE_FILE" ps -q "$N8N_SERVICE")"
  running="$(docker inspect -f '{{.State.Running}}' "$container_id" 2>/dev/null || true)"
  if [ "$running" = "true" ]; then
    docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" n8n --version >/dev/null
    echo "$N8N_SERVICE is running and the n8n CLI is available"
    exit 0
  fi
  sleep 2
done

echo "$N8N_SERVICE did not report running status after restart" >&2
docker compose -f "$COMPOSE_FILE" ps "$N8N_SERVICE" >&2
exit 1
