import { Injectable } from '@nestjs/common';

import { readEnvironment } from '../../adapters/environment.js';
import { buildGithubReviewEvent } from '../github-review.js';
import { ingestEntry } from '../ingest-entry.js';
import { runOnboarding } from '../onboarding.js';
import { queryKnowledgeBase } from '../query-knowledge.js';
import { buildReminderDispatch, markRemindersAsSent } from '../reminders.js';
import { processConversation } from '../whatsapp-conversation.js';
import { buildTelegramCodeReviewMessage } from '../../domain/notifications.js';
import { ProjectRepository, VaultNoteRepository, WorkspaceRepository } from '../ports/repositories.js';

@Injectable()
export class BuildDashboardUseCase {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly workspaceRepository: WorkspaceRepository,
    private readonly vaultNoteRepository: VaultNoteRepository,
  ) {}

  async execute() {
    const [workspaces, projects, notes, reviews, reminders] = await Promise.all([
      this.workspaceRepository.list(),
      this.projectRepository.list(),
      this.vaultNoteRepository.list(),
      this.vaultNoteRepository.listReviews(),
      this.vaultNoteRepository.listReminders(),
    ]);
    return { workspaces, projects, notes, reviews, reminders };
  }
}

@Injectable()
export class GetNoteDetailUseCase {
  constructor(private readonly vaultNoteRepository: VaultNoteRepository) {}

  async execute(id: string) {
    return this.vaultNoteRepository.getById(id);
  }
}

@Injectable()
export class QueryKnowledgeUseCase {
  async execute(input: unknown) {
    return queryKnowledgeBase(input, readEnvironment());
  }
}

@Injectable()
export class IngestEntryUseCase {
  async execute(input: unknown) {
    return ingestEntry(input, readEnvironment());
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
  async execute(input: unknown) {
    const environment = readEnvironment();
    const payload = await buildGithubReviewEvent(input, environment);
    const ingestResult = await ingestEntry(payload, environment);
    return {
      ok: true,
      payload,
      ingestResult,
      telegramMessage: buildTelegramCodeReviewMessage(payload),
    };
  }
}
