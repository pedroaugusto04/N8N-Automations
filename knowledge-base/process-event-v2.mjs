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

async function readManifest() {
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.projects) ? parsed.projects : [];
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
    repo_full_name: repoFullName,
    default_branch: String(payload.branch || 'main').trim() || 'main',
    default_tags: [],
    enabled: true,
    notes_path: `projects/${projectSlug}`,
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
  return promptPayload;
}

function parseJsonText(content) {
  const raw = String(content || '').trim();
  if (!raw) {
    return {};
  }
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
  return JSON.parse(cleaned || '{}');
}

async function buildOpenAiAnalysis(event, promptPayload) {
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
  const parsed = parseJsonText(content);
  return {
    source: 'openai',
    summary: parsed.summary,
    impact: parsed.impact,
    risks: parsed.risks,
    nextSteps: parsed.next_steps || parsed.nextSteps,
  };
}

async function buildGeminiAnalysis(event, promptPayload) {
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
                  'You produce concise engineering memory notes in Brazilian Portuguese.',
                  'Respond with strict JSON containing summary, impact, risks, next_steps.',
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

  return {
    source: result.source || provider,
    summary: trimParagraph(result.summary, base.summary),
    impact: trimParagraph(result.impact, base.impact),
    risks: trimParagraph(result.risks, base.risks),
    nextSteps: trimParagraph(result.nextSteps, base.nextSteps),
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
    ? path.join(vaultPath, 'projects', project.project_slug, 'assets', year, month)
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
  const attachment = event.attachment;
  const attachmentSection = attachment
    ? [
        '## Attachment',
        `- mode: ${attachment.mode}`,
        `- original_name: ${attachment.file_name}`,
        `- mime: ${attachment.mime_type}`,
        `- size_bytes: ${attachment.size_bytes}`,
        `- sha256: ${attachment.sha256}`,
        `- path: ${attachment.stored_path}`,
        `- technical_link: ${attachment.technical_link}`,
        '',
      ]
    : ['## Attachment', '- none', ''];
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
    ...attachmentSection,
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

  let entry = '';
  if (event.event_type === 'manual_note') {
    const manualLabel = noteRelativePath ? `[manual](${path.basename(noteRelativePath)})` : 'manual';
    const attachmentLines = event.attachment
      ? [
          `- attachment_mode: ${event.attachment.mode}`,
          `- attachment_path: ${event.attachment.stored_path}`,
          `- attachment_size: ${event.attachment.size_bytes}`,
          `- attachment_sha256: ${event.attachment.sha256}`,
        ]
      : ['- attachment_mode: none'];
    entry = [
      eventMarker,
      `### ${time} ${manualLabel}`,
      '',
      '#### Resumo',
      analysis.summary,
      '',
      '#### Observação original',
      trimParagraph(event.raw_text, 'Sem texto informado.'),
      '',
      '#### Contexto',
      `- branch: ${event.branch || 'n/a'}`,
      `- head_sha: ${event.head_sha || 'n/a'}`,
      ...attachmentLines,
      '',
    ].join('\n');
  } else {
    entry = [
      eventMarker,
      `### ${time} push \`${shortSha(event.head_sha)}\``,
      '',
      `- branch: ${event.branch || 'n/a'}`,
      `- author: ${event.source_actor || 'n/a'}`,
      `- commits: ${Array.isArray(event.commits) ? event.commits.length : 0}`,
      `- files_changed: ${Number(event?.diffstat?.files_changed) || (Array.isArray(event.files) ? event.files.length : 0)}`,
      '',
      '#### Resumo',
      analysis.summary,
      '',
      '#### Impacto',
      analysis.impact,
      '',
      '#### Riscos',
      analysis.risks,
      '',
      '#### Próximos passos',
      analysis.nextSteps,
      '',
      '#### Arquivos alterados',
      renderFilesSection(event.files),
      '',
      '#### Commits',
      renderCommitsSection(event.commits),
      '',
      '#### Links',
      buildLinksSection(event),
      '',
    ].join('\n');
  }

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
    `- repository: ${project.repo_full_name || 'n/a'}`,
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
  const persistedAttachment = await persistAttachment(project, payload, eventDate);
  const event =
    payload.event_type === 'manual_note'
      ? {
          ...payload,
          display_name: project.display_name,
          attachment: persistedAttachment,
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
  const isManual = payload.event_type === 'manual_note';

  let noteRelativePath = '';
  if (isManual) {
    const noteFileName = `${year}-${month}-${day}-manual-${time}.md`;
    const notePath = path.join(vaultPath, project.notes_path, year, month, noteFileName);
    noteRelativePath = toRelativeVaultPath(notePath);
    await ensureDir(path.dirname(notePath));

    const tags = unique([
      ...(project.default_tags || []),
      ...(Array.isArray(payload.tags) ? payload.tags : []),
      'manual-note',
    ]);
    const commitsCount = Array.isArray(payload.commits) ? payload.commits.length : 0;
    const filesChanged = Number(payload?.diffstat?.files_changed) || (Array.isArray(payload.files) ? payload.files.length : 0);
    const insertions = Number(payload?.diffstat?.insertions) || 0;
    const deletions = Number(payload?.diffstat?.deletions) || 0;
    const noteFrontmatter = {
      id: payload.event_id,
      type: 'manual_note',
      kind: payload.kind || 'manual_note',
      project: project.project_slug,
      repo: payload.repo || project.repo_full_name || '',
      branch: payload.branch || project.default_branch,
      event_at: eventDate.toISOString(),
      source: payload.source || 'n8n',
      head_sha: payload.head_sha || '',
      author: payload.source_actor || '',
      is_manual: true,
      commits_count: commitsCount,
      files_changed: filesChanged,
      insertions,
      deletions,
      tags,
      semantic_text_version: semanticTextVersion,
      analysis_source: analysis.source,
      attachment_mode: persistedAttachment?.mode || 'none',
      attachment_path: persistedAttachment?.stored_path || '',
      attachment_sha256: persistedAttachment?.sha256 || '',
      attachment_size_bytes: persistedAttachment?.size_bytes || 0,
    };
    const content = renderManualNote(event, analysis, noteFrontmatter);
    await fs.writeFile(notePath, content, 'utf8');
  }

  const dailyPath = await upsertDailyNote(project, payload, analysis, noteRelativePath, eventDate);
  const indexPath = await updateProjectIndex(project);

  let commitMessage = `kb: ${project.project_slug} ${payload.event_type} ${payload.event_type === 'manual_note' ? time : shortSha(payload.head_sha)}`;
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
    notePath: isManual ? noteRelativePath : toRelativeVaultPath(dailyPath),
    attachmentMode: persistedAttachment?.mode || 'none',
    attachmentPath: persistedAttachment?.stored_path || '',
    dailyPath: toRelativeVaultPath(dailyPath),
    indexPath: toRelativeVaultPath(indexPath),
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
  const primaryBinary = binaryEntries.length > 0 ? binaryEntries[0][1] : null;
  const dataB64 = String(primaryBinary?.data || '').trim();
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

  if (!dataB64 && !fileName) {
    return null;
  }

  if (!dataB64) {
    return {
      file_name: fileName || 'attachment.bin',
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
  return {
    file_name: fileName || 'attachment.bin',
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
  payload.kind = slugify(String(payload.kind || 'manual_note').replace(/_/g, '-')).replace(/-/g, '_') || 'manual_note';
  payload.tags = parseTags(payload.tags || payload.tags_json || payload.tags_csv);
  payload.attachment = parseAttachmentFromInput(payload, binaries);

  if (!payload.event_type || !payload.event_id) {
    throw new Error('invalid_payload_missing_type_or_id');
  }
  if (payload.event_type === 'manual_note') {
    payload.raw_text = trimParagraph(payload.raw_text, '');
    if (!payload.raw_text) {
      throw new Error('manual_note_without_text');
    }
    if (!['manual_note', 'bug', 'resume', 'article', 'daily'].includes(payload.kind)) {
      throw new Error('invalid_manual_note_kind');
    }
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
  const analysis = await buildAnalysis(payload);
  const result = await persistEvent(project, payload, analysis);
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
