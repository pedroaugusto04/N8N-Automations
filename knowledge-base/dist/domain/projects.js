import { slugify } from './strings.js';
export async function loadProjects(_manifestPath) {
    return [];
}
export function findProject(projects, value) {
    const target = slugify(value);
    if (!target)
        return undefined;
    return projects.find((project) => {
        return project.projectSlug === target || project.aliases.includes(target) || slugify(project.displayName) === target;
    });
}
export async function saveProjects(manifestPath, projects) {
    void manifestPath;
    void projects;
    throw new Error('filesystem_project_manifest_removed_use_content_repository');
}
export async function upsertProjects(manifestPath, items) {
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
            aliases: Array.from(new Set([...(existing?.aliases || []), ...(item.aliases || []).map((value) => slugify(String(value || ''))).filter(Boolean)])),
            defaultTags: Array.from(new Set([
                ...(existing?.defaultTags || []),
                ...(item.defaultTags || []).map((value) => slugify(String(value || ''))).filter(Boolean),
            ])),
            enabled: item.enabled ?? existing?.enabled ?? true,
        });
    }
    const result = Array.from(bySlug.values());
    await saveProjects(manifestPath, result);
    return result;
}
export function ensureProject(projects, projectSlug) {
    const project = findProject(projects, projectSlug);
    if (project)
        return project;
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
