import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = '/home/pedroduarte/Documents/GitHub/N8N-Automations';
const processorPath = path.join(repoRoot, 'knowledge-base/process-event-v2.mjs');

async function runProcessor({ payload, env }) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  const child = spawn('node', [processorPath, '--stdin-base64'], {
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.write(encoded);
  child.stdin.end();

  let stdout = '';
  let stderr = '';
  for await (const chunk of child.stdout) {
    stdout += chunk.toString();
  }
  for await (const chunk of child.stderr) {
    stderr += chunk.toString();
  }

  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(exitCode, 0, `processor exited with code ${exitCode}, stderr=${stderr}`);
  return JSON.parse(stdout.trim() || '{}');
}

async function createManifest(manifestPath) {
  const manifest = {
    projects: [
      {
        project_slug: 'n8n-automations',
        display_name: 'N8N Automations',
        repo_full_name: 'pedroaugusto04/n8n-automations',
        default_branch: 'main',
        notes_path: 'projects/n8n-automations',
        default_tags: ['n8n-automations'],
        enabled: true,
      },
    ],
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
}

function buildInput({ text, eventId, attachment }) {
  return {
    headers: {
      'x-kb-secret': 'test-secret',
    },
    body: {
      event_type: 'manual_note',
      event_id: eventId,
      project_slug: 'n8n-automations',
      kind: 'manual_note',
      raw_text: text,
      tags_json: '["test"]',
      source: 'test',
      triggered_at: '2026-04-21T10:00:00.000Z',
    },
    binaries: attachment
      ? {
          attachment: {
            data: attachment.data,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            fileSize: String(attachment.size),
          },
        }
      : {},
  };
}

test('stores small attachment inside vault assets path', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-small-'));
  const vaultPath = path.join(tmp, 'vault');
  const archivePath = path.join(tmp, 'archive');
  const manifestPath = path.join(tmp, 'projects.json');
  await createManifest(manifestPath);

  const smallBuffer = Buffer.from('small attachment content', 'utf8');
  const input = buildInput({
    text: 'small attachment note',
    eventId: 'manual:test-small',
    attachment: {
      data: smallBuffer.toString('base64'),
      fileName: 'sample.txt',
      mimeType: 'text/plain',
      size: smallBuffer.byteLength,
    },
  });

  const result = await runProcessor({
    payload: input,
    env: {
      KB_WEBHOOK_SECRET: 'test-secret',
      KB_VAULT_PATH: vaultPath,
      KB_ARCHIVE_PATH: archivePath,
      KB_PROJECTS_MANIFEST: manifestPath,
      KB_GIT_BATCH_MODE: 'true',
      KB_ENABLE_GIT_PUSH: 'false',
      KB_AI_PROVIDER: 'none',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attachmentMode, 'vault');
  assert.match(result.attachmentPath, /^projects\/n8n-automations\/assets\//);
  const stored = path.join(vaultPath, result.attachmentPath);
  const storedStat = await fs.stat(stored);
  assert.equal(storedStat.size, smallBuffer.byteLength);
});

test('stores large attachment in archive path', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-large-'));
  const vaultPath = path.join(tmp, 'vault');
  const archivePath = path.join(tmp, 'archive');
  const manifestPath = path.join(tmp, 'projects.json');
  await createManifest(manifestPath);

  const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 5, 7);
  const input = buildInput({
    text: 'large attachment note',
    eventId: 'manual:test-large',
    attachment: {
      data: largeBuffer.toString('base64'),
      fileName: 'artifact.bin',
      mimeType: 'application/octet-stream',
      size: largeBuffer.byteLength,
    },
  });

  const result = await runProcessor({
    payload: input,
    env: {
      KB_WEBHOOK_SECRET: 'test-secret',
      KB_VAULT_PATH: vaultPath,
      KB_ARCHIVE_PATH: archivePath,
      KB_PROJECTS_MANIFEST: manifestPath,
      KB_GIT_BATCH_MODE: 'true',
      KB_ENABLE_GIT_PUSH: 'false',
      KB_AI_PROVIDER: 'none',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attachmentMode, 'archive');
  assert.ok(result.attachmentPath.startsWith(archivePath));
  const storedStat = await fs.stat(result.attachmentPath);
  assert.equal(storedStat.size, largeBuffer.byteLength);

  const notePath = path.join(vaultPath, result.notePath);
  const noteBody = await fs.readFile(notePath, 'utf8');
  assert.match(noteBody, /attachment_mode: "archive"/);
});
