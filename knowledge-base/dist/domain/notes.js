import path from 'node:path';
import { renderFrontmatter } from './frontmatter.js';
import { sanitizeFileStem, trimText } from './strings.js';
import { getSaoPauloParts } from './time.js';
export const vaultFolders = {
    home: '00 Home',
    projects: '10 Projects',
    inbox: '20 Inbox',
    knowledge: '30 Knowledge',
    incidents: '40 Incidents',
    followups: '50 Followups',
    reminders: '60 Reminders',
    assets: '90 Assets',
};
export function vaultLink(relativePath, label = '') {
    const normalized = relativePath.replace(/\\/g, '/').replace(/\.md$/i, '');
    return label ? `[[${normalized}|${label}]]` : `[[${normalized}]]`;
}
export function folderForCanonicalType(type) {
    if (type === 'knowledge' || type === 'decision')
        return vaultFolders.knowledge;
    if (type === 'incident')
        return vaultFolders.incidents;
    if (type === 'followup')
        return vaultFolders.followups;
    if (type === 'reminder')
        return vaultFolders.reminders;
    return vaultFolders.inbox;
}
export function buildNotePaths(project, payload) {
    const occurredAt = new Date(payload.event.occurredAt);
    const safeDate = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
    const { year, month, day, time } = getSaoPauloParts(safeDate);
    const titleStem = sanitizeFileStem(payload.content.title || payload.content.rawText, payload.classification.kind);
    const baseFile = `${year}${month}${day}-${time}-${titleStem}.md`;
    const eventRelativePath = path.join(vaultFolders.inbox, project.projectSlug, year, month, baseFile);
    const canonicalRelativePath = payload.classification.canonicalType !== 'event'
        ? path.join(folderForCanonicalType(payload.classification.canonicalType), project.projectSlug, year, month, baseFile)
        : '';
    const followupRelativePath = payload.actions.followUpBy
        ? path.join(vaultFolders.followups, project.projectSlug, year, month, `${year}${month}${day}-${time}-${titleStem}-followup.md`)
        : '';
    const reminderRelativePath = payload.actions.reminderDate
        ? path.join(vaultFolders.reminders, project.projectSlug, year, month, `${year}${month}${day}-${time}-${titleStem}-reminder.md`)
        : '';
    const assetRelativePaths = payload.content.attachments.map((attachment) => path.join(vaultFolders.assets, project.projectSlug, year, month, `${year}${month}${day}-${time}-${sanitizeFileStem(attachment.fileName, 'attachment')}`));
    const dailyRelativePath = path.join(vaultFolders.inbox, project.projectSlug, year, `${year}-${month}-${day}.md`);
    return {
        eventRelativePath,
        canonicalRelativePath,
        followupRelativePath,
        reminderRelativePath,
        assetRelativePaths,
        dailyRelativePath,
    };
}
function renderList(items) {
    if (!items.length)
        return '- none';
    return items.map((item) => `- ${item}`).join('\n');
}
function renderReviewFindings(findings) {
    if (!findings.length)
        return 'No findings registered.';
    return findings
        .map((finding) => {
        const parts = [`- [${finding.severity.toUpperCase()}] ${finding.summary}`];
        if (finding.file)
            parts.push(`  file: ${finding.file}`);
        if (finding.recommendation)
            parts.push(`  recommendation: ${finding.recommendation}`);
        return parts.join('\n');
    })
        .join('\n');
}
export function renderEventNote(project, payload, paths) {
    const sections = payload.content.sections;
    const frontmatter = renderFrontmatter({
        id: payload.source.correlationId,
        type: 'event',
        workspace: project.workspaceSlug,
        source_channel: payload.source.channel,
        source_system: payload.source.system,
        event_type: payload.event.type,
        project: project.projectSlug,
        kind: payload.classification.kind,
        canonical_type: payload.classification.canonicalType,
        importance: payload.classification.importance,
        status: payload.classification.status || 'active',
        tags: payload.classification.tags,
        occurred_at: payload.event.occurredAt,
        related: [paths.canonicalRelativePath, paths.followupRelativePath, paths.reminderRelativePath].filter(Boolean),
    });
    return [
        frontmatter,
        `# ${trimText(payload.content.title, payload.content.rawText)}`,
        '',
        `Projeto: ${vaultLink(path.join(vaultFolders.projects, `${project.projectSlug}.md`), project.displayName)}`,
        '',
        '## Texto original',
        '',
        payload.content.rawText,
        '',
        '## Resumo',
        '',
        sections.summary || 'No summary generated.',
        '',
        '## Impacto',
        '',
        sections.impact || 'No impact registered.',
        '',
        '## Riscos',
        '',
        renderList(sections.risks),
        '',
        '## Proximos passos',
        '',
        renderList(sections.nextSteps),
        '',
        payload.event.type === 'code_review'
            ? ['## Findings de review', '', renderReviewFindings(sections.reviewFindings)].join('\n')
            : '',
        '',
    ]
        .filter(Boolean)
        .join('\n');
}
export function renderCanonicalNote(project, payload, relatedEventPath) {
    const sections = payload.content.sections;
    const frontmatter = renderFrontmatter({
        id: `${payload.source.correlationId}:canonical`,
        type: payload.classification.canonicalType,
        workspace: project.workspaceSlug,
        project: project.projectSlug,
        importance: payload.classification.importance,
        status: payload.classification.status || 'active',
        tags: payload.classification.tags,
        occurred_at: payload.event.occurredAt,
        canonical: true,
        related: [relatedEventPath],
    });
    return [
        frontmatter,
        `# ${trimText(payload.content.title, payload.content.rawText)}`,
        '',
        '## Resumo consolidado',
        '',
        sections.summary || payload.content.rawText,
        '',
        '## Impacto',
        '',
        sections.impact || 'No impact registered.',
        '',
        '## Riscos',
        '',
        renderList(sections.risks),
        '',
        '## Proximos passos',
        '',
        renderList(sections.nextSteps),
        '',
        `Origem: ${vaultLink(relatedEventPath, 'evento original')}`,
        '',
    ].join('\n');
}
export function renderFollowupNote(project, payload, relatedEventPath) {
    const sections = payload.content.sections;
    const frontmatter = renderFrontmatter({
        id: `${payload.source.correlationId}:followup`,
        type: 'followup',
        workspace: project.workspaceSlug,
        project: project.projectSlug,
        importance: payload.classification.importance,
        status: 'open',
        tags: [...payload.classification.tags, 'followup'],
        occurred_at: payload.event.occurredAt,
        follow_up_by: payload.actions.followUpBy,
        related: [relatedEventPath],
    });
    return [
        frontmatter,
        `# Follow-up ${trimText(payload.content.title, payload.content.rawText)}`,
        '',
        '## O que fazer',
        '',
        renderList(sections.nextSteps.length ? sections.nextSteps : [payload.content.rawText]),
        '',
        `Prazo: ${payload.actions.followUpBy || 'not defined'}`,
        '',
        `Origem: ${vaultLink(relatedEventPath, 'evento original')}`,
        '',
    ].join('\n');
}
export function renderReminderNote(project, payload, relatedEventPath, reminderAt) {
    const frontmatter = renderFrontmatter({
        id: `${payload.source.correlationId}:reminder`,
        type: 'reminder',
        workspace: project.workspaceSlug,
        project: project.projectSlug,
        importance: payload.classification.importance,
        status: 'open',
        tags: [...payload.classification.tags, 'reminder'],
        occurred_at: payload.event.occurredAt,
        reminder_date: payload.actions.reminderDate,
        reminder_time: payload.actions.reminderTime,
        reminder_at: reminderAt,
        related: [relatedEventPath],
    });
    return [
        frontmatter,
        `# Reminder ${trimText(payload.content.title, payload.content.rawText)}`,
        '',
        '## O que lembrar',
        '',
        payload.content.sections.summary || payload.content.rawText,
        '',
        `Agendado para: ${payload.actions.reminderDate}${payload.actions.reminderTime ? ` ${payload.actions.reminderTime}` : ''}`,
        '',
        `Origem: ${vaultLink(relatedEventPath, 'evento original')}`,
        '',
    ].join('\n');
}
export function renderProjectSummary(project, recentEntries) {
    const frontmatter = renderFrontmatter({
        id: `project:${project.projectSlug}`,
        type: 'project_summary',
        workspace: project.workspaceSlug,
        project: project.projectSlug,
        repo_full_name: project.repoFullName,
        tags: ['project', project.projectSlug],
    });
    return [
        frontmatter,
        `# ${project.displayName}`,
        '',
        project.repoFullName ? `Repo: ${project.repoFullName}` : '',
        '',
        '## Entradas recentes',
        '',
        recentEntries.length ? recentEntries.map((entry) => `- ${entry}`).join('\n') : '- none',
        '',
    ]
        .filter(Boolean)
        .join('\n');
}
export function renderHomePage(projects) {
    return [
        '# Home',
        '',
        '## Navegacao',
        '',
        `- ${vaultLink(path.join(vaultFolders.projects, 'Projects.md'), 'Projetos')}`,
        `- ${vaultLink(path.join(vaultFolders.reminders, 'Reminders.md'), 'Lembretes')}`,
        '',
        '## Projetos',
        '',
        ...projects.map((project) => `- ${vaultLink(path.join(vaultFolders.projects, `${project.projectSlug}.md`), project.displayName)}`),
        '',
    ].join('\n');
}
export function renderProjectsIndex(projects) {
    return [
        '# Projetos',
        '',
        ...projects.map((project) => `- ${vaultLink(path.join(vaultFolders.projects, `${project.projectSlug}.md`), project.displayName)}`),
        '',
    ].join('\n');
}
export function renderRemindersIndex(reminders) {
    return [
        '# Lembretes',
        '',
        ...reminders.map((entry) => `- ${entry}`),
        '',
    ].join('\n');
}
