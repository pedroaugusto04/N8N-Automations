import fs from 'node:fs/promises';
import path from 'node:path';

import { extractConversationFields } from '../adapters/ai.js';
import type { RuntimeEnvironment } from '../adapters/environment.js';
import { ingestPayloadSchema, type IngestPayload } from '../contracts/ingest.js';
import { conversationInputSchema, conversationStateSchema, type ConversationInput, type ConversationState } from '../contracts/conversation.js';
import { defaultImportance } from '../domain/classification.js';
import { findProject, loadProjects } from '../domain/projects.js';
import { slugify } from '../domain/strings.js';
import { buildReminderAt, normalizeDate, normalizeTime, nowIso } from '../domain/time.js';
import { queryKnowledgeBase } from './query-knowledge.js';

const emptyState: ConversationState = {
  phase: 'idle',
  rawText: '',
  projectSlug: '',
  kind: 'note',
  canonicalType: 'event',
  importance: 'low',
  tags: [],
  reminderDate: '',
  reminderTime: '',
  media: {
    fileName: '',
    mimeType: 'application/octet-stream',
    sizeBytes: 0,
    dataBase64: '',
  },
  updatedAt: '',
};

function stateFilePath(archivePath: string): string {
  return path.join(archivePath, 'whatsapp-state.json');
}

async function loadStates(environment: RuntimeEnvironment): Promise<Record<string, ConversationState>> {
  try {
    const raw = await fs.readFile(stateFilePath(environment.archivePath), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, ConversationState> = {};
    for (const [key, value] of Object.entries(parsed)) {
      result[key] = conversationStateSchema.parse(value);
    }
    return result;
  } catch {
    return {};
  }
}

async function saveStates(environment: RuntimeEnvironment, states: Record<string, ConversationState>): Promise<void> {
  await fs.mkdir(environment.archivePath, { recursive: true });
  await fs.writeFile(stateFilePath(environment.archivePath), JSON.stringify(states, null, 2), 'utf8');
}

function conversationKey(input: ConversationInput): string {
  return `${input.groupId}:${input.senderId}`;
}

function isExpired(state: ConversationState, timeoutMs: number): boolean {
  if (!state.updatedAt || state.phase === 'idle') return false;
  return Date.now() - new Date(state.updatedAt).getTime() > timeoutMs;
}

function isCancel(text: string): boolean {
  return ['cancelar', 'cancel', 'cancela', 'sair', '0'].includes(text.toLowerCase().trim());
}

function isConfirm(text: string): boolean {
  return ['sim', 's', 'confirmar', '1', 'ok', 'enviar'].includes(text.toLowerCase().trim());
}

function isSkip(text: string): boolean {
  return ['pular', 'skip', 'nao', 'não', 'n', '9', 'sem'].includes(text.toLowerCase().trim());
}

function parseKnowledgeCommand(text: string): { type: 'query'; query: string } | null {
  const normalized = String(text || '').trim();
  const commandMatch = normalized.match(/^\/(buscar|consultar|perguntar|ask)\s+(.+)$/i);
  if (!commandMatch) return null;
  const query = String(commandMatch[2] || '').trim();
  if (!query) return null;
  return { type: 'query', query };
}

function kindPrompt(): string {
  return [
    'Qual o tipo da nota?',
    '1. Nota geral',
    '2. Bug / incidente',
    '3. Resumo',
    '4. Artigo / documentacao',
    '5. Daily',
    '9. Pular',
    '0. Cancelar',
  ].join('\n');
}

function parseKind(text: string): ConversationState['kind'] | '' {
  const normalized = text.trim().toLowerCase();
  if (normalized === '1' || normalized === 'note' || normalized === 'nota') return 'note';
  if (normalized === '2' || normalized === 'bug') return 'bug';
  if (normalized === '3' || normalized === 'summary' || normalized === 'resumo') return 'summary';
  if (normalized === '4' || normalized === 'article' || normalized === 'artigo') return 'article';
  if (normalized === '5' || normalized === 'daily') return 'daily';
  return '';
}

function confirmationPrompt(state: ConversationState): string {
  return [
    'Resumo da nota:',
    `Texto: ${state.rawText}`,
    `Tipo: ${state.kind}`,
    `Projeto: ${state.projectSlug || 'inbox'}`,
    `Lembrete: ${state.reminderDate ? `${state.reminderDate}${state.reminderTime ? ` ${state.reminderTime}` : ''}` : 'sem lembrete'}`,
    state.tags.length ? `Tags: ${state.tags.join(', ')}` : '',
    '',
    '1. Confirmar',
    '9. Descartar',
    '0. Cancelar',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildSubmitPayload(input: ConversationInput, state: ConversationState): IngestPayload {
  const payload = {
    schemaVersion: 1,
    source: {
      channel: 'whatsapp' as const,
      system: 'evolution-api',
      actor: input.senderId,
      conversationId: input.groupId,
      correlationId: `wpp:${input.messageId || Date.now().toString()}`,
    },
    event: {
      type: 'manual_note' as const,
      occurredAt: nowIso(),
      projectSlug: state.projectSlug || 'inbox',
    },
    content: {
      rawText: state.rawText,
      title: '',
      attachments: state.media.fileName
        ? [
            {
              fileName: state.media.fileName,
              mimeType: state.media.mimeType,
              sizeBytes: state.media.sizeBytes,
              dataBase64: state.media.dataBase64,
            },
          ]
        : [],
      sections: {
        summary: state.rawText,
        impact: '',
        risks: [],
        nextSteps: [],
        reviewFindings: [],
      },
    },
    classification: {
      kind: state.kind,
      canonicalType: state.canonicalType,
      importance: state.importance,
      status: state.canonicalType === 'event' ? 'active' : 'open',
      tags: state.tags,
      decisionFlag: state.canonicalType === 'decision',
    },
    actions: {
      reminderDate: state.reminderDate,
      reminderTime: state.reminderTime,
      followUpBy: '',
    },
    metadata: {
      reminderAt: buildReminderAt(state.reminderDate, state.reminderTime),
    },
  };
  return ingestPayloadSchema.parse(payload);
}

function inferInteractiveCanonicalType(kind: ConversationState['kind']): ConversationState['canonicalType'] {
  if (kind === 'bug') return 'incident';
  if (kind === 'summary' || kind === 'article') return 'knowledge';
  return 'event';
}

export async function processConversation(rawInput: unknown, environment: RuntimeEnvironment) {
  const input = conversationInputSchema.parse(rawInput);
  if (environment.allowedGroupId && input.groupId !== environment.allowedGroupId) {
    return { action: 'ignore', replyText: '', payload: null };
  }

  const states = await loadStates(environment);
  const key = conversationKey(input);
  const current = states[key] && !isExpired(states[key], environment.conversationTimeoutMs) ? states[key] : { ...emptyState };
  const message = input.messageText.trim();
  const command = current.phase === 'idle' ? parseKnowledgeCommand(message) : null;

  if (isCancel(message)) {
    states[key] = { ...emptyState };
    await saveStates(environment, states);
    return { action: 'reply', replyText: 'Conversa cancelada. Envie uma nova nota quando quiser.', payload: null };
  }

  const projects = await loadProjects(environment.manifestPath);

  if (command?.type === 'query') {
    const result = await queryKnowledgeBase(
      {
        query: command.query,
        mode: 'answer',
      },
      environment,
    );
    const lines = [
      result.answer.answer,
      '',
      ...result.answer.bullets.slice(0, 4).map((item) => `- ${item}`),
      result.answer.citedPaths.length ? '' : '',
      ...result.answer.citedPaths.slice(0, 4).map((item) => `Fonte: ${item}`),
    ].filter(Boolean);
    return {
      action: 'reply',
      replyText: lines.join('\n'),
      payload: null,
    };
  }

  if (current.phase === 'idle') {
    const aiExtracted =
      input.agentResult?.extracted ||
      (await extractConversationFields(
        {
          provider: environment.conversationAiProvider,
          baseUrl: environment.conversationAiBaseUrl,
          model: environment.conversationAiModel,
          apiKey: environment.conversationAiApiKey,
        },
        {
          messageText: message,
          projectSlugs: projects.map((project) => project.projectSlug),
        },
      )) ||
      {};
    const extracted = aiExtracted;
    const nextState: ConversationState = {
      ...emptyState,
      rawText: extracted.rawText || message,
      projectSlug: extracted.projectSlug ? findProject(projects, extracted.projectSlug)?.projectSlug || slugify(extracted.projectSlug) : '',
      kind: extracted.kind || 'note',
      canonicalType: extracted.canonicalType || inferInteractiveCanonicalType(extracted.kind || 'note'),
      importance: extracted.importance || defaultImportance(extracted.kind || 'note'),
      tags: Array.isArray(extracted.tags) ? extracted.tags.map((item) => slugify(item)).filter(Boolean) : [],
      reminderDate: normalizeDate(extracted.reminderDate || ''),
      reminderTime: normalizeTime(extracted.reminderTime || ''),
      media: input.hasMedia ? input.media : emptyState.media,
      updatedAt: nowIso(),
      phase: 'awaiting_kind',
    };

    if (!nextState.rawText) {
      nextState.phase = 'awaiting_kind';
      states[key] = nextState;
      await saveStates(environment, states);
      return { action: 'reply', replyText: 'Nao consegui extrair o texto principal. Envie a nota novamente.', payload: null };
    }

    if ((input.agentResult?.confidence === 'high' || Boolean(aiExtracted && Object.keys(aiExtracted).length)) && nextState.projectSlug && extracted.kind) {
      nextState.phase = nextState.reminderDate ? 'awaiting_confirmation' : 'awaiting_reminder_date';
    }

    states[key] = nextState;
    await saveStates(environment, states);

    if (!extracted.kind) {
      return {
        action: 'reply',
        replyText: `Nova nota recebida:\n"${nextState.rawText}"\n\n${kindPrompt()}`,
        payload: null,
      };
    }
    if (!nextState.projectSlug) {
      return {
        action: 'reply',
        replyText: `Tipo detectado: ${nextState.kind}\n\nQual o projeto? Responda com o slug ou alias. Envie "inbox" para geral.`,
        payload: null,
      };
    }
    if (!nextState.reminderDate) {
      return {
        action: 'reply',
        replyText: 'Deseja agendar um lembrete? Envie a data (DD/MM/AAAA, hoje, amanhã) ou 9 para pular.',
        payload: null,
      };
    }
    return {
      action: 'reply',
      replyText: confirmationPrompt(nextState),
      payload: null,
    };
  }

  if (current.phase === 'awaiting_kind') {
    const kind = isSkip(message) ? current.kind : parseKind(message);
    if (!kind) {
      return { action: 'reply', replyText: `Nao entendi.\n\n${kindPrompt()}`, payload: null };
    }
    current.kind = kind;
    current.canonicalType = inferInteractiveCanonicalType(kind);
    current.importance = defaultImportance(kind);
    current.phase = 'awaiting_project';
    current.updatedAt = nowIso();
    states[key] = current;
    await saveStates(environment, states);
    return {
      action: 'reply',
      replyText: 'Qual o projeto? Responda com o slug ou alias. Envie "inbox" para geral.',
      payload: null,
    };
  }

  if (current.phase === 'awaiting_project') {
    const project = isSkip(message) && current.projectSlug ? current.projectSlug : message.toLowerCase().trim() === 'inbox' ? 'inbox' : findProject(projects, message)?.projectSlug || '';
    if (!project) {
      return { action: 'reply', replyText: 'Projeto invalido. Responda com o slug, alias ou "inbox".', payload: null };
    }
    current.projectSlug = project;
    current.phase = 'awaiting_reminder_date';
    current.updatedAt = nowIso();
    states[key] = current;
    await saveStates(environment, states);
    return {
      action: 'reply',
      replyText: 'Deseja agendar um lembrete? Envie a data (DD/MM/AAAA, hoje, amanhã) ou 9 para pular.',
      payload: null,
    };
  }

  if (current.phase === 'awaiting_reminder_date') {
    if (isSkip(message)) {
      current.reminderDate = '';
      current.reminderTime = '';
      current.phase = 'awaiting_confirmation';
      current.updatedAt = nowIso();
      states[key] = current;
      await saveStates(environment, states);
      return { action: 'reply', replyText: confirmationPrompt(current), payload: null };
    }
    const date = normalizeDate(message);
    if (!date) {
      return { action: 'reply', replyText: 'Data invalida. Use DD/MM/AAAA, YYYY-MM-DD, hoje ou amanhã.', payload: null };
    }
    current.reminderDate = date;
    current.phase = 'awaiting_reminder_time';
    current.updatedAt = nowIso();
    states[key] = current;
    await saveStates(environment, states);
    return { action: 'reply', replyText: `Data: ${date}. Envie o horario HH:mm ou 9 para lembrete sem horario exato.`, payload: null };
  }

  if (current.phase === 'awaiting_reminder_time') {
    if (isSkip(message)) {
      current.reminderTime = '';
      current.phase = 'awaiting_confirmation';
      current.updatedAt = nowIso();
      states[key] = current;
      await saveStates(environment, states);
      return { action: 'reply', replyText: confirmationPrompt(current), payload: null };
    }
    const time = normalizeTime(message);
    if (!time) {
      return { action: 'reply', replyText: 'Horario invalido. Use HH:mm.', payload: null };
    }
    current.reminderTime = time;
    current.phase = 'awaiting_confirmation';
    current.updatedAt = nowIso();
    states[key] = current;
    await saveStates(environment, states);
    return { action: 'reply', replyText: confirmationPrompt(current), payload: null };
  }

  if (current.phase === 'awaiting_confirmation') {
    if (isSkip(message)) {
      states[key] = { ...emptyState };
      await saveStates(environment, states);
      return { action: 'reply', replyText: 'Nota descartada.', payload: null };
    }
    if (!isConfirm(message)) {
      return { action: 'reply', replyText: confirmationPrompt(current), payload: null };
    }
    const payload = buildSubmitPayload(input, current);
    states[key] = { ...emptyState };
    await saveStates(environment, states);
    return { action: 'submit', replyText: 'Nota pronta para ingestao.', payload };
  }

  return { action: 'ignore', replyText: '', payload: null };
}
