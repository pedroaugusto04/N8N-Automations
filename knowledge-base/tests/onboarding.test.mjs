import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runOnboarding } from '../dist/application/onboarding.js';

async function createEnvironment() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-onboarding-'));
  const manifestPath = path.join(root, 'projects.json');
  const workspacesManifestPath = path.join(root, 'workspaces.json');
  await fs.writeFile(manifestPath, JSON.stringify({ projects: [] }), 'utf8');
  await fs.writeFile(workspacesManifestPath, JSON.stringify({ workspaces: [] }), 'utf8');
  return {
    vaultPath: path.join(root, 'vault'),
    archivePath: path.join(root, 'archive'),
    manifestPath,
    workspacesManifestPath,
    webhookSecret: '',
    githubWebhookSecret: 'secret',
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
    githubAppInstallUrl: 'https://github.com/apps/knowledge-base/installations/new',
    whatsappPairingUrl: 'https://example.com/connect-whatsapp',
  };
}

test('onboarding upserts workspace and projects and returns setup links', async () => {
  const env = await createEnvironment();
  const result = await runOnboarding(
    {
      operation: 'upsert',
      workspaceSlug: 'acme-team',
      displayName: 'Acme Team',
      whatsappGroupJid: '120363000000000@g.us',
      githubRepos: ['acme/api'],
      projects: [
        {
          projectSlug: 'acme-api',
          displayName: 'Acme API',
          repoFullName: 'acme/api',
          aliases: ['api'],
          defaultTags: ['backend'],
        },
      ],
    },
    env,
  );

  assert.equal(result.ok, true);
  assert.equal(result.workspace.workspaceSlug, 'acme-team');
  assert.equal(result.statuses.overallReady, true);
  assert.equal(result.workspace.projects[0].projectSlug, 'acme-api');
  assert.match(result.links.githubInstallUrl, /github\.com\/apps/);
  assert.match(result.links.queryWebhookUrl, /kb-query/);
});
