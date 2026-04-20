#!/usr/bin/env sh
set -eu

LOCK_FILE="/tmp/knowledge-vault-git-push.lock"
SYNC_ENV_FILE_DEFAULT="/home/node/.n8n/kb-vault-sync.env"

# lock simples sem flock para manter compatibilidade de imagem
if [ -e "$LOCK_FILE" ]; then
  if kill -0 "$(cat "$LOCK_FILE" 2>/dev/null)" 2>/dev/null; then
    echo "git-push ja em execucao"
    exit 0
  fi
fi

echo "$$" > "$LOCK_FILE"
cleanup() {
  rm -f "$LOCK_FILE"
}
trap cleanup EXIT INT TERM

REPO_DIR="${KB_VAULT_REPO_DIR:-/home/node/knowledge-vault}"
GIT_USER_NAME="${KB_VAULT_GIT_USER_NAME:-}"
GIT_USER_EMAIL="${KB_VAULT_GIT_USER_EMAIL:-}"
GIT_PUSH_USERNAME="${KB_VAULT_GIT_PUSH_USERNAME:-}"
GIT_PUSH_TOKEN="${KB_VAULT_GIT_PUSH_TOKEN:-}"
GIT_BRANCH="${KB_VAULT_GIT_BRANCH:-main}"
SYNC_ENV_FILE="${KB_VAULT_SYNC_ENV_FILE:-$SYNC_ENV_FILE_DEFAULT}"

if [ -f "$SYNC_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$SYNC_ENV_FILE"
  REPO_DIR="${KB_VAULT_REPO_DIR:-$REPO_DIR}"
  GIT_USER_NAME="${KB_VAULT_GIT_USER_NAME:-$GIT_USER_NAME}"
  GIT_USER_EMAIL="${KB_VAULT_GIT_USER_EMAIL:-$GIT_USER_EMAIL}"
  GIT_PUSH_USERNAME="${KB_VAULT_GIT_PUSH_USERNAME:-$GIT_PUSH_USERNAME}"
  GIT_PUSH_TOKEN="${KB_VAULT_GIT_PUSH_TOKEN:-$GIT_PUSH_TOKEN}"
  GIT_BRANCH="${KB_VAULT_GIT_BRANCH:-$GIT_BRANCH}"
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "repositorio nao encontrado em $REPO_DIR"
  exit 2
fi

cd "$REPO_DIR"

if [ -n "$GIT_USER_NAME" ]; then
  git config user.name "$GIT_USER_NAME"
fi
if [ -n "$GIT_USER_EMAIL" ]; then
  git config user.email "$GIT_USER_EMAIL"
fi

git add -A

if git diff --cached --quiet; then
  echo "NO_CHANGES"
  exit 0
fi

if [ -z "$GIT_USER_NAME" ] && [ -z "$(git config --get user.name || true)" ]; then
  echo "usuario git ausente: defina KB_VAULT_GIT_USER_NAME"
  exit 3
fi
if [ -z "$GIT_USER_EMAIL" ] && [ -z "$(git config --get user.email || true)" ]; then
  echo "email git ausente: defina KB_VAULT_GIT_USER_EMAIL"
  exit 3
fi

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
git commit -m "chore(kb): sync from vps $STAMP"

ASKPASS_FILE="/tmp/git-askpass-kv.sh"
export GIT_TERMINAL_PROMPT=0

if [ -n "$GIT_PUSH_USERNAME" ] && [ -n "$GIT_PUSH_TOKEN" ]; then
  cat > "$ASKPASS_FILE" <<'ASK'
#!/usr/bin/env sh
case "$1" in
  *Username*) echo "$KB_VAULT_GIT_PUSH_USERNAME" ;;
  *Password*) echo "$KB_VAULT_GIT_PUSH_TOKEN" ;;
  *) echo "" ;;
esac
ASK
  chmod 700 "$ASKPASS_FILE"
  export GIT_ASKPASS="$ASKPASS_FILE"
fi

if ! git push origin "$GIT_BRANCH"; then
  echo "falha no push: configure KB_VAULT_GIT_PUSH_USERNAME/KB_VAULT_GIT_PUSH_TOKEN ou remoto SSH com chave"
  rm -f "$ASKPASS_FILE"
  exit 4
fi

rm -f "$ASKPASS_FILE"
echo "PUSH_OK $STAMP"
