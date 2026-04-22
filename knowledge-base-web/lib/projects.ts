import fs from 'node:fs/promises';

import type { ProjectOption } from './types';

const fallbackProject: ProjectOption = {
  slug: 'inbox',
  label: 'Inbox',
  aliases: [],
  description: 'Caixa de entrada geral quando voce so quer registrar rapido.',
};

export async function readProjectOptions(): Promise<ProjectOption[]> {
  const manifestPath = String(process.env.KB_PROJECTS_FILE || '').trim();
  if (!manifestPath) {
    return [fallbackProject];
  }

  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.projects) ? (parsed.projects as Array<Record<string, unknown>>) : [];
    const projects = items
      .filter((project: Record<string, unknown>) => project?.enabled !== false)
      .map((project: Record<string, unknown>): ProjectOption | null => {
        const slug = String(project?.project_slug || '').trim();
        if (!slug) {
          return null;
        }
        const label = String(project?.display_name || project?.name || slug).trim();
        const aliases = Array.isArray(project?.aliases)
          ? project.aliases.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
          : [];
        return {
          slug,
          label,
          aliases,
          description: aliases.length > 0 ? `Aliases: ${aliases.join(', ')}` : '',
        };
      })
      .filter((project: ProjectOption | null): project is ProjectOption => project !== null)
      .sort((left: ProjectOption, right: ProjectOption) => left.label.localeCompare(right.label, 'pt-BR'));

    const seen = new Set<string>();
    const uniqueProjects = [fallbackProject, ...projects].filter((project: ProjectOption) => {
      if (seen.has(project.slug)) {
        return false;
      }
      seen.add(project.slug);
      return true;
    });

    return uniqueProjects;
  } catch {
    return [fallbackProject];
  }
}
