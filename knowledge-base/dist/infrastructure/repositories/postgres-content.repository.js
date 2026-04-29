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
import { KnowledgeStore } from '../../application/knowledge-store.js';
import { ContentQueryRepository } from '../../application/ports/repositories.js';
function noteSummary(record) {
    return {
        id: record.id,
        path: record.path,
        type: record.type,
        title: record.title,
        project: record.projectSlug,
        workspace: record.workspaceSlug,
        tags: record.tags,
        date: record.occurredAt,
        status: record.status,
        summary: record.summary,
        source: record.source || record.sourceChannel,
    };
}
function noteDetail(record) {
    return {
        ...noteSummary(record),
        markdown: record.markdown,
        frontmatter: record.frontmatter,
        links: record.links,
        origin: record.origin,
    };
}
function reviewFromNote(record) {
    if (record.type !== 'event' && record.metadata.eventType !== 'code_review')
        return null;
    if (record.metadata.eventType !== 'code_review' && record.sourceChannel !== 'github-push')
        return null;
    const findings = Array.isArray(record.metadata.reviewFindings) ? record.metadata.reviewFindings : [];
    return {
        id: record.id,
        title: record.title,
        repo: String(record.metadata.repoFullName || ''),
        project: record.projectSlug,
        branch: String(record.metadata.branch || ''),
        date: record.occurredAt,
        status: record.status,
        summary: record.summary,
        impact: String(record.metadata.impact || ''),
        changedFiles: Array.isArray(record.metadata.changedFiles) ? record.metadata.changedFiles.map((item) => String(item)) : [],
        generatedNotePath: record.path,
        findings: findings.map((entry) => {
            const finding = entry;
            return {
                severity: String(finding.severity || 'medium'),
                file: String(finding.file || ''),
                line: Number(finding.line || 0),
                summary: String(finding.summary || ''),
                recommendation: String(finding.recommendation || ''),
                status: String(finding.status || 'open'),
            };
        }),
    };
}
function reminderFromNote(record) {
    if (record.type !== 'reminder')
        return null;
    return {
        id: record.id,
        title: record.title,
        project: record.projectSlug,
        workspace: record.workspaceSlug,
        status: record.status,
        reminderDate: String(record.metadata.reminderDate || ''),
        reminderTime: String(record.metadata.reminderTime || ''),
        reminderAt: String(record.metadata.reminderAt || ''),
        relativePath: record.path,
        sourceNotePath: String(record.metadata.sourceNotePath || ''),
    };
}
let PostgresContentQueryRepository = class PostgresContentQueryRepository extends ContentQueryRepository {
    store;
    constructor(store) {
        super();
        this.store = store;
    }
    async list(userId) {
        return (await this.store.listNotes(userId)).map(noteSummary);
    }
    async getById(userId, id) {
        const note = await this.store.getNoteById(userId, id);
        return note ? noteDetail(note) : null;
    }
    async listReviews(userId) {
        return (await this.store.listNotes(userId)).map(reviewFromNote).filter((review) => Boolean(review));
    }
    async listReminders(userId) {
        return (await this.store.listNotes(userId)).map(reminderFromNote).filter((reminder) => Boolean(reminder));
    }
};
PostgresContentQueryRepository = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [KnowledgeStore])
], PostgresContentQueryRepository);
export { PostgresContentQueryRepository };
