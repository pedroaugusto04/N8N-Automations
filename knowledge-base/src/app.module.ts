import { Module } from '@nestjs/common';

import {
  BuildDashboardUseCase,
  BuildReminderDispatchUseCase,
  GetNoteDetailUseCase,
  HandleGithubPushUseCase,
  IngestEntryUseCase,
  MarkReminderAsSentUseCase,
  ProcessConversationUseCase,
  QueryKnowledgeUseCase,
  RunOnboardingUseCase,
} from './application/use-cases/dashboard.use-cases.js';
import { ProjectRepository, VaultNoteRepository, WorkspaceRepository } from './application/ports/repositories.js';
import { FilesystemProjectRepository, FilesystemWorkspaceRepository } from './infrastructure/repositories/filesystem-project.repository.js';
import { FilesystemVaultNoteRepository } from './infrastructure/repositories/filesystem-vault-note.repository.js';
import { DashboardController, HealthController, OperationsController, WebhookController } from './interfaces/http/controllers/knowledge.controllers.js';

@Module({
  controllers: [HealthController, DashboardController, OperationsController, WebhookController],
  providers: [
    BuildDashboardUseCase,
    GetNoteDetailUseCase,
    QueryKnowledgeUseCase,
    IngestEntryUseCase,
    RunOnboardingUseCase,
    ProcessConversationUseCase,
    BuildReminderDispatchUseCase,
    MarkReminderAsSentUseCase,
    HandleGithubPushUseCase,
    { provide: ProjectRepository, useClass: FilesystemProjectRepository },
    { provide: WorkspaceRepository, useClass: FilesystemWorkspaceRepository },
    { provide: VaultNoteRepository, useClass: FilesystemVaultNoteRepository },
  ],
})
export class AppModule {}
