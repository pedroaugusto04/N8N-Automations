import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AuthService } from '../../../application/auth.js';
import { IntegrationCredentialService } from '../../../application/credentials.js';
import { accessTokenFromRequest, assertTrustedBrowserOrigin, clearAuthCookies, refreshTokenFromRequest, setAuthCookies } from '../http-security.js';

type LoginBody = {
  email?: string;
  password?: string;
};

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() body: LoginBody, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertTrustedBrowserOrigin(request);
    const { user, tokens } = await this.auth.login(String(body.email || ''), String(body.password || ''));
    setAuthCookies(response, tokens);
    return { ok: true, user };
  }

  @Post('refresh')
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertTrustedBrowserOrigin(request);
    const { user, tokens } = await this.auth.refresh(refreshTokenFromRequest(request) || '');
    setAuthCookies(response, tokens);
    return { ok: true, user };
  }

  @Post('logout')
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertTrustedBrowserOrigin(request);
    clearAuthCookies(response);
    return { ok: true };
  }

  @Get('me')
  async me(@Req() request: Request) {
    return { ok: true, user: await this.auth.authenticateAccessToken(accessTokenFromRequest(request)) };
  }
}

@Controller('api/integrations')
export class UserIntegrationsController {
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: IntegrationCredentialService,
  ) {}

  @Get()
  async list(@Req() request: Request, @Query('workspaceSlug') workspaceSlug = 'default') {
    const user = await this.auth.authenticateAccessToken(accessTokenFromRequest(request));
    return this.credentials.list(user.id, workspaceSlug || 'default');
  }

  @Put(':provider')
  async save(@Param('provider') provider: string, @Body() body: Record<string, unknown>, @Req() request: Request) {
    assertTrustedBrowserOrigin(request);
    const user = await this.auth.authenticateAccessToken(accessTokenFromRequest(request));
    return this.credentials.save({
      userId: user.id,
      workspaceSlug: String(body.workspaceSlug || 'default'),
      provider,
      config: body.config,
      publicMetadata: body.publicMetadata,
      externalIdentities: body.externalIdentities,
    });
  }

  @Delete(':provider')
  async revoke(@Param('provider') provider: string, @Query('workspaceSlug') workspaceSlug: string, @Req() request: Request) {
    assertTrustedBrowserOrigin(request);
    const user = await this.auth.authenticateAccessToken(accessTokenFromRequest(request));
    return this.credentials.revoke(user.id, workspaceSlug || 'default', provider);
  }
}

@Controller('api/internal/integrations')
export class InternalIntegrationsController {
  constructor(private readonly credentials: IntegrationCredentialService) {}

  @Post(':provider/resolve')
  resolve(@Param('provider') provider: string, @Body() body: Record<string, unknown>, @Req() request: Request) {
    const externalIdentity = body.externalIdentity && typeof body.externalIdentity === 'object' ? body.externalIdentity as { provider: string; externalId: string } : undefined;
    return this.credentials.resolve({
      provider,
      workspaceSlug: String(body.workspaceSlug || 'default'),
      userId: body.userId ? String(body.userId) : undefined,
      externalIdentity,
      authorization: request.headers.authorization,
    });
  }
}
