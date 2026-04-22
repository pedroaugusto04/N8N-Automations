import { z } from 'zod';

export const manualKinds = ['manual_note', 'bug', 'resume', 'article', 'daily'] as const;
export const noteTypes = ['event', 'knowledge', 'decision', 'incident', 'followup', 'project_summary'] as const;
export const importanceLevels = ['low', 'medium', 'high'] as const;
export const statusValues = ['open', 'active', 'resolved', 'archived'] as const;

export type ManualKind = (typeof manualKinds)[number];
export type NoteType = (typeof noteTypes)[number];
export type ImportanceLevel = (typeof importanceLevels)[number];
export type StatusValue = (typeof statusValues)[number];

export type PresetKey = 'manual' | 'bug' | 'resume' | 'decision' | 'reminder';

export type PresetDefinition = {
  label: string;
  description: string;
  kind: ManualKind;
  noteType: '' | NoteType;
  importance: '' | ImportanceLevel;
  status: '' | StatusValue;
  decisionFlag: boolean;
};

export const presetDefinitions: Record<PresetKey, PresetDefinition> = {
  manual: {
    label: 'Nota manual',
    description: 'Mantem a anotacao livre e sem derivacoes forcadas.',
    kind: 'manual_note',
    noteType: '',
    importance: '',
    status: '',
    decisionFlag: false,
  },
  bug: {
    label: 'Bug',
    description: 'Abre incidente com prioridade alta e status aberto.',
    kind: 'bug',
    noteType: 'incident',
    importance: 'high',
    status: 'open',
    decisionFlag: false,
  },
  resume: {
    label: 'Resumo',
    description: 'Gera conhecimento consolidado para recap e contexto.',
    kind: 'resume',
    noteType: 'knowledge',
    importance: 'medium',
    status: 'active',
    decisionFlag: false,
  },
  decision: {
    label: 'Decisao',
    description: 'Marca a nota como decisao sem esconder os campos avancados.',
    kind: 'manual_note',
    noteType: 'decision',
    importance: 'high',
    status: 'active',
    decisionFlag: true,
  },
  reminder: {
    label: 'Lembrete',
    description: 'Foca em prazo e agenda sem trocar o backend atual.',
    kind: 'manual_note',
    noteType: '',
    importance: 'medium',
    status: 'open',
    decisionFlag: false,
  },
};

export function slugify(value: string): string {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

export function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCsvList(value: string, { slugifyItems = false }: { slugifyItems?: boolean } = {}): string[] {
  const list = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (slugifyItems ? slugify(entry) : entry));
  return [...new Set(list.filter(Boolean))];
}

export function inferKindAndImportance(text: string): { kind: ManualKind; importance: ImportanceLevel } {
  const value = String(text || '').toLowerCase();
  if (/(erro|bug|falha|exception|stacktrace|quebrou|incidente)/.test(value)) {
    return { kind: 'bug', importance: 'high' };
  }
  if (/(resumo|summary|sumario|sintese|recap)/.test(value)) {
    return { kind: 'resume', importance: 'medium' };
  }
  if (/(artigo|article|tutorial|guia|documentacao|doc)/.test(value)) {
    return { kind: 'article', importance: 'medium' };
  }
  if (/(hoje|daily|diario|standup)/.test(value)) {
    return { kind: 'daily', importance: 'medium' };
  }
  return { kind: 'manual_note', importance: 'low' };
}

export function buildReminderAt(reminderDate: string, reminderTime: string): string {
  if (!reminderDate || !reminderTime) {
    return '';
  }
  return `${reminderDate}T${reminderTime}:00-03:00`;
}

export function resolveCanonicalHint(kind: string, noteType: string, decisionFlag: boolean): string {
  if (noteType === 'knowledge' || noteType === 'decision' || noteType === 'incident') {
    return noteType;
  }
  if (decisionFlag) {
    return 'decision';
  }
  if (kind === 'bug') {
    return 'incident';
  }
  if (kind === 'resume' || kind === 'article') {
    return 'knowledge';
  }
  return 'event';
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

const emptyableEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.union([z.enum(values), z.literal('')]);

export const kbPayloadSchema = z
  .object({
    raw_text: z.string().min(1, 'Texto obrigatorio.'),
    project_slug: z.string().min(1, 'Projeto obrigatorio.'),
    kind: z.enum(manualKinds),
    note_type: emptyableEnum(noteTypes),
    importance: emptyableEnum(importanceLevels),
    status: emptyableEnum(statusValues),
    follow_up_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Prazo invalido.').or(z.literal('')),
    reminder_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida.').or(z.literal('')),
    reminder_time: z.string().regex(/^\d{2}:\d{2}$/, 'Horario invalido.').or(z.literal('')),
    decision_flag: z.boolean(),
    tags: z.array(z.string()),
    related_projects: z.array(z.string()),
  })
  .superRefine((value, ctx) => {
    if (value.reminder_time && !value.reminder_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reminder_time'],
        message: 'Horario exige data de lembrete.',
      });
    }
  });
