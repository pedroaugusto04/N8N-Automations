#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';

const execFile = promisify(execFileCb);
const vaultPath = process.env.KB_VAULT_PATH || '/home/node/knowledge-vault';
const manifestPath = process.env.KB_PROJECTS_MANIFEST || '/home/node/knowledge-base/projects.json';
const semanticTextVersion = 1;
const analysisModel = (process.env.KB_OPENAI_MODEL || '').trim();
const analysisApiKey = (process.env.KB_OPENAI_API_KEY || '').trim();
const webhookSecret = (process.env.KB_WEBHOOK_SECRET || '').trim();
const enableGitPush = String(process.env.KB_ENABLE_GIT_PUSH || 'false').toLowerCase() === 'true';
const vaultRemoteUrl = (process.env.KB_VAULT_REMOTE_URL || '').trim();
const gitUserName = (process.env.KB_VAULT_GIT_USER_NAME || 'knowledge-bot').trim();
const gitUserEmail = (process.env.KB_VAULT_GIT_USER_EMAIL || 'knowledge-bot@example.local').trim();
const saoPauloFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const saoPauloTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

function escapeYamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function toFrontmatterValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => escapeYamlString(item)).join(', ')}]`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value == null) {
    return 'null';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return escapeYamlString(value);
}

function renderFrontmatter(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${toFrontmatterValue(value)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeHeaders(value) {
  const headers = {};
  if (!value || typeof value !== 'object') {
    return headers;
  }
  for (const [key, entry] of Object.entries(value)) {
    headers[String(key).toLowerCase()] = Array.isArray(entry) ? String(entry[0] ?? '') : String(entry ?? '');
  }
  return headers;
}

function parseDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getDateParts(date) {
  const [year, month, day] = saoPauloFormatter.format(date).split('-');
  const time = saoPauloTimeFormatter.format(date).replace(/:/g, '');
  return { year, month, day, time };
}

function shortSha(value) {
  return String(value || '').slice(0, 8) || 'unknown';
}

function trimParagraph(value, fallback) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

async function readManifest() {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.projects) ? parsed.projects : [];
}

function unwrapInput(decoded) {
  if (decoded && typeof decoded === 'object' && decoded.body && typeof decoded.body === 'object') {
    return {
      headers: normalizeHeaders(decoded.headers),
      payload: decoded.body,
      wrapper: decoded,
    };
  }
  return {
    headers: normalizeHeaders(decoded?.headers),
    payload: decoded,
    wrapper: decoded,
  };
}

function assertAuthorized(headers) {
  if (!webhookSecret) {
    return;
  }
  const received = String(headers['x-kb-secret'] || '').trim();
  if (!received || received !== webhookSecret) {
    throw new Error('unauthorized_request');
  }
}

function resolveProject(payload, projects) {
  const projectSlug = String(payload.project_slug || '').trim();
  const repo = String(payload.repo || payload.repo_full_name || '').trim();
  const project =
    projects.find((entry) => entry.project_slug === projectSlug) ||
    projects.find((entry) => entry.repo_full_name === repo);
  if (!project) {
    throw new Error(`unknown_project:${projectSlug || repo || 'missing'}`);
  }
  if (!project.enabled) {
    throw new Error(`disabled_project:${project.project_slug}`);
  }
  return project;
}

async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function runGit(args, { allowFailure = false } = {}) {
  try {
    const result = await execFile('git', ['-c', `safe.directory=${vaultPath}`, '-C', vaultPath, ...args], {
      cwd: vaultPath,
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      ok: true,
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim(),
    };
  } catch (error) {
    if (!allowFailure) {
      throw error;
    }
    return {
      ok: false,
      stdout: String(error.stdout || '').trim(),
      stderr: String(error.stderr || error.message || '').trim(),
      code: error.code ?? null,
    };
  }
}

async function ensureVaultRepository() {
  await ensureDir(vaultPath);
  const gitPath = path.join(vaultPath, '.git');
  let hasGit = true;
  try {
    await fs.access(gitPath);
  } catch {
    hasGit = false;
  }

  if (!hasGit) {
    await execFile('git', ['init', '--initial-branch=main', vaultPath], { maxBuffer: 10 * 1024 * 1024 });
  }

  await runGit(['config', 'user.name', gitUserName]);
  await runGit(['config', 'user.email', gitUserEmail]);

  if (vaultRemoteUrl) {
    const remotes = await runGit(['remote'], { allowFailure: true });
    const remoteNames = new Set(String(remotes.stdout || '').split(/\r?\n/).filter(Boolean));
    if (!remoteNames.has('origin')) {
      await runGit(['remote', 'add', 'origin', vaultRemoteUrl]);
    }
  }

  const rootReadme = path.join(vaultPath, 'README.md');
  try {
    await fs.access(rootReadme);
  } catch {
    await fs.writeFile(
      rootReadme,
      [
        '# Knowledge Vault',
        '',
        'Personal engineering knowledge base generated from GitHub pushes and manual notes.',
        '',
        'This repository is intended to be opened in Obsidian as a vault.',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  const gitignorePath = path.join(vaultPath, '.gitignore');
  try {
    await fs.access(gitignorePath);
  } catch {
    await fs.writeFile(gitignorePath, '.obsidian/\n.DS_Store\n', 'utf8');
  }
}

function buildCanonicalText(event, analysis) {
  const files = (event.files || []).map((entry) => `file:${entry.path}${entry.status ? `:${entry.status}` : ''}`);
  const commits = (event.commits || []).map((entry) => `commit:${shortSha(entry.id)}:${entry.message}`);
  return [
    `project:${event.project_slug}`,
    `type:${event.event_type}`,
    `branch:${event.branch || ''}`,
    analysis.summary,
    analysis.impact,
    analysis.risks,
    analysis.nextSteps,
    ...files,
    ...commits,
    event.raw_text ? `manual:${event.raw_text}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderFilesSection(files) {
  const list = Array.isArray(files) ? files.slice(0, 80) : [];
  if (list.length === 0) {
    return '- none';
  }
  const lines = list.map((entry) => `- ${entry.status || 'M'} ${entry.path}`);
  if ((files || []).length > list.length) {
    lines.push(`- ... ${files.length - list.length} more files`);
  }
  return lines.join('\n');
}

function renderCommitsSection(commits) {
  const list = Array.isArray(commits) ? commits : [];
  if (list.length === 0) {
    return '- none';
  }
  return list
    .map((entry) => {
      const message = trimParagraph(entry.message, 'sem mensagem');
      const author = trimParagraph(entry.author_name, 'unknown');
      return `- \`${shortSha(entry.id)}\` ${message} (${author})`;
    })
    .join('\n');
}

function buildFallbackAnalysis(event) {
  if (event.event_type === 'manual_note') {
    const summary = trimParagraph(event.raw_text, 'Manual note registered.');
    return {
      source: 'fallback',
      summary,
      impact: 'Observacao manual registrada para consulta futura e vinculada ao contexto atual do repositório.',
      risks: 'Sem analise de IA configurada. Validar depois se a nota exige follow-up tecnico.',
      nextSteps: 'Revisar a nota e complementar com decisao, contexto ou link se necessario.',
    };
  }

  const commitMessages = (event.commits || []).map((entry) => trimParagraph(entry.message, '')).filter(Boolean);
  const topMessage = commitMessages[0] || 'Push registrado sem resumo de commit disponível.';
  const filesChanged = Array.isArray(event.files) ? event.files.length : 0;
  return {
    source: 'fallback',
    summary: topMessage,
    impact: `Push registrado em ${event.branch || 'branch desconhecida'} com ${filesChanged} arquivo(s) alterado(s).`,
    risks: 'Sem analise de IA configurada. Revisar possiveis regressões manualmente se a mudança for sensível.',
    nextSteps: 'Usar a nota como base para continuidade e complementar contexto manual quando necessario.',
  };
}

async function buildAiAnalysis(event) {
  if (!analysisApiKey || !analysisModel) {
    return buildFallbackAnalysis(event);
  }

  const files = (event.files || []).slice(0, 80).map((entry) => `${entry.status || 'M'} ${entry.path}`);
  const commits = (event.commits || []).map((entry) => ({
    sha: shortSha(entry.id),
    message: trimParagraph(entry.message, ''),
    author: trimParagraph(entry.author_name, ''),
  }));
  const promptPayload =
    event.event_type === 'manual_note'
      ? {
          type: event.event_type,
          project: event.project_slug,
          branch: event.branch || '',
          repo: event.repo || '',
          note: trimParagraph(event.raw_text, ''),
          head_sha: event.head_sha || '',
        }
      : {
          type: event.event_type,
          project: event.project_slug,
          branch: event.branch || '',
          repo: event.repo || '',
          head_sha: event.head_sha || '',
          diffstat: event.diffstat || {},
          files,
          commits,
        };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${analysisApiKey}`,
    },
    body: JSON.stringify({
      model: analysisModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You produce concise engineering memory notes in Brazilian Portuguese. Respond with strict JSON containing summary, impact, risks, next_steps.',
        },
        {
          role: 'user',
          content: JSON.stringify(promptPayload),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`openai_http_${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(String(content || '{}'));
  return {
    source: 'openai',
    summary: trimParagraph(parsed.summary, buildFallbackAnalysis(event).summary),
    impact: trimParagraph(parsed.impact, buildFallbackAnalysis(event).impact),
    risks: trimParagraph(parsed.risks, buildFallbackAnalysis(event).risks),
    nextSteps: trimParagraph(parsed.next_steps || parsed.nextSteps, buildFallbackAnalysis(event).nextSteps),
  };
}

async function buildAnalysis(event) {
  try {
    return await buildAiAnalysis(event);
  } catch {
    return buildFallbackAnalysis(event);
  }
}

function toRelativeVaultPath(targetPath) {
  return path.relative(vaultPath, targetPath).replace(/\\/g, '/');
}

function buildLinksSection(event) {
  const links = [];
  if (event.repository_url) {
    links.push(`- Repository: ${event.repository_url}`);
  }
  if (event.compare_url) {
    links.push(`- Compare: ${event.compare_url}`);
  }
  if (event.workflow_url) {
    links.push(`- Workflow: ${event.workflow_url}`);
  }
  if (event.commit_url) {
    links.push(`- Commit: ${event.commit_url}`);
  }
  return links.length > 0 ? links.join('\n') : '- none';
}

function renderPushNote(event, analysis, noteFrontmatter) {
  const frontmatter = renderFrontmatter(noteFrontmatter);
  const diffstatLine = event.diffstat?.summary || 'No diffstat available.';
  return [
    frontmatter,
    `# ${event.display_name} - ${shortSha(event.head_sha)}`,
    '',
    '## Resumo',
    analysis.summary,
    '',
    '## Impacto',
    analysis.impact,
    '',
    '## Riscos',
    analysis.risks,
    '',
    '## Próximos passos',
    analysis.nextSteps,
    '',
    '## Arquivos alterados',
    renderFilesSection(event.files),
    '',
    '## Diffstat',
    `- ${diffstatLine}`,
    `- files_changed: ${event.diffstat?.files_changed ?? 0}`,
    `- insertions: ${event.diffstat?.insertions ?? 0}`,
    `- deletions: ${event.diffstat?.deletions ?? 0}`,
    '',
    '## Commits',
    renderCommitsSection(event.commits),
    '',
    '## Links',
    buildLinksSection(event),
    '',
  ].join('\n');
}

function renderManualNote(event, analysis, noteFrontmatter) {
  const frontmatter = renderFrontmatter(noteFrontmatter);
  return [
    frontmatter,
    `# ${event.display_name} - manual note`,
    '',
    '## Observação original',
    trimParagraph(event.raw_text, 'Sem texto informado.'),
    '',
    '## Resumo estruturado',
    analysis.summary,
    '',
    '## Impacto',
    analysis.impact,
    '',
    '## Riscos',
    analysis.risks,
    '',
    '## Próximos passos',
    analysis.nextSteps,
    '',
    '## Contexto Git',
    `- repo: ${event.repo || 'n/a'}`,
    `- branch: ${event.branch || 'n/a'}`,
    `- head_sha: ${event.head_sha || 'n/a'}`,
    '',
  ].join('\n');
}

async function readFileIfExists(targetPath) {
  try {
    return await fs.readFile(targetPath, 'utf8');
  } catch {
    return '';
  }
}

async function upsertDailyNote(project, event, analysis, noteRelativePath, eventDate) {
  const { year, month, day, time } = getDateParts(eventDate);
  const dailyPath = path.join(vaultPath, project.notes_path, year, month, `${year}-${month}-${day}-daily.md`);
  const eventMarker = `<!-- event:${event.event_id} -->`;
  const existing = await readFileIfExists(dailyPath);
  if (existing.includes(eventMarker)) {
    return dailyPath;
  }

  const header =
    existing ||
    [
      renderFrontmatter({
        id: `daily:${project.project_slug}:${year}-${month}-${day}`,
        type: 'daily',
        project: project.project_slug,
        event_at: `${year}-${month}-${day}T00:00:00-03:00`,
        tags: ['daily', project.project_slug],
      }),
      `# ${project.display_name} - ${year}-${month}-${day}`,
      '',
      '## Events',
      '',
    ].join('\n');

  const entry = [
    eventMarker,
    `- ${time} [${event.event_type === 'manual_note' ? 'manual' : `push ${shortSha(event.head_sha)}`}](${path.basename(noteRelativePath)}) - ${analysis.summary}`,
    '',
  ].join('\n');
  await ensureDir(path.dirname(dailyPath));
  await fs.writeFile(dailyPath, `${header}${header.endsWith('\n') ? '' : '\n'}${entry}`, 'utf8');
  return dailyPath;
}

async function updateProjectIndex(project) {
  const projectRoot = path.join(vaultPath, project.notes_path);
  await ensureDir(projectRoot);
  const entries = [];

  async function walk(dir) {
    const children = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      const target = path.join(dir, child.name);
      if (child.isDirectory()) {
        await walk(target);
        continue;
      }
      if (!child.name.endsWith('.md') || child.name === 'index.md') {
        continue;
      }
      const body = await readFileIfExists(target);
      const match = body.match(/^event_at:\s+"?([^"\n]+)"?/m);
      entries.push({
        relativePath: toRelativeVaultPath(target),
        fileName: child.name,
        eventAt: match?.[1] || child.name.slice(0, 10),
      });
    }
  }

  await walk(projectRoot);
  entries.sort((left, right) => String(right.eventAt).localeCompare(String(left.eventAt)));

  const monthPrefix = (() => {
    const { year, month } = getDateParts(new Date());
    return `${year}-${month}`;
  })();
  const monthCount = entries.filter((entry) => entry.fileName.startsWith(monthPrefix)).length;
  const indexPath = path.join(projectRoot, 'index.md');
  const content = [
    renderFrontmatter({
      id: `index:${project.project_slug}`,
      type: 'project_index',
      project: project.project_slug,
      tags: ['project-index', project.project_slug],
    }),
    `# ${project.display_name}`,
    '',
    `- repository: ${project.repo_full_name}`,
    `- default_branch: ${project.default_branch}`,
    `- total_notes: ${entries.length}`,
    `- current_month_notes: ${monthCount}`,
    '',
    '## Latest Events',
    ...(entries.slice(0, 20).map((entry) => `- [${entry.fileName}](${path.basename(entry.relativePath)})`) || ['- none']),
    '',
  ].join('\n');
  await fs.writeFile(indexPath, content, 'utf8');
  return indexPath;
}

async function persistEvent(project, payload, analysis) {
  const eventDate = parseDate(payload.triggered_at);
  const { year, month, day, time } = getDateParts(eventDate);
  const event =
    payload.event_type === 'manual_note'
      ? {
          ...payload,
          display_name: project.display_name,
        }
      : {
          ...payload,
          display_name: project.display_name,
          files: Array.isArray(payload.files)
            ? payload.files.map((entry) => ({
                path: String(entry.path || ''),
                status: String(entry.status || 'M'),
              }))
            : [],
          commits: Array.isArray(payload.commits) ? payload.commits : [],
        };

  const noteFileName =
    payload.event_type === 'manual_note'
      ? `${year}-${month}-${day}-manual-${time}.md`
      : `${year}-${month}-${day}-push-${shortSha(payload.head_sha)}.md`;
  const notePath = path.join(vaultPath, project.notes_path, year, month, noteFileName);
  const noteRelativePath = toRelativeVaultPath(notePath);
  await ensureDir(path.dirname(notePath));

  const tags = unique([
    ...(project.default_tags || []),
    ...(Array.isArray(payload.tags) ? payload.tags : []),
    payload.event_type === 'manual_note' ? 'manual-note' : 'github-push',
  ]);
  const noteFrontmatter = {
    id: payload.event_id,
    type: payload.event_type === 'manual_note' ? 'manual_note' : 'dev_log',
    project: project.project_slug,
    repo: payload.repo || project.repo_full_name,
    branch: payload.branch || project.default_branch,
    event_at: eventDate.toISOString(),
    source: payload.source || 'n8n',
    head_sha: payload.head_sha || '',
    author: payload.source_actor || '',
    tags,
    semantic_text_version: semanticTextVersion,
    analysis_source: analysis.source,
  };

  const content =
    payload.event_type === 'manual_note'
      ? renderManualNote(event, analysis, noteFrontmatter)
      : renderPushNote(event, analysis, noteFrontmatter);
  await fs.writeFile(notePath, content, 'utf8');

  const dailyPath = await upsertDailyNote(project, payload, analysis, noteRelativePath, eventDate);
  const indexPath = await updateProjectIndex(project);

  await runGit(['add', '.']);
  const commitMessage = `kb: ${project.project_slug} ${payload.event_type} ${payload.event_type === 'manual_note' ? time : shortSha(payload.head_sha)}`;
  const commitResult = await runGit(['commit', '-m', commitMessage], { allowFailure: true });

  let pushed = false;
  let pushMessage = 'disabled';
  if (enableGitPush) {
    const remoteResult = await runGit(['remote'], { allowFailure: true });
    if (String(remoteResult.stdout || '').split(/\r?\n/).includes('origin')) {
      const pushResult = await runGit(['push', 'origin', 'HEAD'], { allowFailure: true });
      pushed = pushResult.ok;
      pushMessage = pushResult.ok ? 'pushed' : pushResult.stderr || 'push_failed';
    } else {
      pushMessage = 'remote_missing';
    }
  }

  return {
    ok: true,
    eventId: payload.event_id,
    eventType: payload.event_type,
    project: project.project_slug,
    notePath: noteRelativePath,
    dailyPath: toRelativeVaultPath(dailyPath),
    indexPath: toRelativeVaultPath(indexPath),
    commitCreated: commitResult.ok,
    commitMessage,
    pushAttempted: enableGitPush,
    pushStatus: pushMessage,
    pushed,
    summary: analysis.summary,
    semanticText: buildCanonicalText(payload, analysis),
  };
}

function normalizePayload(rawPayload, project) {
  const payload = { ...(rawPayload || {}) };
  payload.project_slug = project.project_slug;
  payload.event_type = String(payload.event_type || '').trim();
  payload.event_id = String(payload.event_id || '').trim();
  payload.source = String(payload.source || 'n8n').trim();
  payload.triggered_at = String(payload.triggered_at || new Date().toISOString()).trim();
  payload.repo = String(payload.repo || project.repo_full_name).trim();
  payload.branch = String(payload.branch || project.default_branch).trim();
  payload.tags = Array.isArray(payload.tags) ? payload.tags : [];

  if (!payload.event_type || !payload.event_id) {
    throw new Error('invalid_payload_missing_type_or_id');
  }
  if (payload.event_type === 'manual_note') {
    payload.raw_text = trimParagraph(payload.raw_text, '');
    if (!payload.raw_text) {
      throw new Error('manual_note_without_text');
    }
  }
  return payload;
}

async function main() {
  const encoded = process.argv[2];
  if (!encoded) {
    throw new Error('missing_base64_payload');
  }

  const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  const { headers, payload } = unwrapInput(decoded);
  assertAuthorized(headers);
  const projects = await readManifest();
  const project = resolveProject(payload, projects);
  const normalizedPayload = normalizePayload(payload, project);
  await ensureVaultRepository();
  const analysis = await buildAnalysis(normalizedPayload);
  const result = await persistEvent(project, normalizedPayload, analysis);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const result = {
    ok: false,
    status: 'error',
    message: String(error?.message || error),
    alertMessage: `Knowledge base ingestion failed: ${String(error?.message || error)}`,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 0;
});
