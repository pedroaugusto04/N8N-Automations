# Knowledge Base Automation

This directory contains the central assets for the personal engineering knowledge base flow.

Main files:
- `process-event-v2.mjs`: centralized processor for GitHub App and manual note events.
- `flush-batch.mjs`: periodic git flusher used to consolidate multiple note updates.
- `projects.json`: optional project overrides.
- `knowledge-base-ingestion.json`: importable n8n workflow for centralized webhook ingestion.
- `knowledge-base-batch-flush.json`: importable n8n cron workflow that runs `flush-batch.mjs`.
- `github-app-setup.md`: GitHub App setup checklist.

## Local CLI Note Commands

The note flow is now local and deterministic (no kb-agent runtime required).

- `kb-note`: creates markdown files directly in the knowledge vault.
- `kb-bug`: wrapper for `kb-note --kind bug`.
- `kb-resume`: wrapper for `kb-note --kind resume`.
- `kb-article`: wrapper for `kb-note --kind article`.

### Required setup

Copy `kb-note-config.env.example` to `~/.config/kb-note/config.env` and set:

```bash
KB_VAULT_DIR=/home/ubuntu/knowledge-vault
```

If `KB_VAULT_DIR` is not set, `kb-note` attempts auto-detection (`/home/ubuntu/knowledge-vault`, then `/home/node/knowledge-vault`).

### Usage

```bash
kb-bug n8n-automations "erro webhook 401"
kb-resume n8n-automations "resumo do pdf de arquitetura"
kb-article n8n-automations "publicar guia de deploy"

kb-note --kind manual_note --project n8n-automations --title "ajuste do fluxo" "detalhes da mudanca"
kb-note --kind postmortem --project n8n-automations --severity high --status closed --name postmortem-webhook-401.md "incidente e resolucao"
kb-note --kind daily --project n8n-automations --folder daily --name 2026-04-20.md "resumo do dia"
```

### Flexible options

- `--project <slug>`
- `--kind <bug|resume|article|manual_note|postmortem|daily>`
- `--title <title>`
- `--name <file.md>`
- `--folder <relative/path>`
- `--status <value>`
- `--source-kind <value>`
- `--severity <value>`
- `--source-file <path>`
- `--tags a,b,c`
- `--file <path>`

### Fixed vault structure by type

- `inbox/`
- `projects/<slug>/bugs/`
- `projects/<slug>/docs/`
- `projects/<slug>/docs/articles/`
- `projects/<slug>/docs/resumes/`
- `projects/<slug>/docs/manual-notes/`
- `projects/<slug>/daily/`
- `projects/<slug>/postmortems/`

`--folder` can override destination when needed, while keeping paths relative to the vault.

## Codex Skill

Repository skill for natural language to deterministic command execution:
- `knowledge-base/skills/kb-vault-cli/SKILL.md`

The skill is intended to classify requests and execute the complete command (`kb-note`/`kb-bug`/`kb-resume`/`kb-article`) with explicit flags.

### Tutorial (usuario) - cadastrar no Codex

The Codex runtime loads custom skills from your local Codex skills directory. On this VPS, use:

```bash
mkdir -p ~/.codex/skills/kb-vault-cli
cp /home/ubuntu/n8n/knowledge-base/skills/kb-vault-cli/SKILL.md ~/.codex/skills/kb-vault-cli/SKILL.md
```

Optional (if you also want local agent metadata alongside the skill):

```bash
mkdir -p ~/.codex/skills/kb-vault-cli/agents
cp /home/ubuntu/n8n/knowledge-base/skills/kb-vault-cli/agents/openai.yaml ~/.codex/skills/kb-vault-cli/agents/openai.yaml
```

After this, start a new Codex session (or restart the current one) so the skill list is reloaded.

### Tutorial (usuario) - uso simples na pratica

To force usage of this skill, start your request with `$kb-vault-cli` and describe only the intent in natural language.
Codex should infer type, project, folder, metadata, and execute the correct command for you.

Examples:

```text
$kb-vault-cli registra um bug do n8n-automations: webhook 401 apos trocar secret
$kb-vault-cli resumir o pdf /tmp/rag.pdf no projeto n8n-automations
$kb-vault-cli criar postmortem high severity do incidente de timeout de ontem e marcar como closed
```

Expected behavior from Codex:
- Selects `kb-bug`, `kb-resume`, `kb-article`, or `kb-note` automatically.
- Completes deterministic flags (`--project`, `--kind`, `--folder`, `--severity`, `--status`, etc.).
- Writes only inside the vault structure and reports the generated file path.

If you prefer, you can still be explicit:

```text
$kb-vault-cli usa --project n8n-automations --kind daily e cria nota de hoje com os aprendizados do deploy
```
