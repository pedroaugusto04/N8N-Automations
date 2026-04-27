import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildReminderDispatch, markRemindersAsSent } from '../dist/application/reminders.js';

async function createEnvironmentWithReminder() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-reminders-'));
  const reminderRoot = path.join(root, 'vault', '60 Reminders', 'n8n-automations', '2026', '04');
  await fs.mkdir(reminderRoot, { recursive: true });
  await fs.writeFile(
    path.join(reminderRoot, 'reminder.md'),
    `---
id: "r1"
type: "reminder"
project: "n8n-automations"
status: "open"
reminder_date: "2099-12-31"
reminder_time: "09:00"
reminder_at: "2099-12-31T09:00:00-03:00"
---

# Reminder deploy
`,
  );
  return {
    vaultPath: path.join(root, 'vault'),
    archivePath: path.join(root, 'archive'),
    manifestPath: path.join(root, 'projects.json'),
    workspacesManifestPath: path.join(root, 'workspaces.json'),
    webhookSecret: '',
    githubWebhookSecret: '',
    attachmentMaxVaultBytes: 0,
    conversationTimeoutMs: 0,
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
    gitUserName: '',
    gitUserEmail: '',
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

test('daily reminders are aggregated once per date', async () => {
  const env = await createEnvironmentWithReminder();
  const result = await buildReminderDispatch('daily', env);
  assert.equal(result.ok, true);
  assert.equal(typeof result.shouldSend, 'boolean');
});

test('markRemindersAsSent updates exact reminder state', async () => {
  const env = await createEnvironmentWithReminder();
  const result = await markRemindersAsSent(['r1'], env);
  assert.equal(result.ok, true);
  assert.equal(result.marked, 1);
});
