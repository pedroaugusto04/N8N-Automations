import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { processConversation } from '../dist/application/whatsapp-conversation.js';

async function createEnvironment() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-conversation-'));
  const manifestPath = path.join(root, 'projects.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      projects: [
        {
          project_slug: 'n8n-automations',
          display_name: 'N8N Automations',
          aliases: ['n8n'],
          enabled: true,
        },
      ],
    }),
  );
  return {
    vaultPath: path.join(root, 'vault'),
    archivePath: path.join(root, 'archive'),
    manifestPath,
    workspacesManifestPath: path.join(root, 'workspaces.json'),
    webhookSecret: '',
    githubWebhookSecret: '',
    attachmentMaxVaultBytes: 1024,
    conversationTimeoutMs: 60000,
    reviewAiProvider: 'none',
    reviewAiBaseUrl: '',
    reviewAiModel: '',
    reviewAiApiKey: '',
    conversationAiProvider: 'none',
    conversationAiBaseUrl: '',
    conversationAiModel: '',
    conversationAiApiKey: '',
    githubApiToken: '',
    enableGitPush: false,
    gitBatchMode: true,
    vaultRemoteUrl: '',
    gitUserName: 'tester',
    gitUserEmail: 'tester@example.com',
    gitPushUsername: '',
    gitPushToken: '',
    allowedGroupId: 'group@g.us',
    publicBaseUrl: 'https://example.com',
    githubPushWebhookPath: '/n8n/webhook/kb-github-push',
    ingestWebhookPath: '/n8n/webhook/kb-event',
    whatsappWebhookPath: '/n8n/webhook/whatsapp-kb-event',
    onboardingWebhookPath: '/n8n/webhook/kb-onboarding',
    queryWebhookPath: '/n8n/webhook/kb-query',
    githubAppInstallUrl: 'https://github.com/apps/example/installations/new',
    whatsappPairingUrl: 'https://example.com/connect-whatsapp',
  };
}

function input(messageText, extras = {}) {
  return {
    messageText,
    senderId: '5511999999999@s.whatsapp.net',
    groupId: 'group@g.us',
    messageId: `msg-${Date.now()}-${Math.random()}`,
    hasMedia: false,
    media: {},
    ...extras,
  };
}

test('whatsapp conversation asks only missing fields and emits canonical payload on confirm', async () => {
  const env = await createEnvironment();

  const step1 = await processConversation(
    input('corrigi timeout no webhook', {
      agentResult: {
        extracted: {
          rawText: 'corrigi timeout no webhook',
          kind: 'bug',
          projectSlug: 'n8n',
          importance: 'high',
        },
        missingFields: ['reminderDate', 'confirmation'],
        confidence: 'high',
      },
    }),
    env,
  );
  assert.equal(step1.action, 'reply');
  assert.match(step1.replyText, /lembrete/i);

  const step2 = await processConversation(input('9'), env);
  assert.equal(step2.action, 'reply');
  assert.match(step2.replyText, /Resumo da nota/);
  assert.match(step2.replyText, /bug/);

  const step3 = await processConversation(input('sim'), env);
  assert.equal(step3.action, 'submit');
  assert.equal(step3.payload.event.projectSlug, 'n8n-automations');
  assert.equal(step3.payload.classification.kind, 'bug');
  assert.equal(step3.payload.classification.canonicalType, 'incident');
});

test('whatsapp conversation answers explicit knowledge queries without starting capture flow', async () => {
  const env = await createEnvironment();
  await fs.mkdir(path.join(env.vaultPath, '20 Inbox', 'n8n-automations', '2026', '04'), { recursive: true });
  await fs.writeFile(
    path.join(env.vaultPath, '20 Inbox', 'n8n-automations', '2026', '04', 'deploy.md'),
    `---
id: "q1"
type: "event"
workspace: ""
project: "n8n-automations"
tags: ["deploy", "n8n-automations"]
---

# Deploy checklist

## Resumo

Revisar timeout e validar webhook em producao.
`,
  );

  const result = await processConversation(input('/buscar deploy webhook'), env);
  assert.equal(result.action, 'reply');
  assert.match(result.replyText, /deploy/i);
  assert.match(result.replyText, /20 Inbox\/n8n-automations\//);
});
