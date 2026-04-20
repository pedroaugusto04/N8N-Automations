---
name: kb-agent-usage
description: Use to handle knowledge-vault note requests via kb-agent with deterministic routing by note type and fixed folder structure. Trigger when the user asks in natural language to create/update bug notes, PDF summaries, articles, postmortems, manual notes, or daily entries in the vault, especially when destination path or frontmatter should be standardized.
---

# KB Agent Usage

## Execute Workflow

1. Classificar a solicitacao em um tipo de nota:
- `bug`
- `resumo_pdf`
- `article`
- `manual_note`
- `postmortem`
- `daily`

2. Definir `project slug`:
- Usar o slug informado pelo usuario.
- Se ausente, inferir pelo contexto.
- Se nao for possivel inferir com seguranca, usar `inbox`.

3. Aplicar roteamento fixo de pastas:
- `bug` -> `projects/<slug>/bugs/`
- `article` -> `projects/<slug>/docs/articles/`
- `resumo_pdf` -> `projects/<slug>/docs/resumes/`
- `manual_note` -> `projects/<slug>/docs/manual-notes/`
- `postmortem` -> `projects/<slug>/postmortems/`
- `daily` -> `projects/<slug>/daily/`
- Fallback -> `inbox/`

4. Criar ou atualizar nota em Markdown com nome `kebab-case` curto e descritivo.

5. Preencher frontmatter padrao:
- `id`
- `type`
- `project`
- `source_kind`
- `status`
- `event_at`
- `tags`

6. Aplicar campos por tipo quando necessario:
- `bug`: incluir `severity`, `opened_at`, `closed_at` (se encerrado)
- `postmortem`: incluir `severity`, `opened_at`, `closed_at`
- `resumo_pdf`: incluir `source_file`

7. Usar templates do vault quando existirem:
- `templates/bug.md`
- `templates/manual_note.md`
- `templates/postmortem.md`
- `templates/resumo_pdf.md`

## Use Local Commands When Available

Preferir comandos curtos quando o pedido ja vier estruturado:
- `kb-bug <project-slug> "<descricao>"`
- `kb-resume <project-slug> "<descricao>"`
- `kb-article <project-slug> "<descricao>"`

Usar `kb-note --kind <bug|resume|article> --project <slug> "<texto>"` quando for preciso montar o prompt explicitamente.

## Keep Output Deterministic

- Nao inventar pastas fora da estrutura fixa.
- Nao omitir frontmatter minimo.
- Nao usar nomes de arquivo genericos como `note.md`.
- Informar no final quais arquivos foram criados/atualizados.
