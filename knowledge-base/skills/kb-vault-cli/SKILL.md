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
- `kb-note` sends payload to webhook; file placement/routing is handled downstream, not by local `--folder` flags.

3. Mapping requests to `kb-note`:
- Free text note: put content in `[text]`.
- Titled note: add `--title`.
- Project note: add `--project`.
- Attachment request: add `--file`.

## Path Rules (Strict)

- Use root-relative logical folders in communication, for example: `CompetitiveProgramming/`.
- Never use absolute host paths like `/home/pedroduarte/...` when describing target folders.
- If user supplies an absolute source file path, it can be used for `--file` input only.
- When creating local folders/files outside kb-note workflow, create them as relative paths from workspace root whenever possible (for example `CompetitiveProgramming/`).

## Execution Style

- Prefer executing commands directly instead of only suggesting them.
- Report what command was run and the effective destination/logical folder.
- If CLI capabilities conflict with requested metadata, state limitation clearly and apply the closest valid command.
