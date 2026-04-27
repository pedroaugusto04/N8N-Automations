import fs from 'node:fs/promises';
import path from 'node:path';

import type { RuntimeEnvironment } from '../adapters/environment.js';
import { runGit, buildPushGitConfigs } from '../adapters/git.js';
import { ingestPayloadSchema, withDerivedReminderAt, type IngestPayload } from '../contracts/ingest.js';
import { defaultStatus } from '../domain/classification.js';
import { renderHomePage, renderProjectSummary, renderProjectsIndex, renderRemindersIndex, renderEventNote, renderCanonicalNote, renderFollowupNote, renderReminderNote, buildNotePaths, vaultFolders, vaultLink } from '../domain/notes.js';
import { ensureProject, loadProjects } from '../domain/projects.js';
import { unique } from '../domain/strings.js';

async function ensureDir(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
}

async function writeFile(targetPath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, content, 'utf8');
}

async function ensureVaultSkeleton(vaultPath: string): Promise<void> {
  await ensureDir(vaultPath);
  await Promise.all(Object.values(vaultFolders).map((folder) => ensureDir(path.join(vaultPath, folder))));
}

async function ensureVaultGit(environment: RuntimeEnvironment): Promise<void> {
  await ensureDir(environment.vaultPath);
  const gitPath = path.join(environment.vaultPath, '.git');
  try {
    await fs.access(gitPath);
  } catch {
    await runGit(environment.vaultPath, ['init', '--initial-branch=main']);
  }
  await runGit(environment.vaultPath, ['config', 'user.name', environment.gitUserName]);
  await runGit(environment.vaultPath, ['config', 'user.email', environment.gitUserEmail]);
  if (environment.vaultRemoteUrl) {
    const remotes = await runGit(environment.vaultPath, ['remote'], { allowFailure: true });
    if (!String(remotes.stdout || '').split(/\r?\n/).includes('origin')) {
      await runGit(environment.vaultPath, ['remote', 'add', 'origin', environment.vaultRemoteUrl]);
    }
  }
}

async function upsertProjectPages(vaultPath: string, projectEntries: Map<string, string[]>, projects: Awaited<ReturnType<typeof loadProjects>>): Promise<void> {
  for (const project of projects) {
    const targetPath = path.join(vaultPath, vaultFolders.projects, `${project.projectSlug}.md`);
    await writeFile(targetPath, renderProjectSummary(project, projectEntries.get(project.projectSlug) || []));
  }
  await writeFile(path.join(vaultPath, vaultFolders.projects, 'Projects.md'), renderProjectsIndex(projects));
  await writeFile(path.join(vaultPath, vaultFolders.home, 'Home.md'), renderHomePage(projects));
}

async function refreshReminderIndex(vaultPath: string): Promise<void> {
  const remindersRoot = path.join(vaultPath, vaultFolders.reminders);
  const entries: string[] = [];
  async function walk(dirPath: string): Promise<void> {
    const dirEntries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    for (const entry of dirEntries) {
      const resolved = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(resolved);
      } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'Reminders.md') {
        entries.push(vaultLink(path.relative(vaultPath, resolved).replace(/\\/g, '/'), entry.name.replace(/\.md$/i, '')));
      }
    }
  }
  await walk(remindersRoot);
  await writeFile(path.join(remindersRoot, 'Reminders.md'), renderRemindersIndex(entries.sort()));
}

export async function ingestEntry(input: unknown, environment: RuntimeEnvironment) {
  const parsed = withDerivedReminderAt(ingestPayloadSchema.parse(input));
  const payload: IngestPayload & { actions: IngestPayload['actions'] & { reminderAt: string } } = {
    ...parsed,
    classification: {
      ...parsed.classification,
      status: parsed.classification.status || defaultStatus(parsed.classification.canonicalType),
      tags: unique([parsed.event.projectSlug, ...parsed.classification.tags]),
    },
  };

  await ensureVaultSkeleton(environment.vaultPath);
  await ensureVaultGit(environment);

  const projects = await loadProjects(environment.manifestPath);
  const project = ensureProject(projects, payload.event.projectSlug);
  if (!projects.find((item) => item.projectSlug === project.projectSlug)) {
    projects.push(project);
  }

  const paths = buildNotePaths(project, payload);
  const assetWriteResults: string[] = [];
  for (let index = 0; index < payload.content.attachments.length; index += 1) {
    const attachment = payload.content.attachments[index];
    const relativePath = paths.assetRelativePaths[index];
    const targetPath = path.join(environment.vaultPath, relativePath);
    await ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, Buffer.from(attachment.dataBase64 || '', 'base64'));
    assetWriteResults.push(relativePath.replace(/\\/g, '/'));
  }

  await writeFile(path.join(environment.vaultPath, paths.eventRelativePath), renderEventNote(project, payload, paths));
  if (paths.canonicalRelativePath) {
    await writeFile(path.join(environment.vaultPath, paths.canonicalRelativePath), renderCanonicalNote(project, payload, paths.eventRelativePath));
  }
  if (paths.followupRelativePath) {
    await writeFile(path.join(environment.vaultPath, paths.followupRelativePath), renderFollowupNote(project, payload, paths.eventRelativePath));
  }
  if (paths.reminderRelativePath) {
    await writeFile(
      path.join(environment.vaultPath, paths.reminderRelativePath),
      renderReminderNote(project, payload, paths.eventRelativePath, payload.actions.reminderAt),
    );
  }

  const dailyPath = path.join(environment.vaultPath, paths.dailyRelativePath);
  const dailyEntry = [
    `- ${new Date(payload.event.occurredAt).toISOString()} ${vaultLink(paths.eventRelativePath, payload.content.title || payload.content.rawText)}`,
  ].join('\n');
  const existingDaily = await fs.readFile(dailyPath, 'utf8').catch(() => `# ${project.displayName} Daily\n\n`);
  await writeFile(dailyPath, `${existingDaily.trimEnd()}\n${dailyEntry}\n`);

  const projectEntries = new Map<string, string[]>();
  projectEntries.set(project.projectSlug, [
    vaultLink(paths.eventRelativePath, payload.content.title || payload.content.rawText),
    ...(paths.canonicalRelativePath ? [vaultLink(paths.canonicalRelativePath, 'canonical')] : []),
    ...(paths.reminderRelativePath ? [vaultLink(paths.reminderRelativePath, 'reminder')] : []),
    ...(paths.followupRelativePath ? [vaultLink(paths.followupRelativePath, 'follow-up')] : []),
  ]);
  await upsertProjectPages(environment.vaultPath, projectEntries, projects);
  await refreshReminderIndex(environment.vaultPath);

  let gitStatus = 'deferred_batch_mode';
  if (!environment.gitBatchMode) {
    await runGit(environment.vaultPath, ['add', '-A']);
    const commitResult = await runGit(environment.vaultPath, ['commit', '-m', `kb: ingest ${payload.source.correlationId}`], { allowFailure: true });
    gitStatus = commitResult.ok ? 'committed' : 'nothing_to_commit';
    if (environment.enableGitPush) {
      const pushGitConfigs = buildPushGitConfigs(environment.vaultRemoteUrl, environment.gitPushUsername, environment.gitPushToken);
      const pushResult = await runGit(environment.vaultPath, ['push', 'origin', 'HEAD'], {
        allowFailure: true,
        gitConfigs: pushGitConfigs,
      });
      gitStatus = pushResult.ok ? 'pushed' : `push_failed:${pushResult.stderr}`;
    }
  }

  return {
    ok: true,
    project: project.projectSlug,
    eventPath: paths.eventRelativePath.replace(/\\/g, '/'),
    canonicalPath: paths.canonicalRelativePath.replace(/\\/g, '/'),
    followupPath: paths.followupRelativePath.replace(/\\/g, '/'),
    reminderPath: paths.reminderRelativePath.replace(/\\/g, '/'),
    dailyPath: paths.dailyRelativePath.replace(/\\/g, '/'),
    assetPaths: assetWriteResults,
    gitStatus,
  };
}
