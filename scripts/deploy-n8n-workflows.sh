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

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required on the VPS to validate workflow JSON files" >&2
  exit 1
fi

python3 - "${WORKFLOW_FILES[@]}" <<'PY'
import json
import sys
from pathlib import Path

failed = False
for file_name in sys.argv[1:]:
    path = Path(file_name)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"{file_name}: invalid JSON: {exc}", file=sys.stderr)
        failed = True
        continue

    workflows = data if isinstance(data, list) else [data]
    if not workflows:
        print(f"{file_name}: does not contain any workflows", file=sys.stderr)
        failed = True
        continue

    for index, workflow in enumerate(workflows):
        if not isinstance(workflow, dict):
            print(f"{file_name}[{index}]: workflow must be an object", file=sys.stderr)
            failed = True
            continue

        workflow_id = workflow.get("id")
        workflow_name = workflow.get("name")
        if not isinstance(workflow_id, str) or not workflow_id.strip():
            print(f"{file_name}[{index}]: workflow id is required", file=sys.stderr)
            failed = True
        if not isinstance(workflow_name, str) or not workflow_name.strip():
            print(f"{file_name}[{index}]: workflow name is required", file=sys.stderr)
            failed = True

if failed:
    sys.exit(1)
PY

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

echo "Applying workflow active states from versioned JSON files"
for workflow_file in "${WORKFLOW_FILES[@]}"; do
  while IFS=$'\t' read -r workflow_id workflow_active; do
    echo "Setting workflow $workflow_id active=$workflow_active"
    docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" n8n update:workflow --id="$workflow_id" --active="$workflow_active"
  done < <(
    python3 - "$workflow_file" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
workflows = data if isinstance(data, list) else [data]
for workflow in workflows:
    workflow_id = workflow["id"]
    workflow_active = "true" if workflow.get("active") is True else "false"
    print(f"{workflow_id}\t{workflow_active}")
PY
  )
done

echo "Detecting duplicate workflows with active managed replacements"
current_workflows_file="$(mktemp)"
duplicate_workflows_file="$(mktemp)"
docker compose -f "$COMPOSE_FILE" exec -T "$N8N_SERVICE" n8n export:workflow --all > "$current_workflows_file"
python3 - "$current_workflows_file" "${WORKFLOW_FILES[@]}" > "$duplicate_workflows_file" <<'PY'
import json
import sys
from pathlib import Path

current_path = Path(sys.argv[1])
managed_files = [Path(name) for name in sys.argv[2:]]

managed_by_name = {}
for path in managed_files:
    data = json.loads(path.read_text(encoding="utf-8"))
    workflows = data if isinstance(data, list) else [data]
    for workflow in workflows:
        managed_by_name[workflow["name"]] = {
            "id": workflow["id"],
            "active": bool(workflow.get("active") is True),
        }

current_data = json.loads(current_path.read_text(encoding="utf-8") or "[]")
current_workflows = current_data if isinstance(current_data, list) else [current_data]
for workflow in current_workflows:
    workflow_id = str(workflow.get("id") or "").strip()
    workflow_name = str(workflow.get("name") or "").strip()
    if not workflow_id or not workflow_name:
        continue

    managed = managed_by_name.get(workflow_name)
    if not managed:
        continue

    managed_id = managed["id"]
    managed_is_active = managed["active"]
    if not managed_is_active:
        continue

    if workflow_id != managed_id:
        print(f"{workflow_id}\t{workflow_name}")
PY
if [ -s "$duplicate_workflows_file" ]; then
  echo "Removing duplicate workflows that already have an active managed replacement"
  while IFS=$'\t' read -r duplicate_id duplicate_name; do
    echo "Queued for removal: $duplicate_id ($duplicate_name)"
  done < "$duplicate_workflows_file"

  data_mount_source="$(
    docker inspect "$container_id" --format '{{json .Mounts}}' \
      | python3 -c 'import json, sys; mounts=json.loads(sys.stdin.read() or "[]"); print(next((m.get("Source","") for m in mounts if m.get("Destination")=="/home/node/.n8n"), ""))'
  )"

  if [ -z "$data_mount_source" ]; then
    echo "Could not resolve the host mount for /home/node/.n8n" >&2
    rm -f "$current_workflows_file" "$duplicate_workflows_file"
    exit 1
  fi

  sqlite_path="$data_mount_source/database.sqlite"
  if [ ! -f "$sqlite_path" ]; then
    echo "Could not find n8n SQLite database at $sqlite_path" >&2
    rm -f "$current_workflows_file" "$duplicate_workflows_file"
    exit 1
  fi

  sqlite_backup_path="$BACKUP_DIR/database-before-duplicate-cleanup-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
  echo "Backing up SQLite database to $sqlite_backup_path"
  sudo cp "$sqlite_path" "$sqlite_backup_path"

  echo "Stopping $N8N_SERVICE to remove duplicate workflow rows safely"
  docker compose -f "$COMPOSE_FILE" stop "$N8N_SERVICE"

  sudo python3 - "$duplicate_workflows_file" "$sqlite_path" <<'PY'
import sqlite3
import sys
from pathlib import Path

duplicates_path = Path(sys.argv[1])
sqlite_path = Path(sys.argv[2])
duplicate_ids = []
for line in duplicates_path.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line:
        continue
    workflow_id = line.split("\t", 1)[0].strip()
    if workflow_id:
        duplicate_ids.append(workflow_id)

if duplicate_ids:
    conn = sqlite3.connect(str(sqlite_path))
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()
    for workflow_id in duplicate_ids:
        cur.execute("DELETE FROM workflow_entity WHERE id = ?", (workflow_id,))
    conn.commit()
    conn.close()
PY

  echo "Starting $N8N_SERVICE after duplicate cleanup"
  docker compose -f "$COMPOSE_FILE" up -d "$N8N_SERVICE"
else
  echo "No removable duplicate workflows found"
  echo "Restarting $N8N_SERVICE so active workflows and webhooks are reloaded"
  docker compose -f "$COMPOSE_FILE" restart "$N8N_SERVICE"
fi

rm -f "$current_workflows_file" "$duplicate_workflows_file"

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
