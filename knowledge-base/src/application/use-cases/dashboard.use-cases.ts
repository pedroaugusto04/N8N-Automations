import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { readEnvironment } from '../../adapters/environment.js';
import { verifyGithubSignature } from '../../adapters/github.js';
import { ingestPayloadSchema, withDerivedReminderAt, type IngestPayload } from '../../contracts/ingest.js';
import { queryInputSchema } from '../../contracts/query.js';
import { buildGithubReviewEvent } from '../github-review.js';
import { ContentQueryRepository, ContentRepository, ExternalIdentityRepository, WebhookEventRepository } from '../ports/repositories.js';
import { runOnboarding } from '../onboarding.js';
import { buildReminderDispatch, markRemindersAsSent } from '../reminders.js';
import { processConversation } from '../whatsapp-conversation.js';
import { buildTelegramCodeReviewMessage } from '../../domain/notifications.js';
import { buildNotePaths, renderEventNote } from '../../domain/notes.js';
import type { Project } from '../../domain/projects.js';
import { slugify, trimText } from '../../domain/strings.js';
import type { DashboardHomeSummary, HomePriority } from '../models/dashboard-home.models.js';
import type { ReminderView } from '../models/reminder.models.js';
import type { ReviewView } from '../models/review.models.js';
import type { VaultNoteSummary } from '../models/vault-note.models.js';

const HOME_WINDOW_DAYS = 7;
const OPEN_STATUSES = new Set(['open', 'active', 'pending', 'todo']);
const INTERESTING_TYPES = ['incident', 'decision', 'followup', 'reminder', 'event'];

function normalizeDateInput(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(trimmed)) return trimmed.replace(' ', 'T');
  return trimmed;
}

function parseTimestamp(value: string): number {
  const normalized = normalizeDateInput(value);
  if (!normalized) return 0;
  const timestamp = Date.parse(normalized);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function dateKey(value: string) {
  const direct = String(value || '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (direct) return direct;
  const timestamp = parseTimestamp(value);
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

function formatDayLabel(key: string) {
  const [, month, day] = key.match(/\d{4}-(\d{2})-(\d{2})/) || [];
  return month && day ? `${day}/${month}` : key;
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isOpen(status: string) {
  return OPEN_STATUSES.has(String(status || '').toLowerCase());
}

function isHigh(severity: string) {
  return ['high', 'critical'].includes(String(severity || '').toLowerCase());
}

function projectLabel(projects: Project[], slug: string) {
  return projects.find((project) => project.projectSlug === slug)?.displayName || slug || 'Sem projeto';
}

function recentWindow(now: Date, windowDays: number) {
  const end = startOfDay(now.getTime()) + 86_399_999;
  const start = startOfDay(now.getTime() - (windowDays - 1) * 86_400_000);
  return { start, end };
}

function isWithinWindow(value: string, start: number, end: number) {
  const timestamp = parseTimestamp(value);
  return Boolean(timestamp && timestamp >= start && timestamp <= end);
}

function noteTarget(note: VaultNoteSummary) {
  return { kind: 'note' as const, id: note.id, path: note.path };
}

function findNoteByPath(notes: VaultNoteSummary[], path: string) {
  if (!path) return undefined;
  return notes.find((note) => note.path === path || note.path.endsWith(path));
}

function sortPriorities(left: HomePriority & { rank?: number; timestamp?: number }, right: HomePriority & { rank?: number; timestamp?: number }) {
  return (left.rank || 0) - (right.rank || 0) || (left.timestamp || 0) - (right.timestamp || 0) || left.title.localeCompare(right.title);
}

export function buildDashboardHome(
  projects: Project[],
  notes: VaultNoteSummary[],
  reviews: ReviewView[],
  reminders: ReminderView[],
  now = new Date(),
): DashboardHomeSummary {
  const { start, end } = recentWindow(now, HOME_WINDOW_DAYS);
  const todayStart = startOfDay(now.getTime());
  const recentNotes = notes.filter((note) => isWithinWindow(note.date, start, end));
  const openReminders = reminders.filter((reminder) => isOpen(reminder.status));
  const overdueReminders = openReminders.filter((reminder) => {
    const timestamp = parseTimestamp(reminder.reminderAt || `${reminder.reminderDate}T${reminder.reminderTime || '00:00'}`);
    return Boolean(timestamp && timestamp < todayStart);
  });
  const openHighFindings = reviews.flatMap((review) => review.findings.filter((finding) => isOpen(finding.status) && isHigh(finding.severity)).map((finding) => ({ review, finding })));
  const reviewsWithOpenFindings = reviews.filter((review) => review.findings.some((finding) => isOpen(finding.status)));
  const recentIncidentsAndFollowups = recentNotes.filter((note) => ['incident', 'followup'].includes(note.type) && isOpen(note.status));

  const dayKeys = Array.from({ length: HOME_WINDOW_DAYS }, (_, index) => {
    const date = new Date(start + index * 86_400_000);
    return date.toISOString().slice(0, 10);
  });
  const countByDay = new Map(dayKeys.map((key) => [key, 0]));
  for (const note of recentNotes) {
    const key = dateKey(note.date);
    if (countByDay.has(key)) countByDay.set(key, (countByDay.get(key) || 0) + 1);
  }

  const countByProject = new Map<string, number>();
  for (const note of recentNotes) {
    countByProject.set(note.project, (countByProject.get(note.project) || 0) + 1);
  }

  const priorityCandidates: Array<HomePriority & { rank: number; timestamp: number }> = [
    ...openReminders.map((reminder) => {
      const timestamp = parseTimestamp(reminder.reminderAt || `${reminder.reminderDate}T${reminder.reminderTime || '00:00'}`);
      const relatedNote = findNoteByPath(notes, reminder.sourceNotePath) || findNoteByPath(notes, reminder.relativePath);
      const overdue = Boolean(timestamp && timestamp < todayStart);
      return {
        id: `reminder:${reminder.id}`,
        type: 'reminder' as const,
        title: reminder.title,
        project: reminder.project,
        date: reminder.reminderAt || reminder.reminderDate,
        description: overdue ? 'Lembrete vencido' : 'Lembrete aberto',
        status: reminder.status,
        target: relatedNote ? noteTarget(relatedNote) : { kind: 'note' as const, path: reminder.sourceNotePath || reminder.relativePath },
        rank: overdue ? 0 : 1,
        timestamp: timestamp || Number.MAX_SAFE_INTEGER,
      };
    }),
    ...openHighFindings.map(({ review, finding }, index) => ({
      id: `finding:${review.id}:${index}`,
      type: 'finding' as const,
      title: review.title,
      project: review.project,
      date: review.date,
      description: finding.file ? `${finding.summary} (${finding.file})` : finding.summary,
      severity: finding.severity,
      status: finding.status,
      target: { kind: 'review' as const, id: review.id, path: review.generatedNotePath },
      rank: 2,
      timestamp: parseTimestamp(review.date) || Number.MAX_SAFE_INTEGER,
    })),
    ...recentIncidentsAndFollowups.map((note) => ({
      id: `note:${note.id}`,
      type: note.type === 'incident' ? ('incident' as const) : ('followup' as const),
      title: note.title,
      project: note.project,
      date: note.date,
      description: note.summary,
      status: note.status,
      target: noteTarget(note),
      rank: note.type === 'incident' ? 3 : 4,
      timestamp: parseTimestamp(note.date) || Number.MAX_SAFE_INTEGER,
    })),
  ];

  const recentInterestingEvents = recentNotes
    .filter((note) => INTERESTING_TYPES.includes(note.type) && isOpen(note.status))
    .sort((left, right) => {
      const typePriority = INTERESTING_TYPES.indexOf(left.type) - INTERESTING_TYPES.indexOf(right.type);
      return typePriority || (parseTimestamp(right.date) || 0) - (parseTimestamp(left.date) || 0) || left.title.localeCompare(right.title);
    })
    .slice(0, 5)
    .map((note) => ({
      id: note.id,
      type: note.type,
      title: note.title,
      project: note.project,
      date: note.date,
      summary: note.summary,
      status: note.status,
      target: noteTarget(note),
    }));

  return {
    windowDays: HOME_WINDOW_DAYS,
    metrics: [
      { id: 'recent-notes', label: 'Mudancas recentes', value: recentNotes.length, meta: `notas em ${HOME_WINDOW_DAYS} dias`, tone: 'active' },
      { id: 'active-projects', label: 'Projetos ativos', value: countByProject.size, meta: 'com movimento recente', tone: 'active' },
      { id: 'open-reminders', label: 'Lembretes abertos', value: openReminders.length, meta: `${overdueReminders.length} vencidos`, tone: overdueReminders.length ? 'high' : 'active' },
      {
        id: 'open-findings',
        label: 'Findings abertos',
        value: openHighFindings.length,
        meta: `${reviewsWithOpenFindings.length} reviews com pendencias`,
        tone: openHighFindings.length ? 'high' : 'active',
      },
    ],
    activityByDay: dayKeys.map((key) => ({ date: key, label: formatDayLabel(key), count: countByDay.get(key) || 0 })),
    activityByProject: Array.from(countByProject.entries())
      .map(([project, count]) => ({ project, label: projectLabel(projects, project), count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, 5),
    priorities: priorityCandidates.sort(sortPriorities).slice(0, 5).map(({ rank: _rank, timestamp: _timestamp, ...priority }) => priority),
    recentInterestingEvents,
  };
}

@Injectable()
export class BuildDashboardUseCase {
  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentQueryRepository: ContentQueryRepository,
  ) {}

  async execute(userId: string) {
    const [workspaces, projects, notes, reviews, reminders] = await Promise.all([
      this.contentRepository.listWorkspaces(userId),
      this.contentRepository.listProjects(userId),
      this.contentQueryRepository.list(userId),
      this.contentQueryRepository.listReviews(userId),
      this.contentQueryRepository.listReminders(userId),
    ]);
    return { workspaces, projects, notes, reviews, reminders, home: buildDashboardHome(projects, notes, reviews, reminders) };
  }
}

@Injectable()
export class GetNoteDetailUseCase {
  constructor(private readonly contentQueryRepository: ContentQueryRepository) {}

  async execute(userId: string, id: string) {
    return this.contentQueryRepository.getById(userId, id);
  }
}

@Injectable()
export class QueryKnowledgeUseCase {
  constructor(private readonly contentQueryRepository: ContentQueryRepository) {}

  async execute(input: unknown, userId: string) {
    const parsed = queryInputSchema.parse({
      ...(typeof input === 'object' && input ? input : {}),
      limit: Number((input as { limit?: unknown })?.limit || 5),
    });
    const tokens = parsed.query
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    const notes = await this.contentQueryRepository.list(userId);
    const matches = notes
      .filter((note) => (!parsed.projectSlug || note.project === parsed.projectSlug) && (!parsed.workspaceSlug || note.workspace === parsed.workspaceSlug))
      .map((note) => {
        const haystack = [note.title, note.path, note.summary, note.tags.join(' ')].join('\n').toLowerCase();
        const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 5 : 0), 0);
        return {
          path: note.path,
          title: note.title,
          projectSlug: note.project,
          score,
          snippet: note.summary || note.title,
        };
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
      .slice(0, parsed.limit);
    return {
      ok: true,
      mode: parsed.mode,
      query: parsed.query,
      matches,
      answer: matches.length
        ? {
            answer: `Encontrei ${matches.length} nota(s) relevante(s) para "${parsed.query}".`,
            bullets: matches.map((match) => `${match.title}: ${match.snippet}`),
            citedPaths: matches.map((match) => match.path),
          }
        : { answer: `Nao encontrei notas relevantes para: ${parsed.query}`, bullets: [], citedPaths: [] },
    };
  }
}

@Injectable()
export class IngestEntryUseCase {
  constructor(private readonly contentRepository: ContentRepository) {}

  async execute(input: unknown, userId: string, workspaceSlug = '') {
    return saveIngestedNote(this.contentRepository, userId, input, workspaceSlug);
  }
}

@Injectable()
export class RunOnboardingUseCase {
  async execute(input: unknown) {
    return runOnboarding(input, readEnvironment());
  }
}

@Injectable()
export class ProcessConversationUseCase {
  async execute(input: unknown) {
    return processConversation(input, readEnvironment());
  }
}

@Injectable()
export class BuildReminderDispatchUseCase {
  async execute(mode: 'daily' | 'exact') {
    return buildReminderDispatch(mode, readEnvironment());
  }
}

@Injectable()
export class MarkReminderAsSentUseCase {
  async execute(ids: string[]) {
    return markRemindersAsSent(ids, readEnvironment());
  }
}

@Injectable()
export class HandleGithubPushUseCase {
  constructor(
    private readonly ingestEntryUseCase: IngestEntryUseCase,
    private readonly externalIdentities: ExternalIdentityRepository,
    private readonly webhookEvents: WebhookEventRepository = externalIdentities as unknown as WebhookEventRepository,
  ) {}

  async execute(input: unknown) {
    const environment = readEnvironment();
    const request = input as { headers?: Record<string, string | string[] | undefined>; body?: Record<string, unknown>; rawBody?: string };
    const headers = normalizeHeaders(request.headers || {});
    const body = request.body || {};
    const installationId = String((body.installation as { id?: unknown } | undefined)?.id || '').trim();
    const externalIdentity = { provider: 'github-app', identityType: 'installation_id', externalId: installationId };
    if (!environment.githubWebhookSecret) {
      await this.webhookEvents.recordWebhookEvent({
        provider: 'github-app',
        eventType: String(headers['x-github-event'] || 'push'),
        status: 'rejected',
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
        error: 'github_webhook_secret_not_configured',
      });
      throw new UnauthorizedException('github_webhook_secret_not_configured');
    }
    try {
      verifyGithubSignature(environment.githubWebhookSecret, String(request.rawBody || ''), String(headers['x-hub-signature-256'] || ''));
    } catch (error) {
      await this.webhookEvents.recordWebhookEvent({
        provider: 'github-app',
        eventType: String(headers['x-github-event'] || 'push'),
        status: 'rejected',
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new UnauthorizedException('invalid_github_signature');
    }
    if (!installationId) {
      await this.webhookEvents.recordWebhookEvent({
        provider: 'github-app',
        eventType: String(headers['x-github-event'] || 'push'),
        status: 'rejected',
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
        error: 'missing_installation_id',
      });
      throw new UnauthorizedException('missing_installation_id');
    }
    const identity = await this.externalIdentities.findExternalIdentity('github-app', 'installation_id', installationId);
    if (!identity) {
      await this.webhookEvents.recordWebhookEvent({
        provider: 'github-app',
        eventType: String(headers['x-github-event'] || 'push'),
        status: 'rejected',
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
        error: 'identity_not_found',
      });
      throw new NotFoundException('identity_not_found');
    }
    await this.webhookEvents.recordWebhookEvent({
      provider: 'github-app',
      eventType: String(headers['x-github-event'] || 'push'),
      status: 'resolved',
      resolvedUserId: identity.userId,
      externalIdentity,
      rawHeaders: headers,
      rawPayload: body,
    });
    try {
      const payload = await buildGithubReviewEvent(input, environment);
      const ingestResult = await this.ingestEntryUseCase.execute(payload, identity.userId, identity.workspaceSlug);
      await this.webhookEvents.recordWebhookEvent({
        provider: 'github-app',
        eventType: String(headers['x-github-event'] || 'push'),
        status: 'processed',
        resolvedUserId: identity.userId,
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
      });
      return {
        ok: true,
        payload,
        ingestResult,
        telegramMessage: buildTelegramCodeReviewMessage(payload),
      };
    } catch (error) {
      await this.webhookEvents.recordWebhookEvent({
        provider: 'github-app',
        eventType: String(headers['x-github-event'] || 'push'),
        status: 'failed',
        resolvedUserId: identity.userId,
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

@Injectable()
export class HandleWhatsappWebhookUseCase {
  constructor(
    private readonly ingestEntryUseCase: IngestEntryUseCase,
    private readonly externalIdentities: ExternalIdentityRepository,
    private readonly webhookEvents: WebhookEventRepository = externalIdentities as unknown as WebhookEventRepository,
  ) {}

  async execute(input: unknown) {
    const environment = readEnvironment();
    const request = input as { headers?: Record<string, string | string[] | undefined>; body?: Record<string, unknown> };
    const headers = normalizeHeaders(request.headers || {});
    const body = request.body || {};
    const token = String(headers.authorization || '').startsWith('Bearer ')
      ? String(headers.authorization).slice('Bearer '.length)
      : String(headers['x-kb-webhook-token'] || '');
    const externalId = extractWhatsappExternalId(body);
    const externalIdentity = { provider: 'whatsapp', identityType: 'jid', externalId };
    if (!environment.webhookSecret || token !== environment.webhookSecret) {
      await this.webhookEvents.recordWebhookEvent({
        provider: 'whatsapp',
        eventType: 'message',
        status: 'rejected',
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
        error: 'invalid_webhook_token',
      });
      throw new UnauthorizedException('invalid_webhook_token');
    }
    if (!externalId) {
      await this.webhookEvents.recordWebhookEvent({
        provider: 'whatsapp',
        eventType: 'message',
        status: 'rejected',
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
        error: 'missing_external_identity',
      });
      throw new UnauthorizedException('missing_external_identity');
    }
    const identity = await this.externalIdentities.findExternalIdentity('whatsapp', 'jid', externalId);
    if (!identity) {
      await this.webhookEvents.recordWebhookEvent({
        provider: 'whatsapp',
        eventType: 'message',
        status: 'rejected',
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
        error: 'identity_not_found',
      });
      throw new NotFoundException('identity_not_found');
    }
    await this.webhookEvents.recordWebhookEvent({
      provider: 'whatsapp',
      eventType: 'message',
      status: 'resolved',
      resolvedUserId: identity.userId,
      externalIdentity,
      rawHeaders: headers,
      rawPayload: body,
    });
    try {
      if (Number(body.schemaVersion) !== 1) {
        await this.webhookEvents.recordWebhookEvent({
          provider: 'whatsapp',
          eventType: 'message',
          status: 'processed',
          resolvedUserId: identity.userId,
          externalIdentity,
          rawHeaders: headers,
          rawPayload: body,
        });
        return { ok: true, resolvedUserId: identity.userId, processed: false };
      }
      const ingestResult = await this.ingestEntryUseCase.execute(body, identity.userId, identity.workspaceSlug);
      await this.webhookEvents.recordWebhookEvent({
        provider: 'whatsapp',
        eventType: 'message',
        status: 'processed',
        resolvedUserId: identity.userId,
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
      });
      return { ok: true, ingestResult };
    } catch (error) {
      await this.webhookEvents.recordWebhookEvent({
        provider: 'whatsapp',
        eventType: 'message',
        status: 'failed',
        resolvedUserId: identity.userId,
        externalIdentity,
        rawHeaders: headers,
        rawPayload: body,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

function normalizeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(',') : String(value || '')]));
}

function extractWhatsappExternalId(body: Record<string, unknown>): string {
  const data = body.data as Record<string, unknown> | undefined;
  const key = data?.key as Record<string, unknown> | undefined;
  return String(
    body.jid ||
      body.remoteJid ||
      body.chatId ||
      body.from ||
      key?.remoteJid ||
      data?.remoteJid ||
      data?.chatId ||
      '',
  ).trim();
}

function projectFromPayload(payload: IngestPayload, workspaceSlug: string): Project {
  const projectSlug = slugify(payload.event.projectSlug) || 'inbox';
  return {
    projectSlug,
    displayName: projectSlug === 'inbox' ? 'Inbox' : projectSlug,
    repoFullName: String(payload.metadata.repoFullName || ''),
    workspaceSlug,
    aliases: [],
    defaultTags: [],
    enabled: true,
  };
}

async function saveIngestedNote(contentRepository: ContentRepository, userId: string, input: unknown, workspaceSlugOverride = '') {
  const parsed = withDerivedReminderAt(ingestPayloadSchema.parse(input));
  const payload = {
    ...parsed,
    classification: {
      ...parsed.classification,
      status: parsed.classification.status || 'active',
      tags: Array.from(new Set([parsed.event.projectSlug, ...parsed.classification.tags].map((tag) => slugify(tag)).filter(Boolean))),
    },
  };
  const workspaceSlug = slugify(workspaceSlugOverride || String(payload.metadata.workspaceSlug || 'default')) || 'default';
  const project = projectFromPayload(payload, workspaceSlug);
  const paths = buildNotePaths(project, payload);
  const markdown = renderEventNote(project, payload, paths);
  const title = trimText(payload.content.title, payload.content.rawText);
  await contentRepository.upsertWorkspace(userId, {
    workspaceSlug,
    displayName: workspaceSlug,
    whatsappGroupJid: '',
    telegramChatId: '',
    githubRepos: project.repoFullName ? [project.repoFullName] : [],
    projectSlugs: [project.projectSlug],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await contentRepository.upsertProject(userId, project);
  const note = await contentRepository.upsertNote(userId, {
    path: paths.eventRelativePath.replace(/\\/g, '/'),
    type: 'event',
    title,
    projectSlug: project.projectSlug,
    workspaceSlug,
    status: payload.classification.status || 'active',
    tags: payload.classification.tags,
    occurredAt: payload.event.occurredAt,
    sourceChannel: payload.source.channel,
    summary: payload.content.sections.summary || payload.content.rawText,
    markdown,
    frontmatter: {
      id: payload.source.correlationId,
      type: 'event',
      workspace: workspaceSlug,
      source_channel: payload.source.channel,
      event_type: payload.event.type,
      project: project.projectSlug,
      status: payload.classification.status,
      tags: payload.classification.tags,
      occurred_at: payload.event.occurredAt,
    },
    metadata: {
      ...payload.metadata,
      eventType: payload.event.type,
      impact: payload.content.sections.impact,
      reviewFindings: payload.content.sections.reviewFindings,
      reminderDate: payload.actions.reminderDate,
      reminderTime: payload.actions.reminderTime,
      reminderAt: payload.actions.reminderAt,
    },
    origin: 'postgres',
    source: payload.source.system,
    links: [paths.canonicalRelativePath, paths.followupRelativePath, paths.reminderRelativePath].filter(Boolean),
  });
  return {
    ok: true,
    project: project.projectSlug,
    noteId: note.id,
    eventPath: note.path,
    canonicalPath: paths.canonicalRelativePath.replace(/\\/g, '/'),
    followupPath: paths.followupRelativePath.replace(/\\/g, '/'),
    reminderPath: paths.reminderRelativePath.replace(/\\/g, '/'),
    dailyPath: paths.dailyRelativePath.replace(/\\/g, '/'),
    assetPaths: [],
    gitStatus: 'not_used_postgres',
  };
}
