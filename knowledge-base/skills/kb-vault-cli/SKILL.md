---
name: kb-vault-cli
description: Use when the user asks in natural language to create or update knowledge-vault notes via the installed kb CLI. Prefer real command capabilities discovered at runtime (currently kb-note with --project/--title/--file + text), and keep folder paths root-relative (never /home/...).
---

# KB Vault CLI

## Runtime-First Command Policy

1. Validate available commands before acting:
- Run `which kb-note kb-bug kb-resume kb-article`.
- If only `kb-note` exists, use only `kb-note`.
- Never invent unsupported flags.

2. Current known interface (from local binary):
- `kb-note [--project <slug>] [--title <text>] [--file <path>] [text]`
- Supported flags are `--project`, `--title`, `--file`.
- `kb-note` sends payload to webhook (VPS destination via `KB_WEBHOOK_URL`); file placement/routing is handled downstream, not by local `--folder` flags.

3. Mapping requests to `kb-note`:
- Free text note: put content in `[text]`.
- Titled note: add `--title`.
- Project note: add `--project`.
- Attachment request: add `--file`.

## VPS Delivery Rules (Mandatory)

- Always deliver notes through `kb-note` webhook flow. Do not create/edit local vault note files as a fallback.
- Before first send in a session, validate webhook configuration from `~/.config/kb-note/config.env` (or `KB_NOTE_CONFIG_FILE`) and confirm `KB_WEBHOOK_URL` is set.
- Consider delivery successful only when command output includes `kb-note: ok (HTTP 200)`.
- If delivery fails, report the remote error and retry once if failure looks transient. Never silently downgrade to local-only write.

## Path Rules (Strict)

- Use root-relative logical folders in communication, for example: `CompetitiveProgramming/`.
- Never use absolute host paths like `/home/pedroduarte/...` when describing target folders.
- If user supplies an absolute source file path, it can be used for `--file` input only.
- When creating local folders/files outside kb-note workflow, create them as relative paths from workspace root whenever possible (for example `CompetitiveProgramming/`).

## Execution Style

- Prefer executing commands directly instead of only suggesting them.
- Report what command was run and the effective destination/logical folder (webhook/VPS path handled downstream).
- If CLI capabilities conflict with requested metadata, state limitation clearly and apply the closest valid command.
