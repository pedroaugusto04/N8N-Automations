import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const repoRoot = '/home/pedroduarte/Documents/GitHub/N8N-Automations';
const kbPath = path.join(repoRoot, 'knowledge-base/kb');

function runKb(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(kbPath, args, {
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function runKbInteractive(args, input, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(kbPath, args, {
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

test('kb sends json payload with text and attachment', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const parsed = JSON.parse(raw);
      requests.push({
        headers: req.headers,
        body: raw,
        json: parsed,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          event_id: 'manual:test',
          project: 'n8n-automations',
          kind: 'bug',
          notePath: 'projects/n8n-automations/2026/04/note.md',
          attachmentMode: 'vault',
          attachmentPath: 'projects/n8n-automations/assets/2026/04/sample.txt',
          pushStatus: 'deferred_batch_mode',
        }),
      );
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-cli-'));
  const attachmentPath = path.join(tmp, 'sample.txt');
  await fs.writeFile(attachmentPath, 'sample body', 'utf8');

  const result = await runKb(
    ['fix de timeout no webhook', '--project', 'n8n-automations', '--kind', 'bug', '--path', attachmentPath, '--default'],
    {
      HOME: tmp,
      KB_WEBHOOK_URL: `http://127.0.0.1:${port}/kb-event`,
      KB_WEBHOOK_SECRET: 'test-secret',
    },
  );

  server.close();

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /kb: nota enviada com sucesso\./);
  assert.match(result.stdout, /project: n8n-automations/);
  assert.match(result.stdout, /kind: bug/);
  assert.match(result.stdout, /note: projects\/n8n-automations\/2026\/04\/note\.md/);
  assert.match(result.stdout, /attachment: projects\/n8n-automations\/assets\/2026\/04\/sample\.txt \(vault\)/);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers['x-kb-secret'], 'test-secret');
  assert.match(String(requests[0].headers['content-type'] || ''), /^application\/json\b/);
  assert.equal(requests[0].json.raw_text, 'fix de timeout no webhook');
  assert.equal(requests[0].json.kind, 'bug');
  assert.equal(requests[0].json.project_slug, 'n8n-automations');
  assert.equal(requests[0].json.attachment.file_name, 'sample.txt');
  assert.equal(requests[0].json.attachment.mime_type, 'text/plain');
  assert.equal(requests[0].json.attachment.data_b64, Buffer.from('sample body', 'utf8').toString('base64'));
});

test('kb asks for missing kind and project one by one with numbered choices', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('latin1');
      const parsed = JSON.parse(raw);
      requests.push({
        headers: req.headers,
        body: raw,
        json: parsed,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          event_id: 'manual:test:interactive',
          project: 'n8n-automations',
          kind: 'bug',
        }),
      );
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-cli-interactive-'));
  const result = await runKbInteractive(
    ['fix de timeout no webhook'],
    '2\n3\n',
    {
      HOME: tmp,
      KB_WEBHOOK_URL: `http://127.0.0.1:${port}/kb-event`,
      KB_WEBHOOK_SECRET: 'test-secret',
    },
  );

  server.close();

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /kb: selecione o kind da anotacao:/);
  assert.match(result.stderr, /1\) manual_note - anotacao manual geral \[padrao\]/);
  assert.match(result.stderr, /2\) bug - erro, falha ou incidente/);
  assert.match(result.stderr, /kb: selecione o projeto:/);
  assert.match(result.stderr, /1\) n8n-automations - projeto detectado pelo repositorio atual \[padrao\]/);
  assert.match(result.stderr, /2\) inbox - projeto padrao configurado/);
  assert.match(result.stderr, /3\) Fe-Connect \(fe-connect\)/);
  assert.equal(requests.length, 1);
  assert.match(String(requests[0].headers['content-type'] || ''), /^application\/json\b/);
  assert.equal(requests[0].json.event_type, 'manual_note');
  assert.equal(requests[0].json.kind, 'bug');
  assert.equal(requests[0].json.project_slug, 'fe-connect');
  assert.equal(requests[0].json.raw_text, 'fix de timeout no webhook');
  assert.match(result.stdout, /kb: nota enviada com sucesso\./);
  assert.match(result.stdout, /project: n8n-automations/);
  assert.match(result.stdout, /kind: bug/);
});
