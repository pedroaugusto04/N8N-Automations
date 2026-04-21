# Knowledge Base Automation

Fluxo oficial: **remote-first** via webhook no n8n usando um comando único.

## Comando oficial

```bash
kb "<texto livre>" [--path /caminho/arquivo] [--project slug] [--kind manual_note|bug|resume|article|daily] [--tags a,b] [--default]
```

Exemplos:

```bash
kb "corrigi timeout no webhook"
kb "erro 401 no webhook" --kind bug --project n8n-automations
kb "referencia do parser" --path ./knowledge-base/process-event-v2.mjs --tags parser,ingestion
```

Se `--kind` ou `--project` nao forem informados, o `kb` pergunta no terminal um parametro por vez e lista as opcoes numeradas para selecao. Use `--default` para aceitar a sugestao automatica sem interacao.

## Política de anexos

- Até **10 MiB**: arquivo vai para `projects/<slug>/assets/YYYY/MM/` dentro do vault Git.
- Acima de **10 MiB**: arquivo vai para `/home/node/knowledge-vault-archive/<slug>/YYYY/MM/` fora do vault.
- A nota sempre registra metadados técnicos do anexo (`mode`, `path`, `size`, `sha256`).

## Fluxo de ingestão

1. `kb` envia `multipart/form-data` para `KB_WEBHOOK_URL` com `x-kb-secret`.
2. Workflow `knowledge-base-ingestion.json` normaliza payload + binário.
3. n8n executa `process-event-v2.mjs` via **stdin** (`--stdin-base64`) para evitar limite de `argv`.
4. Processor persiste nota + anexo conforme threshold, comita no vault e faz push conforme env.

## Variáveis de ambiente relevantes

No host/CLI:

- `KB_WEBHOOK_URL` (obrigatória, endpoint `/kb-event`)
- `KB_WEBHOOK_SECRET` (obrigatória)
- `WEBHOOK_URL` (fallback para montar `KB_WEBHOOK_URL` automaticamente)

No processor (VPS):

- `KB_VAULT_PATH` (default `/home/node/knowledge-vault`)
- `KB_ARCHIVE_PATH` (default `/home/node/knowledge-vault-archive`)
- `KB_ATTACHMENT_MAX_VAULT_BYTES` (default `10485760`)
