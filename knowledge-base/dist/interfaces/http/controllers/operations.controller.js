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
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { BuildReminderDispatchUseCase, IngestEntryUseCase, MarkReminderAsSentUseCase, ProcessConversationUseCase, RunOnboardingUseCase, } from '../../../application/use-cases/index.js';
import { CurrentUser } from '../auth.decorators.js';
import { AccessTokenAuthGuard, TrustedOriginGuard } from '../auth.guards.js';
import { conversationBodySchema, ingestBodySchema, onboardingBodySchema, reminderDispatchQuerySchema, workspaceQuerySchema, } from '../dto/operations.dto.js';
import { markRemindersBodySchema } from '../dto/query.dto.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
let OperationsController = class OperationsController {
    ingestEntry;
    onboarding;
    conversation;
    reminderDispatch;
    markReminders;
    constructor(ingestEntry, onboarding, conversation, reminderDispatch, markReminders) {
        this.ingestEntry = ingestEntry;
        this.onboarding = onboarding;
        this.conversation = conversation;
        this.reminderDispatch = reminderDispatch;
        this.markReminders = markReminders;
    }
    ingest(body, user) {
        return this.ingestEntry.execute(body, user.id);
    }
    runOnboarding(body, user) {
        return this.onboarding.execute(body, user.id);
    }
    processConversation(body, user, query) {
        return this.conversation.execute(body, user.id, query.workspaceSlug);
    }
    remindersDispatch(user, query) {
        return this.reminderDispatch.execute(query.mode, user.id, query.workspaceSlug);
    }
    remindersMarkSent(body, user, query) {
        return this.markReminders.execute(body.ids, user.id, query.workspaceSlug);
    }
};
__decorate([
    Post('ingest'),
    UseGuards(TrustedOriginGuard),
    __param(0, Body(new ZodValidationPipe(ingestBodySchema, 'invalid_ingest_payload'))),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "ingest", null);
__decorate([
    Post('onboarding'),
    UseGuards(TrustedOriginGuard),
    __param(0, Body(new ZodValidationPipe(onboardingBodySchema, 'invalid_onboarding_payload'))),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "runOnboarding", null);
__decorate([
    Post('conversation'),
    UseGuards(TrustedOriginGuard),
    __param(0, Body(new ZodValidationPipe(conversationBodySchema, 'invalid_conversation_payload'))),
    __param(1, CurrentUser()),
    __param(2, Query(new ZodValidationPipe(workspaceQuerySchema, 'invalid_workspace_query'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "processConversation", null);
__decorate([
    Get('reminders/dispatch'),
    __param(0, CurrentUser()),
    __param(1, Query(new ZodValidationPipe(reminderDispatchQuerySchema, 'invalid_reminder_dispatch_query'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "remindersDispatch", null);
__decorate([
    Post('reminders/mark-sent'),
    UseGuards(TrustedOriginGuard),
    __param(0, Body(new ZodValidationPipe(markRemindersBodySchema, 'invalid_mark_reminders_payload'))),
    __param(1, CurrentUser()),
    __param(2, Query(new ZodValidationPipe(workspaceQuerySchema, 'invalid_workspace_query'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], OperationsController.prototype, "remindersMarkSent", null);
OperationsController = __decorate([
    Controller('api'),
    UseGuards(AccessTokenAuthGuard),
    __metadata("design:paramtypes", [IngestEntryUseCase,
        RunOnboardingUseCase,
        ProcessConversationUseCase,
        BuildReminderDispatchUseCase,
        MarkReminderAsSentUseCase])
], OperationsController);
export { OperationsController };
