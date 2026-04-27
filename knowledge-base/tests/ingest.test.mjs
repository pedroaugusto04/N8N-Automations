import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ingestEntry } from '../dist/application/ingest-entry.js';

async function createEnvironment() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-ingest-'));
  const manifestPath = path.join(root, 'projects.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify({
      projects: [
        {
          project_slug: 'n8n-automations',
          display_name: 'N8N Automations',
          repo_full_name: 'pedroaugusto04/N8N-Automations',
          workspace_slug: 'default',
          aliases: ['n8n'],
          enabled: true,
          default_tags: ['automation'],
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
    attachmentMaxVaultBytes: 1024 * 1024,
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

test('ingest writes event, canonical, follow-up, reminder and dashboards', async () => {
  const env = await createEnvironment();
  const result = await ingestEntry(
    {
      schemaVersion: 1,
      source: {
        channel: 'n8n-workflow',
        system: 'test-suite',
        actor: 'tester',
        conversationId: 'conv',
        correlationId: 'corr-ingest',
      },
      event: {
        type: 'manual_note',
        occurredAt: '2026-04-27T10:00:00.000Z',
        projectSlug: 'n8n-automations',
      },
      content: {
        rawText: 'revisar rollout do deploy',
        title: 'Deploy rollout',
        attachments: [
          {
            fileName: 'sample.txt',
            mimeType: 'text/plain',
            sizeBytes: 11,
            dataBase64: Buffer.from('hello world').toString('base64'),
          },
        ],
        sections: {
          summary: 'Deploy needs coordinated rollout.',
          impact: 'Can affect webhook availability.',
          risks: ['Downtime'],
          nextSteps: ['Check production logs'],
          reviewFindings: [],
        },
      },
      classification: {
        kind: 'summary',
        canonicalType: 'knowledge',
        importance: 'medium',
        status: 'active',
        tags: ['deploy'],
        decisionFlag: false,
      },
      actions: {
        reminderDate: '2026-04-28',
        reminderTime: '09:30',
        followUpBy: '2026-04-29',
      },
      metadata: {},
    },
    env,
  );

  assert.equal(result.ok, true);
  assert.match(result.eventPath, /^20 Inbox\/n8n-automations\//);
  assert.match(result.canonicalPath, /^30 Knowledge\/n8n-automations\//);
  assert.match(result.followupPath, /^50 Followups\/n8n-automations\//);
  assert.match(result.reminderPath, /^60 Reminders\/n8n-automations\//);
  assert.equal(result.assetPaths.length, 1);

  const eventBody = await fs.readFile(path.join(env.vaultPath, result.eventPath), 'utf8');
  assert.match(eventBody, /## Texto original/);
  assert.match(eventBody, /Deploy needs coordinated rollout/);
  assert.match(eventBody, /workspace: "default"/);

  const reminderBody = await fs.readFile(path.join(env.vaultPath, result.reminderPath), 'utf8');
  assert.match(reminderBody, /2026-04-28 09:30/);

  const homeBody = await fs.readFile(path.join(env.vaultPath, '00 Home/Home.md'), 'utf8');
  assert.match(homeBody, /Projetos/);

  const projectBody = await fs.readFile(path.join(env.vaultPath, '10 Projects/n8n-automations.md'), 'utf8');
  assert.match(projectBody, /Entradas recentes/);
});
