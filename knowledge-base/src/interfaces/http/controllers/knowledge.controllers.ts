import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import {
  BuildDashboardUseCase,
  BuildReminderDispatchUseCase,
  GetNoteDetailUseCase,
  HandleGithubPushUseCase,
  IngestEntryUseCase,
  MarkReminderAsSentUseCase,
  ProcessConversationUseCase,
  QueryKnowledgeUseCase,
  RunOnboardingUseCase,
} from '../../../application/use-cases/dashboard.use-cases.js';
import type { MarkRemindersDto, QueryRequestDto } from '../dto/query.dto.js';

@Controller('api')
export class HealthController {
  @Get('health')
  health() {
    return { ok: true, service: 'knowledge-base' };
  }
}

@Controller('api')
export class DashboardController {
  constructor(
    private readonly buildDashboard: BuildDashboardUseCase,
    private readonly getNoteDetail: GetNoteDetailUseCase,
    private readonly queryKnowledge: QueryKnowledgeUseCase,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.buildDashboard.execute();
  }

  @Get('projects')
  async projects() {
    return { ok: true, projects: (await this.buildDashboard.execute()).projects };
  }

  @Get('workspaces')
  async workspaces() {
    return { ok: true, workspaces: (await this.buildDashboard.execute()).workspaces };
  }

  @Get('notes')
  async notes() {
    return { ok: true, notes: (await this.buildDashboard.execute()).notes };
  }

  @Get('notes/:id')
  async note(@Param('id') id: string) {
    const note = await this.getNoteDetail.execute(id);
    if (!note) throw new NotFoundException('note_not_found');
    return { ok: true, note };
  }

  @Get('query')
  query(@Query() query: QueryRequestDto) {
    return this.queryKnowledge.execute({
      ...query,
      limit: Number(query.limit || 5),
    });
  }

  @Post('query')
  queryPost(@Body() body: QueryRequestDto) {
    return this.queryKnowledge.execute(body);
  }
}

@Controller('api')
export class OperationsController {
  constructor(
    private readonly ingestEntry: IngestEntryUseCase,
    private readonly onboarding: RunOnboardingUseCase,
    private readonly conversation: ProcessConversationUseCase,
    private readonly reminderDispatch: BuildReminderDispatchUseCase,
    private readonly markReminders: MarkReminderAsSentUseCase,
  ) {}

  @Post('ingest')
  ingest(@Body() body: unknown) {
    return this.ingestEntry.execute(body);
  }

  @Post('onboarding')
  runOnboarding(@Body() body: unknown) {
    return this.onboarding.execute(body);
  }

  @Post('conversation')
  processConversation(@Body() body: unknown) {
    return this.conversation.execute(body);
  }

  @Get('reminders/dispatch')
  remindersDispatch(@Query('mode') mode: 'daily' | 'exact' = 'daily') {
    return this.reminderDispatch.execute(mode === 'exact' ? 'exact' : 'daily');
  }

  @Post('reminders/mark-sent')
  remindersMarkSent(@Body() body: MarkRemindersDto) {
    return this.markReminders.execute(Array.isArray(body.ids) ? body.ids : []);
  }
}

@Controller('api/webhooks')
export class WebhookController {
  constructor(
    private readonly githubPush: HandleGithubPushUseCase,
    private readonly conversation: ProcessConversationUseCase,
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
  whatsapp(@Body() body: unknown) {
    return this.conversation.execute(body);
  }
}
