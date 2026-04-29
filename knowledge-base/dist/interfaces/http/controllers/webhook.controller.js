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
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { HandleGithubPushUseCase, HandleWhatsappWebhookUseCase } from '../../../application/use-cases/index.js';
import { WebhookRateLimitGuard } from '../auth.guards.js';
import { githubPushWebhookBodySchema, whatsappWebhookBodySchema } from '../dto/webhook.dto.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
let WebhookController = class WebhookController {
    githubPush;
    whatsappWebhook;
    constructor(githubPush, whatsappWebhook) {
        this.githubPush = githubPush;
        this.whatsappWebhook = whatsappWebhook;
    }
    github(body, request) {
        return this.githubPush.execute({
            headers: request.headers,
            body,
            rawBody: request.rawBody?.toString('utf8') || JSON.stringify(body || {}),
        });
    }
    whatsapp(body, request) {
        return this.whatsappWebhook.execute({ headers: request.headers, body });
    }
};
__decorate([
    Post('github/push'),
    __param(0, Body(new ZodValidationPipe(githubPushWebhookBodySchema, 'invalid_github_webhook_payload'))),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WebhookController.prototype, "github", null);
__decorate([
    Post('whatsapp'),
    __param(0, Body(new ZodValidationPipe(whatsappWebhookBodySchema, 'invalid_whatsapp_webhook_payload'))),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WebhookController.prototype, "whatsapp", null);
WebhookController = __decorate([
    Controller('api/webhooks'),
    UseGuards(WebhookRateLimitGuard),
    __metadata("design:paramtypes", [HandleGithubPushUseCase,
        HandleWhatsappWebhookUseCase])
], WebhookController);
export { WebhookController };
