var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { ContentQueryRepository, ContentRepository } from '../../ports/repositories.js';
import { buildDashboardHome } from '../../utils/dashboard-home.utils.js';
export { buildDashboardHome };
let BuildDashboardUseCase = class BuildDashboardUseCase {
    contentRepository;
    contentQueryRepository;
    constructor(contentRepository, contentQueryRepository) {
        this.contentRepository = contentRepository;
        this.contentQueryRepository = contentQueryRepository;
    }
    async execute(userId) {
        const [workspaces, projects, notes, reviews, reminders] = await Promise.all([
            this.contentRepository.listWorkspaces(userId),
            this.contentRepository.listProjects(userId),
            this.contentQueryRepository.list(userId),
            this.contentQueryRepository.listReviews(userId),
            this.contentQueryRepository.listReminders(userId),
        ]);
        return { workspaces, projects, notes, reviews, reminders, home: buildDashboardHome(projects, notes, reviews, reminders) };
    }
};
BuildDashboardUseCase = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ContentRepository,
        ContentQueryRepository])
], BuildDashboardUseCase);
export { BuildDashboardUseCase };
