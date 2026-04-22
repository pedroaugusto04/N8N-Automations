# KB Notes Web

Cliente web do fluxo `kb`, mantendo o `n8n` como backend principal.

## O que esta app faz

- serve a interface em `/notes`
- protege acesso com senha e sessao HTTP-only
- envia o formulario para `/api/kb-proxy`
- o proxy injeta `x-kb-secret` no servidor
- encaminha o payload compativel para o webhook atual do `n8n`

## Deploy rapido

1. Copie `.env.example` para `.env` e ajuste os valores.
2. Suba o container:

```bash
docker compose up -d --build
```

3. Configure o `nginx` do host usando `deploy/nginx.notes.conf.example`.
4. Recarregue o `nginx` e acesse `https://seu-dominio/notes`.

## Variaveis importantes

- `APP_BASE_URL`: URL publica do dominio principal
- `APP_PASSWORD`: senha unica da interface
- `APP_SESSION_SECRET`: segredo para assinar o cookie
- `KB_WEBHOOK_URL`: webhook atual do workflow de ingestion
- `KB_WEBHOOK_SECRET`: segredo compartilhado com o webhook
- `KB_PROJECTS_FILE`: caminho do manifest de projetos montado no container
- `MAX_UPLOAD_BYTES`: limite de upload aceito pela UI

## Observacoes

- O manifest atual do `knowledge-base` e montado em `/knowledge-base`.
- O upload e convertido no servidor em `file_name`, `mime_type`, `size_bytes`, `sha256` e `data_b64`.
- A app nao substitui o processor nem altera o fluxo atual do `kb`.
