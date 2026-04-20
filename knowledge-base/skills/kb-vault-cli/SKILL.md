---
name: kb-vault-cli
description: Use when the user asks in natural language to create or update knowledge-vault notes using fixed CLI commands. Convert requests into full kb-note/kb-bug/kb-resume/kb-article commands with deterministic folder routing, flexible project/file/folder options, and standardized frontmatter.
---

# KB Vault CLI

## Command Selection

1. Choose command by note type:
- `kb-bug` for bug notes.
- `kb-resume` for PDF summary notes.
- `kb-article` for article-like notes.
- `kb-note` for any other type (`manual_note`, `postmortem`, `daily`).

2. Build complete command with explicit flags whenever possible:
- `--project <slug>`
- `--kind <bug|resume|article|manual_note|postmortem|daily>`
- `--title "..."`
- `--name <file.md>`
- `--folder <relative/path>`
- `--status <value>`
- `--tags a,b,c`
- `--source-kind <value>`
- `--severity <value>`
- `--source-file <path>`

## Fixed Routing Rules

Default folder mapping:
- `bug` -> `projects/<slug>/bugs/`
- `resume` -> `projects/<slug>/docs/resumes/`
- `article` -> `projects/<slug>/docs/articles/`
- `manual_note` -> `projects/<slug>/docs/manual-notes/`
- `postmortem` -> `projects/<slug>/postmortems/`
- `daily` -> `projects/<slug>/daily/`
- Missing project -> `inbox`

If `--folder` is provided, keep it relative and deterministic:
- `projects/...` or `inbox/...` means absolute from vault root.
- Any other value means under `projects/<slug>/...`.

## Output Constraints

- Keep file names in kebab-case and `.md` extension.
- Keep frontmatter standardized: `id`, `type`, `project`, `source_kind`, `status`, `event_at`, `tags`.
- Add extra metadata by type:
- `bug`: `severity`, `opened_at`, optional `closed_at`.
- `postmortem`: `severity`, `opened_at`, optional `closed_at`.
- `resume`: `source_file` when available.

## Execution Style

- Prefer executing commands directly instead of only suggesting them.
- Report the generated file path after command execution.
- Never route outside the vault structure.
