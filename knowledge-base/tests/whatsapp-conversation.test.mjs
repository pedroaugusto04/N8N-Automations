import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);
const scriptPath = path.join(repoRoot, 'whatsapp-conversation.mjs');

function runConversation(inputJson, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath, '--process'], {
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
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        // Leave null
      }
      resolve({ code, stdout, stderr, json });
    });
    child.stdin.write(JSON.stringify(inputJson));
    child.stdin.end();
  });
}

function makeEnv(tmp) {
  return {
    KB_ARCHIVE_PATH: tmp,
    KB_PROJECTS_MANIFEST: path.join(repoRoot, 'projects.json'),
    WPP_KB_GROUP_JID: '120363test@g.us',
    KB_AI_PROVIDER: '',
    KB_OPENAI_API_KEY: '',
    KB_GEMINI_API_KEY: '',
    WPP_CONVERSATION_TIMEOUT_MS: '60000',
  };
}

function makeInput(text, groupJid = '120363test@g.us') {
  return {
    message_text: text,
    sender_jid: '5511999999999@s.whatsapp.net',
    group_jid: groupJid,
    message_id: `msg-${Date.now()}`,
  };
}

test('ignores messages from wrong group', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const result = await runConversation(makeInput('hello', 'wrong-group@g.us'), makeEnv(tmp));
  assert.equal(result.json.action, 'ignore');
});

test('starts new note on first message in idle state', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const result = await runConversation(makeInput('corrigi timeout no webhook'), makeEnv(tmp));
  assert.equal(result.json.action, 'reply');
  assert.match(result.json.reply_text, /Nova nota recebida/);
  assert.match(result.json.reply_text, /corrigi timeout no webhook/);
  assert.match(result.json.reply_text, /Qual o tipo da nota/);
  assert.equal(result.json.payload, null);
});

test('infers kind=bug from error-related text', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const result = await runConversation(makeInput('erro 500 no webhook de ingestion'), makeEnv(tmp));
  assert.equal(result.json.action, 'reply');
  assert.match(result.json.reply_text, /bug/i);
});

test('full interactive flow: new note → kind → project → skip reminder → confirm', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = makeEnv(tmp);

  // Step 1: Send initial message
  const step1 = await runConversation(makeInput('configurar deploy automatizado'), env);
  assert.equal(step1.json.action, 'reply');
  assert.match(step1.json.reply_text, /Nova nota recebida/);

  // Step 2: Select kind (1 = manual_note)
  const step2 = await runConversation(makeInput('1'), env);
  assert.equal(step2.json.action, 'reply');
  assert.match(step2.json.reply_text, /Qual o projeto/);

  // Step 3: Select project (inbox)
  const step3 = await runConversation(makeInput('inbox'), env);
  assert.equal(step3.json.action, 'reply');
  assert.match(step3.json.reply_text, /lembrete/i);

  // Step 4: Skip reminder
  const step4 = await runConversation(makeInput('pular'), env);
  assert.equal(step4.json.action, 'reply');
  assert.match(step4.json.reply_text, /Resumo da nota/);
  assert.match(step4.json.reply_text, /configurar deploy automatizado/);

  // Step 5: Confirm
  const step5 = await runConversation(makeInput('sim'), env);
  assert.equal(step5.json.action, 'submit');
  assert.ok(step5.json.payload);
  assert.equal(step5.json.payload.event_type, 'manual_note');
  assert.equal(step5.json.payload.raw_text, 'configurar deploy automatizado');
  assert.equal(step5.json.payload.kind, 'manual_note');
  assert.equal(step5.json.payload.project_slug, 'inbox');
  assert.equal(step5.json.payload.source, 'whatsapp');
  assert.equal(step5.json.payload.reminder_date, '');
  assert.equal(step5.json.payload.reminder_time, '');
});

test('flow with reminder date and time', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = makeEnv(tmp);

  await runConversation(makeInput('revisar PR do feconnect'), env);
  await runConversation(makeInput('1'), env); // kind
  await runConversation(makeInput('1'), env); // project (first available)

  // Enter date
  const stepDate = await runConversation(makeInput('25/12/2026'), env);
  assert.match(stepDate.json.reply_text, /2026-12-25/);
  assert.match(stepDate.json.reply_text, /horário/i);

  // Enter time
  const stepTime = await runConversation(makeInput('14:30'), env);
  assert.match(stepTime.json.reply_text, /14:30/);
  assert.match(stepTime.json.reply_text, /Resumo da nota/);

  // Confirm
  const confirm = await runConversation(makeInput('sim'), env);
  assert.equal(confirm.json.action, 'submit');
  assert.equal(confirm.json.payload.reminder_date, '2026-12-25');
  assert.equal(confirm.json.payload.reminder_time, '14:30');
  assert.equal(confirm.json.payload.reminder_at, '2026-12-25T14:30:00-03:00');
});

test('cancel command resets conversation', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = makeEnv(tmp);

  await runConversation(makeInput('algo importante'), env);
  const cancel = await runConversation(makeInput('cancelar'), env);
  assert.equal(cancel.json.action, 'reply');
  assert.match(cancel.json.reply_text, /cancelada/i);

  // Next message should start fresh
  const fresh = await runConversation(makeInput('nova nota'), env);
  assert.match(fresh.json.reply_text, /Nova nota recebida/);
});

test('invalid kind re-prompts', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = makeEnv(tmp);

  await runConversation(makeInput('teste'), env);
  const bad = await runConversation(makeInput('xyz_invalido'), env);
  assert.equal(bad.json.action, 'reply');
  assert.match(bad.json.reply_text, /Não entendi/);
});

test('invalid reminder date re-prompts', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = makeEnv(tmp);

  await runConversation(makeInput('teste'), env);
  await runConversation(makeInput('1'), env); // kind
  await runConversation(makeInput('inbox'), env); // project

  const badDate = await runConversation(makeInput('32/13/2026'), env);
  assert.match(badDate.json.reply_text, /Data inválida/);
});

test('natural language dates: hoje and amanha', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = makeEnv(tmp);

  await runConversation(makeInput('teste'), env);
  await runConversation(makeInput('1'), env);
  await runConversation(makeInput('inbox'), env);

  const today = new Date().toISOString().slice(0, 10);
  const step = await runConversation(makeInput('hoje'), env);
  assert.match(step.json.reply_text, new RegExp(today));
});

test('discard note on "nao" at confirmation', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = makeEnv(tmp);

  await runConversation(makeInput('nota teste'), env);
  await runConversation(makeInput('1'), env);
  await runConversation(makeInput('inbox'), env);
  await runConversation(makeInput('pular'), env);

  const discard = await runConversation(makeInput('nao'), env);
  assert.equal(discard.json.action, 'reply');
  assert.match(discard.json.reply_text, /descartada/i);
});

test('kind selection by text name', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = makeEnv(tmp);

  await runConversation(makeInput('teste de bug'), env);
  const step = await runConversation(makeInput('bug'), env);
  assert.match(step.json.reply_text, /Erro.*falha.*incidente/i);
});

test('project match by alias', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = makeEnv(tmp);

  await runConversation(makeInput('nota sobre feconnect'), env);
  await runConversation(makeInput('1'), env); // kind

  const step = await runConversation(makeInput('feconnect'), env);
  assert.match(step.json.reply_text, /fe-connect/);
});

test('conversation times out after configured duration', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = { ...makeEnv(tmp), WPP_CONVERSATION_TIMEOUT_MS: '1' }; // 1ms timeout

  // Start a conversation
  await runConversation(makeInput('nota timeout'), env);

  // Wait for timeout
  await new Promise((r) => setTimeout(r, 50));

  // Next message should start fresh (state expired)
  const fresh = await runConversation(makeInput('nova nota'), env);
  assert.match(fresh.json.reply_text, /Nova nota recebida/);
  assert.match(fresh.json.reply_text, /nova nota/);
});

test('skip at kind selection uses inferred default', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const env = makeEnv(tmp);

  await runConversation(makeInput('algo geral'), env);
  const step = await runConversation(makeInput('pular'), env);
  // Should move to project phase with kind = manual_note
  assert.match(step.json.reply_text, /Qual o projeto/);
});

test('empty message is ignored', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wpp-conv-'));
  const result = await runConversation(makeInput(''), makeEnv(tmp));
  assert.equal(result.json.action, 'ignore');
});
