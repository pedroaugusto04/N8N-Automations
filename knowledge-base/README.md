# Knowledge Base Automation

This directory contains the central assets for the personal engineering knowledge base flow:

- `process-event-v2.mjs`: centralized processor that accepts either `kb-note` events or raw GitHub App webhook deliveries, normalizes them, and updates the local vault clone.
- `projects.json`: optional project overrides. Unknown repositories can be auto-created from the incoming GitHub payload.
- `knowledge-base-ingestion.json`: importable `n8n` workflow that exposes the centralized webhook and failure alert.
- `github-app-setup.md`: checklist for configuring the GitHub App once, centrally.
- `kb-note`: host-side CLI entrypoint used by the installed wrapper in `~/.local/bin`. The target webhook URL is expected to come from local config such as `KB_WEBHOOK_URL` in `~/.config/kb-note/config.env`.

The runtime vault lives at `/home/ubuntu/knowledge-vault` on the host and is mounted into the
`n8n` container at `/home/node/knowledge-vault`.
