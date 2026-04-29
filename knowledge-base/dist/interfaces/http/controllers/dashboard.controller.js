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
import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { BuildDashboardUseCase, GetNoteDetailUseCase, QueryKnowledgeUseCase } from '../../../application/use-cases/index.js';
import { CurrentUser } from '../auth.decorators.js';
import { AccessTokenAuthGuard, TrustedOriginGuard } from '../auth.guards.js';
import { queryRequestSchema } from '../dto/query.dto.js';
import { ZodValidationPipe } from '../zod-validation.pipe.js';
const noteIdParamSchema = z.object({
    id: z.string().trim().min(1),
});
let DashboardController = class DashboardController {
    buildDashboard;
    getNoteDetail;
    queryKnowledge;
    constructor(buildDashboard, getNoteDetail, queryKnowledge) {
        this.buildDashboard = buildDashboard;
        this.getNoteDetail = getNoteDetail;
        this.queryKnowledge = queryKnowledge;
    }
    dashboard(user) {
        return this.buildDashboard.execute(user.id);
    }
    async projects(user) {
        return { ok: true, projects: (await this.buildDashboard.execute(user.id)).projects };
    }
    async workspaces(user) {
        return { ok: true, workspaces: (await this.buildDashboard.execute(user.id)).workspaces };
    }
    async notes(user) {
        return { ok: true, notes: (await this.buildDashboard.execute(user.id)).notes };
    }
    async note(params, user) {
        const note = await this.getNoteDetail.execute(user.id, params.id);
        if (!note)
            throw new NotFoundException('note_not_found');
        return { ok: true, note };
    }
    query(query, user) {
        return this.queryKnowledge.execute(query, user.id);
    }
    queryPost(body, user) {
        return this.queryKnowledge.execute(body, user.id);
    }
};
__decorate([
    Get('dashboard'),
    __param(0, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DashboardController.prototype, "dashboard", null);
__decorate([
    Get('projects'),
    __param(0, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DashboardController.prototype, "projects", null);
__decorate([
    Get('workspaces'),
    __param(0, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DashboardController.prototype, "workspaces", null);
__decorate([
    Get('notes'),
    __param(0, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DashboardController.prototype, "notes", null);
__decorate([
    Get('notes/:id'),
    __param(0, Param(new ZodValidationPipe(noteIdParamSchema, 'invalid_note_id'))),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], DashboardController.prototype, "note", null);
__decorate([
    Get('query'),
    __param(0, Query(new ZodValidationPipe(queryRequestSchema, 'invalid_query_payload'))),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], DashboardController.prototype, "query", null);
__decorate([
    Post('query'),
    UseGuards(TrustedOriginGuard),
    __param(0, Body(new ZodValidationPipe(queryRequestSchema, 'invalid_query_payload'))),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], DashboardController.prototype, "queryPost", null);
DashboardController = __decorate([
    Controller('api'),
    UseGuards(AccessTokenAuthGuard),
    __metadata("design:paramtypes", [BuildDashboardUseCase,
        GetNoteDetailUseCase,
        QueryKnowledgeUseCase])
], DashboardController);
export { DashboardController };
