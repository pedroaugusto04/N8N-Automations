# Knowledge Base Automation

Fluxo oficial: **remote-first** via webhook no n8n usando um comando único e um vault otimizado para `Obsidian`.

## Comando oficial

```bash
kb "<texto livre>" [--path /caminho/arquivo] [--project slug] [--kind manual_note|bug|resume|article|daily] [--note-type event|knowledge|decision|incident] [--importance low|medium|high] [--status open|active|resolved|archived] [--follow-up-by 2026-04-30] [--decision] [--related-projects a,b] [--tags a,b] [--default]
```

Exemplos:

```bash
kb "corrigi timeout no webhook"
kb "erro 401 no webhook" --kind bug --project n8n-automations
kb "padronizar deploy do backend" --note-type knowledge --importance high --related-projects fe-connect,wander-rag
kb "referencia do parser" --path ./knowledge-base/process-event-v2.mjs --tags parser,ingestion
```

Se `--kind` ou `--project` nao forem informados, o `kb` pergunta no terminal um parametro por vez e lista as opcoes numeradas para selecao. Use `--default` para aceitar a sugestao automatica sem interacao.

## Modelo do vault

O processor agora gera uma estrutura orientada a visualizacao e navegacao no `Obsidian`:

- `00 Home`: dashboards e entrada principal
- `10 Projects`: uma pagina-resumo por projeto
- `20 Inbox`: eventos brutos e logs diarios
- `30 Knowledge`: conhecimento consolidado
- `40 Decisions`: decisoes registradas
- `50 Incidents`: incidentes e bugs promovidos
- `60 Followups`: pendencias abertas
- `90 Assets`: anexos leves armazenados dentro do vault

Todas as notas novas usam frontmatter consistente com campos como:

- `type`
- `project`
- `source`
- `occurred_at`
- `importance`
- `status`
- `tags`
- `related`
- `canonical`

Notas manuais podem informar metadados extras:

- `--note-type`
- `--importance`
- `--status`
- `--follow-up-by`
- `--decision`
- `--related-projects`

## Política de anexos

- Até **10 MiB**: arquivo vai para `90 Assets/<slug>/YYYY/MM/` dentro do vault Git.
- Acima de **10 MiB**: arquivo vai para `/home/node/knowledge-vault-archive/<slug>/YYYY/MM/` fora do vault.
- A nota sempre registra metadados técnicos do anexo (`mode`, `path`, `size`, `sha256`).

## Fluxo de ingestão

1. `kb` envia `application/json` para o `KB_WEBHOOK_URL` com `x-kb-secret`; quando existe anexo, ele segue embutido no campo `attachment.data_b64`.
2. Workflow `knowledge-base-ingestion.json` normaliza payload + binário.
3. n8n executa `process-event-v2.mjs` via **stdin** (`--stdin-base64`) para evitar limite de `argv`.
4. Processor persiste `event notes`, dashboards, paginas de projeto e, quando aplicavel, promove conteudo para `knowledge`, `decision`, `incident` e `followup`.
5. O vault pode ser aberto direto no `Obsidian`, com `00 Home/Home.md` como entrada recomendada.

## Variáveis de ambiente relevantes

No host/CLI:

- `KB_WEBHOOK_URL` (obrigatória, endpoint `/kb-event`)
- `KB_WEBHOOK_SECRET` (obrigatória)
- `WEBHOOK_URL` (fallback para montar `KB_WEBHOOK_URL` automaticamente)

No processor (VPS):

- `KB_VAULT_PATH` (default `/home/node/knowledge-vault`)
- `KB_ARCHIVE_PATH` (default `/home/node/knowledge-vault-archive`)
- `KB_ATTACHMENT_MAX_VAULT_BYTES` (default `10485760`)
