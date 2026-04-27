import path from 'node:path';

export type RuntimeEnvironment = {
  vaultPath: string;
  archivePath: string;
  manifestPath: string;
  workspacesManifestPath: string;
  webhookSecret: string;
  githubWebhookSecret: string;
  attachmentMaxVaultBytes: number;
  conversationTimeoutMs: number;
  reviewAiProvider: 'openrouter' | 'openai' | 'none';
  reviewAiBaseUrl: string;
  reviewAiModel: string;
  reviewAiApiKey: string;
  conversationAiProvider: 'openrouter' | 'openai' | 'none';
  conversationAiBaseUrl: string;
  conversationAiModel: string;
  conversationAiApiKey: string;
  githubApiToken: string;
  enableGitPush: boolean;
  gitBatchMode: boolean;
  vaultRemoteUrl: string;
  gitUserName: string;
  gitUserEmail: string;
  gitPushUsername: string;
  gitPushToken: string;
  allowedGroupId: string;
  publicBaseUrl: string;
  githubPushWebhookPath: string;
  ingestWebhookPath: string;
  whatsappWebhookPath: string;
  onboardingWebhookPath: string;
  queryWebhookPath: string;
  githubAppInstallUrl: string;
  whatsappPairingUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  evolutionApiKey: string;
  evolutionApiUrl: string;
  evolutionApiPublicUrl: string;
  evolutionInstanceName: string;
};

export function readEnvironment(env = process.env): RuntimeEnvironment {
  const basePath = process.cwd();
  return {
    vaultPath: env.KB_VAULT_PATH || path.resolve(basePath, '../knowledge-vault'),
    archivePath: env.KB_ARCHIVE_PATH || path.resolve(basePath, '../knowledge-vault-archive'),
    manifestPath: env.KB_PROJECTS_MANIFEST || path.join(basePath, 'projects.json'),
    workspacesManifestPath: env.KB_WORKSPACES_MANIFEST || path.join(basePath, 'workspaces.json'),
    webhookSecret: String(env.KB_WEBHOOK_SECRET || '').trim(),
    githubWebhookSecret: String(env.KB_GITHUB_APP_WEBHOOK_SECRET || '').trim(),
    attachmentMaxVaultBytes: Number(env.KB_ATTACHMENT_MAX_VAULT_BYTES || 10 * 1024 * 1024),
    conversationTimeoutMs: Number(env.WPP_CONVERSATION_TIMEOUT_MS || 600_000),
    reviewAiProvider: (String(env.KB_REVIEW_AI_PROVIDER || 'openrouter').trim().toLowerCase() as RuntimeEnvironment['reviewAiProvider']),
    reviewAiBaseUrl: String(env.KB_REVIEW_AI_BASE_URL || 'https://openrouter.ai/api/v1').trim(),
    reviewAiModel: String(env.KB_REVIEW_AI_MODEL || 'openrouter/auto').trim(),
    reviewAiApiKey: String(env.KB_REVIEW_AI_API_KEY || '').trim(),
    conversationAiProvider: (String(env.KB_CONVERSATION_AI_PROVIDER || env.KB_REVIEW_AI_PROVIDER || 'openrouter').trim().toLowerCase() as RuntimeEnvironment['conversationAiProvider']),
    conversationAiBaseUrl: String(env.KB_CONVERSATION_AI_BASE_URL || env.KB_REVIEW_AI_BASE_URL || 'https://openrouter.ai/api/v1').trim(),
    conversationAiModel: String(env.KB_CONVERSATION_AI_MODEL || env.KB_REVIEW_AI_MODEL || 'openrouter/auto').trim(),
    conversationAiApiKey: String(env.KB_CONVERSATION_AI_API_KEY || env.KB_REVIEW_AI_API_KEY || '').trim(),
    githubApiToken: String(env.KB_GITHUB_API_TOKEN || '').trim(),
    enableGitPush: String(env.KB_ENABLE_GIT_PUSH || 'false').toLowerCase() === 'true',
    gitBatchMode: String(env.KB_GIT_BATCH_MODE || 'true').toLowerCase() === 'true',
    vaultRemoteUrl: String(env.KB_VAULT_REMOTE_URL || '').trim(),
    gitUserName: String(env.KB_VAULT_GIT_USER_NAME || 'knowledge-bot').trim(),
    gitUserEmail: String(env.KB_VAULT_GIT_USER_EMAIL || 'knowledge-bot@example.local').trim(),
    gitPushUsername: String(env.KB_VAULT_GIT_PUSH_USERNAME || '').trim(),
    gitPushToken: String(env.KB_VAULT_GIT_PUSH_TOKEN || '').trim(),
    allowedGroupId: String(env.WPP_KB_GROUP_JID || '').trim(),
    publicBaseUrl: String(env.KB_PUBLIC_BASE_URL || env.WEBHOOK_URL || '').trim().replace(/\/$/, ''),
    githubPushWebhookPath: String(env.KB_GITHUB_WEBHOOK_PATH || '/n8n/webhook/kb-github-push').trim(),
    ingestWebhookPath: String(env.KB_INGEST_WEBHOOK_PATH || '/n8n/webhook/kb-event').trim(),
    whatsappWebhookPath: String(env.KB_WPP_WEBHOOK_PATH || '/n8n/webhook/whatsapp-kb-event').trim(),
    onboardingWebhookPath: String(env.KB_ONBOARDING_WEBHOOK_PATH || '/n8n/webhook/kb-onboarding').trim(),
    queryWebhookPath: String(env.KB_QUERY_WEBHOOK_PATH || '/n8n/webhook/kb-query').trim(),
    githubAppInstallUrl: String(env.KB_GITHUB_APP_INSTALL_URL || '').trim(),
    whatsappPairingUrl: String(env.KB_WPP_PAIRING_URL || '').trim(),
    telegramBotToken: String(env.KB_TELEGRAM_BOT_TOKEN || '').trim(),
    telegramChatId: String(env.KB_TELEGRAM_CHAT_ID || '').trim(),
    evolutionApiKey: String(env.EVOLUTION_API_KEY || '').trim(),
    evolutionApiUrl: String(env.EVOLUTION_API_URL || '').trim(),
    evolutionApiPublicUrl: String(env.EVOLUTION_API_PUBLIC_URL || '').trim(),
    evolutionInstanceName: String(env.EVOLUTION_INSTANCE_NAME || '').trim(),
  };
}
