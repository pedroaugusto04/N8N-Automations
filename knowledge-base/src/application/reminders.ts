import fs from 'node:fs/promises';
import path from 'node:path';

import type { RuntimeEnvironment } from '../adapters/environment.js';
import { parseFrontmatter } from '../domain/frontmatter.js';
import { vaultFolders } from '../domain/notes.js';
import { currentSaoPauloDateTime } from '../domain/time.js';

type ReminderEntry = {
  id: string;
  project: string;
  filePath: string;
  relativePath: string;
  status: string;
  reminderDate: string;
  reminderTime: string;
  reminderAt: string;
  title: string;
};

type ReminderState = {
  daily: Record<string, true>;
  exact: Record<string, true>;
};

async function walkMarkdown(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkMarkdown(resolved)));
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'Reminders.md') {
      files.push(resolved);
    }
  }
  return files;
}

async function readReminderState(environment: RuntimeEnvironment): Promise<ReminderState> {
  const filePath = path.join(environment.archivePath, 'reminders-state.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as ReminderState;
    return {
      daily: parsed.daily || {},
      exact: parsed.exact || {},
    };
  } catch {
    return { daily: {}, exact: {} };
  }
}

async function writeReminderState(environment: RuntimeEnvironment, state: ReminderState): Promise<void> {
  await fs.mkdir(environment.archivePath, { recursive: true });
  await fs.writeFile(path.join(environment.archivePath, 'reminders-state.json'), JSON.stringify(state, null, 2), 'utf8');
}

async function loadReminders(environment: RuntimeEnvironment): Promise<ReminderEntry[]> {
  const root = path.join(environment.vaultPath, vaultFolders.reminders);
  const files = await walkMarkdown(root);
  const reminders: ReminderEntry[] = [];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf8');
    const frontmatter = parseFrontmatter(content);
    if (String(frontmatter.type || '') !== 'reminder') continue;
    const status = String(frontmatter.status || '');
    if (!['open', 'active'].includes(status)) continue;
    const heading = content.match(/^#\s+(.+)$/m)?.[1] || path.basename(filePath, '.md');
    reminders.push({
      id: String(frontmatter.id || path.basename(filePath, '.md')),
      project: String(frontmatter.project || 'inbox'),
      filePath,
      relativePath: path.relative(environment.vaultPath, filePath).replace(/\\/g, '/'),
      status,
      reminderDate: String(frontmatter.reminder_date || ''),
      reminderTime: String(frontmatter.reminder_time || ''),
      reminderAt: String(frontmatter.reminder_at || ''),
      title: heading,
    });
  }
  return reminders.sort((left, right) => `${left.reminderDate} ${left.reminderTime}`.localeCompare(`${right.reminderDate} ${right.reminderTime}`));
}

export async function buildReminderDispatch(mode: 'daily' | 'exact', environment: RuntimeEnvironment) {
  const reminders = await loadReminders(environment);
  const state = await readReminderState(environment);
  const now = currentSaoPauloDateTime();

  if (mode === 'daily') {
    if (state.daily[now.date]) {
      return { ok: true, shouldSend: false, message: 'daily_already_sent_today' };
    }
    state.daily = { [now.date]: true };
    await writeReminderState(environment, state);
    if (!reminders.length) {
      return { ok: true, shouldSend: false, message: 'no_active_reminders' };
    }
    const text = ['Lembretes ativos', `Data: ${now.date}`, '', ...reminders.map((item) => `- [${item.project}] ${item.title} (${item.reminderDate}${item.reminderTime ? ` ${item.reminderTime}` : ''})`)].join('\n');
    return { ok: true, shouldSend: true, text, remindersArg: '' };
  }

  const due = reminders.filter((item) => item.reminderDate === now.date && item.reminderTime === now.time);
  const pending = due.filter((item) => !state.exact[item.id]);
  if (!pending.length) {
    return { ok: true, shouldSend: false, message: 'no_due_reminders' };
  }
  const remindersArg = pending.map((item) => item.id).join(',');
  const text = ['Lembrete do momento', `Agora: ${now.date} ${now.time}`, '', ...pending.map((item) => `- [${item.project}] ${item.title}`)].join('\n');
  return { ok: true, shouldSend: true, text, remindersArg };
}

export async function markRemindersAsSent(ids: string[], environment: RuntimeEnvironment) {
  const state = await readReminderState(environment);
  for (const id of ids) {
    if (id) state.exact[id] = true;
  }
  await writeReminderState(environment, state);
  return { ok: true, marked: ids.filter(Boolean).length };
}
