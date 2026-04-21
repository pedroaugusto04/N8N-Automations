---
name: kb-vault-cli
description: Use quando o usuario pedir para criar/atualizar notas no Knowledge Vault por linguagem natural. Prioriza comando curto `kb` e usa `kb-note`/wrappers apenas quando necessario.
---

# KB Vault CLI

## Runtime-First Command Policy

1. Valide os comandos instalados antes de agir:
- `which kb kb-note kb-bug kb-resume kb-article kb-summary kb-file`
- Se wrappers nao existirem, use somente `kb-note`.

2. Interface atual suportada:
- Preferencial (curta):
- `kb note [project] [texto]`
- `kb bug [project] [texto]`
- `kb resume|summary [project] [texto]`
- `kb article [project] [texto]`
- `kb daily [project] [texto]`
- `kb file [project] <arquivo> [--note ...] [--title ...] [--tags ...]`
- Compatibilidade:
- `kb-note --kind <bug|resume|article|manual_note|postmortem|daily> --project <slug> [opcoes] [text]`
- Wrappers:
- `kb-bug <project> [text]`
- `kb-resume <project> [text]`
- `kb-article <project> [text]`
- `kb-summary <project> [text]`
- `kb-file [project] <arquivo>`

3. Flags validas do `kb-note`:
- `--project`, `--kind`, `--title`, `--name`, `--folder`, `--status`, `--source-kind`, `--severity`, `--source-file`, `--tags`, `--file`
- atalhos: `-p`, `-k`, `-t`, `-n`, `-d`
- Nunca inventar flags fora dessa lista.

## Mapping de Intencao -> Comando

- Bug report: preferir `kb bug <project> <texto>`.
- Resumo de conteudo/chat: preferir `kb summary <project> <texto>` (ou via stdin).
- Artigo/guia: preferir `kb article <project> <texto>`.
- Arquivo interessante: preferir `kb file <project> <arquivo> --note "motivo"`.
- Casos avancados (postmortem, nome/metadata custom): usar `kb-note` com flags explicitas.

## Regras de Path

- `--folder` sempre relativo ao vault, sem path absoluto.
- Nunca usar `/home/...` em `--folder`.
- Rejeitar `--folder` com `..` (path traversal).
- `--file` pode receber caminho absoluto apenas como arquivo de entrada.

## Execucao

- Execute o comando diretamente sempre que possivel.
- Retorne o comando executado e o caminho final gerado pelo CLI.
- Se o pedido do usuario conflitar com as capacidades atuais, explique a limitacao e aplique o comando valido mais proximo.
