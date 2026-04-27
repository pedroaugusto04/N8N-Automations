import fs from 'node:fs/promises';

import { slugify } from './strings.js';

export type Project = {
  projectSlug: string;
  displayName: string;
  repoFullName: string;
  workspaceSlug: string;
  aliases: string[];
  defaultTags: string[];
  enabled: boolean;
};

export async function loadProjects(manifestPath: string): Promise<Project[]> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as { projects?: unknown[] };
    const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    return projects
      .map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          projectSlug: slugify(String(item.project_slug || item.projectSlug || '')),
          displayName: String(item.display_name || item.name || item.project_slug || '').trim(),
          repoFullName: String(item.repo_full_name || item.repoFullName || '').trim(),
          workspaceSlug: slugify(String(item.workspace_slug || item.workspaceSlug || '')),
          aliases: Array.isArray(item.aliases) ? item.aliases.map((value) => slugify(String(value || ''))).filter(Boolean) : [],
          defaultTags: Array.isArray(item.default_tags)
            ? item.default_tags.map((value) => slugify(String(value || ''))).filter(Boolean)
            : [],
          enabled: item.enabled !== false,
        };
      })
      .filter((project) => project.projectSlug && project.enabled);
  } catch {
    return [];
  }
}

export function findProject(projects: Project[], value: string): Project | undefined {
  const target = slugify(value);
  if (!target) return undefined;
  return projects.find((project) => {
    return project.projectSlug === target || project.aliases.includes(target) || slugify(project.displayName) === target;
  });
}

export async function saveProjects(manifestPath: string, projects: Project[]): Promise<void> {
  const normalized = projects
    .map((project) => ({
      project_slug: project.projectSlug,
      display_name: project.displayName,
      repo_full_name: project.repoFullName,
      workspace_slug: project.workspaceSlug,
      aliases: project.aliases,
      default_tags: project.defaultTags,
      enabled: project.enabled,
    }))
    .sort((left, right) => left.project_slug.localeCompare(right.project_slug));
  await fs.writeFile(manifestPath, `${JSON.stringify({ projects: normalized }, null, 2)}\n`, 'utf8');
}

export async function upsertProjects(
  manifestPath: string,
  items: Array<Partial<Project> & Pick<Project, 'projectSlug' | 'displayName'>>,
): Promise<Project[]> {
  const current = await loadProjects(manifestPath);
  const bySlug = new Map(current.map((project) => [project.projectSlug, project]));
  for (const item of items) {
    const projectSlug = slugify(item.projectSlug) || 'inbox';
    const existing = bySlug.get(projectSlug);
    bySlug.set(projectSlug, {
      projectSlug,
      displayName: String(item.displayName || existing?.displayName || projectSlug).trim(),
      repoFullName: String(item.repoFullName || existing?.repoFullName || '').trim(),
      workspaceSlug: slugify(String(item.workspaceSlug || existing?.workspaceSlug || '')),
      aliases: Array.from(
        new Set([...(existing?.aliases || []), ...((item.aliases || []).map((value) => slugify(String(value || ''))).filter(Boolean) as string[])]),
      ),
      defaultTags: Array.from(
        new Set([
          ...(existing?.defaultTags || []),
          ...((item.defaultTags || []).map((value) => slugify(String(value || ''))).filter(Boolean) as string[]),
        ]),
      ),
      enabled: item.enabled ?? existing?.enabled ?? true,
    });
  }
  const result = Array.from(bySlug.values());
  await saveProjects(manifestPath, result);
  return result;
}

export function ensureProject(projects: Project[], projectSlug: string): Project {
  const project = findProject(projects, projectSlug);
  if (project) return project;
  const slug = slugify(projectSlug) || 'inbox';
  return {
    projectSlug: slug,
    displayName: slug === 'inbox' ? 'Inbox' : slug,
    repoFullName: '',
    workspaceSlug: '',
    aliases: [],
    defaultTags: [],
    enabled: true,
  };
}
