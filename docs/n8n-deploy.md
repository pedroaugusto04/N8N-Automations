# Deploy automatico dos workflows do n8n

Este repositorio publica os workflows no n8n da VPS a cada push na branch `main`.

O GitHub Actions acessa a VPS por SSH, entra no clone deste repositorio, executa `git pull --ff-only origin main`, importa os workflows com o CLI do n8n dentro do container Docker e reinicia o servico `n8n`.

## GitHub Secrets obrigatorios

Crie estes secrets em `Settings > Secrets and variables > Actions > Repository secrets`:

| Secret | Valor esperado |
| --- | --- |
| `VPS_HOST` | IP ou hostname publico da VPS, por exemplo `203.0.113.10` ou `n8n.seudominio.com`. |
| `VPS_USER` | Usuario Linux usado para o deploy, por exemplo `deploy` ou `ubuntu`. |
| `VPS_SSH_PRIVATE_KEY` | Chave privada SSH desse usuario. Use uma chave dedicada para deploy, sem senha, no formato completo `-----BEGIN OPENSSH PRIVATE KEY-----...`. |
| `VPS_SSH_KNOWN_HOSTS` | Linha de `known_hosts` da VPS. Gere com `ssh-keyscan -p 22 seu-host`. |
| `VPS_REPO_PATH` | Caminho absoluto do clone deste repositorio na VPS, por exemplo `/home/ubuntu/N8N-Automations`. |

## GitHub Secret opcional

| Secret | Valor esperado |
| --- | --- |
| `VPS_SSH_PORT` | Porta SSH da VPS. Se nao existir, o workflow usa `22`. |

## Preparo unico da VPS

1. Clone este repositorio na VPS no caminho configurado em `VPS_REPO_PATH`.
2. Configure o arquivo `.env` diretamente na VPS. Ele nao deve ser commitado.
3. Garanta que `docker compose -f docker-compose.yml up -d n8n` funciona na VPS.
4. Adicione a chave publica correspondente a `VPS_SSH_PRIVATE_KEY` no `~/.ssh/authorized_keys` do usuario de deploy.
5. Garanta que esse usuario consegue executar `git pull` e `docker compose` no diretorio do repositorio.

## Workflows importados

O script importa:

- todos os arquivos `*.json` na raiz do repositorio;
- todos os arquivos `knowledge-base/knowledge-base-*.json`.

Antes de importar, o script exporta um backup dos workflows atuais para `backups/n8n-workflows/` na VPS. Essa pasta e ignorada pelo Git.

## Segurança

Credenciais ficam fora do Git:

- `.env` local e da VPS continuam ignorados;
- a chave SSH fica somente em GitHub Secrets;
- o workflow usa `StrictHostKeyChecking=yes` com `VPS_SSH_KNOWN_HOSTS`, evitando aceitar host SSH desconhecido automaticamente.
