var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { readEnvironment } from '../adapters/environment.js';
import { SchemaMigrator, UserRepository } from './ports/repositories.js';
const scrypt = promisify(crypto.scrypt);
function base64url(input) {
    return Buffer.from(input).toString('base64url');
}
function parseBase64urlJson(value) {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}
async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('base64url');
    const derived = (await scrypt(password, salt, 64));
    return `scrypt$${salt}$${derived.toString('base64url')}`;
}
async function verifyPassword(password, storedHash) {
    const [algorithm, salt, hash] = storedHash.split('$');
    if (algorithm !== 'scrypt' || !salt || !hash)
        return false;
    const derived = (await scrypt(password, salt, 64));
    const expected = Buffer.from(hash, 'base64url');
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}
function signJwt(payload, secret, ttlSeconds) {
    if (!secret)
        throw new Error('jwt_secret_not_configured');
    const issuedAt = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const body = { ...payload, iat: issuedAt, exp: issuedAt + ttlSeconds };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
    const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
    return `${signingInput}.${signature}`;
}
function verifyJwt(token, secret, expectedType) {
    if (!secret)
        throw new UnauthorizedException('jwt_secret_not_configured');
    const [encodedHeader, encodedPayload, signature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !signature)
        throw new UnauthorizedException('invalid_token');
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expected = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        throw new UnauthorizedException('invalid_token');
    }
    const payload = parseBase64urlJson(encodedPayload);
    if (payload.typ !== expectedType)
        throw new UnauthorizedException('invalid_token_type');
    if (!payload.sub || !payload.email || !payload.role || !payload.exp)
        throw new UnauthorizedException('invalid_token');
    if (payload.exp <= Math.floor(Date.now() / 1000))
        throw new UnauthorizedException('token_expired');
    return payload;
}
export function parseCookies(cookieHeader) {
    if (!cookieHeader)
        return {};
    return Object.fromEntries(cookieHeader
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
        const index = part.indexOf('=');
        if (index === -1)
            return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    }));
}
function toAuthenticatedUser(user) {
    return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}
let AuthService = class AuthService {
    users;
    schemaMigrator;
    constructor(users, schemaMigrator = users) {
        this.users = users;
        this.schemaMigrator = schemaMigrator;
    }
    async onModuleInit() {
        await this.schemaMigrator.migrate();
        const environment = readEnvironment();
        if (!environment.adminEmail || !environment.adminPassword)
            return;
        const existing = await this.users.findUserByEmail(environment.adminEmail);
        if (existing)
            return;
        await this.users.createUser({
            email: environment.adminEmail,
            displayName: 'Admin',
            passwordHash: await hashPassword(environment.adminPassword),
            role: 'admin',
        });
    }
    async signup(input) {
        const email = String(input.email || '').trim().toLowerCase();
        const displayName = String(input.name || '').trim();
        const password = String(input.password || '');
        if (!email || !email.includes('@'))
            throw new UnauthorizedException('invalid_signup');
        if (password.length < 8)
            throw new UnauthorizedException('invalid_signup');
        if (!displayName)
            throw new UnauthorizedException('invalid_signup');
        const existing = await this.users.findUserByEmail(email);
        if (existing)
            throw new ConflictException('email_already_registered');
        const user = await this.users.createUser({
            email,
            displayName,
            passwordHash: await hashPassword(password),
            role: 'user',
        });
        return { user: toAuthenticatedUser(user), tokens: this.issueTokens(user) };
    }
    async login(email, password) {
        const user = await this.users.findUserByEmail(String(email || '').trim().toLowerCase());
        if (!user || !(await verifyPassword(password, user.passwordHash))) {
            throw new UnauthorizedException('invalid_credentials');
        }
        return { user: toAuthenticatedUser(user), tokens: this.issueTokens(user) };
    }
    async refresh(refreshToken) {
        const environment = readEnvironment();
        const payload = verifyJwt(refreshToken, environment.jwtRefreshSecret, 'refresh');
        const user = await this.users.findUserById(payload.sub);
        if (!user)
            throw new UnauthorizedException('user_not_found');
        return { user: toAuthenticatedUser(user), tokens: this.issueTokens(user) };
    }
    async authenticateAccessToken(accessToken) {
        if (!accessToken)
            throw new UnauthorizedException('missing_access_token');
        const environment = readEnvironment();
        const payload = verifyJwt(accessToken, environment.jwtAccessSecret, 'access');
        const user = await this.users.findUserById(payload.sub);
        if (!user)
            throw new UnauthorizedException('user_not_found');
        return toAuthenticatedUser(user);
    }
    issueTokens(user) {
        const environment = readEnvironment();
        return {
            accessToken: signJwt({ sub: user.id, email: user.email, role: user.role, typ: 'access' }, environment.jwtAccessSecret, environment.accessTokenTtlSeconds),
            refreshToken: signJwt({ sub: user.id, email: user.email, role: user.role, typ: 'refresh' }, environment.jwtRefreshSecret, environment.refreshTokenTtlSeconds),
            accessTokenMaxAgeSeconds: environment.accessTokenTtlSeconds,
            refreshTokenMaxAgeSeconds: environment.refreshTokenTtlSeconds,
        };
    }
};
AuthService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UserRepository,
        SchemaMigrator])
], AuthService);
export { AuthService };
export const passwordHashing = { hashPassword, verifyPassword };
