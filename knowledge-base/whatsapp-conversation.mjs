#!/usr/bin/env node

/**
 * WhatsApp Conversation Engine for Knowledge Base
 *
 * Manages a stateful conversation flow to collect note fields via natural language
 * in a WhatsApp group. Replaces the bash `kb` CLI interactive prompts.
 *
 * Usage:
 *   echo '<json>' | node whatsapp-conversation.mjs --process
 *
 * Input JSON:
 *   { "message_text": "...", "sender_jid": "...", "group_jid": "...", "message_id": "..." }
 *
 * Output JSON:
 *   { "action": "reply"|"submit"|"ignore", "reply_text": "...", "payload": null|{...} }
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// ── Configuration ──────────────────────────────────────────────────────────────

const archivePath = process.env.KB_ARCHIVE_PATH || '/home/node/knowledge-vault-archive';
const manifestPath = process.env.KB_PROJECTS_MANIFEST || '/home/node/knowledge-base/projects.json';
const allowedGroupJid = (process.env.WPP_KB_GROUP_JID || '').trim();
const conversationTimeoutMs = Number(process.env.WPP_CONVERSATION_TIMEOUT_MS) || 600_000; // 10 min
const aiProvider = (process.env.KB_AI_PROVIDER || 'openai').trim().toLowerCase();
const openaiApiKey = (process.env.KB_OPENAI_API_KEY || '').trim();
const openaiModel = (process.env.KB_OPENAI_MODEL || 'gpt-4.1-mini').trim();
const geminiApiKey = (process.env.KB_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const geminiModel = (process.env.KB_GEMINI_MODEL || 'gemini-2.0-flash').trim();

const statePath = path.join(archivePath, 'whatsapp-conversation-state.json');

const KINDS = ['manual_note', 'bug', 'resume', 'article', 'daily'];
const KIND_LABELS = {
  manual_note: 'Anotação geral',
  bug: 'Erro / falha / incidente',
  resume: 'Resumo / síntese',
  article: 'Artigo / tutorial / documentação',
  daily: 'Diário / standup',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

function now() {
  return new Date().toISOString();
}

// ── Projects Manifest ──────────────────────────────────────────────────────────

async function loadProjects() {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const data = JSON.parse(raw);
    const projects = Array.isArray(data?.projects) ? data.projects : [];
    return projects
      .filter((p) => p?.enabled !== false && p?.project_slug)
      .map((p) => ({
        slug: String(p.project_slug).trim(),
        display: String(p.display_name || p.name || p.project_slug).trim(),
        aliases: Array.isArray(p.aliases) ? p.aliases.map((a) => String(a).toLowerCase().trim()) : [],
      }));
  } catch {
    return [];
  }
}

function matchProject(text, projects) {
  const lower = text.toLowerCase().trim();
  for (const p of projects) {
    if (lower === p.slug || lower === p.display.toLowerCase()) return p.slug;
    for (const alias of p.aliases) {
      if (lower === alias) return p.slug;
    }
  }
  // Fuzzy: check if any project slug/alias is contained in the text
  for (const p of projects) {
    if (lower.includes(p.slug)) return p.slug;
    for (const alias of p.aliases) {
      if (lower.includes(alias)) return p.slug;
    }
  }
  return '';
}

// ── Conversation State ─────────────────────────────────────────────────────────

/**
 * State shape:
 * {
 *   phase: "idle" | "awaiting_kind" | "awaiting_project" | "awaiting_reminder_date" | "awaiting_reminder_time" | "awaiting_confirmation",
 *   raw_text: string,
 *   kind: string,
 *   project_slug: string,
 *   reminder_date: string,  // YYYY-MM-DD
 *   reminder_time: string,  // HH:mm
 *   tags: string[],
 *   importance: string,
 *   note_type: string,
 *   updated_at: string (ISO),
 * }
 */

const EMPTY_STATE = {
  phase: 'idle',
  raw_text: '',
  kind: '',
  project_slug: '',
  reminder_date: '',
  reminder_time: '',
  tags: [],
  importance: '',
  note_type: '',
  attachment_file_name: '',
  attachment_mime_type: '',
  attachment_size: 0,
  attachment_data_b64: '',
  updated_at: '',
};

async function loadState() {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.phase) {
      // Check timeout
      if (parsed.updated_at && parsed.phase !== 'idle') {
        const elapsed = Date.now() - new Date(parsed.updated_at).getTime();
        if (elapsed > conversationTimeoutMs) {
          return { ...EMPTY_STATE };
        }
      }
      return parsed;
    }
  } catch {
    // No state file yet
  }
  return { ...EMPTY_STATE };
}

async function saveState(state) {
  state.updated_at = now();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

// ── Date/Time Parsing ──────────────────────────────────────────────────────────

function parseReminderDate(text) {
  const trimmed = text.trim();

  // DD/MM/YYYY
  let match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (d.getUTCDate() === Number(day) && d.getUTCMonth() === Number(month) - 1) {
      return `${year}-${month}-${day}`;
    }
  }

  // YYYY-MM-DD
  match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (d.getUTCDate() === Number(day) && d.getUTCMonth() === Number(month) - 1) {
      return `${year}-${month}-${day}`;
    }
  }

  // Natural language: "amanha", "hoje"
  const lower = trimmed.toLowerCase();
  const today = new Date();
  if (lower === 'hoje' || lower === 'today') {
    return today.toISOString().slice(0, 10);
  }
  if (lower === 'amanha' || lower === 'amanhã' || lower === 'tomorrow') {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }

  return '';
}

function parseReminderTime(text) {
  const match = text.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// ── Kind Inference (regex fallback) ────────────────────────────────────────────

function inferKind(text) {
  const lower = text.toLowerCase();
  if (/\b(erro|bug|falha|exception|stacktrace|quebrou|incidente|crash)\b/.test(lower)) return 'bug';
  if (/\b(resumo|summary|sumario|sintese|recap)\b/.test(lower)) return 'resume';
  if (/\b(artigo|article|tutorial|guia|documentacao|doc)\b/.test(lower)) return 'article';
  if (/\b(hoje|daily|diario|standup)\b/.test(lower)) return 'daily';
  return 'manual_note';
}

// ── AI Extraction ──────────────────────────────────────────────────────────────

function hasAI() {
  if (aiProvider === 'openai' && openaiApiKey) return true;
  if (aiProvider === 'gemini' && geminiApiKey) return true;
  return false;
}

async function aiExtractFields(messageText, projects) {
  const projectList = projects.map((p) => p.slug).join(', ');
  const systemPrompt = [
    'Voce e um assistente que extrai campos estruturados de uma mensagem de anotacao em portugues.',
    'Extraia os seguintes campos do texto do usuario:',
    '- "raw_text": o texto principal da anotacao (obrigatorio)',
    `- "kind": um de [manual_note, bug, resume, article, daily] (inferir do contexto)`,
    `- "project_slug": um de [${projectList}, inbox] (inferir do contexto, ou "inbox" se nao detectar)`,
    '- "importance": um de [low, medium, high] (inferir do contexto, default "low")',
    '- "reminder_date": data no formato YYYY-MM-DD se mencionada (ou vazio)',
    '- "reminder_time": horario no formato HH:mm se mencionado (ou vazio)',
    '- "tags": array de tags relevantes extraidas do texto (slugificadas)',
    '',
    'Responda SOMENTE com JSON valido, sem markdown, sem explicacao.',
  ].join('\n');

  try {
    let responseText = '';

    if (aiProvider === 'openai' && openaiApiKey) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: openaiModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: messageText },
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });
      const data = await response.json();
      responseText = data?.choices?.[0]?.message?.content || '';
    } else if (aiProvider === 'gemini' && geminiApiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: messageText }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
        }),
      });
      const data = await response.json();
      responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    if (!responseText) return null;

    // Strip markdown fences if present
    const cleaned = responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// ── Conversation Flow ──────────────────────────────────────────────────────────

function isCancel(text) {
  const lower = text.toLowerCase().trim();
  return ['cancelar', 'cancel', 'cancela', 'sair', 'desistir', '0'].includes(lower);
}

function isConfirm(text) {
  const lower = text.toLowerCase().trim();
  return ['confirmar', 'confirma', 'ok', 'sim', 's', 'yes', 'y', 'enviar', 'salvar', '1'].includes(lower);
}

function isSkip(text) {
  const lower = text.toLowerCase().trim();
  return ['pular', 'skip', 'nao', 'não', 'n', 'no', 'nenhum', 'sem', '', '9'].includes(lower);
}

function parseKindChoice(text) {
  const trimmed = text.trim();

  // Numeric choice: "1", "2", etc.
  const num = Number(trimmed);
  if (Number.isInteger(num) && num >= 1 && num <= KINDS.length) {
    return KINDS[num - 1];
  }

  // Text match
  const lower = trimmed.toLowerCase();
  for (const kind of KINDS) {
    if (lower === kind || lower === kind.replace(/_/g, ' ')) return kind;
  }
  // Partial match on labels
  for (const [kind, label] of Object.entries(KIND_LABELS)) {
    if (label.toLowerCase().includes(lower) || lower.includes(kind.replace(/_/g, ' '))) return kind;
  }

  return '';
}

function parseProjectChoice(text, projects) {
  const trimmed = text.trim();

  // Numeric choice
  const num = Number(trimmed);
  if (Number.isInteger(num) && num >= 1 && num <= projects.length + 1) {
    if (num <= projects.length) return projects[num - 1].slug;
    return 'inbox'; // Last option
  }

  // Text match
  const slug = matchProject(trimmed, projects);
  if (slug) return slug;

  if (trimmed.toLowerCase() === 'inbox') return 'inbox';

  return '';
}

function buildKindPrompt() {
  const lines = ['Qual o tipo da nota?', ''];
  KINDS.forEach((kind, index) => {
    lines.push(`${index + 1}. ${KIND_LABELS[kind]}`);
  });
  lines.push('', '9. Pular (usar sugerido)');
  lines.push('0. Cancelar');
  return lines.join('\n');
}

function buildProjectPrompt(projects, suggestedSlug) {
  const lines = ['Qual o projeto?', ''];
  projects.forEach((p, index) => {
    const suffix = p.slug === suggestedSlug ? ' ✓' : '';
    lines.push(`${index + 1}. ${p.display} (${p.slug})${suffix}`);
  });
  lines.push(`${projects.length + 1}. inbox - caixa de entrada geral`);
  lines.push('', '9. Pular (usar sugerido)');
  lines.push('0. Cancelar');
  return lines.join('\n');
}

function buildReminderDatePrompt() {
  return [
    'Deseja agendar um lembrete?',
    '',
    'Envie a data (DD/MM/AAAA, "hoje", "amanhã")',
    '',
    '9. Pular (sem lembrete)',
    '0. Cancelar',
  ].join('\n');
}

function buildReminderTimePrompt() {
  return [
    'Qual horário exato para o lembrete? (HH:mm)',
    '',
    '9. Pular (resumo diário 09:00)',
    '0. Cancelar',
  ].join('\n');
}

function buildConfirmationPrompt(state) {
  const datePart = state.reminder_date
    ? state.reminder_time
      ? `${state.reminder_date} às ${state.reminder_time}`
      : `${state.reminder_date} (resumo diário)`
    : 'Sem lembrete';

  const attachmentPart = state.attachment_file_name
    ? `*Anexo:* ${state.attachment_file_name} (${state.attachment_mime_type})`
    : '';

  return [
    '📋 *Resumo da nota:*',
    '',
    `*Texto:* ${state.raw_text}`,
    `*Tipo:* ${KIND_LABELS[state.kind] || state.kind}`,
    `*Projeto:* ${state.project_slug}`,
    `*Lembrete:* ${datePart}`,
    state.tags?.length ? `*Tags:* ${state.tags.join(', ')}` : '',
    attachmentPart,
    '',
    '1. Confirmar ✅',
    '9. Descartar 🗑️',
    '0. Cancelar ❌',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPayload(state) {
  const eventId = `manual:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
  const reminderAt =
    state.reminder_date && state.reminder_time ? `${state.reminder_date}T${state.reminder_time}:00-03:00` : '';

  const payload = {
    event_type: 'manual_note',
    event_id: eventId,
    triggered_at: now(),
    project_slug: state.project_slug || 'inbox',
    source: 'whatsapp',
    raw_text: state.raw_text,
    kind: state.kind || 'manual_note',
    tags: state.tags || [],
    note_type: state.note_type || '',
    importance: state.importance || '',
    status: '',
    follow_up_by: '',
    decision_flag: false,
    related_projects: [],
    reminder_date: state.reminder_date || '',
    reminder_time: state.reminder_time || '',
    reminder_at: reminderAt,
  };

  // Include attachment if present
  if (state.attachment_data_b64 && state.attachment_file_name) {
    payload.attachment = {
      file_name: state.attachment_file_name,
      mime_type: state.attachment_mime_type || 'application/octet-stream',
      size_bytes: state.attachment_size || 0,
      sha256: '',
      data_b64: state.attachment_data_b64,
    };
  }

  return payload;
}

// ── Main Process ───────────────────────────────────────────────────────────────

async function processMessage(input) {
  const messageText = String(input.message_text || '').trim();
  const groupJid = String(input.group_jid || '').trim();

  // Only respond in the configured group
  if (allowedGroupJid && groupJid !== allowedGroupJid) {
    return { action: 'ignore', reply_text: '', payload: null };
  }

  if (!messageText && !input.has_media) {
    return { action: 'ignore', reply_text: '', payload: null };
  }

  const state = await loadState();
  const projects = await loadProjects();

  // Cancel command works from any phase
  if (isCancel(messageText)) {
    await saveState({ ...EMPTY_STATE });
    return { action: 'reply', reply_text: '❌ Conversa cancelada. Envie uma nova anotação quando quiser.', payload: null };
  }

  // ── Phase: idle → start new note ──────────────────────────────────────────

  if (state.phase === 'idle') {
    let extractedFields = null;

    // Try AI extraction first
    if (hasAI()) {
      extractedFields = await aiExtractFields(messageText, projects);
    }

    const rawText = extractedFields?.raw_text || messageText;
    const inferredKind = extractedFields?.kind || inferKind(messageText);
    const inferredProject = extractedFields?.project_slug || matchProject(messageText, projects) || '';
    const inferredImportance = extractedFields?.importance || '';
    const inferredTags = Array.isArray(extractedFields?.tags)
      ? extractedFields.tags.map((t) => slugify(t)).filter(Boolean)
      : [];
    const inferredReminderDate = extractedFields?.reminder_date || '';
    const inferredReminderTime = extractedFields?.reminder_time || '';

    // If AI extracted everything and we have a confident match, go straight to confirmation
    const aiComplete = extractedFields && extractedFields.raw_text && extractedFields.kind && extractedFields.project_slug && extractedFields.project_slug !== 'inbox';

    if (aiComplete) {
      const newState = {
        phase: 'awaiting_confirmation',
        raw_text: rawText,
        kind: inferredKind,
        project_slug: inferredProject || 'inbox',
        reminder_date: inferredReminderDate,
        reminder_time: inferredReminderTime,
        tags: inferredTags,
        importance: inferredImportance,
        note_type: '',
        attachment_file_name: input.has_media ? String(input.media_file_name || '') : '',
        attachment_mime_type: input.has_media ? String(input.media_mime_type || '') : '',
        attachment_size: input.has_media ? Number(input.media_file_size || 0) : 0,
        attachment_data_b64: input.has_media ? String(input.media_data_b64 || '') : '',
        updated_at: '',
      };
      await saveState(newState);
      return {
        action: 'reply',
        reply_text: `✏️ Nota detectada!\n\n${buildConfirmationPrompt(newState)}`,
        payload: null,
      };
    }

    // Otherwise, start interactive flow
    const newState = {
      phase: 'awaiting_kind',
      raw_text: rawText,
      kind: inferredKind,
      project_slug: inferredProject,
      reminder_date: inferredReminderDate,
      reminder_time: inferredReminderTime,
      tags: inferredTags,
      importance: inferredImportance,
      note_type: '',
      attachment_file_name: input.has_media ? String(input.media_file_name || '') : '',
      attachment_mime_type: input.has_media ? String(input.media_mime_type || '') : '',
      attachment_size: input.has_media ? Number(input.media_file_size || 0) : 0,
      attachment_data_b64: input.has_media ? String(input.media_data_b64 || '') : '',
      updated_at: '',
    };
    await saveState(newState);

    const suggestedLabel = KIND_LABELS[inferredKind] || inferredKind;
    return {
      action: 'reply',
      reply_text: `✏️ *Nova nota recebida!*\n_"${rawText.slice(0, 100)}${rawText.length > 100 ? '...' : ''}"_\n\nSugestão de tipo: *${suggestedLabel}*\n\n${buildKindPrompt()}`,
      payload: null,
    };
  }

  // ── Phase: awaiting_kind ──────────────────────────────────────────────────

  if (state.phase === 'awaiting_kind') {
    let selectedKind = '';

    if (isSkip(messageText)) {
      selectedKind = state.kind || 'manual_note';
    } else {
      selectedKind = parseKindChoice(messageText);
    }

    if (!selectedKind) {
      return {
        action: 'reply',
        reply_text: `Não entendi. ${buildKindPrompt()}`,
        payload: null,
      };
    }

    state.kind = selectedKind;
    state.phase = 'awaiting_project';
    await saveState(state);

    const suggestedProject = state.project_slug || 'inbox';
    return {
      action: 'reply',
      reply_text: `Tipo: *${KIND_LABELS[selectedKind]}* ✓\n\n${buildProjectPrompt(projects, suggestedProject)}`,
      payload: null,
    };
  }

  // ── Phase: awaiting_project ───────────────────────────────────────────────

  if (state.phase === 'awaiting_project') {
    let selectedProject = '';

    if (isSkip(messageText)) {
      selectedProject = state.project_slug || 'inbox';
    } else {
      selectedProject = parseProjectChoice(messageText, projects);
    }

    if (!selectedProject) {
      return {
        action: 'reply',
        reply_text: `Não entendi. ${buildProjectPrompt(projects, state.project_slug || 'inbox')}`,
        payload: null,
      };
    }

    state.project_slug = selectedProject;
    state.phase = 'awaiting_reminder_date';
    await saveState(state);

    return {
      action: 'reply',
      reply_text: `Projeto: *${selectedProject}* ✓\n\n${buildReminderDatePrompt()}`,
      payload: null,
    };
  }

  // ── Phase: awaiting_reminder_date ─────────────────────────────────────────

  if (state.phase === 'awaiting_reminder_date') {
    if (isSkip(messageText)) {
      state.reminder_date = '';
      state.reminder_time = '';
      state.phase = 'awaiting_confirmation';
      await saveState(state);
      return {
        action: 'reply',
        reply_text: `Sem lembrete ✓\n\n${buildConfirmationPrompt(state)}`,
        payload: null,
      };
    }

    const parsedDate = parseReminderDate(messageText);
    if (!parsedDate) {
      return {
        action: 'reply',
        reply_text: 'Data inválida. Use DD/MM/AAAA, "hoje" ou "amanhã". "pular" para seguir sem lembrete.',
        payload: null,
      };
    }

    state.reminder_date = parsedDate;
    state.phase = 'awaiting_reminder_time';
    await saveState(state);

    return {
      action: 'reply',
      reply_text: `Data: *${parsedDate}* ✓\n\n${buildReminderTimePrompt()}`,
      payload: null,
    };
  }

  // ── Phase: awaiting_reminder_time ─────────────────────────────────────────

  if (state.phase === 'awaiting_reminder_time') {
    if (isSkip(messageText)) {
      state.reminder_time = '';
      state.phase = 'awaiting_confirmation';
      await saveState(state);
      return {
        action: 'reply',
        reply_text: `Horário: resumo diário ✓\n\n${buildConfirmationPrompt(state)}`,
        payload: null,
      };
    }

    const parsedTime = parseReminderTime(messageText);
    if (!parsedTime) {
      return {
        action: 'reply',
        reply_text: 'Horário inválido. Use HH:mm (ex: 14:30). "pular" para receber no resumo diário.',
        payload: null,
      };
    }

    state.reminder_time = parsedTime;
    state.phase = 'awaiting_confirmation';
    await saveState(state);

    return {
      action: 'reply',
      reply_text: `Horário: *${parsedTime}* ✓\n\n${buildConfirmationPrompt(state)}`,
      payload: null,
    };
  }

  // ── Phase: awaiting_confirmation ──────────────────────────────────────────

  if (state.phase === 'awaiting_confirmation') {
    if (isSkip(messageText) && !isConfirm(messageText)) {
      await saveState({ ...EMPTY_STATE });
      return {
        action: 'reply',
        reply_text: '❌ Nota descartada. Envie uma nova anotação quando quiser.',
        payload: null,
      };
    }

    if (isConfirm(messageText)) {
      const payload = buildPayload(state);
      await saveState({ ...EMPTY_STATE });
      return {
        action: 'submit',
        reply_text: '✅ Nota enviada para processamento!',
        payload,
      };
    }

    return {
      action: 'reply',
      reply_text: `Responda "sim" para confirmar, "não" para descartar, ou "cancelar".\n\n${buildConfirmationPrompt(state)}`,
      payload: null,
    };
  }

  // Fallback: reset
  await saveState({ ...EMPTY_STATE });
  return { action: 'ignore', reply_text: '', payload: null };
}

// ── CLI Entry Point ────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2] || '';

  if (mode !== '--process') {
    console.error('Usage: echo \'<json>\' | node whatsapp-conversation.mjs --process');
    process.exit(1);
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const rawInput = Buffer.concat(chunks).toString('utf8').trim();

  if (!rawInput) {
    process.stdout.write(JSON.stringify({ action: 'ignore', reply_text: '', payload: null }));
    return;
  }

  const input = JSON.parse(rawInput);
  const result = await processMessage(input);
  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      action: 'error',
      reply_text: `Erro interno: ${String(error?.message || error)}`,
      payload: null,
    }),
  );
  process.exitCode = 0;
});
