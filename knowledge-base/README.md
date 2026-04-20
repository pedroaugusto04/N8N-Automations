# Knowledge Base Automation

Automacao do Knowledge Database com criacao local de notas e sincronizacao VPS -> GitHub -> maquina local.

## Arquivos principais

- `kb-note`: cria notas markdown localmente no vault.
- `kb-bug`, `kb-resume`, `kb-article`: wrappers do `kb-note`.
- `scripts/knowledge-vault-git-push.sh`: commit + push automatico do vault.
- `workflows/knowledge-vault-sync-vps-to-local.json`: workflow n8n (cron 5 min) que executa o script de push.
- `knowledge-base-ingestion.json`: workflow opcional de ingestao via webhook.
- `knowledge-base-batch-flush.json`: workflow opcional de batch flush (quando ingestao estiver em batch).
- `skills/kb-vault-cli/SKILL.md`: skill do Codex para acionar comandos do CLI.

## Fluxo oficial (ativo)

1. Nota e criada/atualizada no vault (via `kb-note`/wrappers ou pela pipeline de ingestao).
2. O n8n executa `knowledge-vault-git-push.sh` a cada 5 minutos.
3. O script faz `git add -A`, cria commit se houver mudanca e envia para `origin/main`.
4. A maquina local sincroniza com `git pull` periodico.

## Configuracao do kb-note

Crie `~/.config/kb-note/config.env`:

```bash
KB_VAULT_DIR=/home/ubuntu/knowledge-vault
```

Se nao definir `KB_VAULT_DIR`, o script tenta detectar:
1. `/home/ubuntu/knowledge-vault`
2. `/home/node/knowledge-vault`

Requisito: o usuario que executa o comando precisa ter permissao de escrita no diretório.

## Uso rapido

```bash
kb-bug n8n-automations "erro webhook 401"
kb-resume n8n-automations "resumo do pdf de arquitetura"
kb-article n8n-automations "guia de deploy"

kb-note --kind manual_note --project n8n-automations --title "ajuste do fluxo" "detalhes"
kb-note --kind daily --project n8n-automations --name 2026-04-20.md "resumo do dia"
```

Flags suportadas no `kb-note`:
- `--kind <bug|resume|article|manual_note|postmortem|daily>`
- `--project <slug>`
- `--title <title>`
- `--name <file.md>`
- `--folder <relative/path>`
- `--status <value>`
- `--source-kind <value>`
- `--severity <value>`
- `--source-file <path>`
- `--tags a,b,c`
- `--file <path>`

## Configuracao do push automatico no n8n

O script de push agora suporta arquivo de ambiente dedicado (recomendado):

- arquivo padrao no container n8n: `/home/node/.n8n/kb-vault-sync.env`
- arquivo de exemplo neste repo: `scripts/kb-vault-sync.env.example`

Variaveis suportadas:
- `KB_VAULT_REPO_DIR` (default: `/home/node/knowledge-vault`)
- `KB_VAULT_GIT_BRANCH` (default: `main`)
- `KB_VAULT_GIT_USER_NAME`
- `KB_VAULT_GIT_USER_EMAIL`
- `KB_VAULT_GIT_PUSH_USERNAME`
- `KB_VAULT_GIT_PUSH_TOKEN`

Observacoes:
- Se nao houver mudancas, o script retorna `NO_CHANGES` e sai sem erro.
- Se o remoto for HTTPS, configure `KB_VAULT_GIT_PUSH_USERNAME` e `KB_VAULT_GIT_PUSH_TOKEN`.
- Se usar remoto SSH com chave valida no container, username/token nao sao necessarios.

## Skill do Codex

Instalacao da skill na VPS:

```bash
mkdir -p ~/.codex/skills/kb-vault-cli
cp /home/ubuntu/n8n/knowledge-base/skills/kb-vault-cli/SKILL.md ~/.codex/skills/kb-vault-cli/SKILL.md
```

Depois reinicie a sessao do Codex para recarregar skills.
