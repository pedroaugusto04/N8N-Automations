import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);
const processorPath = path.join(repoRoot, 'process-event-v2.mjs');

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
        name: 'N8N Automations',
        repo_full_name: 'pedroaugusto04/n8n-automations',
        default_branch: 'main',
        default_tags: ['n8n-automations'],
        owners: ['Pedro'],
        criticality: 'high',
        status: 'active',
        aliases: ['n8n'],
        area: 'automation',
        enabled: true,
      },
    ],
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest), 'utf8');
}

function buildInput({ text, eventId, attachment, body = {} }) {
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
      ...body,
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

test('stores small attachment in vault and creates dashboard, canonical note and followup', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-small-'));
  const vaultPath = path.join(tmp, 'vault');
  const archivePath = path.join(tmp, 'archive');
  const manifestPath = path.join(tmp, 'projects.json');
  await createManifest(manifestPath);

  const smallBuffer = Buffer.from('small attachment content', 'utf8');
  const input = buildInput({
    text: 'small attachment note',
    eventId: 'manual:test-small',
    body: {
      note_type: 'knowledge',
      importance: 'high',
      follow_up_by: '2026-04-25',
      related_projects: ['fe-connect'],
    },
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
  assert.match(result.notePath, /^20 Inbox\/n8n-automations\/2026\/04\//);
  assert.match(result.attachmentPath, /^90 Assets\/n8n-automations\/2026\/04\//);
  assert.match(result.canonicalPath, /^30 Knowledge\/n8n-automations\/2026\/04\//);
  assert.match(result.followupPath, /^60 Followups\/n8n-automations\/2026\/04\//);
  assert.equal(result.projectPath, '10 Projects/n8n-automations.md');
  const stored = path.join(vaultPath, result.attachmentPath);
  const storedStat = await fs.stat(stored);
  assert.equal(storedStat.size, smallBuffer.byteLength);

  const noteBody = await fs.readFile(path.join(vaultPath, result.notePath), 'utf8');
  assert.match(noteBody, /type: "event"/);
  assert.match(noteBody, /note_type: "knowledge"/);
  assert.match(noteBody, /> \[!abstract\] Resumo do evento/);
  assert.match(noteBody, /## Navegacao rapida/);
  assert.match(noteBody, /\[\[10 Projects\/n8n-automations\|Resumo do projeto\]\]/);
  assert.match(noteBody, /## Proximos passos/);
  assert.match(noteBody, /## Contexto original/);

  const canonicalBody = await fs.readFile(path.join(vaultPath, result.canonicalPath), 'utf8');
  assert.match(canonicalBody, /type: "knowledge"/);
  assert.match(canonicalBody, /canonical: true/);
  assert.match(canonicalBody, /> \[!abstract\] Registro consolidado/);
  assert.match(canonicalBody, /## Rastreabilidade/);

  const homeBody = await fs.readFile(path.join(vaultPath, '00 Home/Home.md'), 'utf8');
  assert.match(homeBody, /# Home/);
  assert.match(homeBody, /> \[!warning\] Atencao agora/);
  assert.match(homeBody, /## Radar rapido/);
  assert.match(homeBody, /## Navegacao por objetivo/);

  const projectsDashboardBody = await fs.readFile(path.join(vaultPath, '10 Projects/Projects.md'), 'utf8');
  assert.match(projectsDashboardBody, /# Projetos/);
  assert.match(projectsDashboardBody, /## Projetos com atencao agora/);

  const projectBody = await fs.readFile(path.join(vaultPath, result.projectPath), 'utf8');
  assert.match(projectBody, /type: "project_summary"/);
  assert.match(projectBody, /criticality: "high"/);
  assert.match(projectBody, /> \[!info\] Estado atual do projeto/);
  assert.match(projectBody, /## Onde olhar primeiro/);
  assert.match(projectBody, /## Saude do projeto/);

  const followupBody = await fs.readFile(path.join(vaultPath, result.followupPath), 'utf8');
  assert.match(followupBody, /> \[!warning\] Acao pendente/);
  assert.match(followupBody, /## O que precisa ser feito/);
  assert.match(followupBody, /## Links relacionados/);
});

test('stores large attachment in archive and promotes bug notes to incident', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-large-'));
  const vaultPath = path.join(tmp, 'vault');
  const archivePath = path.join(tmp, 'archive');
  const manifestPath = path.join(tmp, 'projects.json');
  await createManifest(manifestPath);

  const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 5, 7);
  const input = buildInput({
    text: 'large attachment note',
    eventId: 'manual:test-large',
    body: {
      kind: 'bug',
      status: 'open',
    },
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
  assert.match(result.notePath, /^20 Inbox\/n8n-automations\/2026\/04\//);
  assert.match(result.canonicalPath, /^50 Incidents\/n8n-automations\/2026\/04\//);
  assert.match(result.followupPath, /^60 Followups\/n8n-automations\/2026\/04\//);
  assert.ok(result.attachmentPath.startsWith(archivePath));
  const storedStat = await fs.stat(result.attachmentPath);
  assert.equal(storedStat.size, largeBuffer.byteLength);

  const notePath = path.join(vaultPath, result.notePath);
  const noteBody = await fs.readFile(notePath, 'utf8');
  assert.match(noteBody, /attachment_mode: "archive"/);

  const incidentBody = await fs.readFile(path.join(vaultPath, result.canonicalPath), 'utf8');
  assert.match(incidentBody, /type: "incident"/);
  assert.match(incidentBody, /> \[!abstract\] Registro consolidado/);
  assert.match(incidentBody, /## Riscos e prevencao/);

  const dailyBody = await fs.readFile(path.join(vaultPath, result.dailyPath), 'utf8');
  assert.match(dailyBody, /## Events/);
});
