import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import {
  BuildDashboardUseCase,
  BuildReminderDispatchUseCase,
  GetNoteDetailUseCase,
  HandleGithubPushUseCase,
  HandleWhatsappWebhookUseCase,
  IngestEntryUseCase,
  MarkReminderAsSentUseCase,
  ProcessConversationUseCase,
  QueryKnowledgeUseCase,
  RunOnboardingUseCase,
} from './application/use-cases/dashboard.use-cases.js';
import { AuthService } from './application/auth.js';
import { IntegrationCredentialService } from './application/credentials.js';
import { KnowledgeStore } from './application/knowledge-store.js';
import {
  ContentQueryRepository,
  ContentRepository,
  CredentialRepository,
  ExternalIdentityRepository,
  SchemaMigrator,
  UserRepository,
  WebhookEventRepository,
} from './application/ports/repositories.js';
import { PostgresKnowledgeStore } from './infrastructure/repositories/postgres-knowledge.store.js';
import { PostgresContentQueryRepository } from './infrastructure/repositories/postgres-content.repository.js';
import { DashboardController, HealthController, OperationsController, WebhookController } from './interfaces/http/controllers/knowledge.controllers.js';
import { AuthController, InternalIntegrationsController, UserIntegrationsController } from './interfaces/http/controllers/auth.controllers.js';
import { AccessTokenAuthGuard, AuthRateLimitGuard, GlobalRateLimitGuard, InternalServiceTokenGuard, TrustedOriginGuard, WebhookRateLimitGuard } from './interfaces/http/auth.guards.js';

@Module({
  controllers: [HealthController, DashboardController, AuthController, UserIntegrationsController, InternalIntegrationsController, OperationsController, WebhookController],
  providers: [
    AuthService,
    AccessTokenAuthGuard,
    AuthRateLimitGuard,
    GlobalRateLimitGuard,
    TrustedOriginGuard,
    InternalServiceTokenGuard,
    WebhookRateLimitGuard,
    BuildDashboardUseCase,
    IntegrationCredentialService,
    GetNoteDetailUseCase,
    QueryKnowledgeUseCase,
    IngestEntryUseCase,
    RunOnboardingUseCase,
    ProcessConversationUseCase,
    BuildReminderDispatchUseCase,
    MarkReminderAsSentUseCase,
    HandleGithubPushUseCase,
    HandleWhatsappWebhookUseCase,
    { provide: KnowledgeStore, useClass: PostgresKnowledgeStore },
    { provide: SchemaMigrator, useExisting: KnowledgeStore },
    { provide: UserRepository, useExisting: KnowledgeStore },
    { provide: CredentialRepository, useExisting: KnowledgeStore },
    { provide: ExternalIdentityRepository, useExisting: KnowledgeStore },
    { provide: ContentRepository, useExisting: KnowledgeStore },
    { provide: WebhookEventRepository, useExisting: KnowledgeStore },
    { provide: ContentQueryRepository, useClass: PostgresContentQueryRepository },
    { provide: APP_GUARD, useClass: GlobalRateLimitGuard },
  ],
})
export class AppModule {}
