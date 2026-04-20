# Dashboards Obsidian para Knowledge Base

Arquivos incluidos:
- 00-Dashboard-Geral.md
- 01-Dashboard-por-Projeto.md
- 02-Dashboard-Tendencias.md
- 03-Dashboard-Riscos.md

## Como usar

1. Copie os arquivos desta pasta para o seu vault em uma pasta como `dashboards/`.
2. No Obsidian, habilite os plugins community: Dataview (obrigatorio).
3. Opcional para graficos: Charts e Tracker.
4. Abra os dashboards e ajuste filtros de projeto quando necessario.

## Campos esperados no frontmatter

- type
- project
- repo
- branch
- event_at
- analysis_source
- is_manual
- commits_count
- files_changed
- insertions
- deletions
- tags

Esses campos agora sao preenchidos pelo processador em `process-event-v2.mjs` para notas novas.
