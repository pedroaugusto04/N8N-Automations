#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const vaultPath = process.env.KB_VAULT_PATH || '/home/node/knowledge-vault';
const archivePath = process.env.KB_ARCHIVE_PATH || '/home/node/knowledge-vault-archive';
const statePath = process.env.KB_REMINDER_STATE_PATH || path.join(archivePath, 'reminders-state.json');
const remindersRoot = path.join(vaultPath, '70 Reminders');

const mode = String(process.argv[2] || '').trim().toLowerCase();

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function getNow() {
  const override = String(process.env.KB_REMINDER_NOW || '').trim();
  if (!override) {
    return new Date();
  }
  const parsed = new Date(override);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('invalid_reminder_now');
  }
  return parsed;
}

function usage() {
  console.error('Usage: node reminders-dispatch.mjs daily|exact');
}

function parseFrontmatterValue(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith('[') && value.endsWith(']')) ||
    value === 'true' ||
    value === 'false' ||
    value === 'null'
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function parseFrontmatter(content) {
  const match = String(content || '').match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return {};
  }
  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    frontmatter[key] = parseFrontmatterValue(value);
  }
  return frontmatter;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHeading(content) {
  const match = String(content || '').match(/^#\s+(.+)$/m);
  return normalizeText(match?.[1] || '');
}

function extractSection(content, heading) {
  const pattern = new RegExp(`^## ${escapeRegExp(heading)}\\n([\\s\\S]*?)(?=\\n## |$)`, 'm');
  const match = String(content || '').match(pattern);
  return normalizeText(match?.[1] || '');
}

function formatReminderEntry(reminder, { includeSchedule = false } = {}) {
  const lines = [];
  lines.push(`[${reminder.project}] ${reminder.title}`);
  if (includeSchedule) {
    const schedule = reminder.reminderTime
      ? `${reminder.reminderDate} ${reminder.reminderTime}`
      : `${reminder.reminderDate} (sem horario exato)`;
    lines.push(`Agendado para: ${schedule}`);
  }
  if (reminder.description) {
    lines.push(`Descricao: ${reminder.description}`);
  }
  if (reminder.context && reminder.context !== reminder.description) {
    lines.push(`Contexto: ${reminder.context}`);
  }
  return lines.join('\n');
}

async function listMarkdownFiles(dirPath) {
  let entries = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(resolved)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'Reminders.md') {
      files.push(resolved);
    }
  }
  return files;
}

async function loadReminders() {
  const files = await listMarkdownFiles(remindersRoot);
  const reminders = [];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const frontmatter = parseFrontmatter(content);
    if (String(frontmatter.type || '').trim() !== 'reminder') {
      continue;
    }
    const status = String(frontmatter.status || '').trim();
    if (status === 'resolved' || status === 'archived') {
      continue;
    }
    const rawTitle = extractHeading(content);
    const title = rawTitle.replace(/^Reminder\s+/i, '').trim() || path.basename(filePath, '.md');
    reminders.push({
      id: String(frontmatter.id || path.basename(filePath, '.md')).trim(),
      project: String(frontmatter.project || 'inbox').trim(),
      status,
      importance: String(frontmatter.importance || '').trim(),
      reminderDate: String(frontmatter.reminder_date || '').trim(),
      reminderTime: String(frontmatter.reminder_time || '').trim(),
      reminderAt: String(frontmatter.reminder_at || '').trim(),
      relativePath: path.relative(vaultPath, filePath).replace(/\\/g, '/'),
      title,
      description: extractSection(content, 'O que lembrar'),
      context: extractSection(content, 'Contexto'),
    });
  }
  return reminders.sort((left, right) => {
    const leftKey = left.reminderAt || `${left.reminderDate}T${left.reminderTime || '99:99'}`;
    const rightKey = right.reminderAt || `${right.reminderDate}T${right.reminderTime || '99:99'}`;
    return leftKey.localeCompare(rightKey) || left.project.localeCompare(right.project);
  });
}

async function readState() {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? {
          daily: parsed.daily && typeof parsed.daily === 'object' ? parsed.daily : {},
          exact: parsed.exact && typeof parsed.exact === 'object' ? parsed.exact : {},
        }
      : { daily: {}, exact: {} };
  } catch {
    return { daily: {}, exact: {} };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function getSaoPauloNowParts() {
  const now = getNow();
  return {
    date: dateFormatter.format(now),
    time: timeFormatter.format(now),
  };
}

function buildDailyMessage(reminders, currentDate) {
  const lines = ['Lembretes ativos', `Data: ${currentDate}`, ''];
  for (const reminder of reminders) {
    lines.push(formatReminderEntry(reminder, { includeSchedule: true }), '');
  }
  return lines.join('\n').trim();
}

function buildExactMessage(reminders, currentDate, currentTime) {
  const lines = ['Lembrete do momento', `Agora: ${currentDate} ${currentTime}`, ''];
  for (const reminder of reminders) {
    lines.push(formatReminderEntry(reminder), '');
  }
  return lines.join('\n').trim();
}

async function main() {
  if (!['daily', 'exact'].includes(mode)) {
    usage();
    process.exit(1);
  }

  const { date, time } = getSaoPauloNowParts();
  const state = await readState();
  const reminders = await loadReminders();

  if (mode === 'daily') {
    if (state.daily[date]) {
      process.stdout.write(JSON.stringify({ ok: true, shouldSend: false, mode, reason: 'already_sent_today' }));
      return;
    }
    if (reminders.length === 0) {
      process.stdout.write(JSON.stringify({ ok: true, shouldSend: false, mode, reason: 'no_active_reminders' }));
      return;
    }
    state.daily[date] = new Date().toISOString();
    await writeState(state);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        shouldSend: true,
        mode,
        count: reminders.length,
        text: buildDailyMessage(reminders, date),
      }),
    );
    return;
  }

  const currentMinute = `${date}T${time}`;
  const due = reminders.filter((reminder) => {
    const scheduledMinute = String(reminder.reminderAt || '').slice(0, 16);
    if (!scheduledMinute || scheduledMinute > currentMinute) {
      return false;
    }
    const stateKey = `${reminder.id}:${reminder.reminderAt}`;
    return !state.exact[stateKey];
  });

  if (due.length === 0) {
    process.stdout.write(JSON.stringify({ ok: true, shouldSend: false, mode, reason: 'no_due_reminders' }));
    return;
  }

  for (const reminder of due) {
    state.exact[`${reminder.id}:${reminder.reminderAt}`] = new Date().toISOString();
  }
  await writeState(state);
  process.stdout.write(
    JSON.stringify({
      ok: true,
      shouldSend: true,
      mode,
      count: due.length,
      text: buildExactMessage(due, date, time),
    }),
  );
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      shouldSend: false,
      mode,
      message: String(error?.message || error || 'unknown_error'),
    }),
  );
  process.exit(1);
});
