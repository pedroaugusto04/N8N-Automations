import fs from 'node:fs/promises';

import { slugify } from './strings.js';
import { nowIso } from './time.js';

export type Workspace = {
  workspaceSlug: string;
  displayName: string;
  whatsappGroupJid: string;
  telegramChatId: string;
  githubRepos: string[];
  projectSlugs: string[];
  createdAt: string;
  updatedAt: string;
};

export async function loadWorkspaces(manifestPath: string): Promise<Workspace[]> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as { workspaces?: unknown[] };
    const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : [];
    return workspaces
      .map((entry) => {
        const item = entry as Record<string, unknown>;
        const githubRepos = Array.isArray(item.github_repos) ? item.github_repos : Array.isArray(item.githubRepos) ? item.githubRepos : [];
        const projectSlugs = Array.isArray(item.project_slugs) ? item.project_slugs : Array.isArray(item.projectSlugs) ? item.projectSlugs : [];
        return {
          workspaceSlug: slugify(String(item.workspace_slug || item.workspaceSlug || '')),
          displayName: String(item.display_name || item.displayName || item.workspace_slug || '').trim(),
          whatsappGroupJid: String(item.whatsapp_group_jid || item.whatsappGroupJid || '').trim(),
          telegramChatId: String(item.telegram_chat_id || item.telegramChatId || '').trim(),
          githubRepos: githubRepos.map((value) => String(value || '').trim()).filter(Boolean),
          projectSlugs: projectSlugs.map((value) => slugify(String(value || ''))).filter(Boolean),
          createdAt: String(item.created_at || item.createdAt || '').trim() || nowIso(),
          updatedAt: String(item.updated_at || item.updatedAt || '').trim() || nowIso(),
        };
      })
      .filter((workspace) => workspace.workspaceSlug);
  } catch {
    return [];
  }
}

export async function saveWorkspaces(manifestPath: string, workspaces: Workspace[]): Promise<void> {
  const normalized = workspaces
    .map((workspace) => ({
      workspace_slug: workspace.workspaceSlug,
      display_name: workspace.displayName,
      whatsapp_group_jid: workspace.whatsappGroupJid,
      telegram_chat_id: workspace.telegramChatId,
      github_repos: workspace.githubRepos,
      project_slugs: workspace.projectSlugs,
      created_at: workspace.createdAt,
      updated_at: workspace.updatedAt,
    }))
    .sort((left, right) => left.workspace_slug.localeCompare(right.workspace_slug));
  await fs.writeFile(manifestPath, `${JSON.stringify({ workspaces: normalized }, null, 2)}\n`, 'utf8');
}

export async function upsertWorkspace(
  manifestPath: string,
  input: Partial<Workspace> & Pick<Workspace, 'workspaceSlug'>,
): Promise<Workspace> {
  const current = await loadWorkspaces(manifestPath);
  const workspaceSlug = slugify(input.workspaceSlug) || 'default';
  const existing = current.find((workspace) => workspace.workspaceSlug === workspaceSlug);
  const merged: Workspace = {
    workspaceSlug,
    displayName: String(input.displayName || existing?.displayName || workspaceSlug).trim(),
    whatsappGroupJid: String(input.whatsappGroupJid || existing?.whatsappGroupJid || '').trim(),
    telegramChatId: String(input.telegramChatId || existing?.telegramChatId || '').trim(),
    githubRepos: Array.from(new Set([...(existing?.githubRepos || []), ...(input.githubRepos || [])].map((value) => String(value || '').trim()).filter(Boolean))),
    projectSlugs: Array.from(new Set([...(existing?.projectSlugs || []), ...(input.projectSlugs || [])].map((value) => slugify(String(value || ''))).filter(Boolean))),
    createdAt: existing?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  const remaining = current.filter((workspace) => workspace.workspaceSlug !== workspaceSlug);
  await saveWorkspaces(manifestPath, [...remaining, merged]);
  return merged;
}

export function findWorkspace(workspaces: Workspace[], value: string): Workspace | undefined {
  const target = slugify(value);
  if (!target) return undefined;
  return workspaces.find((workspace) => workspace.workspaceSlug === target || slugify(workspace.displayName) === target);
}
