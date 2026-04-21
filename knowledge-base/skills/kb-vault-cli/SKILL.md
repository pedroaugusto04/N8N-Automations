---
name: kb-vault-cli
description: Use quando o usuario pedir para criar/atualizar notas no Knowledge Vault por linguagem natural. Sempre usa o comando unico `kb` no modo remote-first.
---

# KB Vault CLI

## Command Policy

1. Valide o comando principal antes de agir:
- `which kb`

2. Interface oficial suportada:
- `kb "<texto livre>" [--path /arquivo] [--project slug] [--kind manual_note|bug|resume|article|daily] [--tags a,b] [--yes]`

3. Nao use comandos legados:
- `kb-note`, `kb-bug`, `kb-resume`, `kb-article`, `kb-summary`, `kb-file`
- Se o usuario pedir legado, converta para o formato unico `kb "..."`.

4. Politica de arquivo:
- Use `--path` para 1 arquivo por comando (V1).
- Nao inferir caminho de arquivo a partir do texto livre.

## Mapping de Intencao -> kind

- Bug report: `--kind bug`
- Resumo: `--kind resume`
- Artigo/guia: `--kind article`
- Nota geral: `--kind manual_note`
- Diario: `--kind daily`

Se ambiguidade e o usuario nao pedir explicitamente, deixar classificacao automatica do `kb` (com prompt de confirmacao quando necessario).

## Execucao

- Sempre enviar remoto via webhook (`KB_WEBHOOK_URL` + `x-kb-secret`).
- Nunca fazer fallback para escrita local no vault.
- Retorne comando executado e resposta JSON principal (`event_id`, `project`, `kind`, `notePath`, `attachmentMode`, `attachmentPath`, `pushStatus`).
