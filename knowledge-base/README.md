# Knowledge Base Automation

Fluxo oficial: **WhatsApp-first** via grupo dedicado do WhatsApp + webhook no n8n usando um vault otimizado para `Obsidian`.

## Fluxo WhatsApp (principal)

Envie uma mensagem no grupo do WhatsApp configurado e o bot conduz a conversa:

```
Você: "corrigi timeout no webhook do n8n"

Bot: ✏️ Nova nota recebida!
     "corrigi timeout no webhook do n8n"
     Sugestão de tipo: bug
     1. Anotação geral
     2. Erro / falha / incidente
     3. Resumo / síntese
     4. Artigo / tutorial / documentação
     5. Diário / standup
     Responda com o número ou o nome.

Você: 2

Bot: Tipo: Erro / falha / incidente ✓
     Qual o projeto?
     1. Fe-Connect
     2. n8n
     ...

Você: n8n

Bot: Projeto: n8n-automations ✓
     Deseja agendar um lembrete?
     Envie a data (DD/MM/AAAA, "hoje", "amanhã")
     ou "pular" para seguir sem lembrete.

Você: pular

Bot: 📋 Resumo da nota:
     Texto: corrigi timeout no webhook do n8n
     Tipo: Erro / falha / incidente
     Projeto: n8n-automations
     Lembrete: Sem lembrete
     Confirma? (sim/não/cancelar)

Você: sim

Bot: ✅ Nota salva no vault!
     Projeto: n8n-automations
     Tipo: bug
```

### Comandos especiais

- `cancelar` — interrompe a conversa atual
- `pular` / `skip` — pula campo opcional e usa o padrão
- `sim` / `confirmar` — confirma e envia a nota
- `não` — descarta a nota na fase de confirmação

### IA (opcional)

Se `KB_OPENAI_API_KEY` ou `KB_GEMINI_API_KEY` estiverem configuradas, o bot tenta extrair todos os campos automaticamente da primeira mensagem. Se conseguir, pula direto para confirmação.

## Modelo do vault

O processor gera uma estrutura orientada a visualização e navegação no `Obsidian`:

- `00 Home`: dashboards e entrada principal
- `10 Projects`: uma pagina-resumo por projeto
- `20 Inbox`: eventos brutos e logs diarios
- `30 Knowledge`: conhecimento consolidado
- `40 Actions`: followups, lembretes e incidentes
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

## Fluxo de ingestão

1. Usuário envia mensagem no grupo do WhatsApp.
2. Evolution API repassa para o webhook `whatsapp-kb-event` no n8n.
3. Workflow `knowledge-base-whatsapp.json` filtra, roda `whatsapp-conversation.mjs` e conduz a conversa.
4. Quando a nota está completa, monta payload `manual_note` e chama `process-event-v2.mjs`.
5. Processor persiste event notes, dashboards, páginas de projeto e, quando aplicável, promove conteúdo para knowledge, decision, incident e followup.
6. Quando existe `reminder_date`, o processor cria uma nota em `40 Actions/` e ela alimenta o workflow `knowledge-base-reminders.json`.
7. Lembretes são enviados de volta no grupo do WhatsApp (diários às 09:00 e exatos no horário agendado).
8. O vault pode ser aberto direto no `Obsidian`, com `00 Home/Home.md` como entrada recomendada.

## Setup inicial

### 1. Evolution API

A Evolution API roda no Docker Compose junto ao n8n:

```bash
# Configurar .env com as variáveis necessárias
EVOLUTION_API_KEY=sua-chave-segura
EVOLUTION_API_PORT=8081
EVOLUTION_API_URL=http://127.0.0.1:8081
EVOLUTION_API_PUBLIC_URL=https://seu-dominio:8081
EVOLUTION_INSTANCE_NAME=kb-bot
WPP_KB_GROUP_JID=ID-DO-GRUPO@g.us

# Subir os containers
docker compose up -d
```

### 2. Criar instância e conectar WhatsApp

```bash
# Criar instância na Evolution API
curl -X POST "https://seu-dominio:8081/instance/create" \
  -H "apikey: SUA_EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"instanceName": "kb-bot", "integration": "WHATSAPP-BAILEYS"}'

# Gerar QR code para parear
curl -X GET "https://seu-dominio:8081/instance/connect/kb-bot" \
  -H "apikey: SUA_EVOLUTION_API_KEY"
```

Escaneie o QR code com seu WhatsApp.

### 3. Configurar webhook na Evolution API

```bash
curl -X POST "https://seu-dominio:8081/webhook/set/kb-bot" \
  -H "apikey: SUA_EVOLUTION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "https://seu-dominio/n8n/webhook/whatsapp-kb-event",
      "webhookByEvents": false,
      "events": ["MESSAGES_UPSERT"]
    }
  }'
```

Use o path simples `/n8n/webhook/whatsapp-kb-event`. Nao reutilize URLs antigas com `workflowId` ou com o nome do node no caminho, porque elas podem deixar de existir depois de reimportar, duplicar ou recriar o workflow.

### 4. Obter o JID do grupo

Crie um grupo no WhatsApp e envie uma mensagem teste. Verifique os logs do workflow n8n para capturar o `remoteJid` (formato `120363XXX@g.us`). Configure `WPP_KB_GROUP_JID` no `.env`.

## Variáveis de ambiente relevantes

No host/Docker:

- `EVOLUTION_API_KEY` (obrigatória, chave da Evolution API)
- `EVOLUTION_API_URL` (obrigatória, URL usada pelo n8n; com `network_mode: host`, use a porta publicada no host)
- `EVOLUTION_API_PUBLIC_URL` (obrigatória, URL pública para acesso externo)
- `EVOLUTION_INSTANCE_NAME` (nome da instância, ex: `kb-bot`)
- `WPP_KB_GROUP_JID` (obrigatória, JID do grupo do WhatsApp)
- `WPP_CONVERSATION_TIMEOUT_MS` (timeout da conversa, default `600000` = 10min)
- `KB_WEBHOOK_SECRET` (obrigatória para ingestion)

No processor (VPS):

- `KB_VAULT_PATH` (default `/home/node/knowledge-vault`)
- `KB_ARCHIVE_PATH` (default `/home/node/knowledge-vault-archive`)
- `KB_AI_PROVIDER` (openai ou gemini, para extração automática de campos)
- `KB_OPENAI_API_KEY` / `KB_GEMINI_API_KEY` (opcional, melhora extração)
