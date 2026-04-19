# GitHub App Setup

Use this mode to decouple the knowledge-base ingestion flow from individual repositories.

## Central webhook

- Webhook path: `/n8n/webhook/gH8xKbIngest0001/webhook/kb-event`
- Example production webhook URL: `https://example.com/n8n/webhook/gH8xKbIngest0001/webhook/kb-event`
- The same workflow also accepts manual `kb-note` entries.

## Required env vars on the VPS

- `KB_WEBHOOK_SECRET`: shared secret used by `kb-note`
- `KB_GITHUB_APP_WEBHOOK_SECRET`: GitHub App webhook secret used to validate `x-hub-signature-256`
- `KB_OPENAI_API_KEY`: optional, enables AI-generated summaries
- `KB_OPENAI_MODEL`: optional, defaults to `gpt-4.1-mini`
- `KB_ENABLE_GIT_PUSH`: optional, when `true` the vault clone will push to `origin`
- `KB_VAULT_REMOTE_URL`: optional remote URL for the knowledge vault repository

## GitHub App configuration

1. Create a GitHub App in your GitHub account settings.
2. Set the webhook URL to your public endpoint using the path above.
3. Set the webhook secret to the same value stored in `KB_GITHUB_APP_WEBHOOK_SECRET`.
4. Subscribe to the `Push` event.
5. Grant repository metadata read access.
6. Install the app on `All repositories` so new repositories are covered automatically.

## Notes

- The central processor auto-slugs unknown repositories from the push payload, so a new repository does not require a workflow file or a code change.
- Keep `projects.json` only for overrides such as custom display names, tags, or note paths.
