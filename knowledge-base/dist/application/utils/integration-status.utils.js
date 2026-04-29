import { IntegrationSetupStatus } from '../../contracts/enums.js';
export function configuredEnv(env) {
    return Object.entries(env)
        .filter(([, configured]) => configured)
        .map(([name]) => name);
}
export function missingEnv(env) {
    return Object.entries(env)
        .filter(([, configured]) => !configured)
        .map(([name]) => name);
}
export function statusFromFlags(flags) {
    if (flags.every(Boolean))
        return IntegrationSetupStatus.Connected;
    if (flags.some(Boolean))
        return IntegrationSetupStatus.Partial;
    return IntegrationSetupStatus.Missing;
}
export function absoluteUrl(baseUrl, pathname) {
    if (!baseUrl)
        return pathname;
    const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    return `${baseUrl}${normalizedPath}`;
}
export function link(label, url, external = true) {
    return { label, url, external };
}
export function workspaceRepos(workspace, projects) {
    const workspaceProjectRepos = projects
        .filter((project) => !workspace || project.workspaceSlug === workspace.workspaceSlug || workspace.projectSlugs.includes(project.projectSlug))
        .map((project) => project.repoFullName)
        .filter(Boolean);
    return Array.from(new Set([...(workspace?.githubRepos || []), ...workspaceProjectRepos]));
}
export function secretConfigured(value) {
    return Boolean(value.trim());
}
