---
name: kb-vault-cli
description: Use quando o usuario pedir para criar/atualizar notas no Knowledge Vault por linguagem natural. Executa kb-note/kb-bug/kb-resume/kb-article com flags reais suportadas localmente.
---

# KB Vault CLI

## Runtime-First Command Policy

1. Valide os comandos instalados antes de agir:
- `which kb-note kb-bug kb-resume kb-article`
- Se wrappers nao existirem, use somente `kb-note`.

2. Interface atual suportada:
- `kb-note --kind <bug|resume|article|manual_note|postmortem|daily> --project <slug> [opcoes] [text]`
- Wrappers:
- `kb-bug <project> [text]`
- `kb-resume <project> [text]`
- `kb-article <project> [text]`

3. Flags validas do `kb-note`:
- `--project`, `--kind`, `--title`, `--name`, `--folder`, `--status`, `--source-kind`, `--severity`, `--source-file`, `--tags`, `--file`
- Nunca inventar flags fora dessa lista.

## Mapping de Intencao -> Comando

- Bug report: preferir `kb-bug <project> <texto>`.
- Resumo de conteudo: preferir `kb-resume <project> <texto>`.
- Artigo/guia: preferir `kb-article <project> <texto>`.
- Casos avancados (daily, postmortem, nome/metadata custom): usar `kb-note` com flags explicitas.

## Regras de Path

- `--folder` sempre relativo ao vault, sem path absoluto.
- Nunca usar `/home/...` em `--folder`.
- Rejeitar `--folder` com `..` (path traversal).
- `--file` pode receber caminho absoluto apenas como arquivo de entrada.

## Execucao

- Execute o comando diretamente sempre que possivel.
- Retorne o comando executado e o caminho final gerado pelo CLI.
- Se o pedido do usuario conflitar com as capacidades atuais, explique a limitacao e aplique o comando valido mais proximo.
