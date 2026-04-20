# Knowledge Base Automation

This directory contains the central assets for the personal engineering knowledge base flow:

- `process-event-v2.mjs`: centralized processor that accepts either `kb-note` events or raw GitHub App webhook deliveries, normalizes them, and updates the local vault clone.
- `flush-batch.mjs`: periodic git flusher used to consolidate multiple note updates into a single commit/push.
- `projects.json`: optional project overrides. Unknown repositories can be auto-created from the incoming GitHub payload.
- `knowledge-base-ingestion.json`: importable `n8n` workflow that exposes the centralized webhook and failure alert.
- `knowledge-base-batch-flush.json`: importable `n8n` cron workflow that runs `flush-batch.mjs` every 10 minutes.
- `github-app-setup.md`: checklist for configuring the GitHub App once, centrally.
- `kb-note`: CLI client for the host-side `kb-agent-server`. It reads `~/.config/kb-note/config.env` and sends a prompt to the VPS over HTTP.
- `kb-agent`: local OpenCode wrapper dedicated to this knowledge base setup. It always loads project-scoped agent config from this directory and limits the agent to `knowledge-base/` plus `/home/ubuntu/knowledge-vault`.
- `kb-agent-server.mjs`: lightweight host-side HTTP server that exposes `POST /kb-agent` (agent prompt) and `POST /kb-agent/files` (file save) directly on the VPS.
- `.env.kb-agent-server.example`: optional env template for endpoint settings and a dedicated webhook secret.
- `kb-note-config.env.example`: example config for remote clients that call `kb-note` from other machines.
- `Dockerfile.kb-agent`: container image for running `kb-agent-server` as a standalone service managed by Docker/Portainer.

The runtime vault lives at `/home/ubuntu/knowledge-vault` on the host and is mounted into the
`n8n` container at `/home/node/knowledge-vault`.

Batch mode variables:

- `KB_GIT_BATCH_MODE=true`: disable per-event commit/push in `process-event-v2.mjs` and defer git writeback.
- `KB_IGNORE_REPOS=owner/repo,...`: ignore selected repositories at webhook ingestion time (used to block self-recursion, e.g. `pedroaugusto04/Knowledge-Vault`).

OpenCode agent mode:

- `kb-agent "salve um resumo do erro X na pasta bugs do projeto n8n-automations"` runs a dedicated OpenCode agent for this knowledge base only.
- Project config lives in `knowledge-base/opencode.json`.
- The dedicated agent prompt lives in `knowledge-base/.opencode/agents/knowledge-writer.md`.
- The wrapper keeps the agent scoped to `/home/ubuntu/n8n/knowledge-base` and `/home/ubuntu/knowledge-vault`.
- You can place provider keys and the default model in `knowledge-base/.env.kb-agent`; the wrapper loads it automatically.
- Use `knowledge-base/.env.kb-agent.example` as the template for `Gemini`, `OpenAI`, or `Anthropic`.

Container mode:

- `docker-compose.yml` defines a dedicated `kb-agent-server` service, separate from `n8n`.
- The container mounts `knowledge-base/` read-only and `knowledge-vault/` read-write.
- The service publishes `127.0.0.1:8787` on the VPS host, so it can be proxied by `nginx` and managed in Portainer like the other apps.
- OpenCode runtime DB is persisted in a named Docker volume (`kb-agent-opencode-share`), while provider cache/config are mounted from host.

File save endpoint (`POST /kb-agent/files`):

- Auth: same `x-kb-secret` used by `/kb-agent`.
- Default allowed extensions: `.md`, `.txt`, `.pdf` (customize with `KB_AGENT_SERVER_ALLOWED_EXTENSIONS`).
- Default destination root: auto-detects a writable vault path (`KB_AGENT_SERVER_FILES_ROOT`, `KB_VAULT_DIR`, `/home/node/knowledge-vault`, `/home/ubuntu/knowledge-vault`, then local fallback). You can force one with `KB_AGENT_SERVER_FILES_ROOT`.
- Accepted payload:

```json
{
  "files": [
    {
      "path": "projects/fe-connect/docs/contexto.md",
      "content": "# Contexto\ntexto..."
    },
    {
      "path": "inbox/requisito.pdf",
      "contentBase64": "JVBERi0xLjcKJc..."
    }
  ]
}
```

- `content` is UTF-8 text; `contentBase64` is recommended for binary files (PDF, images, etc).

`kb-note` client setup:

- Copy `knowledge-base/kb-note-config.env.example` to `~/.config/kb-note/config.env` on the client machine.
- Set `KB_NOTE_URL` to the VPS endpoint, for example `http://pedro-duarte.ddns.net:8787/kb-agent`.
- Set `KB_NOTE_SECRET` to the same secret configured on the VPS.
- Then run `kb-note "salve um resumo do erro X na pasta bugs"`.
