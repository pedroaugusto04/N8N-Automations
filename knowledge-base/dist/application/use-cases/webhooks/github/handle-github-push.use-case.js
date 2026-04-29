var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { readEnvironment } from '../../../../adapters/environment.js';
import { verifyGithubSignature } from '../../../../adapters/github.js';
import { ExternalIdentityProvider, IntegrationProvider, WebhookEventStatus } from '../../../../contracts/enums.js';
import { buildTelegramCodeReviewMessage } from '../../../../domain/notifications.js';
import { buildGithubReviewEvent } from '../../../github-review.js';
import { ExternalIdentityRepository, WebhookEventRepository } from '../../../ports/repositories.js';
import { normalizeHeaders } from '../../../utils/webhook.utils.js';
import { IngestEntryUseCase } from '../../ingest/ingest-entry.use-case.js';
let HandleGithubPushUseCase = class HandleGithubPushUseCase {
    ingestEntryUseCase;
    externalIdentities;
    webhookEvents;
    constructor(ingestEntryUseCase, externalIdentities, webhookEvents = externalIdentities) {
        this.ingestEntryUseCase = ingestEntryUseCase;
        this.externalIdentities = externalIdentities;
        this.webhookEvents = webhookEvents;
    }
    async execute(input) {
        const environment = readEnvironment();
        const headers = normalizeHeaders(input.headers || {});
        const body = input.body || {};
        const installationId = String(body.installation?.id || '').trim();
        const externalIdentity = { provider: ExternalIdentityProvider.GithubApp, identityType: 'installation_id', externalId: installationId };
        if (!environment.githubWebhookSecret) {
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.GithubApp,
                eventType: String(headers['x-github-event'] || 'push'),
                status: WebhookEventStatus.Rejected,
                externalIdentity,
                rawHeaders: headers,
                rawPayload: body,
                error: 'github_webhook_secret_not_configured',
            });
            throw new UnauthorizedException('github_webhook_secret_not_configured');
        }
        try {
            verifyGithubSignature(environment.githubWebhookSecret, String(input.rawBody || ''), String(headers['x-hub-signature-256'] || ''));
        }
        catch (error) {
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.GithubApp,
                eventType: String(headers['x-github-event'] || 'push'),
                status: WebhookEventStatus.Rejected,
                externalIdentity,
                rawHeaders: headers,
                rawPayload: body,
                error: error instanceof Error ? error.message : String(error),
            });
            throw new UnauthorizedException('invalid_github_signature');
        }
        if (!installationId) {
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.GithubApp,
                eventType: String(headers['x-github-event'] || 'push'),
                status: WebhookEventStatus.Rejected,
                externalIdentity,
                rawHeaders: headers,
                rawPayload: body,
                error: 'missing_installation_id',
            });
            throw new UnauthorizedException('missing_installation_id');
        }
        const identity = await this.externalIdentities.findExternalIdentity(ExternalIdentityProvider.GithubApp, 'installation_id', installationId);
        if (!identity) {
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.GithubApp,
                eventType: String(headers['x-github-event'] || 'push'),
                status: WebhookEventStatus.Rejected,
                externalIdentity,
                rawHeaders: headers,
                rawPayload: body,
                error: 'identity_not_found',
            });
            throw new NotFoundException('identity_not_found');
        }
        await this.webhookEvents.recordWebhookEvent({
            provider: IntegrationProvider.GithubApp,
            eventType: String(headers['x-github-event'] || 'push'),
            status: WebhookEventStatus.Resolved,
            resolvedUserId: identity.userId,
            externalIdentity,
            rawHeaders: headers,
            rawPayload: body,
        });
        try {
            const payload = await buildGithubReviewEvent(input, environment);
            const ingestResult = await this.ingestEntryUseCase.execute(payload, identity.userId, identity.workspaceSlug);
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.GithubApp,
                eventType: String(headers['x-github-event'] || 'push'),
                status: WebhookEventStatus.Processed,
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
        }
        catch (error) {
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.GithubApp,
                eventType: String(headers['x-github-event'] || 'push'),
                status: WebhookEventStatus.Failed,
                resolvedUserId: identity.userId,
                externalIdentity,
                rawHeaders: headers,
                rawPayload: body,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
};
HandleGithubPushUseCase = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [IngestEntryUseCase,
        ExternalIdentityRepository,
        WebhookEventRepository])
], HandleGithubPushUseCase);
export { HandleGithubPushUseCase };
