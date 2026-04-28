import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../../application/auth.js';
import {
  BuildDashboardUseCase,
  BuildReminderDispatchUseCase,
  GetNoteDetailUseCase,
  HandleGithubPushUseCase,
  HandleWhatsappWebhookUseCase,
  IngestEntryUseCase,
  MarkReminderAsSentUseCase,
  ProcessConversationUseCase,
  QueryKnowledgeUseCase,
  RunOnboardingUseCase,
} from '../../../application/use-cases/dashboard.use-cases.js';
import { CurrentUser } from '../auth.decorators.js';
import { AccessTokenAuthGuard, TrustedOriginGuard, WebhookRateLimitGuard } from '../auth.guards.js';
import type { MarkRemindersDto, QueryRequestDto } from '../dto/query.dto.js';

@Controller('api')
export class HealthController {
  @Get('health')
  health() {
    return { ok: true, service: 'knowledge-base' };
  }
}

@Controller('api')
@UseGuards(AccessTokenAuthGuard)
export class DashboardController {
  constructor(
    private readonly buildDashboard: BuildDashboardUseCase,
    private readonly getNoteDetail: GetNoteDetailUseCase,
    private readonly queryKnowledge: QueryKnowledgeUseCase,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.buildDashboard.execute(user.id);
  }

  @Get('projects')
  async projects(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, projects: (await this.buildDashboard.execute(user.id)).projects };
  }

  @Get('workspaces')
  async workspaces(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, workspaces: (await this.buildDashboard.execute(user.id)).workspaces };
  }

  @Get('notes')
  async notes(@CurrentUser() user: AuthenticatedUser) {
    return { ok: true, notes: (await this.buildDashboard.execute(user.id)).notes };
  }

  @Get('notes/:id')
  async note(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const note = await this.getNoteDetail.execute(user.id, id);
    if (!note) throw new NotFoundException('note_not_found');
    return { ok: true, note };
  }

  @Get('query')
  query(@Query() query: QueryRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.queryKnowledge.execute({
      ...query,
      limit: Number(query.limit || 5),
    }, user.id);
  }

  @Post('query')
  @UseGuards(TrustedOriginGuard)
  queryPost(@Body() body: QueryRequestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.queryKnowledge.execute(body, user.id);
  }
}

@Controller('api')
@UseGuards(AccessTokenAuthGuard)
export class OperationsController {
  constructor(
    private readonly ingestEntry: IngestEntryUseCase,
    private readonly onboarding: RunOnboardingUseCase,
    private readonly conversation: ProcessConversationUseCase,
    private readonly reminderDispatch: BuildReminderDispatchUseCase,
    private readonly markReminders: MarkReminderAsSentUseCase,
  ) {}

  @Post('ingest')
  @UseGuards(TrustedOriginGuard)
  ingest(@Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    return this.ingestEntry.execute(body, user.id);
  }

  @Post('onboarding')
  @UseGuards(TrustedOriginGuard)
  runOnboarding(@Body() body: unknown) {
    return this.onboarding.execute(body);
  }

  @Post('conversation')
  @UseGuards(TrustedOriginGuard)
  processConversation(@Body() body: unknown) {
    return this.conversation.execute(body);
  }

  @Get('reminders/dispatch')
  remindersDispatch(@Query('mode') mode: 'daily' | 'exact' = 'daily') {
    return this.reminderDispatch.execute(mode === 'exact' ? 'exact' : 'daily');
  }

  @Post('reminders/mark-sent')
  @UseGuards(TrustedOriginGuard)
  remindersMarkSent(@Body() body: MarkRemindersDto) {
    return this.markReminders.execute(Array.isArray(body.ids) ? body.ids : []);
  }
}

@Controller('api/webhooks')
@UseGuards(WebhookRateLimitGuard)
export class WebhookController {
  constructor(
    private readonly githubPush: HandleGithubPushUseCase,
    private readonly whatsappWebhook: HandleWhatsappWebhookUseCase,
  ) {}

  @Post('github/push')
  github(@Body() body: unknown, @Req() request: Request & { rawBody?: Buffer }) {
    return this.githubPush.execute({
      headers: request.headers,
      body,
      rawBody: request.rawBody?.toString('utf8') || JSON.stringify(body || {}),
    });
  }

  @Post('whatsapp')
  whatsapp(@Body() body: unknown, @Req() request: Request) {
    return this.whatsappWebhook.execute({ headers: request.headers, body });
  }
}
