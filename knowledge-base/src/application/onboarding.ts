import { mkdir } from 'node:fs/promises';

import type { RuntimeEnvironment } from '../adapters/environment.js';
import { onboardingInputSchema } from '../contracts/onboarding.js';
import { loadProjects, upsertProjects } from '../domain/projects.js';
import { loadWorkspaces, upsertWorkspace } from '../domain/workspaces.js';

function absoluteUrl(baseUrl: string, relativePath: string): string {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/$/, '');
  const normalizedPath = `/${String(relativePath || '').trim().replace(/^\/+/, '')}`;
  return normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath;
}

export async function runOnboarding(rawInput: unknown, environment: RuntimeEnvironment) {
  const input = onboardingInputSchema.parse(rawInput);
  await mkdir(environment.archivePath, { recursive: true });

  if (input.operation === 'upsert') {
    await upsertWorkspace(environment.workspacesManifestPath, {
      workspaceSlug: input.workspaceSlug,
      displayName: input.displayName || input.workspaceSlug,
      whatsappGroupJid: input.whatsappGroupJid,
      telegramChatId: input.telegramChatId,
      githubRepos: input.githubRepos,
      projectSlugs: input.projects.map((project) => project.projectSlug),
    });
    if (input.projects.length) {
      await upsertProjects(
        environment.manifestPath,
        input.projects.map((project) => ({
          projectSlug: project.projectSlug,
          displayName: project.displayName,
          repoFullName: project.repoFullName,
          aliases: project.aliases,
          defaultTags: project.defaultTags,
          workspaceSlug: input.workspaceSlug,
          enabled: true,
        })),
      );
    }
  }

  const workspaces = await loadWorkspaces(environment.workspacesManifestPath);
  const projects = await loadProjects(environment.manifestPath);
  const workspace = workspaces.find((item) => item.workspaceSlug === input.workspaceSlug);
  if (!workspace) {
    throw new Error(`workspace_not_found:${input.workspaceSlug}`);
  }

  const workspaceProjects = projects.filter((project) => project.workspaceSlug === workspace.workspaceSlug);
  const statuses = {
    workspaceReady: Boolean(workspace.displayName),
    whatsappReady: Boolean(workspace.whatsappGroupJid && (environment.whatsappPairingUrl || environment.allowedGroupId || workspace.whatsappGroupJid)),
    githubReady: Boolean(workspace.githubRepos.length && environment.githubAppInstallUrl && environment.githubWebhookSecret),
    projectsReady: workspaceProjects.length > 0,
    queryReady: Boolean(environment.vaultPath && environment.queryWebhookPath),
  };
  const overallReady = Object.values(statuses).every(Boolean);
  const links = {
    whatsappPairingUrl: environment.whatsappPairingUrl,
    githubInstallUrl: environment.githubAppInstallUrl,
    whatsappWebhookUrl: absoluteUrl(environment.publicBaseUrl, environment.whatsappWebhookPath),
    githubWebhookUrl: absoluteUrl(environment.publicBaseUrl, environment.githubPushWebhookPath),
    ingestWebhookUrl: absoluteUrl(environment.publicBaseUrl, environment.ingestWebhookPath),
    onboardingWebhookUrl: absoluteUrl(environment.publicBaseUrl, environment.onboardingWebhookPath),
    queryWebhookUrl: absoluteUrl(environment.publicBaseUrl, environment.queryWebhookPath),
  };

  const nextSteps = [
    !statuses.workspaceReady ? 'Defina o nome do workspace.' : '',
    !statuses.whatsappReady ? 'Conecte o grupo do WhatsApp e configure KB_WPP_PAIRING_URL ou WPP_KB_GROUP_JID.' : '',
    !statuses.githubReady ? 'Configure KB_GITHUB_APP_INSTALL_URL, KB_GITHUB_APP_WEBHOOK_SECRET e vincule ao menos um repositorio.' : '',
    !statuses.projectsReady ? 'Cadastre ao menos um projeto/repositorio no workspace.' : '',
    !statuses.queryReady ? 'Configure o endpoint de consulta e garanta acesso ao vault.' : '',
  ].filter(Boolean);

  return {
    ok: true,
    workspace: {
      workspaceSlug: workspace.workspaceSlug,
      displayName: workspace.displayName,
      whatsappGroupJid: workspace.whatsappGroupJid,
      telegramChatId: workspace.telegramChatId,
      githubRepos: workspace.githubRepos,
      projects: workspaceProjects.map((project) => ({
        projectSlug: project.projectSlug,
        displayName: project.displayName,
        repoFullName: project.repoFullName,
      })),
    },
    statuses: {
      ...statuses,
      overallReady,
    },
    links,
    nextSteps,
  };
}
