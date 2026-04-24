#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';

const execFile = promisify(execFileCb);
const vaultPath = process.env.KB_VAULT_PATH || '/home/node/knowledge-vault';
const archivePath = process.env.KB_ARCHIVE_PATH || '/home/node/knowledge-vault-archive';
const manifestPath = process.env.KB_PROJECTS_MANIFEST || '/home/node/knowledge-base/projects.json';
const maxVaultAttachmentBytes = Number(process.env.KB_ATTACHMENT_MAX_VAULT_BYTES || 10 * 1024 * 1024);
const semanticTextVersion = 1;
const aiProvider = (process.env.KB_AI_PROVIDER || 'openai').trim().toLowerCase();
const openaiModel = (process.env.KB_OPENAI_MODEL || '').trim();
const openaiApiKey = (process.env.KB_OPENAI_API_KEY || '').trim();
const geminiModel = (process.env.KB_GEMINI_MODEL || 'gemini-1.5-flash').trim();
const geminiApiKey = (process.env.KB_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const webhookSecret = (process.env.KB_WEBHOOK_SECRET || '').trim();
const githubWebhookSecret = (process.env.KB_GITHUB_APP_WEBHOOK_SECRET || '').trim();
const enableGitPush = String(process.env.KB_ENABLE_GIT_PUSH || 'false').toLowerCase() === 'true';
const gitBatchMode = String(process.env.KB_GIT_BATCH_MODE || 'false').toLowerCase() === 'true';
const vaultRemoteUrl = (process.env.KB_VAULT_REMOTE_URL || '').trim();
const gitUserName = (process.env.KB_VAULT_GIT_USER_NAME || 'knowledge-bot').trim();
const gitUserEmail = (process.env.KB_VAULT_GIT_USER_EMAIL || 'knowledge-bot@example.local').trim();
const gitPushUsername = (process.env.KB_VAULT_GIT_PUSH_USERNAME || '').trim();
const gitPushToken = (process.env.KB_VAULT_GIT_PUSH_TOKEN || '').trim();
const ignoredReposEnv = (process.env.KB_IGNORE_REPOS || '').trim();
const githubApiToken = (process.env.KB_GITHUB_API_TOKEN || process.env.KB_VAULT_GIT_PUSH_TOKEN || '').trim();
const maxDiffChars = Number(process.env.KB_MAX_DIFF_CHARS || 60000);
const manualNoteKinds = new Set(['manual_note', 'bug', 'resume', 'article', 'daily']);
const noteTypes = new Set(['event', 'knowledge', 'decision', 'incident', 'followup', 'project_summary']);
const importanceLevels = new Set(['low', 'medium', 'high']);
const statusValues = new Set(['open', 'active', 'resolved', 'archived']);
const vaultFolders = {
  home: '00 Home',
  projects: '10 Projects',
  inbox: '20 Inbox',
  knowledge: '30 Knowledge',
  decisions: '40 Decisions',
  incidents: '50 Incidents',
  followups: '60 Followups',
  reminders: '70 Reminders',
  assets: '90 Assets',
};
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

function parseRepoFullNameFromRemoteUrl(remoteUrl) {
  const value = String(remoteUrl || '').trim();
  if (!value) {
    return '';
  }
  const httpsMatch = value.match(/^https?:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch) {
    return httpsMatch[1].toLowerCase();
  }
  const sshMatch = value.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch) {
    return sshMatch[1].toLowerCase();
  }
  return '';
}

function buildIgnoredReposSet() {
  const repos = new Set(
    ignoredReposEnv
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
  const vaultRepo = parseRepoFullNameFromRemoteUrl(vaultRemoteUrl);
  if (vaultRepo) {
    repos.add(vaultRepo);
  }
  return repos;
}

const ignoredRepos = buildIgnoredReposSet();

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

function decodeRawBody(rawBodyB64) {
  if (!rawBodyB64) {
    return '';
  }
  try {
    return Buffer.from(String(rawBodyB64), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function serializePayloadFallback(value) {
  if (!value || typeof value !== 'object') {
    return '';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function parseDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function isValidCalendarDateParts(year, month, day) {
  const parsedYear = Number(year);
  const parsedMonth = Number(month);
  const parsedDay = Number(day);
  if (!Number.isInteger(parsedYear) || !Number.isInteger(parsedMonth) || !Number.isInteger(parsedDay)) {
    return false;
  }
  const date = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay));
  return (
    date.getUTCFullYear() === parsedYear &&
    date.getUTCMonth() === parsedMonth - 1 &&
    date.getUTCDate() === parsedDay
  );
}

function normalizeReminderDate(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  let year = '';
  let month = '';
  let day = '';
  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    [, year, month, day] = match;
    return isValidCalendarDateParts(year, month, day) ? `${year}-${month}-${day}` : '';
  }
  match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return '';
  }
  [, day, month, year] = match;
  return isValidCalendarDateParts(year, month, day) ? `${year}-${month}-${day}` : '';
}

function normalizeReminderTime(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  const match = text.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return '';
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return '';
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function buildReminderAt(reminderDate, reminderTime) {
  if (!reminderDate || !reminderTime) {
    return '';
  }
  return `${reminderDate}T${reminderTime}:00-03:00`;
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

function parseTags(value) {
  if (Array.isArray(value)) {
    return unique(value.map((entry) => slugify(String(entry || ''))).filter(Boolean));
  }
  const text = String(value || '').trim();
  if (!text) {
    return [];
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return unique(parsed.map((entry) => slugify(String(entry || ''))).filter(Boolean));
      }
    } catch {
      // Fallback to CSV parser below.
    }
  }
  return unique(
    text
      .split(',')
      .map((entry) => slugify(entry))
      .filter(Boolean),
  );
}

function parseList(value) {
  if (Array.isArray(value)) {
    return unique(value.map((entry) => String(entry || '').trim()).filter(Boolean));
  }
  const text = String(value || '').trim();
  if (!text) {
    return [];
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return unique(parsed.map((entry) => String(entry || '').trim()).filter(Boolean));
      }
    } catch {
      // Fallback to CSV parser below.
    }
  }
  return unique(
    text
      .split(',')
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
  );
}

function parseBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = slugify(String(value || '').replace(/_/g, '-')).replace(/-/g, '_');
  if (allowed.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function sanitizeFileStem(value, fallback = 'note') {
  const stem = slugify(String(value || ''));
  return stem || fallback;
}

async function readManifest() {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  return projects.map((project) => ({
    ...project,
    name: String(project.name || project.display_name || project.project_slug || '').trim(),
    owners: Array.isArray(project.owners) ? project.owners.map((entry) => String(entry || '').trim()).filter(Boolean) : [],
    criticality: normalizeEnum(project.criticality, importanceLevels, 'medium'),
    status: normalizeEnum(project.status, statusValues, 'active'),
    aliases: parseList(project.aliases),
    area: String(project.area || 'engineering').trim() || 'engineering',
  }));
}

async function readStdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function unwrapInput(decoded) {
  if (decoded && typeof decoded === 'object' && decoded.body && typeof decoded.body === 'object') {
    const payload = decoded.body;
    return {
      headers: normalizeHeaders(decoded.headers),
      payload,
      binaries: decoded.binaries && typeof decoded.binaries === 'object' ? decoded.binaries : {},
      rawBody: decodeRawBody(decoded.raw_body_b64) || serializePayloadFallback(payload),
    };
  }
  const payload = decoded;
  return {
    headers: normalizeHeaders(decoded?.headers),
    payload,
    binaries: decoded?.binaries && typeof decoded.binaries === 'object' ? decoded.binaries : {},
    rawBody: decodeRawBody(decoded?.raw_body_b64) || serializePayloadFallback(payload),
  };
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function assertManualSecret(headers) {
  if (!webhookSecret) {
    return;
  }
  const received = String(headers['x-kb-secret'] || '').trim();
  if (!received || !timingSafeEqualString(received, webhookSecret)) {
    throw new Error('unauthorized_manual_request');
  }
}

function assertGithubSignature(headers, rawBody) {
  if (!githubWebhookSecret) {
    throw new Error('missing_github_webhook_secret');
  }
  const received = String(headers['x-hub-signature-256'] || '').trim();
  if (!received) {
    throw new Error('missing_github_signature');
  }
  const expected = `sha256=${crypto.createHmac('sha256', githubWebhookSecret).update(rawBody).digest('hex')}`;
  if (!timingSafeEqualString(received, expected)) {
    throw new Error('invalid_github_signature');
  }
}

function normalizeFilesFromGithubPush(payload) {
  const fileStatus = new Map();
  for (const commit of Array.isArray(payload.commits) ? payload.commits : []) {
    for (const filePath of Array.isArray(commit.added) ? commit.added : []) {
      fileStatus.set(String(filePath), 'A');
    }
    for (const filePath of Array.isArray(commit.modified) ? commit.modified : []) {
      if (!fileStatus.has(String(filePath))) {
        fileStatus.set(String(filePath), 'M');
      }
    }
    for (const filePath of Array.isArray(commit.removed) ? commit.removed : []) {
      fileStatus.set(String(filePath), 'D');
    }
  }

  return [...fileStatus.entries()]
    .map(([filePath, status]) => ({ path: filePath, status }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeGithubPushPayload(payload, headers) {
  const githubEvent = String(headers['x-github-event'] || '').trim();
  if (githubEvent === 'ping') {
    return {
      ok: true,
      skipped: true,
      reason: 'github_ping',
      source: 'github_app',
    };
  }
  if (githubEvent !== 'push') {
    return {
      ok: true,
      skipped: true,
      reason: `unsupported_github_event:${githubEvent || 'unknown'}`,
      source: 'github_app',
    };
  }
  if (payload?.deleted || /^0+$/.test(String(payload?.after || ''))) {
    return {
      ok: true,
      skipped: true,
      reason: 'deleted_ref',
      source: 'github_app',
    };
  }

  const repo = String(payload?.repository?.full_name || '').trim();
  if (!repo) {
    throw new Error('github_push_without_repo');
  }
  if (ignoredRepos.has(repo.toLowerCase())) {
    return {
      ok: true,
      skipped: true,
      reason: `ignored_repo:${repo}`,
      source: 'github_app',
    };
  }

  const branch = String(payload?.ref || '').replace(/^refs\/heads\//, '').trim() || 'main';
  const commits = (Array.isArray(payload?.commits) ? payload.commits : []).map((entry) => ({
    id: String(entry?.id || ''),
    author_name: trimParagraph(entry?.author?.name, payload?.pusher?.name || 'unknown'),
    author_email: trimParagraph(entry?.author?.email, ''),
    timestamp: trimParagraph(entry?.timestamp, payload?.head_commit?.timestamp || ''),
    message: trimParagraph(entry?.message, 'sem mensagem'),
    url: String(entry?.url || '').trim(),
  }));
  const files = normalizeFilesFromGithubPush(payload);
  const filesChanged = files.length;
  const compareUrl = String(payload?.compare || '').trim();
  const repositoryUrl = String(payload?.repository?.html_url || '').trim();
  const headSha = String(payload?.after || '').trim();
  const beforeSha = String(payload?.before || '').trim();
  const headCommitUrl = String(payload?.head_commit?.url || (repositoryUrl && headSha ? `${repositoryUrl}/commit/${headSha}` : '')).trim();

  return {
    event_id: `github_push:${repo}:${headSha}`,
    event_type: 'github_push',
    project_slug: '',
    repo,
    branch,
    triggered_at: trimParagraph(payload?.head_commit?.timestamp, new Date().toISOString()),
    source_actor: trimParagraph(payload?.sender?.login, payload?.pusher?.name || 'github'),
    source: 'github_app',
    head_sha: headSha,
    _before_sha: beforeSha,
    compare_url: compareUrl,
    workflow_url: '',
    repository_url: repositoryUrl,
    delivery_ref: String(headers['x-github-delivery'] || '').trim(),
    commits,
    files,
    diffstat: {
      files_changed: filesChanged,
      insertions: 0,
      deletions: 0,
      summary: `${filesChanged} file(s) changed across ${commits.length} commit(s)`,
    },
    commit_url: headCommitUrl,
    tags: ['push', 'github-app'],
  };
}

function autoProjectFromPayload(payload) {
  const repoFullName = String(payload.repo || payload.repo_full_name || '').trim();
  const repoName = repoFullName ? repoFullName.split('/').pop() || repoFullName : String(payload.project_slug || payload.project || 'project');
  const projectSlug = slugify(payload.project_slug || repoName);
  return {
    project_slug: projectSlug,
    display_name: repoName,
    name: repoName,
    repo_full_name: repoFullName,
    default_branch: String(payload.branch || 'main').trim() || 'main',
    default_tags: [],
    enabled: true,
    notes_path: `${vaultFolders.projects}/${projectSlug}.md`,
    owners: [],
    criticality: 'medium',
    status: 'active',
    aliases: [],
    area: 'engineering',
  };
}

function resolveProject(payload, projects) {
  const projectSlug = String(payload.project_slug || '').trim();
  const repo = String(payload.repo || payload.repo_full_name || '').trim();
  const project =
    projects.find((entry) => entry.project_slug === projectSlug) ||
    projects.find((entry) => entry.repo_full_name === repo);

  if (project) {
    if (!project.enabled) {
      throw new Error(`disabled_project:${project.project_slug}`);
    }
    return project;
  }

  return autoProjectFromPayload(payload);
}

async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

async function runGit(args, { allowFailure = false, gitConfigs = [] } = {}) {
  try {
    const configArgs = [
      '-c',
      `safe.directory=${vaultPath}`,
      ...gitConfigs.flatMap((entry) => ['-c', entry]),
    ];
    const result = await execFile('git', [...configArgs, '-C', vaultPath, ...args], {
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

function buildPushGitConfigs(remoteUrl) {
  if (!remoteUrl || !/^https:\/\//i.test(remoteUrl)) {
    return [];
  }
  if (!gitPushUsername || !gitPushToken) {
    return [];
  }
  const auth = Buffer.from(`${gitPushUsername}:${gitPushToken}`, 'utf8').toString('base64');
  return [`http.extraheader=AUTHORIZATION: Basic ${auth}`];
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
        'Operational engineering memory generated from GitHub pushes and manual notes.',
        '',
        'Open this repository as an Obsidian vault.',
        '',
        'Primary entrypoint: [[00 Home/Home]].',
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

function vaultLink(relativePath, label = '') {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/\.md$/i, '');
  if (!normalized) {
    return label || '';
  }
  return label ? `[[${normalized}|${label}]]` : `[[${normalized}]]`;
}

function projectSummaryPath(project) {
  return path.join(vaultPath, vaultFolders.projects, `${project.project_slug}.md`);
}

function folderForCanonicalType(type) {
  if (type === 'knowledge') {
    return vaultFolders.knowledge;
  }
  if (type === 'decision') {
    return vaultFolders.decisions;
  }
  if (type === 'incident') {
    return vaultFolders.incidents;
  }
  return vaultFolders.inbox;
}

function splitMarkdownLines(content) {
  if (Array.isArray(content)) {
    return content.flatMap((entry) => splitMarkdownLines(entry));
  }
  return String(content || '')
    .split('\n')
    .map((line) => line.trimEnd());
}

function renderCallout(type, title, bodyLines = []) {
  return [
    `> [!${type}] ${title}`,
    ...splitMarkdownLines(bodyLines).map((line) => (line ? `> ${line}` : '>')),
    '',
  ].join('\n');
}

function renderQuickLinks(title, intro, links = []) {
  return [
    `## ${title}`,
    intro,
    '',
    ...links.map((link) => `- ${link}`),
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderMetadataList(items = []) {
  return items
    .filter((item) => item && item.value !== undefined && item.value !== null && String(item.value).trim() !== '')
    .map((item) => `- **${item.label}:** ${item.value}`)
    .join('\n');
}

function renderImportanceBadge(value) {
  const normalized = normalizeEnum(value, importanceLevels, '');
  const labels = {
    low: 'BAIXA',
    medium: 'MEDIA',
    high: 'ALTA',
  };
  return `\`${labels[normalized] || 'N/A'}\``;
}

function renderStatusBadge(value) {
  const normalized = normalizeEnum(value, statusValues, '');
  const labels = {
    open: 'ABERTO',
    active: 'ATIVO',
    resolved: 'RESOLVIDO',
    archived: 'ARQUIVADO',
  };
  return `\`${labels[normalized] || 'N/A'}\``;
}

function renderCriticalityBadge(value) {
  const normalized = normalizeEnum(value, importanceLevels, '');
  const labels = {
    low: 'BAIXA',
    medium: 'MEDIA',
    high: 'ALTA',
  };
  return `\`${labels[normalized] || 'N/A'}\``;
}

function renderDataviewSection({
  title,
  description = '',
  sourceFolder,
  whereClause = '',
  sortField = 'occurred_at',
  sortDirection = 'DESC',
  limit = 20,
  columns = [],
}) {
  const safeColumns = [...columns, 'file.link AS Nota'];
  return [
    `## ${title}`,
    description,
    '',
    '```dataview',
    `TABLE ${safeColumns.join(', ')}`,
    `FROM "${sourceFolder}"`,
    whereClause ? `WHERE ${whereClause}` : '',
    `SORT ${sortField} ${sortDirection}`,
    `LIMIT ${limit}`,
    '```',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function writeGeneratedPage(relativePath, content) {
  const targetPath = path.join(vaultPath, relativePath);
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, content, 'utf8');
  return targetPath;
}

function renderHomePage() {
  return [
    renderFrontmatter({
      id: 'home',
      type: 'dashboard',
      canonical: true,
      tags: ['dashboard', 'home'],
    }),
    '# Home',
    '',
    renderCallout('info', 'Como usar este vault', [
      'Comece por este dashboard para entender o que exige atencao agora.',
      'Abra Projetos para contexto por iniciativa e use Pendencias e Incidentes para triagem diaria.',
      'Knowledge e Decisoes concentram o que ja foi consolidado e o que mudou de rumo.',
    ]),
    renderQuickLinks('Links rapidos', 'Atalhos para as areas mais usadas do vault.', [
      `[[10 Projects/Projects|Projetos]]`,
      `[[60 Followups/Followups|Pendencias]]`,
      `[[70 Reminders/Reminders|Lembretes]]`,
      `[[50 Incidents/Incidents|Incidentes]]`,
      `[[30 Knowledge/Knowledge|Conhecimento]]`,
      `[[40 Decisions/Decisions|Decisoes]]`,
    ]),
    renderCallout('warning', 'Atencao agora', [
      'Priorize pendencias com prazo proximo e incidentes ainda abertos.',
      'Quando algo parecer relevante, abra a pagina do projeto para acessar historico, conhecimento e proximos passos.',
    ]),
    '## Radar rapido',
    'Leia estas secoes primeiro para ter um panorama executivo do que mudou e do que esta em risco.',
    '',
    renderDataviewSection({
      title: 'Pendencias com prazo mais proximo',
      description: 'Mostra o que pode virar gargalo primeiro.',
      sourceFolder: vaultFolders.followups,
      whereClause: 'type = "followup" AND status != "resolved" AND status != "archived"',
      sortField: 'follow_up_by',
      sortDirection: 'ASC',
      limit: 12,
      columns: ['follow_up_by AS Prazo', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Incidentes ativos',
      description: 'Use esta visao para localizar problemas ainda sem encerramento.',
      sourceFolder: vaultFolders.incidents,
      whereClause: 'type = "incident" AND status != "resolved" AND status != "archived"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 12,
      columns: ['occurred_at AS Quando', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'O que mudou recentemente',
      description: 'Eventos novos para leitura rapida do contexto mais recente.',
      sourceFolder: vaultFolders.inbox,
      whereClause: 'type = "event"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 15,
      columns: ['occurred_at AS Quando', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderQuickLinks('Navegacao por objetivo', 'Escolha o caminho conforme a pergunta do usuario.', [
      `Ver estado dos projetos: [[10 Projects/Projects|Projetos]]`,
      `Entender decisoes recentes: [[40 Decisions/Decisions|Decisoes]]`,
      `Consultar conhecimento consolidado: [[30 Knowledge/Knowledge|Conhecimento]]`,
      `Atacar pendencias abertas: [[60 Followups/Followups|Pendencias]]`,
      `Revisar lembretes ativos: [[70 Reminders/Reminders|Lembretes]]`,
    ]),
    renderDataviewSection({
      title: 'Lembretes ativos',
      description: 'Itens com data definida para resumo diario ou disparo exato no Telegram.',
      sourceFolder: vaultFolders.reminders,
      whereClause: 'type = "reminder" AND status != "resolved" AND status != "archived"',
      sortField: 'reminder_at',
      sortDirection: 'ASC',
      limit: 12,
      columns: ['reminder_date AS Data', 'reminder_time AS Horario', 'project AS Projeto', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Decisoes recentes',
      description: 'Resumo rapido do que mudou de direcao ou padrao.',
      sourceFolder: vaultFolders.decisions,
      whereClause: 'type = "decision"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 10,
      columns: ['occurred_at AS Quando', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
  ].join('\n');
}

function renderProjectsPage() {
  return [
    renderFrontmatter({
      id: 'projects-dashboard',
      type: 'dashboard',
      canonical: true,
      tags: ['dashboard', 'projects'],
    }),
    '# Projetos',
    '',
    renderCallout('info', 'Visao de portfolio', [
      'Cada pagina de projeto concentra contexto, saude operacional e navegacao para conhecimento, decisoes, incidentes e pendencias.',
      'Use a tabela principal para descobrir o que e mais critico e as secoes abaixo para localizar onde existe atencao imediata.',
    ]),
    renderQuickLinks('Links rapidos', 'Comece pela listagem completa ou volte para o painel geral.', [
      `[[00 Home/Home|Home]]`,
      `[[50 Incidents/Incidents|Incidentes]]`,
      `[[60 Followups/Followups|Pendencias]]`,
      `[[70 Reminders/Reminders|Lembretes]]`,
    ]),
    renderDataviewSection({
      title: 'Todos os projetos',
      description: 'Panorama geral com prioridade de leitura por criticidade e status.',
      sourceFolder: vaultFolders.projects,
      whereClause: 'type = "project_summary"',
      sortField: 'criticality',
      sortDirection: 'DESC',
      limit: 100,
      columns: ['file.link AS Projeto', 'criticality AS Criticidade', 'status AS Estado', 'area AS Area', 'owners AS Responsaveis'],
    }),
    '## Projetos com atencao agora',
    'As duas secoes seguintes mostram os pontos de tensao mais imediatos sem precisar abrir cada projeto.',
    '',
    renderDataviewSection({
      title: 'Incidentes abertos por projeto',
      description: 'Lista de incidentes ainda ativos para triagem rapida.',
      sourceFolder: vaultFolders.incidents,
      whereClause: 'type = "incident" AND status != "resolved" AND status != "archived"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 15,
      columns: ['project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Pendencias abertas por projeto',
      description: 'Use esta visao para identificar follow-ups sem conclusao.',
      sourceFolder: vaultFolders.followups,
      whereClause: 'type = "followup" AND status != "resolved" AND status != "archived"',
      sortField: 'follow_up_by',
      sortDirection: 'ASC',
      limit: 15,
      columns: ['follow_up_by AS Prazo', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Lembretes ativos por projeto',
      description: 'Lembretes com data definida para envio diario ou exato.',
      sourceFolder: vaultFolders.reminders,
      whereClause: 'type = "reminder" AND status != "resolved" AND status != "archived"',
      sortField: 'reminder_at',
      sortDirection: 'ASC',
      limit: 15,
      columns: ['reminder_date AS Data', 'reminder_time AS Horario', 'project AS Projeto', 'status AS Estado'],
    }),
  ].join('\n');
}

function renderKnowledgePage() {
  return [
    renderFrontmatter({
      id: 'knowledge-dashboard',
      type: 'dashboard',
      canonical: true,
      tags: ['dashboard', 'knowledge'],
    }),
    '# Conhecimento',
    '',
    renderCallout('info', 'Conhecimento consolidado', [
      'Aqui ficam notas canonicas que merecem consulta recorrente.',
      'Quando quiser contexto de um projeto antes de agir, comece por esta area.',
    ]),
    renderQuickLinks('Links rapidos', 'Acesse rapidamente o contexto relacionado.', [
      `[[00 Home/Home|Home]]`,
      `[[10 Projects/Projects|Projetos]]`,
      `[[40 Decisions/Decisions|Decisoes]]`,
    ]),
    renderDataviewSection({
      title: 'Conhecimento recente',
      description: 'Notas consolidadas mais novas para revisao rapida.',
      sourceFolder: vaultFolders.knowledge,
      whereClause: 'type = "knowledge" AND canonical = true',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 30,
      columns: ['occurred_at AS Quando', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Conhecimento de maior prioridade',
      description: 'Entradas de alto impacto para leitura antes de decidir ou executar.',
      sourceFolder: vaultFolders.knowledge,
      whereClause: 'type = "knowledge" AND canonical = true AND importance = "high"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 20,
      columns: ['project AS Projeto', 'status AS Estado'],
    }),
  ].join('\n');
}

function renderDecisionsPage() {
  return [
    renderFrontmatter({
      id: 'decisions-dashboard',
      type: 'dashboard',
      canonical: true,
      tags: ['dashboard', 'decisions'],
    }),
    '# Decisoes',
    '',
    renderCallout('info', 'Registro de direcao', [
      'Use esta area para entender o que foi decidido e qual impacto esperado cada decisao carrega.',
    ]),
    renderQuickLinks('Links rapidos', 'Volte para o painel geral ou navegue pelo contexto de projeto.', [
      `[[00 Home/Home|Home]]`,
      `[[10 Projects/Projects|Projetos]]`,
      `[[30 Knowledge/Knowledge|Conhecimento]]`,
    ]),
    renderDataviewSection({
      title: 'Decisoes recentes',
      description: 'O que mudou de direcao recentemente.',
      sourceFolder: vaultFolders.decisions,
      whereClause: 'type = "decision"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 30,
      columns: ['occurred_at AS Quando', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Decisoes de alta importancia',
      description: 'Mudancas com potencial maior de impacto operacional ou arquitetural.',
      sourceFolder: vaultFolders.decisions,
      whereClause: 'type = "decision" AND importance = "high"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 20,
      columns: ['project AS Projeto', 'status AS Estado'],
    }),
  ].join('\n');
}

function renderIncidentsPage() {
  return [
    renderFrontmatter({
      id: 'incidents-dashboard',
      type: 'dashboard',
      canonical: true,
      tags: ['dashboard', 'incidents'],
    }),
    '# Incidentes',
    '',
    renderCallout('warning', 'Painel de incidentes', [
      'Primeiro veja o que ainda esta aberto. O historico resolvido fica abaixo apenas para consulta e aprendizado.',
    ]),
    renderQuickLinks('Links rapidos', 'Atalhos para contexto relacionado.', [
      `[[00 Home/Home|Home]]`,
      `[[10 Projects/Projects|Projetos]]`,
      `[[60 Followups/Followups|Pendencias]]`,
    ]),
    renderDataviewSection({
      title: 'Incidentes abertos',
      description: 'Lista principal para triagem e acompanhamento.',
      sourceFolder: vaultFolders.incidents,
      whereClause: 'type = "incident" AND status != "resolved" AND status != "archived"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 30,
      columns: ['occurred_at AS Quando', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Historico resolvido',
      description: 'Consulte esta visao para entender o que ja foi encerrado e reaproveitar aprendizados.',
      sourceFolder: vaultFolders.incidents,
      whereClause: 'type = "incident" AND (status = "resolved" OR status = "archived")',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 20,
      columns: ['occurred_at AS Quando', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
  ].join('\n');
}

function renderFollowupsPage() {
  return [
    renderFrontmatter({
      id: 'followups-dashboard',
      type: 'dashboard',
      canonical: true,
      tags: ['dashboard', 'followups'],
    }),
    '# Pendencias',
    '',
    renderCallout('warning', 'Fila de acompanhamento', [
      'Aqui esta o que ainda precisa de acao. Comece pelos prazos mais proximos e depois revise o restante da fila.',
    ]),
    renderQuickLinks('Links rapidos', 'Navegue direto para o painel geral ou para a origem dos problemas.', [
      `[[00 Home/Home|Home]]`,
      `[[10 Projects/Projects|Projetos]]`,
      `[[50 Incidents/Incidents|Incidentes]]`,
    ]),
    renderDataviewSection({
      title: 'Pendencias vencendo primeiro',
      description: 'Priorize por prazo para reduzir risco de esquecimento.',
      sourceFolder: vaultFolders.followups,
      whereClause: 'type = "followup" AND status != "resolved" AND status != "archived"',
      sortField: 'follow_up_by',
      sortDirection: 'ASC',
      limit: 30,
      columns: ['follow_up_by AS Prazo', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Pendencias recentes',
      description: 'Use esta visao para revisar follow-ups adicionados recentemente.',
      sourceFolder: vaultFolders.followups,
      whereClause: 'type = "followup"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 20,
      columns: ['occurred_at AS Criado em', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
  ].join('\n');
}

function renderRemindersPage() {
  return [
    renderFrontmatter({
      id: 'reminders-dashboard',
      type: 'dashboard',
      canonical: true,
      tags: ['dashboard', 'reminders'],
    }),
    '# Lembretes',
    '',
    renderCallout('warning', 'Fila de lembretes', [
      'Esta area concentra os itens que devem aparecer no resumo diario das 09:00 e, quando houver horario, no disparo exato via Telegram.',
    ]),
    renderQuickLinks('Links rapidos', 'Use estes atalhos para navegar pelo restante do contexto.', [
      `[[00 Home/Home|Home]]`,
      `[[10 Projects/Projects|Projetos]]`,
      `[[60 Followups/Followups|Pendencias]]`,
    ]),
    renderDataviewSection({
      title: 'Lembretes com horario exato',
      description: 'Itens com data e horario definidos para envio pontual.',
      sourceFolder: vaultFolders.reminders,
      whereClause: 'type = "reminder" AND reminder_at AND status != "resolved" AND status != "archived"',
      sortField: 'reminder_at',
      sortDirection: 'ASC',
      limit: 30,
      columns: ['reminder_date AS Data', 'reminder_time AS Horario', 'project AS Projeto', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Todos os lembretes ativos',
      description: 'Base usada pelo resumo diario das 09:00.',
      sourceFolder: vaultFolders.reminders,
      whereClause: 'type = "reminder" AND status != "resolved" AND status != "archived"',
      sortField: 'reminder_date',
      sortDirection: 'ASC',
      limit: 40,
      columns: ['reminder_date AS Data', 'reminder_time AS Horario', 'project AS Projeto', 'importance AS Prioridade', 'status AS Estado'],
    }),
  ].join('\n');
}

function renderProjectSummary(project) {
  const projectPath = `${vaultFolders.projects}/${project.project_slug}`;
  return [
    renderFrontmatter({
      id: `project:${project.project_slug}`,
      type: 'project_summary',
      canonical: true,
      project: project.project_slug,
      name: project.name || project.display_name || project.project_slug,
      repo: project.repo_full_name || '',
      criticality: project.criticality || 'medium',
      status: project.status || 'active',
      area: project.area || 'engineering',
      owners: project.owners || [],
      aliases: project.aliases || [],
      tags: unique(['project_summary', project.project_slug, ...(project.default_tags || [])]),
    }),
    `# ${project.display_name || project.name || project.project_slug}`,
    '',
    renderCallout('info', 'Estado atual do projeto', [
      renderMetadataList([
        { label: 'Criticidade', value: renderCriticalityBadge(project.criticality || 'medium') },
        { label: 'Status', value: renderStatusBadge(project.status || 'active') },
        { label: 'Responsaveis', value: (project.owners || []).join(', ') || 'n/a' },
        { label: 'Area', value: project.area || 'engineering' },
        { label: 'Repo', value: project.repo_full_name || 'n/a' },
        { label: 'Branch padrao', value: project.default_branch || 'main' },
      ]),
    ]),
    renderQuickLinks('Onde olhar primeiro', 'Atalhos para navegar pelo contexto do projeto.', [
      `[[#Ultimos eventos|Ultimos eventos]] para ver a linha do tempo mais recente`,
      `[[#Conhecimento consolidado|Conhecimento consolidado]] para referencia reutilizavel`,
      `[[#Decisoes recentes|Decisoes recentes]] para mudancas de rumo`,
      `[[#Incidentes abertos|Incidentes abertos]] para problemas ativos`,
      `[[#Pendencias abertas|Pendencias abertas]] para a fila de acompanhamento`,
      `[[#Lembretes ativos|Lembretes ativos]] para compromissos com data definida`,
    ]),
    '## Saude do projeto',
    'Estas secoes ajudam a entender rapidamente o momento atual do projeto sem abrir varias notas em sequencia.',
    '',
    renderDataviewSection({
      title: 'Ultimos eventos',
      description: 'Linha do tempo recente do que aconteceu.',
      sourceFolder: vaultFolders.inbox,
      whereClause: 'project = this.project AND type = "event"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 12,
      columns: ['occurred_at AS Quando', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Conhecimento consolidado',
      description: 'Notas canonicas para reuso e consulta antes de agir.',
      sourceFolder: vaultFolders.knowledge,
      whereClause: 'project = this.project AND canonical = true',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 12,
      columns: ['importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Decisoes recentes',
      description: 'Mudancas relevantes de direcionamento ou padrao.',
      sourceFolder: vaultFolders.decisions,
      whereClause: 'project = this.project',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 10,
      columns: ['importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Incidentes abertos',
      description: 'Problemas ainda sem conclusao para este projeto.',
      sourceFolder: vaultFolders.incidents,
      whereClause: 'project = this.project AND status != "resolved" AND status != "archived"',
      sortField: 'occurred_at',
      sortDirection: 'DESC',
      limit: 10,
      columns: ['importance AS Prioridade', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Pendencias abertas',
      description: 'Acoes pendentes que ainda precisam de acompanhamento.',
      sourceFolder: vaultFolders.followups,
      whereClause: 'project = this.project AND status != "resolved" AND status != "archived"',
      sortField: 'follow_up_by',
      sortDirection: 'ASC',
      limit: 10,
      columns: ['importance AS Prioridade', 'follow_up_by AS Prazo', 'status AS Estado'],
    }),
    renderDataviewSection({
      title: 'Lembretes ativos',
      description: 'Itens do projeto que vao aparecer no Telegram por resumo diario ou disparo exato.',
      sourceFolder: vaultFolders.reminders,
      whereClause: 'project = this.project AND status != "resolved" AND status != "archived"',
      sortField: 'reminder_at',
      sortDirection: 'ASC',
      limit: 10,
      columns: ['reminder_date AS Data', 'reminder_time AS Horario', 'importance AS Prioridade', 'status AS Estado'],
    }),
    renderCallout('tip', 'Como usar esta pagina', [
      'Comece pelo estado atual para saber a criticidade e quem responde pelo projeto.',
      'Depois use as secoes de saude para localizar eventos recentes, conhecimento reutilizavel e pontos de tensao ainda abertos.',
    ]),
  ].join('\n');
}

async function ensureVaultScaffolding(projects) {
  const dirs = Object.values(vaultFolders).map((entry) => path.join(vaultPath, entry));
  for (const dir of dirs) {
    await ensureDir(dir);
  }

  await writeGeneratedPage(`${vaultFolders.home}/Home.md`, renderHomePage());
  await writeGeneratedPage(`${vaultFolders.projects}/Projects.md`, renderProjectsPage());
  await writeGeneratedPage(`${vaultFolders.knowledge}/Knowledge.md`, renderKnowledgePage());
  await writeGeneratedPage(`${vaultFolders.decisions}/Decisions.md`, renderDecisionsPage());
  await writeGeneratedPage(`${vaultFolders.incidents}/Incidents.md`, renderIncidentsPage());
  await writeGeneratedPage(`${vaultFolders.followups}/Followups.md`, renderFollowupsPage());
  await writeGeneratedPage(`${vaultFolders.reminders}/Reminders.md`, renderRemindersPage());

  for (const project of projects) {
    await writeGeneratedPage(toRelativeVaultPath(projectSummaryPath(project)), renderProjectSummary(project));
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
    event.reminder_date ? `reminder_date:${event.reminder_date}` : '',
    event.reminder_time ? `reminder_time:${event.reminder_time}` : '',
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

async function fetchGithubDiff(repo, beforeSha, afterSha) {
  if (!githubApiToken || !repo || !beforeSha || !afterSha) {
    return '';
  }
  if (/^0+$/.test(beforeSha)) {
    return '';
  }
  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(repo.split('/')[0])}/${encodeURIComponent(repo.split('/')[1])}/compare/${beforeSha}...${afterSha}`;
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github.v3.diff',
        authorization: `Bearer ${githubApiToken}`,
        'user-agent': 'knowledge-base-bot',
      },
    });
    if (!response.ok) {
      return '';
    }
    const diff = await response.text();
    if (diff.length > maxDiffChars) {
      return diff.slice(0, maxDiffChars) + '\n... (diff truncado por limite de tamanho)';
    }
    return diff;
  } catch {
    return '';
  }
}

function buildFallbackAnalysis(event) {
  if (event.event_type === 'manual_note') {
    const summary = trimParagraph(event.raw_text, 'Manual note registered.');
    const canonicalType = resolveCanonicalType(event);
    const reminderContext = event.reminder_date
      ? event.reminder_time
        ? ` Lembrete exato configurado para ${event.reminder_date} ${event.reminder_time}.`
        : ` Lembrete configurado para ${event.reminder_date} no resumo diario das 09:00.`
      : '';
    return {
      source: 'fallback',
      summary,
      impact:
        canonicalType && canonicalType !== 'event'
          ? `Registro manual com potencial de virar ${canonicalType} canonico para o projeto.${reminderContext}`
          : `Observacao manual registrada para consulta futura e vinculada ao contexto atual do repositorio.${reminderContext}`,
      risks: 'Sem analise de IA configurada. Validar se o registro exige follow-up, consolidacao ou decisao explicita.',
      nextSteps:
        canonicalType && canonicalType !== 'event'
          ? `Consolidar a nota como ${canonicalType} e revisar proximos passos no vault.`
          : 'Revisar a nota e complementar com decisao, contexto ou link se necessario.',
    };
  }

  const commitMessages = (event.commits || []).map((entry) => trimParagraph(entry.message, '')).filter(Boolean);
  const topMessage = commitMessages[0] || 'Push registrado sem resumo de commit disponivel.';
  const filesChanged = Array.isArray(event.files) ? event.files.length : 0;
  return {
    source: 'fallback',
    summary: topMessage,
    impact: `Push registrado em ${event.branch || 'branch desconhecida'} com ${filesChanged} arquivo(s) alterado(s).`,
    risks: 'Sem analise de IA configurada. Revisar possiveis regressoes manualmente se a mudanca for sensivel.',
    nextSteps: 'Usar a nota como base para continuidade e complementar contexto manual quando necessario.',
    codeReview: {
      overall_quality: 'Sem analise de IA configurada.',
      observations: ['Review automatico nao disponivel — IA nao configurada ou sem token GitHub.'],
      suggestions: [],
      potential_issues: [],
      positive_highlights: [],
    },
  };
}

function buildPromptPayload(event) {
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
          note_type: event.note_type || '',
          importance: event.importance || '',
          status: event.status || '',
          follow_up_by: event.follow_up_by || '',
          reminder_date: event.reminder_date || '',
          reminder_time: event.reminder_time || '',
          reminder_at: event.reminder_at || '',
          decision_flag: parseBoolean(event.decision_flag),
          related_projects: parseList(event.related_projects),
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
          diff: event._diff || '',
        };
  return promptPayload;
}

function buildCodeReviewSystemPrompt() {
  return [
    'Voce e um engenheiro de software senior fazendo code review.',
    'Analise o diff e os commits do push abaixo e produza um review tecnico em portugues brasileiro.',
    'Responda com JSON estrito contendo:',
    '- "summary": string com resumo geral do que o push faz (1-2 frases)',
    '- "overall_quality": string curta avaliando a qualidade geral (ex: "Boa", "Precisa atencao", "Excelente")',
    '- "observations": array de strings com observacoes sobre o codigo (max 8)',
    '- "suggestions": array de strings com sugestoes de melhoria (max 6)',
    '- "potential_issues": array de strings com possiveis bugs ou problemas (max 6)',
    '- "positive_highlights": array de strings com pontos positivos (max 4)',
    'Se o diff estiver vazio ou for insuficiente, base sua analise nos nomes de arquivos e mensagens de commit.',
    'Seja direto e pratico. Nao repita informacoes entre campos.',
  ].join('\n');
}

function buildManualNoteSystemPrompt() {
  return 'You produce concise engineering memory notes in Brazilian Portuguese. Respond with strict JSON containing summary, impact, risks, next_steps.';
}

function resolveSystemPrompt(event) {
  if (event.event_type === 'github_push') {
    return buildCodeReviewSystemPrompt();
  }
  return buildManualNoteSystemPrompt();
}

function parseJsonText(content) {
  const raw = String(content || '').trim();
  if (!raw) {
    return {};
  }
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned || '{}');
}

function parseAiCodeReview(parsed, source) {
  return {
    source,
    summary: parsed.summary,
    impact: parsed.impact,
    risks: parsed.risks,
    nextSteps: parsed.next_steps || parsed.nextSteps,
    codeReview: {
      overall_quality: String(parsed.overall_quality || '').trim(),
      observations: Array.isArray(parsed.observations) ? parsed.observations.map((e) => String(e || '').trim()).filter(Boolean) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map((e) => String(e || '').trim()).filter(Boolean) : [],
      potential_issues: Array.isArray(parsed.potential_issues) ? parsed.potential_issues.map((e) => String(e || '').trim()).filter(Boolean) : [],
      positive_highlights: Array.isArray(parsed.positive_highlights) ? parsed.positive_highlights.map((e) => String(e || '').trim()).filter(Boolean) : [],
    },
  };
}

async function buildOpenAiAnalysis(event, promptPayload) {
  const systemPrompt = resolveSystemPrompt(event);
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${openaiApiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: systemPrompt,
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
  const parsed = parseJsonText(content);
  if (event.event_type === 'github_push') {
    return parseAiCodeReview(parsed, 'openai');
  }
  return {
    source: 'openai',
    summary: parsed.summary,
    impact: parsed.impact,
    risks: parsed.risks,
    nextSteps: parsed.next_steps || parsed.nextSteps,
  };
}

async function buildGeminiAnalysis(event, promptPayload) {
  const systemPrompt = resolveSystemPrompt(event);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
        contents: [
          {
            parts: [
              {
                text: [
                  systemPrompt,
                  JSON.stringify(promptPayload),
                ].join('\n'),
              },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`gemini_http_${response.status}`);
  }

  const data = await response.json();
  const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = parseJsonText(content);
  if (event.event_type === 'github_push') {
    return parseAiCodeReview(parsed, 'gemini');
  }
  return {
    source: 'gemini',
    summary: parsed.summary,
    impact: parsed.impact,
    risks: parsed.risks,
    nextSteps: parsed.next_steps || parsed.nextSteps,
  };
}

function resolveAiProvider() {
  if (aiProvider === 'auto') {
    if (openaiApiKey && openaiModel) {
      return 'openai';
    }
    if (geminiApiKey && geminiModel) {
      return 'gemini';
    }
    return 'none';
  }
  return aiProvider;
}

async function buildAiAnalysis(event) {
  const provider = resolveAiProvider();
  if (provider === 'none') {
    return buildFallbackAnalysis(event);
  }

  // For push events, fetch the real diff from GitHub API and attach it to the event
  if (event.event_type === 'github_push' && event.repo && event._before_sha && event.head_sha) {
    event._diff = await fetchGithubDiff(event.repo, event._before_sha, event.head_sha);
  }

  const promptPayload = buildPromptPayload(event);
  const base = buildFallbackAnalysis(event);
  let result;
  if (provider === 'openai') {
    if (!openaiApiKey || !openaiModel) {
      return base;
    }
    result = await buildOpenAiAnalysis(event, promptPayload);
  } else if (provider === 'gemini') {
    if (!geminiApiKey || !geminiModel) {
      return base;
    }
    result = await buildGeminiAnalysis(event, promptPayload);
  } else {
    return base;
  }

  const merged = {
    source: result.source || provider,
    summary: trimParagraph(result.summary, base.summary),
    impact: trimParagraph(result.impact, base.impact),
    risks: trimParagraph(result.risks, base.risks),
    nextSteps: trimParagraph(result.nextSteps, base.nextSteps),
  };
  if (result.codeReview) {
    merged.codeReview = result.codeReview;
  }
  return merged;
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

const mimeExtensionMap = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/json': '.json',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
};

function extensionFromMime(mimeType) {
  const normalized = String(mimeType || '').trim().toLowerCase();
  return mimeExtensionMap[normalized] || '';
}

function resolveAttachmentFileName(fileName, mimeType) {
  const raw = String(fileName || '').trim();
  if (raw) {
    return raw;
  }
  const extension = extensionFromMime(mimeType);
  return `attachment${extension || '.bin'}`;
}

function sanitizeAttachmentName(fileName) {
  const parsed = path.parse(String(fileName || 'attachment.bin'));
  const safeBase = slugify(parsed.name || 'attachment') || 'attachment';
  const safeExt = String(parsed.ext || '').replace(/[^.\w-]/g, '');
  return `${safeBase}${safeExt || '.bin'}`;
}

async function persistAttachment(project, payload, eventDate) {
  const attachment = payload.attachment;
  if (!attachment || !attachment.data_b64) {
    return null;
  }
  const { year, month, day, time } = getDateParts(eventDate);
  const dataBuffer = Buffer.from(attachment.data_b64, 'base64');
  const safeName = sanitizeAttachmentName(attachment.file_name);
  const uniqueName = `${year}${month}${day}-${time}-${safeName}`;
  const inVault = attachment.size_bytes <= maxVaultAttachmentBytes;
  const targetDir = inVault
    ? path.join(vaultPath, vaultFolders.assets, project.project_slug, year, month)
    : path.join(archivePath, project.project_slug, year, month);
  await ensureDir(targetDir);
  const targetPath = path.join(targetDir, uniqueName);
  await fs.writeFile(targetPath, dataBuffer);

  if (inVault) {
    return {
      mode: 'vault',
      stored_path: toRelativeVaultPath(targetPath),
      technical_link: targetPath,
      file_name: attachment.file_name,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      sha256: attachment.sha256,
    };
  }

  return {
    mode: 'archive',
    stored_path: targetPath,
    technical_link: targetPath,
    file_name: attachment.file_name,
    mime_type: attachment.mime_type,
    size_bytes: attachment.size_bytes,
    sha256: attachment.sha256,
  };
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

function renderAttachmentSection(event) {
  const attachment = event.attachment;
  const obsidianLink =
    attachment?.mode === 'vault' && attachment.stored_path ? `[[${attachment.stored_path}]]` : '';
  const obsidianEmbed =
    attachment?.mode === 'vault' && attachment.stored_path ? `![[${attachment.stored_path}]]` : '';
  return attachment
    ? [
        '## Anexo',
        'Arquivo associado a esta nota para consulta direta no vault ou no arquivo tecnico.',
        '',
        renderMetadataList([
          { label: 'Modo', value: attachment.mode },
          { label: 'Nome original', value: attachment.file_name },
          { label: 'Mime', value: attachment.mime_type },
          { label: 'Tamanho (bytes)', value: attachment.size_bytes },
          { label: 'SHA256', value: attachment.sha256 },
          { label: 'Path', value: attachment.stored_path },
          { label: 'Link tecnico', value: attachment.technical_link },
          ...(obsidianLink ? [{ label: 'Link no Obsidian', value: obsidianLink }] : []),
          ...(obsidianEmbed ? [{ label: 'Preview', value: obsidianEmbed }] : []),
        ]),
        '',
      ]
    : ['## Anexo', '- none', ''];
}

function resolveImportance(payload) {
  const explicit = normalizeEnum(payload.importance, importanceLevels, '');
  if (explicit) {
    return explicit;
  }
  if (payload.kind === 'bug') {
    return 'high';
  }
  if (payload.kind === 'resume' || payload.kind === 'article' || payload.event_type === 'github_push') {
    return 'medium';
  }
  return 'low';
}

function resolveStatus(payload, canonicalType = '') {
  const explicit = normalizeEnum(payload.status, statusValues, '');
  if (explicit) {
    return explicit;
  }
  if (canonicalType === 'incident' || canonicalType === 'followup') {
    return 'open';
  }
  return 'active';
}

function resolveCanonicalType(payload) {
  const explicit = normalizeEnum(payload.note_type, noteTypes, '');
  if (explicit === 'knowledge' || explicit === 'decision' || explicit === 'incident') {
    return explicit;
  }
  if (parseBoolean(payload.decision_flag)) {
    return 'decision';
  }
  if (payload.kind === 'bug') {
    return 'incident';
  }
  if (payload.kind === 'resume' || payload.kind === 'article') {
    return 'knowledge';
  }
  return '';
}

function shouldCreateFollowup(payload, canonicalType) {
  const explicitStatus = normalizeEnum(payload.status, statusValues, '');
  if (explicitStatus === 'resolved' || explicitStatus === 'archived') {
    return false;
  }
  if (String(payload.follow_up_by || '').trim()) {
    return true;
  }
  return canonicalType === 'incident';
}

function shouldCreateReminder(payload) {
  const explicitStatus = normalizeEnum(payload.status, statusValues, '');
  if (explicitStatus === 'resolved' || explicitStatus === 'archived') {
    return false;
  }
  return Boolean(String(payload.reminder_date || '').trim());
}

function buildNoteTitle(event, analysis, type) {
  if (type === 'project_summary') {
    return event.display_name;
  }
  if (type === 'incident') {
    return trimParagraph(analysis.summary || event.raw_text, `${event.display_name} incidente`);
  }
  if (type === 'decision') {
    return trimParagraph(analysis.summary || event.raw_text, `${event.display_name} decisao`);
  }
  if (type === 'knowledge') {
    return trimParagraph(analysis.summary || event.raw_text, `${event.display_name} conhecimento`);
  }
  if (type === 'followup') {
    return trimParagraph(`Follow-up ${analysis.summary || event.raw_text}`, `Follow-up ${event.display_name}`);
  }
  if (event.event_type === 'github_push') {
    return trimParagraph(`${event.display_name} ${shortSha(event.head_sha)}`, `${event.display_name} push`);
  }
  return trimParagraph(analysis.summary || event.raw_text, `${event.display_name} event`);
}

function buildEventNoteFileName(eventDate, payload, analysis) {
  const { year, month, day, time } = getDateParts(eventDate);
  if (payload.event_type === 'github_push') {
    return `${year}-${month}-${day}-${time}-push-${shortSha(payload.head_sha)}.md`;
  }
  const stem = sanitizeFileStem(analysis.summary || payload.raw_text || payload.kind, payload.kind || 'event');
  return `${year}-${month}-${day}-${time}-${stem}.md`;
}

function buildCanonicalFileName(eventDate, payload, analysis, canonicalType) {
  const { year, month, day, time } = getDateParts(eventDate);
  const stem = sanitizeFileStem(analysis.summary || payload.raw_text || canonicalType, canonicalType);
  return `${year}-${month}-${day}-${time}-${stem}.md`;
}

function buildRelatedEntries(...values) {
  return unique(values.flat().map((entry) => String(entry || '').trim()).filter(Boolean));
}

function renderNavigationSection(paths) {
  return renderQuickLinks('Navegacao rapida', 'Use estes links para saltar entre o contexto principal desta nota.', [
    `${vaultLink(paths.projectSummaryPath, 'Resumo do projeto')}`,
    `${vaultLink(`${vaultFolders.home}/Home`, 'Home')}`,
    ...(paths.dailyPath ? [vaultLink(paths.dailyPath, 'Log diario')] : []),
    ...(paths.canonicalPath ? [vaultLink(paths.canonicalPath, 'Nota canonica')] : []),
    ...(paths.followupPath ? [vaultLink(paths.followupPath, 'Follow-up')] : []),
    ...(paths.reminderPath ? [vaultLink(paths.reminderPath, 'Lembrete')] : []),
  ]);
}

function renderEventOverview(event, noteFrontmatter) {
  return renderCallout('abstract', 'Resumo do evento', [
    trimParagraph(event.raw_text || '', 'Sem texto original registrado.'),
    '',
    renderMetadataList([
      { label: 'Projeto', value: vaultLink(`${vaultFolders.projects}/${noteFrontmatter.project}`, event.display_name) },
      { label: 'Origem', value: event.source || 'n/a' },
      { label: 'Quando', value: noteFrontmatter.occurred_at || 'n/a' },
      { label: 'Prioridade', value: renderImportanceBadge(noteFrontmatter.importance) },
      { label: 'Status', value: renderStatusBadge(noteFrontmatter.status) },
    ]),
  ]);
}

function renderCanonicalOverview(event, noteFrontmatter, canonicalType) {
  const typeLabels = {
    knowledge: 'Conhecimento',
    decision: 'Decisao',
    incident: 'Incidente',
  };
  return renderCallout('abstract', 'Registro consolidado', [
    trimParagraph(event.raw_text || '', 'Sem contexto original registrado.'),
    '',
    renderMetadataList([
      { label: 'Projeto', value: vaultLink(`${vaultFolders.projects}/${noteFrontmatter.project}`, event.display_name) },
      { label: 'Tipo', value: typeLabels[canonicalType] || canonicalType || 'n/a' },
      { label: 'Prioridade', value: renderImportanceBadge(noteFrontmatter.importance) },
      { label: 'Status', value: renderStatusBadge(noteFrontmatter.status) },
    ]),
  ]);
}

function renderFollowupOverview(event, noteFrontmatter) {
  return renderCallout('warning', 'Acao pendente', [
    'Esta nota representa algo que ainda exige acompanhamento.',
    '',
    renderMetadataList([
      { label: 'Projeto', value: vaultLink(`${vaultFolders.projects}/${noteFrontmatter.project}`, event.display_name) },
      { label: 'Prazo', value: noteFrontmatter.follow_up_by || 'n/a' },
      { label: 'Prioridade', value: renderImportanceBadge(noteFrontmatter.importance) },
      { label: 'Status', value: renderStatusBadge(noteFrontmatter.status) },
    ]),
  ]);
}

function renderReminderOverview(event, noteFrontmatter) {
  return renderCallout('warning', 'Lembrete agendado', [
    'Esta nota entra no resumo diario das 09:00 e pode gerar um disparo exato no Telegram quando houver horario definido.',
    '',
    renderMetadataList([
      { label: 'Projeto', value: vaultLink(`${vaultFolders.projects}/${noteFrontmatter.project}`, event.display_name) },
      { label: 'Data', value: noteFrontmatter.reminder_date || 'n/a' },
      { label: 'Horario', value: noteFrontmatter.reminder_time || '09:00 no resumo diario' },
      { label: 'Disparo exato', value: noteFrontmatter.reminder_at || 'nao configurado' },
      { label: 'Prioridade', value: renderImportanceBadge(noteFrontmatter.importance) },
      { label: 'Status', value: renderStatusBadge(noteFrontmatter.status) },
    ]),
  ]);
}

function renderCodeReviewSection(codeReview) {
  if (!codeReview) {
    return [];
  }
  const sections = [];

  sections.push(
    renderCallout('abstract', `Qualidade geral: ${codeReview.overall_quality || 'N/A'}`, [
      'Avaliacao automatica gerada por IA a partir do diff real do push.',
    ]),
  );

  if (codeReview.observations && codeReview.observations.length > 0) {
    sections.push('### Observacoes');
    sections.push(...codeReview.observations.map((o) => `- ${o}`));
    sections.push('');
  }

  if (codeReview.suggestions && codeReview.suggestions.length > 0) {
    sections.push('### Sugestoes de melhoria');
    sections.push(...codeReview.suggestions.map((s) => `- ${s}`));
    sections.push('');
  }

  if (codeReview.potential_issues && codeReview.potential_issues.length > 0) {
    sections.push('### Potenciais problemas');
    sections.push(...codeReview.potential_issues.map((p) => `- ⚠️ ${p}`));
    sections.push('');
  }

  if (codeReview.positive_highlights && codeReview.positive_highlights.length > 0) {
    sections.push('### Destaques positivos');
    sections.push(...codeReview.positive_highlights.map((h) => `- ✅ ${h}`));
    sections.push('');
  }

  return sections;
}

function renderEventNote(event, analysis, noteFrontmatter, paths) {
  const frontmatter = renderFrontmatter(noteFrontmatter);
  const diffstatLine = event.diffstat?.summary || 'No diffstat available.';
  const manualSections =
    event.event_type === 'manual_note'
      ? [
          '## Contexto original',
          trimParagraph(event.raw_text, 'Sem texto informado.'),
          '',
          ...renderAttachmentSection(event),
        ]
      : [];
  const pushSections =
    event.event_type === 'github_push'
      ? [
          '## Arquivos alterados',
          renderFilesSection(event.files),
          '',
          '## Resumo tecnico',
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
        ]
      : [
          '## Contexto tecnico',
          `- repo: ${event.repo || 'n/a'}`,
          `- branch: ${event.branch || 'n/a'}`,
          `- head_sha: ${event.head_sha || 'n/a'}`,
          '',
        ];

  // For push events: replace summary/impact/risks/next_steps with code review
  const isPush = event.event_type === 'github_push';
  const analysisSections = isPush
    ? [
        '## Resumo',
        analysis.summary,
        '',
        '## Code Review',
        ...renderCodeReviewSection(analysis.codeReview),
      ]
    : [
        '## Resumo',
        analysis.summary,
        '',
        '## Impacto',
        analysis.impact,
        '',
        '## Riscos',
        analysis.risks,
        '',
        '## Proximos passos',
        analysis.nextSteps,
        '',
      ];

  return [
    frontmatter,
    `# ${buildNoteTitle(event, analysis, 'event')}`,
    '',
    renderEventOverview(event, noteFrontmatter),
    renderNavigationSection(paths),
    ...analysisSections,
    ...manualSections,
    ...pushSections,
    '## Metadados tecnicos',
    `- event_type: ${event.event_type}`,
    `- source: ${event.source || 'n/a'}`,
    `- importance: ${noteFrontmatter.importance}`,
    `- status: ${noteFrontmatter.status}`,
    `- has_code_review: ${isPush}`,
    `- reminder_date: ${noteFrontmatter.reminder_date || 'n/a'}`,
    `- reminder_time: ${noteFrontmatter.reminder_time || 'n/a'}`,
    '',
  ].join('\n');
}

function renderCanonicalNote(event, analysis, noteFrontmatter, paths, canonicalType) {
  const frontmatter = renderFrontmatter(noteFrontmatter);
  return [
    frontmatter,
    `# ${buildNoteTitle(event, analysis, canonicalType)}`,
    '',
    renderCanonicalOverview(event, noteFrontmatter, canonicalType),
    renderNavigationSection(paths),
    '## Sintese',
    analysis.summary,
    '',
    '## Impacto',
    analysis.impact,
    '',
    canonicalType === 'decision' ? '## Contexto da decisao' : '## Contexto',
    event.event_type === 'manual_note'
      ? trimParagraph(event.raw_text, 'Sem contexto manual informado.')
      : `${event.display_name} ${shortSha(event.head_sha)} em ${event.branch || 'branch desconhecida'}.`,
    '',
    canonicalType === 'incident' ? '## Riscos e prevencao' : '## Riscos',
    analysis.risks,
    '',
    canonicalType === 'decision' ? '## Proximos passos / impacto esperado' : '## Proximos passos',
    analysis.nextSteps,
    '',
    ...(event.event_type === 'manual_note' ? renderAttachmentSection(event) : []),
    '## Rastreabilidade',
    `- event_note: ${vaultLink(paths.eventPath, 'Event Note')}`,
    `- project: ${vaultLink(paths.projectSummaryPath, 'Resumo do projeto')}`,
    ...(paths.followupPath ? [`- followup: ${vaultLink(paths.followupPath, 'Follow-up')}`] : []),
    '',
  ].join('\n');
}

function renderFollowupNote(event, analysis, noteFrontmatter, paths) {
  const frontmatter = renderFrontmatter(noteFrontmatter);
  return [
    frontmatter,
    `# ${buildNoteTitle(event, analysis, 'followup')}`,
    '',
    renderFollowupOverview(event, noteFrontmatter),
    renderNavigationSection(paths),
    '## O que precisa ser feito',
    analysis.nextSteps,
    '',
    '## Por que isso importa',
    analysis.summary,
    '',
    '## Risco de nao fazer',
    analysis.risks,
    '',
    '## Links relacionados',
    `- prazo: ${noteFrontmatter.follow_up_by || 'n/a'}`,
    `- origem: ${vaultLink(paths.eventPath, 'Event Note')}`,
    `- projeto: ${vaultLink(paths.projectSummaryPath, 'Resumo do projeto')}`,
    ...(paths.canonicalPath ? [`- nota canonica: ${vaultLink(paths.canonicalPath, 'Canonical Note')}`] : []),
    '',
  ].join('\n');
}

function renderReminderNote(event, analysis, noteFrontmatter, paths) {
  const frontmatter = renderFrontmatter(noteFrontmatter);
  return [
    frontmatter,
    `# Reminder ${trimParagraph(analysis.summary || event.raw_text, event.display_name)}`,
    '',
    renderReminderOverview(event, noteFrontmatter),
    renderNavigationSection(paths),
    '## O que lembrar',
    trimParagraph(event.raw_text, 'Sem descricao registrada.'),
    '',
    '## Contexto',
    analysis.summary,
    '',
    '## Importancia',
    analysis.impact,
    '',
    '## Links relacionados',
    `- data: ${noteFrontmatter.reminder_date || 'n/a'}`,
    `- horario: ${noteFrontmatter.reminder_time || 'n/a'}`,
    `- disparo_exato: ${noteFrontmatter.reminder_at || 'nao configurado'}`,
    `- origem: ${vaultLink(paths.eventPath, 'Event Note')}`,
    `- projeto: ${vaultLink(paths.projectSummaryPath, 'Resumo do projeto')}`,
    ...(paths.canonicalPath ? [`- nota canonica: ${vaultLink(paths.canonicalPath, 'Canonical Note')}`] : []),
    ...(paths.followupPath ? [`- followup: ${vaultLink(paths.followupPath, 'Follow-up')}`] : []),
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
  const dailyPath = path.join(vaultPath, vaultFolders.inbox, 'Daily', project.project_slug, year, month, `${year}-${month}-${day}.md`);
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
        occurred_at: `${year}-${month}-${day}T00:00:00-03:00`,
        canonical: false,
        status: 'active',
        importance: project.criticality || 'medium',
        tags: ['daily', project.project_slug],
      }),
      `# ${project.display_name} - ${year}-${month}-${day}`,
      '',
      '## Events',
      '',
    ].join('\n');

  let entry = '';
  entry = [
    eventMarker,
    `### ${time} ${vaultLink(noteRelativePath, buildNoteTitle(event, analysis, 'event'))}`,
    '',
    `- type: ${event.event_type}`,
    `- importance: ${resolveImportance(event)}`,
    `- status: ${resolveStatus(event, resolveCanonicalType(event))}`,
    '',
    analysis.summary,
    '',
  ].join('\n');

  await ensureDir(path.dirname(dailyPath));
  await fs.writeFile(dailyPath, `${header}${header.endsWith('\n') ? '' : '\n'}${entry}`, 'utf8');
  return dailyPath;
}

async function persistEvent(project, payload, analysis, allProjects) {
  const eventDate = parseDate(payload.triggered_at);
  const { year, month } = getDateParts(eventDate);
  const persistedAttachment = await persistAttachment(project, payload, eventDate);
  const canonicalType = resolveCanonicalType(payload);
  const importance = resolveImportance(payload);
  const status = resolveStatus(payload, canonicalType);
  const event =
    {
      ...payload,
      display_name: project.display_name,
      attachment: persistedAttachment,
      files: Array.isArray(payload.files)
        ? payload.files.map((entry) => ({
            path: String(entry.path || ''),
            status: String(entry.status || 'M'),
          }))
        : [],
      commits: Array.isArray(payload.commits) ? payload.commits : [],
      importance,
      status,
    };

  const eventDir = path.join(vaultPath, vaultFolders.inbox, project.project_slug, year, month);
  await ensureDir(eventDir);
  const eventPath = path.join(eventDir, buildEventNoteFileName(eventDate, payload, analysis));
  const eventRelativePath = toRelativeVaultPath(eventPath);
  const projectPath = toRelativeVaultPath(projectSummaryPath(project));

  const shouldCreateCanonical = Boolean(canonicalType);
  const canonicalDir = shouldCreateCanonical ? path.join(vaultPath, folderForCanonicalType(canonicalType), project.project_slug, year, month) : '';
  if (canonicalDir) {
    await ensureDir(canonicalDir);
  }
  const canonicalPath = shouldCreateCanonical
    ? path.join(canonicalDir, buildCanonicalFileName(eventDate, payload, analysis, canonicalType))
    : '';
  const canonicalRelativePath = canonicalPath ? toRelativeVaultPath(canonicalPath) : '';

  const shouldTrackFollowup = shouldCreateFollowup(payload, canonicalType);
  const followupDir = shouldTrackFollowup ? path.join(vaultPath, vaultFolders.followups, project.project_slug, year, month) : '';
  if (followupDir) {
    await ensureDir(followupDir);
  }
  const followupPath = shouldTrackFollowup
    ? path.join(followupDir, buildCanonicalFileName(eventDate, payload, analysis, 'followup'))
    : '';
  const followupRelativePath = followupPath ? toRelativeVaultPath(followupPath) : '';

  const shouldTrackReminder = shouldCreateReminder(payload);
  const reminderDir = shouldTrackReminder ? path.join(vaultPath, vaultFolders.reminders, project.project_slug, year, month) : '';
  if (reminderDir) {
    await ensureDir(reminderDir);
  }
  const reminderPath = shouldTrackReminder
    ? path.join(reminderDir, buildCanonicalFileName(eventDate, payload, analysis, 'reminder'))
    : '';
  const reminderRelativePath = reminderPath ? toRelativeVaultPath(reminderPath) : '';

  const relatedProjects = unique([project.project_slug, ...parseList(payload.related_projects)]);
  const relatedEntries = buildRelatedEntries(projectPath, canonicalRelativePath, followupRelativePath, reminderRelativePath, payload.related);
  const baseTags = unique([
    ...(project.default_tags || []),
    ...(Array.isArray(payload.tags) ? payload.tags : []),
    payload.event_type,
    payload.kind || '',
    project.project_slug,
  ]);
  const filesChanged = Number(payload?.diffstat?.files_changed) || (Array.isArray(payload.files) ? payload.files.length : 0);
  const commitsCount = Array.isArray(payload.commits) ? payload.commits.length : 0;
  const insertions = Number(payload?.diffstat?.insertions) || 0;
  const deletions = Number(payload?.diffstat?.deletions) || 0;

  const eventFrontmatter = {
    id: payload.event_id,
    type: 'event',
    canonical: false,
    project: project.project_slug,
    source: payload.source || 'n8n',
    occurred_at: eventDate.toISOString(),
    importance,
    status,
    tags: baseTags,
    related: relatedEntries,
    related_projects: relatedProjects,
    event_type: payload.event_type,
    kind: payload.kind || (payload.event_type === 'github_push' ? 'push' : 'manual_note'),
    note_type: canonicalType || 'event',
    repo: payload.repo || project.repo_full_name || '',
    branch: payload.branch || project.default_branch,
    head_sha: payload.head_sha || '',
    author: payload.source_actor || '',
    analysis_source: analysis.source,
    semantic_text_version: semanticTextVersion,
    semantic_text: buildCanonicalText(event, analysis),
    commits_count: commitsCount,
    files_changed: filesChanged,
    insertions,
    deletions,
    attachment_mode: persistedAttachment?.mode || 'none',
    attachment_path: persistedAttachment?.stored_path || '',
    attachment_sha256: persistedAttachment?.sha256 || '',
    attachment_size_bytes: persistedAttachment?.size_bytes || 0,
    follow_up_by: String(payload.follow_up_by || '').trim(),
    reminder_date: String(payload.reminder_date || '').trim(),
    reminder_time: String(payload.reminder_time || '').trim(),
    reminder_at: String(payload.reminder_at || '').trim(),
    promoted_to: canonicalType || '',
    has_code_review: payload.event_type === 'github_push',
  };

  await fs.writeFile(
    eventPath,
    renderEventNote(event, analysis, eventFrontmatter, {
      projectSummaryPath: projectPath,
      eventPath: eventRelativePath,
      canonicalPath: canonicalRelativePath,
      followupPath: followupRelativePath,
      reminderPath: reminderRelativePath,
    }),
    'utf8',
  );

  let canonicalWritten = false;
  if (canonicalPath) {
    const canonicalFrontmatter = {
      id: `${payload.event_id}:${canonicalType}`,
      type: canonicalType,
      canonical: true,
      project: project.project_slug,
      source: payload.source || 'n8n',
      occurred_at: eventDate.toISOString(),
      importance,
      status,
      tags: unique([...baseTags, canonicalType]),
      related: buildRelatedEntries(eventRelativePath, projectPath, followupRelativePath, reminderRelativePath),
      related_projects: relatedProjects,
      repo: payload.repo || project.repo_full_name || '',
      branch: payload.branch || project.default_branch,
      origin_event_id: payload.event_id,
      origin_event_path: eventRelativePath,
      follow_up_by: String(payload.follow_up_by || '').trim(),
      reminder_date: String(payload.reminder_date || '').trim(),
      reminder_time: String(payload.reminder_time || '').trim(),
      reminder_at: String(payload.reminder_at || '').trim(),
      decision_flag: parseBoolean(payload.decision_flag),
    };
    await fs.writeFile(
      canonicalPath,
      renderCanonicalNote(
        event,
        analysis,
        canonicalFrontmatter,
        {
          projectSummaryPath: projectPath,
          eventPath: eventRelativePath,
          canonicalPath: canonicalRelativePath,
          followupPath: followupRelativePath,
          reminderPath: reminderRelativePath,
        },
        canonicalType,
      ),
      'utf8',
    );
    canonicalWritten = true;
  }

  let followupWritten = false;
  if (followupPath) {
    const followupFrontmatter = {
      id: `${payload.event_id}:followup`,
      type: 'followup',
      canonical: false,
      project: project.project_slug,
      source: payload.source || 'n8n',
      occurred_at: eventDate.toISOString(),
      importance,
      status: resolveStatus({ ...payload, status: payload.status || 'open' }, 'followup'),
      tags: unique([...baseTags, 'followup']),
      related: buildRelatedEntries(eventRelativePath, canonicalRelativePath, reminderRelativePath, projectPath),
      related_projects: relatedProjects,
      follow_up_by: String(payload.follow_up_by || '').trim(),
      reminder_date: String(payload.reminder_date || '').trim(),
      reminder_time: String(payload.reminder_time || '').trim(),
      reminder_at: String(payload.reminder_at || '').trim(),
      origin_event_id: payload.event_id,
      origin_event_path: eventRelativePath,
    };
    await fs.writeFile(
      followupPath,
      renderFollowupNote(event, analysis, followupFrontmatter, {
        projectSummaryPath: projectPath,
        eventPath: eventRelativePath,
        canonicalPath: canonicalRelativePath,
        followupPath: followupRelativePath,
        reminderPath: reminderRelativePath,
      }),
      'utf8',
    );
    followupWritten = true;
  }

  let reminderWritten = false;
  if (reminderPath) {
    const reminderFrontmatter = {
      id: `${payload.event_id}:reminder`,
      type: 'reminder',
      canonical: false,
      project: project.project_slug,
      source: payload.source || 'n8n',
      occurred_at: eventDate.toISOString(),
      importance,
      status,
      tags: unique([...baseTags, 'reminder']),
      related: buildRelatedEntries(eventRelativePath, canonicalRelativePath, followupRelativePath, projectPath),
      related_projects: relatedProjects,
      reminder_date: String(payload.reminder_date || '').trim(),
      reminder_time: String(payload.reminder_time || '').trim(),
      reminder_at: String(payload.reminder_at || '').trim(),
      origin_event_id: payload.event_id,
      origin_event_path: eventRelativePath,
    };
    await fs.writeFile(
      reminderPath,
      renderReminderNote(event, analysis, reminderFrontmatter, {
        projectSummaryPath: projectPath,
        eventPath: eventRelativePath,
        canonicalPath: canonicalRelativePath,
        followupPath: followupRelativePath,
        reminderPath: reminderRelativePath,
      }),
      'utf8',
    );
    reminderWritten = true;
  }

  const dailyPath = await upsertDailyNote(project, event, analysis, eventRelativePath, eventDate);
  await ensureVaultScaffolding(allProjects);

  const eventToken = payload.event_type === 'manual_note' ? sanitizeFileStem(payload.kind || 'manual') : shortSha(payload.head_sha);
  let commitMessage = `kb: ${project.project_slug} ${payload.event_type} ${eventToken}`;
  let commitResult = { ok: false };
  let pushed = false;
  let pushMessage = 'disabled';

  if (gitBatchMode) {
    commitMessage = `${commitMessage} (deferred)`;
    pushMessage = 'deferred_batch_mode';
  } else {
    await runGit(['add', '.']);
    commitResult = await runGit(['commit', '-m', commitMessage], { allowFailure: true });

    if (enableGitPush) {
      const remoteResult = await runGit(['remote'], { allowFailure: true });
      if (String(remoteResult.stdout || '').split(/\r?\n/).includes('origin')) {
        const pushGitConfigs = buildPushGitConfigs(vaultRemoteUrl);
        if (/^https:\/\//i.test(vaultRemoteUrl) && pushGitConfigs.length === 0) {
          pushMessage = 'missing_push_credentials';
        } else {
          const pushResult = await runGit(['push', 'origin', 'HEAD'], {
            allowFailure: true,
            gitConfigs: pushGitConfigs,
          });
          pushed = pushResult.ok;
          pushMessage = pushResult.ok ? 'pushed' : pushResult.stderr || 'push_failed';
        }
      } else {
        pushMessage = 'remote_missing';
      }
    }
  }

  return {
    ok: true,
    event_id: payload.event_id,
    eventId: payload.event_id,
    eventType: payload.event_type,
    project: project.project_slug,
    kind: payload.kind || 'manual_note',
    notePath: eventRelativePath,
    reminderPath: reminderRelativePath,
    attachmentMode: persistedAttachment?.mode || 'none',
    attachmentPath: persistedAttachment?.stored_path || '',
    dailyPath: toRelativeVaultPath(dailyPath),
    indexPath: projectPath,
    projectPath,
    canonicalPath: canonicalRelativePath,
    followupPath: followupRelativePath,
    canonicalCreated: canonicalWritten,
    followupCreated: followupWritten,
    reminderCreated: reminderWritten,
    commitCreated: commitResult.ok,
    commitMessage,
    pushAttempted: gitBatchMode ? false : enableGitPush,
    pushStatus: pushMessage,
    pushed,
    summary: analysis.summary,
    semanticText: buildCanonicalText(payload, analysis),
  };
}

function parseAttachmentFromInput(payload, binaries) {
  const attachmentMeta = payload?.attachment && typeof payload.attachment === 'object' ? payload.attachment : {};
  const binaryEntries = binaries && typeof binaries === 'object' ? Object.entries(binaries) : [];
  const preferredBinaryEntry =
    binaryEntries.find(([key]) => ['attachment', 'file', 'upload', 'document', 'image'].includes(String(key).toLowerCase())) ||
    binaryEntries.find(([key, value]) => String(key).toLowerCase() !== 'data' && value && typeof value === 'object' && String(value?.data || '').trim()) ||
    null;
  const primaryBinary = preferredBinaryEntry ? preferredBinaryEntry[1] : null;
  const dataB64 = String(attachmentMeta.data_b64 || payload.attachment_data_b64 || primaryBinary?.data || '').trim();
  const fileName = String(
    payload.attachment_name ||
      attachmentMeta.file_name ||
      primaryBinary?.fileName ||
      primaryBinary?.file_name ||
      '',
  ).trim();
  const mimeType = String(
    payload.attachment_mime ||
      attachmentMeta.mime_type ||
      primaryBinary?.mimeType ||
      primaryBinary?.mime_type ||
      'application/octet-stream',
  ).trim();
  const sizeBytes = Number(
    payload.attachment_size ||
      attachmentMeta.size_bytes ||
      primaryBinary?.fileSize ||
      primaryBinary?.file_size ||
      0,
  );
  const sha256 = String(payload.attachment_sha256 || attachmentMeta.sha256 || '').trim().toLowerCase();

  // n8n webhook raw-body mode exposes request payload on binary.data. Do not treat it as a file attachment.
  if (!attachmentMeta.data_b64 && !payload.attachment_data_b64 && !primaryBinary && !fileName) {
    return null;
  }

  if (!dataB64 && !fileName && !mimeType && !sizeBytes && !sha256) {
    return null;
  }

  if (!dataB64) {
    const resolvedName = resolveAttachmentFileName(fileName, mimeType);
    return {
      file_name: resolvedName,
      mime_type: mimeType || 'application/octet-stream',
      size_bytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
      sha256: sha256 || '',
      data_b64: '',
    };
  }

  let buffer;
  try {
    buffer = Buffer.from(dataB64, 'base64');
  } catch {
    throw new Error('invalid_attachment_base64');
  }
  const resolvedSize = buffer.byteLength;
  const resolvedSha = crypto.createHash('sha256').update(buffer).digest('hex');
  if (Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes !== resolvedSize) {
    throw new Error('attachment_size_mismatch');
  }
  if (sha256 && sha256 !== resolvedSha) {
    throw new Error('attachment_sha256_mismatch');
  }
  const resolvedName = resolveAttachmentFileName(fileName, mimeType);
  return {
    file_name: resolvedName,
    mime_type: mimeType || 'application/octet-stream',
    size_bytes: resolvedSize,
    sha256: resolvedSha,
    data_b64: dataB64,
  };
}

function normalizePayloadAndAuth(input, projects) {
  const headers = input.headers || {};
  const rawBody = input.rawBody || '';
  const binaries = input.binaries || {};
  if (headers['x-github-event']) {
    assertGithubSignature(headers, rawBody);
    const normalized = normalizeGithubPushPayload(input.payload || {}, headers);
    if (normalized.skipped) {
      return normalized;
    }
    const project = resolveProject(normalized, projects);
    normalized.project_slug = project.project_slug;
    return {
      payload: normalized,
      project,
    };
  }

  assertManualSecret(headers);
  const payload = { ...(input.payload || {}) };
  payload.project_slug = String(payload.project_slug || '').trim();
  payload.event_type = String(payload.event_type || '').trim();
  payload.event_id = String(payload.event_id || '').trim();
  payload.source = String(payload.source || 'n8n').trim();
  payload.triggered_at = String(payload.triggered_at || new Date().toISOString()).trim();
  payload.repo = String(payload.repo || '').trim();
  payload.branch = String(payload.branch || '').trim();
  payload.kind = normalizeEnum(payload.kind || 'manual_note', manualNoteKinds, 'manual_note');
  payload.note_type = normalizeEnum(payload.note_type, noteTypes, '');
  payload.importance = normalizeEnum(payload.importance, importanceLevels, '');
  payload.status = normalizeEnum(payload.status, statusValues, '');
  payload.follow_up_by = String(payload.follow_up_by || '').trim();
  payload.reminder_date = normalizeReminderDate(payload.reminder_date);
  payload.reminder_time = normalizeReminderTime(payload.reminder_time);
  payload.reminder_at = String(payload.reminder_at || '').trim();
  payload.decision_flag = parseBoolean(payload.decision_flag);
  payload.tags = parseTags(payload.tags || payload.tags_json || payload.tags_csv);
  payload.related_projects = parseList(payload.related_projects || payload.related_projects_json || payload.related_projects_csv);
  payload.related = parseList(payload.related);
  payload.attachment = parseAttachmentFromInput(payload, binaries);

  if (!payload.event_type || !payload.event_id) {
    throw new Error('invalid_payload_missing_type_or_id');
  }
  if (payload.event_type === 'manual_note') {
    payload.raw_text = trimParagraph(payload.raw_text, '');
    if (!payload.raw_text) {
      throw new Error('manual_note_without_text');
    }
    if (!manualNoteKinds.has(payload.kind)) {
      throw new Error('invalid_manual_note_kind');
    }
    if (String(input.payload?.reminder_date || '').trim() && !payload.reminder_date) {
      throw new Error('invalid_reminder_date');
    }
    if (String(input.payload?.reminder_time || '').trim() && !payload.reminder_time) {
      throw new Error('invalid_reminder_time');
    }
    if (payload.reminder_time && !payload.reminder_date) {
      throw new Error('reminder_time_without_date');
    }
    payload.reminder_at = payload.reminder_date && payload.reminder_time ? buildReminderAt(payload.reminder_date, payload.reminder_time) : '';
  }

  const project = resolveProject(payload, projects);
  payload.project_slug = project.project_slug;
  payload.repo = payload.repo || project.repo_full_name || '';
  payload.branch = payload.branch || project.default_branch;
  return {
    payload,
    project,
  };
}

async function main() {
  const mode = process.argv[2] || '';
  let rawInput = '';
  if (mode === '--stdin' || mode === '--stdin-base64') {
    rawInput = await readStdinText();
    if (!rawInput.trim()) {
      throw new Error('missing_stdin_payload');
    }
  } else if (mode === '--file') {
    const filePath = process.argv[3];
    if (!filePath) {
      throw new Error('missing_file_payload');
    }
    rawInput = await fs.readFile(filePath, 'utf8');
  } else {
    rawInput = process.argv[2] || '';
    if (!rawInput) {
      throw new Error('missing_base64_payload');
    }
  }

  const decoded =
    mode === '--stdin'
      ? JSON.parse(rawInput)
      : JSON.parse(Buffer.from(rawInput.trim(), 'base64').toString('utf8'));
  const input = unwrapInput(decoded);
  const projects = await readManifest();
  const normalized = normalizePayloadAndAuth(input, projects);

  if (normalized.skipped) {
    process.stdout.write(`${JSON.stringify(normalized)}\n`);
    return;
  }

  const { payload, project } = normalized;
  await ensureVaultRepository();
  const allProjects = unique(
    [...projects, project].map((entry) => JSON.stringify(entry)),
  ).map((entry) => JSON.parse(entry));
  const analysis = await buildAnalysis(payload);
  const result = await persistEvent(project, payload, analysis, allProjects);
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
