import { ForbiddenException } from '@nestjs/common';
import { readEnvironment } from '../../adapters/environment.js';
import { parseCookies } from '../../application/auth.js';
const accessCookieName = 'kb_access_token';
const refreshCookieName = 'kb_refresh_token';
export function accessTokenFromRequest(request) {
    return parseCookies(request.headers.cookie)[accessCookieName];
}
export function refreshTokenFromRequest(request) {
    return parseCookies(request.headers.cookie)[refreshCookieName];
}
export function setAuthCookies(response, tokens) {
    const secure = process.env.NODE_ENV === 'production';
    response.cookie(accessCookieName, tokens.accessToken, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: tokens.accessTokenMaxAgeSeconds * 1000,
    });
    response.cookie(refreshCookieName, tokens.refreshToken, {
        httpOnly: true,
        secure,
        sameSite: 'lax',
        path: '/',
        maxAge: tokens.refreshTokenMaxAgeSeconds * 1000,
    });
}
export function clearAuthCookies(response) {
    const secure = process.env.NODE_ENV === 'production';
    for (const name of [accessCookieName, refreshCookieName]) {
        response.clearCookie(name, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
    }
}
export function assertTrustedBrowserOrigin(request) {
    const originOrReferer = request.headers.origin || request.headers.referer;
    if (!originOrReferer)
        return;
    const actualOrigin = new URL(String(originOrReferer)).origin;
    const expected = expectedOrigins(request);
    if (!expected.has(actualOrigin)) {
        throw new ForbiddenException('invalid_origin');
    }
}
function expectedOrigins(request) {
    const environment = readEnvironment();
    const publicBaseUrl = environment.publicBaseUrl;
    const origins = new Set();
    for (const origin of environment.allowedOrigins) {
        origins.add(new URL(origin).origin);
    }
    if (publicBaseUrl)
        origins.add(new URL(publicBaseUrl).origin);
    const host = request.headers['x-forwarded-host'] || request.headers.host;
    if (host) {
        const protocol = request.headers['x-forwarded-proto'] || request.protocol || 'http';
        origins.add(`${String(protocol).split(',')[0]}://${String(host).split(',')[0]}`);
    }
    return origins;
}
