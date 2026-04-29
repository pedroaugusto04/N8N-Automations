var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Body, Controller, Get, NotFoundException, Post, Query, UseGuards } from '@nestjs/common';
import { ExternalIdentityRepository } from '../../../application/ports/repositories.js';
import { BuildReminderDispatchUseCase, IngestEntryUseCase, MarkReminderAsSentUseCase, ProcessConversationUseCase, QueryKnowledgeUseCase, RunOnboardingUseCase, } from '../../../application/use-cases/index.js';
import { InternalServiceTokenGuard } from '../auth.guards.js';
import { internalN8nConversationBodySchema, internalN8nIngestBodySchema, internalN8nMarkSentBodySchema, internalN8nOnboardingBodySchema, internalN8nQueryBodySchema, internalReminderDispatchQuerySchema, resolveExternalIdentityLookup, } from '../dto/internal-n8n.dto.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
let InternalN8nController = class InternalN8nController {
    ingestEntry;
    onboarding;
    conversation;
    queryKnowledge;
    reminderDispatch;
    markReminders;
    externalIdentities;
    constructor(ingestEntry, onboarding, conversation, queryKnowledge, reminderDispatch, markReminders, externalIdentities) {
        this.ingestEntry = ingestEntry;
        this.onboarding = onboarding;
        this.conversation = conversation;
        this.queryKnowledge = queryKnowledge;
        this.reminderDispatch = reminderDispatch;
        this.markReminders = markReminders;
        this.externalIdentities = externalIdentities;
    }
    async ingest(body) {
        const tenant = await this.resolveTenant(body);
        return this.ingestEntry.execute(body.payload || body, tenant.userId, tenant.workspaceSlug);
    }
    async onboardingPost(body) {
        const tenant = await this.resolveTenant(body);
        return this.onboarding.execute(body.payload || body, tenant.userId);
    }
    async query(body) {
        const tenant = await this.resolveTenant(body);
        return this.queryKnowledge.execute(body.payload || body, tenant.userId);
    }
    async conversationPost(body) {
        const tenant = await this.resolveTenant(body);
        return this.conversation.execute(body.payload || body, tenant.userId, tenant.workspaceSlug);
    }
    async remindersDispatch(query) {
        const tenant = await this.resolveExternalIdentity(query);
        return this.reminderDispatch.execute(query.mode, tenant.userId, tenant.workspaceSlug);
    }
    async remindersMarkSent(body) {
        const tenant = await this.resolveTenant(body);
        const payload = body.payload || body;
        return this.markReminders.execute(payload.ids, tenant.userId, tenant.workspaceSlug);
    }
    async resolveTenant(body) {
        return this.resolveExternalIdentity(resolveExternalIdentityLookup(body));
    }
    async resolveExternalIdentity(input) {
        if (!input.externalId)
            throw new NotFoundException('external_identity_required');
        const identity = await this.externalIdentities.findExternalIdentity(input.provider, input.identityType, input.externalId);
        if (!identity)
            throw new NotFoundException('identity_not_found');
        const requestedWorkspace = String(input.workspaceSlug || '').trim();
        if (requestedWorkspace && requestedWorkspace !== identity.workspaceSlug)
            throw new NotFoundException('identity_not_found');
        return { userId: identity.userId, workspaceSlug: identity.workspaceSlug };
    }
};
__decorate([
    Post('ingest'),
    __param(0, Body(new ZodValidationPipe(internalN8nIngestBodySchema, 'invalid_internal_ingest_payload'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InternalN8nController.prototype, "ingest", null);
__decorate([
    Post('onboarding'),
    __param(0, Body(new ZodValidationPipe(internalN8nOnboardingBodySchema, 'invalid_internal_onboarding_payload'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InternalN8nController.prototype, "onboardingPost", null);
__decorate([
    Post('query'),
    __param(0, Body(new ZodValidationPipe(internalN8nQueryBodySchema, 'invalid_internal_query_payload'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InternalN8nController.prototype, "query", null);
__decorate([
    Post('conversation'),
    __param(0, Body(new ZodValidationPipe(internalN8nConversationBodySchema, 'invalid_internal_conversation_payload'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InternalN8nController.prototype, "conversationPost", null);
__decorate([
    Get('reminders/dispatch'),
    __param(0, Query(new ZodValidationPipe(internalReminderDispatchQuerySchema, 'invalid_internal_reminder_dispatch_query'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InternalN8nController.prototype, "remindersDispatch", null);
__decorate([
    Post('reminders/mark-sent'),
    __param(0, Body(new ZodValidationPipe(internalN8nMarkSentBodySchema, 'invalid_internal_mark_reminders_payload'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InternalN8nController.prototype, "remindersMarkSent", null);
InternalN8nController = __decorate([
    Controller('api/internal/n8n'),
    UseGuards(InternalServiceTokenGuard),
    __metadata("design:paramtypes", [IngestEntryUseCase,
        RunOnboardingUseCase,
        ProcessConversationUseCase,
        QueryKnowledgeUseCase,
        BuildReminderDispatchUseCase,
        MarkReminderAsSentUseCase,
        ExternalIdentityRepository])
], InternalN8nController);
export { InternalN8nController };
