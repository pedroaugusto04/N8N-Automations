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
import { BuildIntegrationsUseCase } from './application/integrations.js';
import { AuthService } from './application/auth.js';
import { IntegrationCredentialService } from './application/credentials.js';
import { KnowledgeStore } from './application/knowledge-store.js';
import { ProjectRepository, VaultNoteRepository, WorkspaceRepository } from './application/ports/repositories.js';
import { FilesystemProjectRepository, FilesystemWorkspaceRepository } from './infrastructure/repositories/filesystem-project.repository.js';
import { PostgresKnowledgeStore } from './infrastructure/repositories/postgres-knowledge.store.js';
import { FilesystemVaultNoteRepository } from './infrastructure/repositories/filesystem-vault-note.repository.js';
import { DashboardController, HealthController, OperationsController, WebhookController } from './interfaces/http/controllers/knowledge.controllers.js';
import { AuthController, InternalIntegrationsController, UserIntegrationsController } from './interfaces/http/controllers/auth.controllers.js';

@Module({
  controllers: [HealthController, DashboardController, AuthController, UserIntegrationsController, InternalIntegrationsController, OperationsController, WebhookController],
  providers: [
    AuthService,
    BuildDashboardUseCase,
    BuildIntegrationsUseCase,
    IntegrationCredentialService,
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
    { provide: KnowledgeStore, useClass: PostgresKnowledgeStore },
  ],
})
export class AppModule {}
