# Knowledge Base

`knowledge-base/` agora é um pacote **code-first**. O domínio do produto fica em código TypeScript; o n8n, quando usado, é apenas adapter fino para webhooks e integrações.

## Arquitetura

- `src/domain`: regras puras, tipos, renderização de notas e mensagens
- `src/application`: casos de uso (`ingest`, `github review`, `reminders`, `conversation`, `onboarding`, `query`)
- `src/adapters`: AI, GitHub, git, IO e ambiente
- `src/cli`: entrypoints executáveis pelo n8n ou por outros runners
- `workflows/`: adapters opcionais do n8n
- `tests/`: contratos, conversa, persistência, reminders, review e smoke dos adapters

## Capacidades novas

### 1. Onboarding de workspace

O produto agora tem um onboarding explícito para:

- registrar `workspace`
- vincular `grupo do WhatsApp`
- declarar `repositorios GitHub`
- cadastrar `projetos` do workspace
- devolver links e checklist de setup

Entrada padrão:

```json
{
  "operation": "upsert",
  "workspaceSlug": "acme-team",
  "displayName": "Acme Team",
  "whatsappGroupJid": "120363000000000@g.us",
  "githubRepos": ["acme/api"],
  "projects": [
    {
      "projectSlug": "acme-api",
      "displayName": "Acme API",
      "repoFullName": "acme/api",
      "aliases": ["api"],
      "defaultTags": ["backend"]
    }
  ]
}
```

Entry points:

- `dist/cli/onboarding.js`
- workflow opcional `workflows/kb-onboarding.json`

Manifestos usados:

- `projects.json`
- `workspaces.json`

### 2. Consulta sobre a base

Existe agora uma camada inicial de busca/consulta sobre o vault:

- ranking determinístico por título, tags, caminho e conteúdo
- filtro por `workspaceSlug` e `projectSlug`
- resposta consolidada por IA quando configurada
- fallback sem IA com resumo e citações dos arquivos

Entrada padrão:

```json
{
  "query": "timeout webhook deploy",
  "mode": "answer",
  "projectSlug": "n8n-automations",
  "limit": 5
}
```

Entry points:

- `dist/cli/query.js`
- workflow opcional `workflows/kb-query.json`

No WhatsApp, a consulta pode ser feita sem abrir o fluxo de captura usando comandos explícitos:

- `/buscar deploy webhook`
- `/consultar o que decidimos sobre reminders?`
- `/perguntar quais foram os riscos do ultimo push?`

## Como o produto conecta WhatsApp e Git push

### WhatsApp do usuário

Recomendação para vender o produto:

1. Cada cliente recebe uma instância dedicada do provedor de WhatsApp.
2. A opção mais simples hoje é manter uma instância `Evolution API` por tenant ou por ambiente controlado.
3. O usuário conecta o WhatsApp escaneando um QR code da própria instância.
4. O grupo ou número autorizado vira a origem oficial de captura manual.
5. O webhook do provedor chama o adapter `kb-whatsapp-entry`.

Fluxo operacional:

- mensagem chega via WhatsApp
- adapter baixa mídia se existir
- CLI de conversa interpreta o texto com OpenRouter
- o core pergunta só o que falta
- ao confirmar, o core gera o payload canônico e persiste no vault

### Git push do usuário

Recomendação para vender o produto:

1. Criar um **GitHub App** do produto.
2. Cada cliente instala o app nos repositórios desejados.
3. O GitHub envia `push` para o endpoint `kb-github-push`.
4. O core coleta diff/commits, gera o review por IA, salva no Obsidian e retorna uma mensagem pronta para Telegram.
5. O adapter envia o review resumido no Telegram.

Isso é melhor do que pedir token manual por repositório porque:

- escala melhor para SaaS
- reduz fricção de setup
- facilita controle de permissões
- evita automação por repo isolado

## Modelo recomendado para vender

Melhor modelo:

- **core multi-tenant code-first**
- **GitHub App** para eventos de código
- **instância WhatsApp por cliente** ou por workspace
- **Telegram opcional** para notificações operacionais
- **n8n opcional** apenas como adapter onde ele acelerar integrações

Recomendação de produto:

- backend principal em código
- contratos JSON versionados
- cobrança por workspace/tenant
- conectores como recursos plugáveis

O que eu recomendo evitar:

- workflow visual como coração do produto
- segredos presos em credenciais internas do n8n
- regras de negócio dentro de nodes `Code`

## Segredos e configuração

Todos os segredos relevantes ficam em `.env` na VPS e nunca no GitHub:

- OpenRouter
- GitHub webhook secret
- GitHub token de leitura
- Telegram bot token/chat
- Evolution API key
- vault remote URL e credenciais de push

Os workflows do n8n devem usar apenas `{{$env.*}}` para segredos.

## CLIs principais

- `dist/cli/ingest.js`
- `dist/cli/conversation.js`
- `dist/cli/github-push.js`
- `dist/cli/onboarding.js`
- `dist/cli/query.js`
- `dist/cli/reminders.js`
- `dist/cli/batch-flush.js`

## Build e testes

```bash
npm --prefix knowledge-base install
npm --prefix knowledge-base test
```

## Workflows opcionais

Os adapters em `knowledge-base/workflows/` fazem apenas:

- receber webhook
- transformar payload de borda
- chamar CLI do core
- enviar resposta para WhatsApp/Telegram

Workflows adicionais disponíveis:

- `kb-onboarding.json`
- `kb-query.json`

Se você quiser remover completamente o n8n no futuro, o core já está preparado para isso.
