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
import { readEnvironment } from '../../../adapters/environment.js';
import { OnboardingOperation } from '../../../contracts/enums.js';
import { ContentRepository } from '../../ports/repositories.js';
let RunOnboardingUseCase = class RunOnboardingUseCase {
    contentRepository;
    constructor(contentRepository) {
        this.contentRepository = contentRepository;
    }
    async execute(input, userId) {
        if (input.operation === OnboardingOperation.Upsert) {
            await this.contentRepository.upsertWorkspace(userId, {
                workspaceSlug: input.workspaceSlug,
                displayName: input.displayName || input.workspaceSlug,
                whatsappGroupJid: input.whatsappGroupJid,
                telegramChatId: input.telegramChatId,
                githubRepos: input.githubRepos,
                projectSlugs: input.projects.map((project) => project.projectSlug),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });
            for (const project of input.projects) {
                await this.contentRepository.upsertProject(userId, {
                    projectSlug: project.projectSlug,
                    displayName: project.displayName,
                    repoFullName: project.repoFullName,
                    workspaceSlug: input.workspaceSlug,
                    aliases: project.aliases,
                    defaultTags: project.defaultTags,
                    enabled: true,
                });
            }
        }
        const [workspaces, projects] = await Promise.all([
            this.contentRepository.listWorkspaces(userId),
            this.contentRepository.listProjects(userId),
        ]);
        return {
            ok: true,
            operation: input.operation,
            workspaceSlug: input.workspaceSlug,
            workspaces,
            projects,
            links: {
                api: readEnvironment().publicBaseUrl ? `${readEnvironment().publicBaseUrl}/api` : '',
                queryReady: true,
            },
        };
    }
};
RunOnboardingUseCase = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ContentRepository])
], RunOnboardingUseCase);
export { RunOnboardingUseCase };
