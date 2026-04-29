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
import { Controller, Body, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IntegrationCredentialService } from '../../../application/credentials.js';
import { InternalServiceTokenGuard } from '../auth.guards.js';
import { providerParamSchema, resolveIntegrationCredentialBodySchema, } from '../dto/integration-credentials.dto.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
let InternalIntegrationsController = class InternalIntegrationsController {
    credentials;
    constructor(credentials) {
        this.credentials = credentials;
    }
    resolve(params, body, request) {
        return this.credentials.resolve({
            provider: params.provider,
            workspaceSlug: body.workspaceSlug,
            userId: body.userId,
            externalIdentity: body.externalIdentity,
            authorization: request.headers.authorization,
        });
    }
};
__decorate([
    Post(':provider/resolve'),
    __param(0, Param(new ZodValidationPipe(providerParamSchema, 'provider_not_supported'))),
    __param(1, Body(new ZodValidationPipe(resolveIntegrationCredentialBodySchema, 'invalid_integration_resolution_payload'))),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], InternalIntegrationsController.prototype, "resolve", null);
InternalIntegrationsController = __decorate([
    Controller('api/internal/integrations'),
    UseGuards(InternalServiceTokenGuard),
    __metadata("design:paramtypes", [IntegrationCredentialService])
], InternalIntegrationsController);
export { InternalIntegrationsController };
