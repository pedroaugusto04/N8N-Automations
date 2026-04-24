# GitHub App Setup

Use this mode to decouple the knowledge-base ingestion flow from individual repositories.

## Central webhook

- Webhook path: `/n8n/webhook/gH8xKbIngest0001/webhook/kb-event`
- Example production webhook URL: `https://example.com/n8n/webhook/gH8xKbIngest0001/webhook/kb-event`
- The same workflow also accepts manual `kb` entries as `application/json`; attachments are sent in `attachment.data_b64`.

## Required env vars on the VPS

- `KB_WEBHOOK_SECRET`: shared secret used by `kb`
- `KB_GITHUB_APP_WEBHOOK_SECRET`: GitHub App webhook secret used to validate `x-hub-signature-256`
- `KB_AI_PROVIDER`: optional, `openai`, `gemini`, or `auto` (default `openai`)
- `KB_OPENAI_API_KEY`: optional, required when provider is `openai`
- `KB_OPENAI_MODEL`: optional, defaults to `gpt-4.1-mini`
- `KB_GEMINI_API_KEY`: optional, required when provider is `gemini`
- `KB_GEMINI_MODEL`: optional, defaults to `gemini-1.5-flash`
- `KB_ENABLE_GIT_PUSH`: optional, when `true` the vault clone will push to `origin`
- `KB_VAULT_REMOTE_URL`: optional remote URL for the knowledge vault repository
- `KB_GITHUB_API_TOKEN`: optional, GitHub token with repo read access used to fetch real diffs for code review (falls back to `KB_VAULT_GIT_PUSH_TOKEN`)
- `KB_MAX_DIFF_CHARS`: optional, max characters of diff to send to the AI (default `60000`)

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
