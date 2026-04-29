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
import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthService } from '../../../application/auth.js';
import { CurrentUser } from '../auth.decorators.js';
import { AccessTokenAuthGuard, AuthRateLimitGuard, TrustedOriginGuard } from '../auth.guards.js';
import { loginBodySchema, signupBodySchema } from '../dto/auth.dto.js';
import { accessTokenFromRequest, assertTrustedBrowserOrigin, clearAuthCookies, refreshTokenFromRequest, setAuthCookies } from '../http-security.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
let AuthController = class AuthController {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    async login(body, request, response) {
        assertTrustedBrowserOrigin(request);
        const { user, tokens } = await this.auth.login(body.email, body.password);
        setAuthCookies(response, tokens);
        return { ok: true, user };
    }
    async signup(body, request, response) {
        assertTrustedBrowserOrigin(request);
        const { user, tokens } = await this.auth.signup({
            email: body.email,
            password: body.password,
            name: body.name,
        });
        setAuthCookies(response, tokens);
        return { ok: true, user };
    }
    async refresh(request, response) {
        assertTrustedBrowserOrigin(request);
        const { user, tokens } = await this.auth.refresh(refreshTokenFromRequest(request) || '');
        setAuthCookies(response, tokens);
        return { ok: true, user };
    }
    logout(request, response) {
        assertTrustedBrowserOrigin(request);
        clearAuthCookies(response);
        return { ok: true };
    }
    async me(user, request) {
        return { ok: true, user: user || await this.auth.authenticateAccessToken(accessTokenFromRequest(request)) };
    }
};
__decorate([
    Post('login'),
    UseGuards(AuthRateLimitGuard, TrustedOriginGuard),
    __param(0, Body(new ZodValidationPipe(loginBodySchema, 'invalid_login_payload'))),
    __param(1, Req()),
    __param(2, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    Post('signup'),
    UseGuards(AuthRateLimitGuard, TrustedOriginGuard),
    __param(0, Body(new ZodValidationPipe(signupBodySchema, 'invalid_signup_payload'))),
    __param(1, Req()),
    __param(2, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "signup", null);
__decorate([
    Post('refresh'),
    UseGuards(AuthRateLimitGuard, TrustedOriginGuard),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "refresh", null);
__decorate([
    Post('logout'),
    UseGuards(TrustedOriginGuard),
    __param(0, Req()),
    __param(1, Res({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "logout", null);
__decorate([
    Get('me'),
    UseGuards(AccessTokenAuthGuard),
    __param(0, CurrentUser()),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
AuthController = __decorate([
    Controller('api/auth'),
    __metadata("design:paramtypes", [AuthService])
], AuthController);
export { AuthController };
