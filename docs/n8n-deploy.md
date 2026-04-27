# Deploy automatico do Knowledge Base

Este repositorio publica apenas os **adapters** do n8n. O core do produto roda em código em `knowledge-base/`.

## O que o deploy faz

1. acessa a VPS por SSH
2. executa `git pull --ff-only origin main`
3. roda `npm --prefix knowledge-base install`
4. roda `npm --prefix knowledge-base test`
5. valida os entrypoints em `knowledge-base/dist/cli/`
6. importa `knowledge-base/workflows/*.json`
7. reinicia/publica o n8n

## GitHub Secrets obrigatorios

| Secret | Valor esperado |
| --- | --- |
| `VPS_HOST` | IP ou hostname publico da VPS |
| `VPS_USER` | Usuario Linux usado no deploy |
| `VPS_SSH_PRIVATE_KEY` | Chave privada SSH do usuario |
| `VPS_SSH_KNOWN_HOSTS` | Saida de `ssh-keyscan` da VPS |
| `VPS_REPO_PATH` | Caminho absoluto do clone na VPS |

## GitHub Secret opcional

| Secret | Valor esperado |
| --- | --- |
| `VPS_SSH_PORT` | Porta SSH. Default `22` |

## Preparo unico da VPS

1. Clone este repositorio na VPS.
2. Configure `.env` diretamente na VPS.
3. Garanta `docker compose up -d n8n`.
4. Garanta `npm` disponível na VPS.
5. Garanta permissão de `git pull` e `docker compose` para o usuário de deploy.

## Segurança

Credenciais do Knowledge Base não devem ir para GitHub nem para workflow hardcoded:

- `KB_REVIEW_AI_API_KEY`
- `KB_CONVERSATION_AI_API_KEY`
- `KB_GITHUB_APP_WEBHOOK_SECRET`
- `KB_GITHUB_API_TOKEN`
- `KB_GITHUB_APP_INSTALL_URL`
- `KB_TELEGRAM_BOT_TOKEN`
- `KB_WPP_PAIRING_URL`
- `EVOLUTION_API_KEY`
- `KB_VAULT_GIT_PUSH_TOKEN`

Tudo isso deve ficar em `.env` na VPS.
