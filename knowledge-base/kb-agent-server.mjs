#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const kbAgentCommand = process.env.KB_AGENT_COMMAND || path.join(scriptDir, 'kb-agent');
const kbAgentEnvFile = process.env.KB_AGENT_ENV_FILE || path.join(scriptDir, '.env.kb-agent');
const serverEnvFile = process.env.KB_AGENT_SERVER_ENV_FILE || path.join(scriptDir, '.env.kb-agent-server');
const projectEnvFile = process.env.KB_PROJECT_ENV_FILE || path.resolve(scriptDir, '..', '.env');
const host = process.env.KB_AGENT_SERVER_HOST || '0.0.0.0';
const port = Number(process.env.KB_AGENT_SERVER_PORT || 8787);
const maxBodyBytes = Number(process.env.KB_AGENT_SERVER_MAX_BODY_BYTES || 25 * 1024 * 1024);
const maxFileBytes = Number(process.env.KB_AGENT_SERVER_MAX_FILE_BYTES || 10 * 1024 * 1024);
const allowedFileExtensions = new Set(
  String(process.env.KB_AGENT_SERVER_ALLOWED_EXTENSIONS || '.md,.txt,.pdf')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .map((entry) => (entry.startsWith('.') ? entry : `.${entry}`)),
);

function parseEnvText(raw) {
  const parsed = {};
  for (const line of String(raw || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

async function readEnvFile(targetPath) {
  try {
    return parseEnvText(await fs.readFile(targetPath, 'utf8'));
  } catch {
    return {};
  }
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(payload)}\n`);
}

function trimText(value, maxLength = 20000) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n...[truncated]`;
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      throw new Error('payload_too_large');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

async function buildRuntimeConfig() {
  const [serverEnv, agentEnv, projectEnv] = await Promise.all([
    readEnvFile(serverEnvFile),
    readEnvFile(kbAgentEnvFile),
    readEnvFile(projectEnvFile),
  ]);
  const secret =
    String(
      process.env.KB_AGENT_WEBHOOK_SECRET ||
        serverEnv.KB_AGENT_WEBHOOK_SECRET ||
        projectEnv.KB_AGENT_WEBHOOK_SECRET ||
        '',
    ).trim();
  return {
    secret,
    agentEnv: { ...projectEnv, ...agentEnv, ...serverEnv },
  };
}

async function handlePrompt(payload, runtimeConfig) {
  const prompt = String(payload?.prompt || payload?.text || '').trim();
  if (!prompt) {
    return {
      statusCode: 400,
      body: { ok: false, message: 'missing_prompt' },
    };
  }

  const env = { ...process.env, ...runtimeConfig.agentEnv };
  env.KB_AGENT_DANGEROUSLY_SKIP_PERMISSIONS = 'true';

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(kbAgentCommand, [prompt], {
        env,
        cwd: scriptDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const error = new Error(stderr || `kb-agent exited with code ${code}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      });
    });
    return {
      statusCode: 200,
      body: {
        ok: true,
        prompt,
        model: env.KB_OPENCODE_MODEL || env.OPENCODE_MODEL || '',
        stdout: trimText(result.stdout),
        stderr: trimText(result.stderr),
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        ok: false,
        prompt,
        model: env.KB_OPENCODE_MODEL || env.OPENCODE_MODEL || '',
        exitCode: error.code ?? null,
        stdout: trimText(error.stdout),
        stderr: trimText(error.stderr || error.message),
        message: trimText(error.stderr || error.message),
      },
    };
  }
}

function toSafeRelativePath(rawPath) {
  const normalized = String(rawPath || '')
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+/, '');
  if (!normalized) {
    throw new Error('missing_file_path');
  }
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) {
    throw new Error('missing_file_path');
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('invalid_file_path');
  }
  return segments.join('/');
}

function getFileBuffer(filePayload) {
  const base64 = filePayload?.contentBase64;
  if (typeof base64 === 'string' && base64.trim()) {
    return Buffer.from(base64.trim(), 'base64');
  }
  const content = filePayload?.content;
  if (typeof content === 'string') {
    return Buffer.from(content, 'utf8');
  }
  throw new Error('missing_file_content');
}

function normalizeFilesPayload(payload) {
  if (Array.isArray(payload?.files) && payload.files.length) {
    return payload.files;
  }
  if (payload?.file && typeof payload.file === 'object') {
    return [payload.file];
  }
  return [];
}

async function saveFiles(payload) {
  const filesRoot = await resolveFilesRoot();
  const files = normalizeFilesPayload(payload);
  if (!files.length) {
    return {
      statusCode: 400,
      body: { ok: false, message: 'missing_files' },
    };
  }

  const saved = [];
  for (const filePayload of files) {
    const requestedPath = filePayload?.path || filePayload?.name || filePayload?.fileName;
    const relativePath = toSafeRelativePath(requestedPath);
    const extension = path.extname(relativePath).toLowerCase();
    if (!extension || !allowedFileExtensions.has(extension)) {
      return {
        statusCode: 400,
        body: {
          ok: false,
          message: 'unsupported_file_extension',
          path: relativePath,
          allowedExtensions: [...allowedFileExtensions],
        },
      };
    }

    const fileBuffer = getFileBuffer(filePayload);
    if (!fileBuffer.length) {
      return {
        statusCode: 400,
        body: { ok: false, message: 'empty_file_content', path: relativePath },
      };
    }
    if (fileBuffer.length > maxFileBytes) {
      return {
        statusCode: 413,
        body: {
          ok: false,
          message: 'file_too_large',
          path: relativePath,
          maxFileBytes,
        },
      };
    }

    const destination = path.resolve(filesRoot, relativePath);
    if (!destination.startsWith(`${filesRoot}${path.sep}`)) {
      return {
        statusCode: 400,
        body: { ok: false, message: 'invalid_file_path', path: relativePath },
      };
    }

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, fileBuffer);
    saved.push({
      path: relativePath,
      bytes: fileBuffer.length,
      extension,
    });
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      filesRoot,
      saved,
    },
  };
}

async function resolveFilesRoot() {
  const explicitRoot = String(process.env.KB_AGENT_SERVER_FILES_ROOT || '').trim();
  const candidates = [
    explicitRoot,
    process.env.KB_VAULT_DIR,
    '/home/node/knowledge-vault',
    '/home/ubuntu/knowledge-vault',
    path.join(scriptDir, '..', '..', 'knowledge-vault'),
    path.join(scriptDir, 'uploads'),
  ]
    .filter(Boolean)
    .map((entry) => path.resolve(String(entry)));

  for (const candidate of candidates) {
    try {
      await fs.mkdir(candidate, { recursive: true });
      await fs.access(candidate, fsConstants.W_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('no_writable_files_root');
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/healthz') {
      const writableFilesRoot = await resolveFilesRoot();
      sendJson(response, 200, {
        ok: true,
        service: 'kb-agent-server',
        filesRoot: writableFilesRoot,
        allowedExtensions: [...allowedFileExtensions],
      });
      return;
    }

    if (
      request.method !== 'POST' ||
      !['/kb-agent', '/kb-agent/files', '/kb-agent/file'].includes(String(request.url))
    ) {
      sendJson(response, 404, { ok: false, message: 'not_found' });
      return;
    }

    const runtimeConfig = await buildRuntimeConfig();
    if (runtimeConfig.secret) {
      const received = String(request.headers['x-kb-secret'] || request.headers.authorization || '')
        .replace(/^Bearer\s+/i, '')
        .trim();
      if (!received || !timingSafeEqualString(received, runtimeConfig.secret)) {
        sendJson(response, 401, { ok: false, message: 'unauthorized_kb_agent_request' });
        return;
      }
    }

    const payload = await readJsonBody(request);
    const result =
      request.url === '/kb-agent'
        ? await handlePrompt(payload, runtimeConfig)
        : await saveFiles(payload);
    sendJson(response, result.statusCode, result.body);
  } catch (error) {
    const message = String(error?.message || error);
    const statusCode = message === 'payload_too_large' ? 413 : 500;
    sendJson(response, statusCode, { ok: false, message });
  }
});

server.listen(port, host, () => {
  process.stdout.write(`kb-agent-server listening on http://${host}:${port}\n`);
});
