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
import { ReminderDispatchMode } from '../../../contracts/enums.js';
import { slugify } from '../../../domain/strings.js';
import { currentSaoPauloDateTime } from '../../../domain/time.js';
import { ReminderDispatchRepository } from '../../ports/repositories.js';
let MarkReminderAsSentUseCase = class MarkReminderAsSentUseCase {
    reminderDispatchRepository;
    constructor(reminderDispatchRepository) {
        this.reminderDispatchRepository = reminderDispatchRepository;
    }
    async execute(ids, userId, workspaceSlug = 'default', mode = ReminderDispatchMode.Exact, dispatchKey = currentSaoPauloDateTime().date) {
        const workspace = slugify(workspaceSlug) || 'default';
        const uniqueIds = Array.from(new Set(ids.map((id) => String(id || '').trim()).filter(Boolean)));
        await Promise.all(uniqueIds.map((id) => this.reminderDispatchRepository.markSent(userId, workspace, mode, dispatchKey, id)));
        return { ok: true, marked: uniqueIds.length };
    }
};
MarkReminderAsSentUseCase = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ReminderDispatchRepository])
], MarkReminderAsSentUseCase);
export { MarkReminderAsSentUseCase };
