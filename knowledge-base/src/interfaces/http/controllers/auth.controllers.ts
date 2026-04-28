import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService, type AuthenticatedUser } from '../../../application/auth.js';
import { IntegrationCredentialService } from '../../../application/credentials.js';
import { CurrentUser } from '../auth.decorators.js';
import { AccessTokenAuthGuard, AuthRateLimitGuard, InternalServiceTokenGuard, TrustedOriginGuard } from '../auth.guards.js';
import { parseLoginBody, parseSignupBody, type LoginBody, type SignupBody } from '../dto/auth.dto.js';
import { parseIntegrationProvider, parseResolveIntegrationCredentialBody, parseSaveIntegrationCredentialBody } from '../dto/integration-credentials.dto.js';
import { accessTokenFromRequest, assertTrustedBrowserOrigin, clearAuthCookies, refreshTokenFromRequest, setAuthCookies } from '../http-security.js';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @UseGuards(AuthRateLimitGuard, TrustedOriginGuard)
  async login(@Body() body: LoginBody, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertTrustedBrowserOrigin(request);
    const parsed = parseLoginBody(body);
    const { user, tokens } = await this.auth.login(parsed.email, parsed.password);
    setAuthCookies(response, tokens);
    return { ok: true, user };
  }

  @Post('signup')
  @UseGuards(AuthRateLimitGuard, TrustedOriginGuard)
  async signup(@Body() body: SignupBody, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertTrustedBrowserOrigin(request);
    const parsed = parseSignupBody(body);
    const { user, tokens } = await this.auth.signup({
      email: parsed.email,
      password: parsed.password,
      name: parsed.name,
    });
    setAuthCookies(response, tokens);
    return { ok: true, user };
  }

  @Post('refresh')
  @UseGuards(AuthRateLimitGuard, TrustedOriginGuard)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertTrustedBrowserOrigin(request);
    const { user, tokens } = await this.auth.refresh(refreshTokenFromRequest(request) || '');
    setAuthCookies(response, tokens);
    return { ok: true, user };
  }

  @Post('logout')
  @UseGuards(TrustedOriginGuard)
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertTrustedBrowserOrigin(request);
    clearAuthCookies(response);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AccessTokenAuthGuard)
  async me(@CurrentUser() user: AuthenticatedUser, @Req() request?: Request) {
    return { ok: true, user: user || await this.auth.authenticateAccessToken(accessTokenFromRequest(request as Request)) };
  }
}

@Controller('api/integrations')
@UseGuards(AccessTokenAuthGuard)
export class UserIntegrationsController {
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: IntegrationCredentialService,
  ) {}

  @Get()
  async list(@CurrentUser() currentUser: AuthenticatedUser, @Req() request: Request, @Query('workspaceSlug') workspaceSlug = 'default') {
    const user = currentUser || await this.auth.authenticateAccessToken(accessTokenFromRequest(request));
    return this.credentials.list(user.id, workspaceSlug || 'default');
  }

  @Put(':provider')
  @UseGuards(TrustedOriginGuard)
  async save(@Param('provider') provider: string, @Body() body: Record<string, unknown>, @CurrentUser() currentUser: AuthenticatedUser, @Req() request: Request) {
    assertTrustedBrowserOrigin(request);
    const user = currentUser || await this.auth.authenticateAccessToken(accessTokenFromRequest(request));
    const parsedProvider = parseIntegrationProvider(provider);
    const parsedBody = parseSaveIntegrationCredentialBody(parsedProvider, body);
    return this.credentials.save({
      userId: user.id,
      workspaceSlug: parsedBody.workspaceSlug,
      provider: parsedProvider,
      config: parsedBody.config,
      publicMetadata: parsedBody.publicMetadata,
      externalIdentities: parsedBody.externalIdentities,
    });
  }

  @Delete(':provider')
  @UseGuards(TrustedOriginGuard)
  async revoke(@Param('provider') provider: string, @Query('workspaceSlug') workspaceSlug: string, @CurrentUser() currentUser: AuthenticatedUser, @Req() request: Request) {
    assertTrustedBrowserOrigin(request);
    const user = currentUser || await this.auth.authenticateAccessToken(accessTokenFromRequest(request));
    return this.credentials.revoke(user.id, workspaceSlug || 'default', provider);
  }
}

@Controller('api/internal/integrations')
@UseGuards(InternalServiceTokenGuard)
export class InternalIntegrationsController {
  constructor(private readonly credentials: IntegrationCredentialService) {}

  @Post(':provider/resolve')
  resolve(@Param('provider') provider: string, @Body() body: Record<string, unknown>, @Req() request: Request) {
    const parsedProvider = parseIntegrationProvider(provider);
    const parsedBody = parseResolveIntegrationCredentialBody(body);
    return this.credentials.resolve({
      provider: parsedProvider,
      workspaceSlug: parsedBody.workspaceSlug,
      userId: parsedBody.userId,
      externalIdentity: parsedBody.externalIdentity,
      authorization: request.headers.authorization,
    });
  }
}
