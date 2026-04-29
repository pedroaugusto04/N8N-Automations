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
import { ExternalIdentityProvider, IntegrationProvider, WebhookEventStatus } from '../../../../contracts/enums.js';
import { ExternalIdentityRepository, WebhookEventRepository } from '../../../ports/repositories.js';
import { extractWhatsappExternalId, normalizeHeaders } from '../../../utils/webhook.utils.js';
import { IngestEntryUseCase } from '../../ingest/ingest-entry.use-case.js';
let HandleWhatsappWebhookUseCase = class HandleWhatsappWebhookUseCase {
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
        const token = String(headers.authorization || '').startsWith('Bearer ')
            ? String(headers.authorization).slice('Bearer '.length)
            : String(headers['x-kb-webhook-token'] || '');
        const externalId = extractWhatsappExternalId(body);
        const externalIdentity = { provider: ExternalIdentityProvider.Whatsapp, identityType: 'jid', externalId };
        if (!environment.webhookSecret || token !== environment.webhookSecret) {
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.Whatsapp,
                eventType: 'message',
                status: WebhookEventStatus.Rejected,
                externalIdentity,
                rawHeaders: headers,
                rawPayload: body,
                error: 'invalid_webhook_token',
            });
            throw new UnauthorizedException('invalid_webhook_token');
        }
        if (!externalId) {
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.Whatsapp,
                eventType: 'message',
                status: WebhookEventStatus.Rejected,
                externalIdentity,
                rawHeaders: headers,
                rawPayload: body,
                error: 'missing_external_identity',
            });
            throw new UnauthorizedException('missing_external_identity');
        }
        const identity = await this.externalIdentities.findExternalIdentity(ExternalIdentityProvider.Whatsapp, 'jid', externalId);
        if (!identity) {
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.Whatsapp,
                eventType: 'message',
                status: WebhookEventStatus.Rejected,
                externalIdentity,
                rawHeaders: headers,
                rawPayload: body,
                error: 'identity_not_found',
            });
            throw new NotFoundException('identity_not_found');
        }
        await this.webhookEvents.recordWebhookEvent({
            provider: IntegrationProvider.Whatsapp,
            eventType: 'message',
            status: WebhookEventStatus.Resolved,
            resolvedUserId: identity.userId,
            externalIdentity,
            rawHeaders: headers,
            rawPayload: body,
        });
        try {
            if (Number(body.schemaVersion) !== 1) {
                await this.webhookEvents.recordWebhookEvent({
                    provider: IntegrationProvider.Whatsapp,
                    eventType: 'message',
                    status: WebhookEventStatus.Processed,
                    resolvedUserId: identity.userId,
                    externalIdentity,
                    rawHeaders: headers,
                    rawPayload: body,
                });
                return { ok: true, resolvedUserId: identity.userId, processed: false };
            }
            const ingestResult = await this.ingestEntryUseCase.execute(body, identity.userId, identity.workspaceSlug);
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.Whatsapp,
                eventType: 'message',
                status: WebhookEventStatus.Processed,
                resolvedUserId: identity.userId,
                externalIdentity,
                rawHeaders: headers,
                rawPayload: body,
            });
            return { ok: true, ingestResult };
        }
        catch (error) {
            await this.webhookEvents.recordWebhookEvent({
                provider: IntegrationProvider.Whatsapp,
                eventType: 'message',
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
HandleWhatsappWebhookUseCase = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [IngestEntryUseCase,
        ExternalIdentityRepository,
        WebhookEventRepository])
], HandleWhatsappWebhookUseCase);
export { HandleWhatsappWebhookUseCase };
