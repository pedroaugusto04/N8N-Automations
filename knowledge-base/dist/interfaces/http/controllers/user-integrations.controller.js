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
import { BadRequestException, Body, Controller, Delete, Get, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthService } from '../../../application/auth.js';
import { IntegrationCredentialService } from '../../../application/credentials.js';
import { CurrentUser } from '../auth.decorators.js';
import { AccessTokenAuthGuard, TrustedOriginGuard } from '../auth.guards.js';
import { parseSaveIntegrationCredentialBody, providerParamSchema, saveIntegrationCredentialBodySchema, workspaceQuerySchema, } from '../dto/integration-credentials.dto.js';
import { accessTokenFromRequest, assertTrustedBrowserOrigin } from '../http-security.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
let UserIntegrationsController = class UserIntegrationsController {
    auth;
    credentials;
    constructor(auth, credentials) {
        this.auth = auth;
        this.credentials = credentials;
    }
    async list(currentUser, request, query) {
        const user = currentUser || await this.auth.authenticateAccessToken(accessTokenFromRequest(request));
        return this.credentials.list(user.id, query.workspaceSlug);
    }
    async save(params, body, currentUser, request) {
        assertTrustedBrowserOrigin(request);
        const user = currentUser || await this.auth.authenticateAccessToken(accessTokenFromRequest(request));
        let parsedBody;
        try {
            parsedBody = parseSaveIntegrationCredentialBody(params.provider, body);
        }
        catch {
            throw new BadRequestException('invalid_integration_config');
        }
        return this.credentials.save({
            userId: user.id,
            workspaceSlug: parsedBody.workspaceSlug,
            provider: params.provider,
            config: parsedBody.config,
            publicMetadata: parsedBody.publicMetadata,
            externalIdentities: parsedBody.externalIdentities,
        });
    }
    async revoke(params, query, currentUser, request) {
        assertTrustedBrowserOrigin(request);
        const user = currentUser || await this.auth.authenticateAccessToken(accessTokenFromRequest(request));
        return this.credentials.revoke(user.id, query.workspaceSlug, params.provider);
    }
};
__decorate([
    Get(),
    __param(0, CurrentUser()),
    __param(1, Req()),
    __param(2, Query(new ZodValidationPipe(workspaceQuerySchema, 'invalid_workspace_query'))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UserIntegrationsController.prototype, "list", null);
__decorate([
    Put(':provider'),
    UseGuards(TrustedOriginGuard),
    __param(0, Param(new ZodValidationPipe(providerParamSchema, 'provider_not_supported'))),
    __param(1, Body(new ZodValidationPipe(saveIntegrationCredentialBodySchema, 'invalid_integration_credential_payload'))),
    __param(2, CurrentUser()),
    __param(3, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UserIntegrationsController.prototype, "save", null);
__decorate([
    Delete(':provider'),
    UseGuards(TrustedOriginGuard),
    __param(0, Param(new ZodValidationPipe(providerParamSchema, 'provider_not_supported'))),
    __param(1, Query(new ZodValidationPipe(workspaceQuerySchema, 'invalid_workspace_query'))),
    __param(2, CurrentUser()),
    __param(3, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object, Object]),
    __metadata("design:returntype", Promise)
], UserIntegrationsController.prototype, "revoke", null);
UserIntegrationsController = __decorate([
    Controller('api/integrations'),
    UseGuards(AccessTokenAuthGuard),
    __metadata("design:paramtypes", [AuthService,
        IntegrationCredentialService])
], UserIntegrationsController);
export { UserIntegrationsController };
