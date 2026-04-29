var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { readEnvironment } from '../../adapters/environment.js';
import { AuthService } from '../../application/auth.js';
import { accessTokenFromRequest, assertTrustedBrowserOrigin } from './http-security.js';
const rateLimitBuckets = new Map();
function requestIp(request) {
    const forwardedFor = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwardedFor || request.ip || request.socket.remoteAddress || 'unknown';
}
function assertRateLimit(request, namespace, limit, windowMs) {
    const now = Date.now();
    const key = `${namespace}:${requestIp(request)}`;
    const current = rateLimitBuckets.get(key);
    if (!current || current.resetAt <= now) {
        rateLimitBuckets.set(key, { resetAt: now + windowMs, count: 1 });
        return;
    }
    current.count += 1;
    if (current.count > limit)
        throw new HttpException('rate_limited', HttpStatus.TOO_MANY_REQUESTS);
}
let AccessTokenAuthGuard = class AccessTokenAuthGuard {
    auth;
    constructor(auth) {
        this.auth = auth;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
        request.user = await this.auth.authenticateAccessToken(accessTokenFromRequest(request));
        return true;
    }
};
AccessTokenAuthGuard = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [AuthService])
], AccessTokenAuthGuard);
export { AccessTokenAuthGuard };
let TrustedOriginGuard = class TrustedOriginGuard {
    canActivate(context) {
        assertTrustedBrowserOrigin(context.switchToHttp().getRequest());
        return true;
    }
};
TrustedOriginGuard = __decorate([
    Injectable()
], TrustedOriginGuard);
export { TrustedOriginGuard };
let InternalServiceTokenGuard = class InternalServiceTokenGuard {
    canActivate(context) {
        const request = context.switchToHttp().getRequest();
        const authorization = request.headers.authorization || '';
        const token = String(authorization).startsWith('Bearer ') ? String(authorization).slice('Bearer '.length) : '';
        if (!readEnvironment().internalServiceToken || token !== readEnvironment().internalServiceToken) {
            throw new UnauthorizedException('invalid_internal_token');
        }
        return true;
    }
};
InternalServiceTokenGuard = __decorate([
    Injectable()
], InternalServiceTokenGuard);
export { InternalServiceTokenGuard };
let AuthRateLimitGuard = class AuthRateLimitGuard {
    canActivate(context) {
        assertRateLimit(context.switchToHttp().getRequest(), 'auth', 10, 60_000);
        return true;
    }
};
AuthRateLimitGuard = __decorate([
    Injectable()
], AuthRateLimitGuard);
export { AuthRateLimitGuard };
let GlobalRateLimitGuard = class GlobalRateLimitGuard {
    canActivate(context) {
        assertRateLimit(context.switchToHttp().getRequest(), 'global', 300, 60_000);
        return true;
    }
};
GlobalRateLimitGuard = __decorate([
    Injectable()
], GlobalRateLimitGuard);
export { GlobalRateLimitGuard };
let WebhookRateLimitGuard = class WebhookRateLimitGuard {
    canActivate(context) {
        assertRateLimit(context.switchToHttp().getRequest(), 'webhook', 60, 60_000);
        return true;
    }
};
WebhookRateLimitGuard = __decorate([
    Injectable()
], WebhookRateLimitGuard);
export { WebhookRateLimitGuard };
