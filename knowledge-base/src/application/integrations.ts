import { Injectable } from '@nestjs/common';

import { readEnvironment, type RuntimeEnvironment } from '../adapters/environment.js';
import type { Project } from '../domain/projects.js';
import type { Workspace } from '../domain/workspaces.js';
import { ProjectRepository, WorkspaceRepository } from './ports/repositories.js';

export type IntegrationStatusValue = 'connected' | 'partial' | 'missing';

export type IntegrationLink = {
  label: string;
  url: string;
  external: boolean;
};

export type IntegrationStatus = {
  id: string;
  name: string;
  description: string;
  status: IntegrationStatusValue;
  requiredEnv: string[];
  configuredEnv: string[];
  missingEnv: string[];
  links: IntegrationLink[];
  checklist: string[];
  warnings: string[];
};

function configuredEnv(env: Record<string, boolean>): string[] {
  return Object.entries(env)
    .filter(([, configured]) => configured)
    .map(([name]) => name);
}

function missingEnv(env: Record<string, boolean>): string[] {
  return Object.entries(env)
    .filter(([, configured]) => !configured)
    .map(([name]) => name);
}

function statusFromFlags(flags: boolean[]): IntegrationStatusValue {
  if (flags.every(Boolean)) return 'connected';
  if (flags.some(Boolean)) return 'partial';
  return 'missing';
}

function absoluteUrl(baseUrl: string, pathname: string): string {
  if (!baseUrl) return pathname;
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${baseUrl}${normalizedPath}`;
}

function link(label: string, url: string, external = true): IntegrationLink {
  return { label, url, external };
}

function workspaceRepos(workspace: Workspace | undefined, projects: Project[]): string[] {
  const workspaceProjectRepos = projects
    .filter((project) => !workspace || project.workspaceSlug === workspace.workspaceSlug || workspace.projectSlugs.includes(project.projectSlug))
    .map((project) => project.repoFullName)
    .filter(Boolean);
  return Array.from(new Set([...(workspace?.githubRepos || []), ...workspaceProjectRepos]));
}

function secretConfigured(value: string): boolean {
  return Boolean(value.trim());
}

export function buildIntegrationStatuses(input: {
  environment: RuntimeEnvironment;
  workspaces: Workspace[];
  projects: Project[];
}): { ok: true; workspaceSlug: string; integrations: IntegrationStatus[] } {
  const { environment, workspaces, projects } = input;
  const workspace = workspaces[0];
  const workspaceSlug = workspace?.workspaceSlug || 'default';
  const repos = workspaceRepos(workspace, projects);
  const workspaceWhatsappGroup = Boolean(workspace?.whatsappGroupJid);
  const workspaceTelegramChat = Boolean(workspace?.telegramChatId);

  const githubEnv = {
    KB_GITHUB_APP_INSTALL_URL: Boolean(environment.githubAppInstallUrl),
    KB_GITHUB_APP_WEBHOOK_SECRET: secretConfigured(environment.githubWebhookSecret),
    KB_GITHUB_API_TOKEN: secretConfigured(environment.githubApiToken),
  };
  const githubFlags = [...Object.values(githubEnv), repos.length > 0];

  const webhookEnv = {
    KB_PUBLIC_BASE_URL: Boolean(environment.publicBaseUrl),
    KB_GITHUB_WEBHOOK_PATH: Boolean(environment.githubPushWebhookPath),
    KB_INGEST_WEBHOOK_PATH: Boolean(environment.ingestWebhookPath),
    KB_WPP_WEBHOOK_PATH: Boolean(environment.whatsappWebhookPath),
    KB_ONBOARDING_WEBHOOK_PATH: Boolean(environment.onboardingWebhookPath),
    KB_QUERY_WEBHOOK_PATH: Boolean(environment.queryWebhookPath),
  };
  const webhookLinks = [
    link('GitHub push webhook', absoluteUrl(environment.publicBaseUrl, environment.githubPushWebhookPath), Boolean(environment.publicBaseUrl)),
    link('Ingest webhook', absoluteUrl(environment.publicBaseUrl, environment.ingestWebhookPath), Boolean(environment.publicBaseUrl)),
    link('WhatsApp webhook', absoluteUrl(environment.publicBaseUrl, environment.whatsappWebhookPath), Boolean(environment.publicBaseUrl)),
    link('Onboarding webhook', absoluteUrl(environment.publicBaseUrl, environment.onboardingWebhookPath), Boolean(environment.publicBaseUrl)),
    link('Query webhook', absoluteUrl(environment.publicBaseUrl, environment.queryWebhookPath), Boolean(environment.publicBaseUrl)),
  ];

  const evolutionConfigured = Boolean(environment.evolutionApiUrl && environment.evolutionInstanceName && environment.evolutionApiKey);
  const whatsappEnv = {
    KB_WPP_PAIRING_URL: Boolean(environment.whatsappPairingUrl),
    EVOLUTION_API_URL: Boolean(environment.evolutionApiUrl),
    EVOLUTION_INSTANCE_NAME: Boolean(environment.evolutionInstanceName),
    EVOLUTION_API_KEY: secretConfigured(environment.evolutionApiKey),
    WPP_KB_GROUP_JID: Boolean(environment.allowedGroupId),
  };
  const whatsappTransport = Boolean(environment.whatsappPairingUrl) || evolutionConfigured;
  const whatsappGroup = Boolean(environment.allowedGroupId) || workspaceWhatsappGroup;

  const telegramEnv = {
    KB_TELEGRAM_BOT_TOKEN: secretConfigured(environment.telegramBotToken),
    KB_TELEGRAM_CHAT_ID: Boolean(environment.telegramChatId),
  };
  const telegramChat = Boolean(environment.telegramChatId) || workspaceTelegramChat;

  const reviewAiActive = environment.reviewAiProvider !== 'none';
  const conversationAiActive = environment.conversationAiProvider !== 'none';
  const aiEnv = {
    KB_REVIEW_AI_PROVIDER: reviewAiActive,
    KB_REVIEW_AI_BASE_URL: reviewAiActive ? Boolean(environment.reviewAiBaseUrl) : true,
    KB_REVIEW_AI_MODEL: reviewAiActive ? Boolean(environment.reviewAiModel) : true,
    KB_REVIEW_AI_API_KEY: reviewAiActive ? secretConfigured(environment.reviewAiApiKey) : true,
    KB_CONVERSATION_AI_PROVIDER: conversationAiActive,
    KB_CONVERSATION_AI_BASE_URL: conversationAiActive ? Boolean(environment.conversationAiBaseUrl) : true,
    KB_CONVERSATION_AI_MODEL: conversationAiActive ? Boolean(environment.conversationAiModel) : true,
    KB_CONVERSATION_AI_API_KEY: conversationAiActive ? secretConfigured(environment.conversationAiApiKey) : true,
  };
  const aiFlags = [reviewAiActive || conversationAiActive, ...Object.values(aiEnv)];

  const vaultEnv = {
    KB_VAULT_PATH: Boolean(environment.vaultPath),
    KB_ENABLE_GIT_PUSH: environment.enableGitPush,
    KB_VAULT_REMOTE_URL: Boolean(environment.vaultRemoteUrl),
    KB_VAULT_GIT_PUSH_USERNAME: Boolean(environment.gitPushUsername),
    KB_VAULT_GIT_PUSH_TOKEN: secretConfigured(environment.gitPushToken),
  };
  const vaultRemoteReady = environment.enableGitPush && Boolean(environment.vaultRemoteUrl && environment.gitPushUsername && environment.gitPushToken);

  return {
    ok: true,
    workspaceSlug,
    integrations: [
      {
        id: 'github-app',
        name: 'GitHub App',
        description: 'Instalacao do app, webhook assinado e token de leitura para reviews de push.',
        status: statusFromFlags(githubFlags),
        requiredEnv: Object.keys(githubEnv),
        configuredEnv: configuredEnv(githubEnv),
        missingEnv: missingEnv(githubEnv),
        links: environment.githubAppInstallUrl ? [link('Instalar GitHub App', environment.githubAppInstallUrl)] : [],
        checklist: [
          'Instalar o GitHub App nos repositorios do workspace.',
          'Configurar o webhook do app para o endpoint de GitHub push.',
          'Cadastrar repositorios no onboarding ou manifesto do workspace.',
        ],
        warnings: [
          !environment.githubWebhookSecret ? 'Webhook do GitHub sem secret configurado.' : '',
          !environment.githubApiToken ? 'Token de API do GitHub ausente para coletar diffs e commits.' : '',
          repos.length === 0 ? 'Workspace sem repositorio vinculado.' : '',
        ].filter(Boolean),
      },
      {
        id: 'webhooks',
        name: 'Webhooks',
        description: 'URLs publicas usadas por n8n, GitHub, WhatsApp, onboarding e consulta.',
        status: statusFromFlags(Object.values(webhookEnv)),
        requiredEnv: Object.keys(webhookEnv),
        configuredEnv: configuredEnv(webhookEnv),
        missingEnv: missingEnv(webhookEnv),
        links: webhookLinks,
        checklist: [
          'Publicar a API por uma URL HTTPS estavel.',
          'Apontar os workflows/adapters para os paths exibidos.',
          'Usar o mesmo base URL nos provedores externos.',
        ],
        warnings: !environment.publicBaseUrl ? ['KB_PUBLIC_BASE_URL ausente: exibindo paths relativos, nao URLs absolutas.'] : [],
      },
      {
        id: 'whatsapp',
        name: 'WhatsApp',
        description: 'Pairing ou Evolution API para captura e resposta no grupo autorizado.',
        status: statusFromFlags([whatsappTransport, whatsappGroup]),
        requiredEnv: Object.keys(whatsappEnv),
        configuredEnv: configuredEnv(whatsappEnv),
        missingEnv: missingEnv(whatsappEnv),
        links: [
          environment.whatsappPairingUrl ? link('Abrir pairing', environment.whatsappPairingUrl) : null,
          environment.evolutionApiPublicUrl ? link('Evolution API', environment.evolutionApiPublicUrl) : null,
        ].filter(Boolean) as IntegrationLink[],
        checklist: [
          'Conectar a conta pelo pairing ou configurar Evolution API.',
          'Autorizar o grupo do workspace por JID.',
          'Configurar o webhook do provedor para o path de WhatsApp.',
        ],
        warnings: [
          !whatsappTransport ? 'Sem pairing URL e sem Evolution API completa.' : '',
          !whatsappGroup ? 'Nenhum grupo autorizado em WPP_KB_GROUP_JID ou no workspace.' : '',
        ].filter(Boolean),
      },
      {
        id: 'telegram',
        name: 'Telegram',
        description: 'Bot e chat usados para notificacoes de ingest, reviews e falhas operacionais.',
        status: statusFromFlags([telegramEnv.KB_TELEGRAM_BOT_TOKEN, telegramChat]),
        requiredEnv: Object.keys(telegramEnv),
        configuredEnv: configuredEnv(telegramEnv),
        missingEnv: missingEnv(telegramEnv),
        links: [],
        checklist: [
          'Criar ou reutilizar um bot do Telegram.',
          'Adicionar o bot ao chat operacional.',
          'Configurar o chat ID global ou no workspace.',
        ],
        warnings: [
          !environment.telegramBotToken ? 'Bot token do Telegram ausente.' : '',
          !telegramChat ? 'Chat ID do Telegram ausente no env e no workspace.' : '',
        ].filter(Boolean),
      },
      {
        id: 'ai',
        name: 'AI',
        description: 'Providers e modelos para reviews de codigo e conversa no WhatsApp.',
        status: statusFromFlags(aiFlags),
        requiredEnv: Object.keys(aiEnv),
        configuredEnv: configuredEnv(aiEnv),
        missingEnv: missingEnv(aiEnv),
        links: [],
        checklist: [
          'Escolher provider diferente de none quando IA estiver habilitada.',
          'Definir modelo e base URL para cada fluxo ativo.',
          'Configurar a API key correspondente ao provider.',
        ],
        warnings: [
          !reviewAiActive && !conversationAiActive ? 'Providers de IA estao como none.' : '',
          reviewAiActive && !environment.reviewAiApiKey ? 'Review AI ativo sem API key.' : '',
          conversationAiActive && !environment.conversationAiApiKey ? 'Conversation AI ativo sem API key.' : '',
        ].filter(Boolean),
      },
      {
        id: 'vault-git',
        name: 'Vault Git',
        description: 'Caminho local do vault e sincronizacao remota opcional por Git.',
        status: environment.vaultPath && vaultRemoteReady ? 'connected' : environment.vaultPath ? 'partial' : 'missing',
        requiredEnv: Object.keys(vaultEnv),
        configuredEnv: configuredEnv(vaultEnv),
        missingEnv: missingEnv(vaultEnv),
        links: [],
        checklist: [
          'Montar KB_VAULT_PATH no ambiente de execucao.',
          'Habilitar KB_ENABLE_GIT_PUSH somente quando o remote estiver pronto.',
          'Configurar remote, usuario e token para push automatico.',
        ],
        warnings: [
          !environment.vaultPath ? 'KB_VAULT_PATH ausente.' : '',
          !environment.enableGitPush ? 'Push remoto desabilitado; sync fica manual/local.' : '',
          environment.enableGitPush && !environment.vaultRemoteUrl ? 'Push habilitado sem remote do vault.' : '',
          environment.enableGitPush && !environment.gitPushToken ? 'Push habilitado sem token de Git.' : '',
        ].filter(Boolean),
      },
    ],
  };
}

@Injectable()
export class BuildIntegrationsUseCase {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly workspaceRepository: WorkspaceRepository,
  ) {}

  async execute() {
    const [workspaces, projects] = await Promise.all([this.workspaceRepository.list(), this.projectRepository.list()]);
    return buildIntegrationStatuses({ environment: readEnvironment(), workspaces, projects });
  }
}
