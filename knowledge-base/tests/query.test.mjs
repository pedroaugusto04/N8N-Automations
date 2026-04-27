import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { queryKnowledgeBase } from '../dist/application/query-knowledge.js';

async function createEnvironment() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-query-'));
  const manifestPath = path.join(root, 'projects.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      projects: [
        {
          project_slug: 'n8n-automations',
          display_name: 'N8N Automations',
          workspace_slug: 'default',
          aliases: ['n8n'],
          enabled: true,
        },
      ],
    }),
  );
  const vaultRoot = path.join(root, 'vault', '20 Inbox', 'n8n-automations', '2026', '04');
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.writeFile(
    path.join(vaultRoot, 'deploy.md'),
    `---
id: "note-1"
type: "event"
workspace: "default"
project: "n8n-automations"
tags: ["deploy", "webhook"]
---

# Deploy rollout

## Resumo

Precisamos revisar o timeout do webhook e validar o rollout.
`,
  );
  await fs.writeFile(
    path.join(vaultRoot, 'reminder.md'),
    `---
id: "note-2"
type: "reminder"
workspace: "default"
project: "n8n-automations"
tags: ["reminder"]
---

# Reminder

Checar producao amanha.
`,
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
    allowedGroupId: '',
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

test('query returns ranked matches and fallback answer when AI is disabled', async () => {
  const env = await createEnvironment();
  const result = await queryKnowledgeBase(
    {
      query: 'timeout webhook deploy',
      mode: 'answer',
      projectSlug: 'n8n-automations',
      limit: 3,
    },
    env,
  );

  assert.equal(result.ok, true);
  assert.equal(result.matches.length, 1);
  assert.match(result.matches[0].title, /Deploy rollout/);
  assert.match(result.answer.answer, /Encontrei 1 nota/);
  assert.match(result.answer.citedPaths[0], /deploy\.md/);
});
