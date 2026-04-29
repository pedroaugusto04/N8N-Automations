import crypto from 'node:crypto';
import { CredentialRecordStatus } from '../contracts/enums.js';
export class KnowledgeStore {
}
export class MemoryKnowledgeStore extends KnowledgeStore {
    users = new Map();
    credentials = new Map();
    identities = new Map();
    workspaces = new Map();
    projects = new Map();
    notes = new Map();
    attachments = new Map();
    webhookEvents = new Map();
    conversationStates = new Map();
    reminderDispatch = new Set();
    async migrate() { }
    async findUserByEmail(email) {
        const normalized = email.trim().toLowerCase();
        return Array.from(this.users.values()).find((user) => user.email === normalized) || null;
    }
    async findUserById(id) {
        return this.users.get(id) || null;
    }
    async createUser(input) {
        const now = new Date().toISOString();
        const user = {
            id: crypto.randomUUID(),
            email: input.email.trim().toLowerCase(),
            displayName: String(input.displayName || input.email.split('@')[0] || 'User').trim(),
            passwordHash: input.passwordHash,
            role: input.role,
            createdAt: now,
            updatedAt: now,
        };
        this.users.set(user.id, user);
        return user;
    }
    async listCredentials(userId, workspaceSlug) {
        return Array.from(this.credentials.values()).filter((credential) => credential.userId === userId && credential.workspaceSlug === workspaceSlug);
    }
    async upsertCredential(input) {
        const key = credentialKey(input.userId, input.workspaceSlug, input.provider);
        const existing = this.credentials.get(key);
        const now = new Date().toISOString();
        const credential = {
            id: existing?.id || crypto.randomUUID(),
            userId: input.userId,
            workspaceSlug: input.workspaceSlug,
            provider: input.provider,
            status: input.status,
            encryptedConfig: input.encryptedConfig,
            publicMetadata: input.publicMetadata,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            revokedAt: null,
        };
        this.credentials.set(key, credential);
        return credential;
    }
    async revokeCredential(userId, workspaceSlug, provider, encryptedConfig) {
        const key = credentialKey(userId, workspaceSlug, provider);
        const existing = this.credentials.get(key);
        if (!existing)
            return null;
        const revoked = { ...existing, status: CredentialRecordStatus.Revoked, encryptedConfig, updatedAt: new Date().toISOString(), revokedAt: new Date().toISOString() };
        this.credentials.set(key, revoked);
        return revoked;
    }
    async findCredential(userId, workspaceSlug, provider) {
        return this.credentials.get(credentialKey(userId, workspaceSlug, provider)) || null;
    }
    async findExternalIdentity(provider, identityType, externalId) {
        return this.identities.get(identityKey(provider, identityType, externalId)) || null;
    }
    async upsertExternalIdentity(input) {
        const key = identityKey(input.provider, input.identityType, input.externalId);
        const existing = this.identities.get(key);
        const now = new Date().toISOString();
        const identity = {
            id: existing?.id || crypto.randomUUID(),
            userId: input.userId,
            workspaceSlug: input.workspaceSlug,
            provider: input.provider,
            identityType: input.identityType,
            externalId: input.externalId,
            credentialId: input.credentialId || existing?.credentialId || null,
            verifiedAt: input.verifiedAt || existing?.verifiedAt || now,
            metadata: input.metadata || existing?.metadata || {},
            publicMetadata: input.publicMetadata,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
        };
        this.identities.set(key, identity);
        return identity;
    }
    async listWorkspaces(userId) {
        return Array.from(this.workspaces.entries())
            .filter(([key]) => key.startsWith(`${userId}:`))
            .map(([, workspace]) => workspace);
    }
    async upsertWorkspace(userId, input) {
        const key = `${userId}:${input.workspaceSlug}`;
        const existing = this.workspaces.get(key);
        const now = new Date().toISOString();
        const workspace = {
            ...input,
            createdAt: existing?.createdAt || input.createdAt || now,
            updatedAt: now,
        };
        this.workspaces.set(key, workspace);
        return workspace;
    }
    async listProjects(userId) {
        return Array.from(this.projects.entries())
            .filter(([key]) => key.startsWith(`${userId}:`))
            .map(([, project]) => project);
    }
    async upsertProject(userId, input) {
        const project = { ...input };
        this.projects.set(`${userId}:${project.projectSlug}`, project);
        return project;
    }
    async listNotes(userId) {
        return Array.from(this.notes.entries())
            .filter(([key]) => key.startsWith(`${userId}:`))
            .map(([, note]) => note);
    }
    async getNoteById(userId, id) {
        return this.notes.get(`${userId}:${id}`) || null;
    }
    async upsertNote(userId, input) {
        const id = input.id || crypto.randomUUID();
        const note = { ...input, id };
        this.notes.set(`${userId}:${id}`, note);
        return note;
    }
    async saveAttachment(userId, input) {
        const now = new Date().toISOString();
        const attachment = {
            id: input.id || crypto.randomUUID(),
            userId,
            noteId: input.noteId,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
            contentBase64: input.contentBase64,
            checksumSha256: input.checksumSha256,
            metadata: input.metadata,
            createdAt: now,
        };
        this.attachments.set(`${userId}:${attachment.noteId}:${attachment.id}`, attachment);
        return attachment;
    }
    async listAttachments(userId, noteId) {
        return Array.from(this.attachments.values()).filter((attachment) => attachment.userId === userId && attachment.noteId === noteId);
    }
    async recordWebhookEvent(input) {
        const now = new Date().toISOString();
        const event = {
            id: crypto.randomUUID(),
            provider: input.provider,
            eventType: input.eventType,
            status: input.status,
            resolvedUserId: input.resolvedUserId || null,
            externalIdentity: input.externalIdentity || {},
            rawHeaders: input.rawHeaders || {},
            rawPayload: input.rawPayload || {},
            error: input.error || '',
            createdAt: now,
            updatedAt: now,
        };
        this.webhookEvents.set(event.id, event);
        return event;
    }
    async get(userId, workspaceSlug, conversationKey) {
        return this.conversationStates.get(stateKey(userId, workspaceSlug, conversationKey)) || null;
    }
    async upsert(userId, workspaceSlug, conversationKey, state) {
        const record = {
            userId,
            workspaceSlug,
            conversationKey,
            state,
            updatedAt: new Date().toISOString(),
        };
        this.conversationStates.set(stateKey(userId, workspaceSlug, conversationKey), record);
        return record;
    }
    async clear(userId, workspaceSlug, conversationKey) {
        this.conversationStates.delete(stateKey(userId, workspaceSlug, conversationKey));
    }
    async hasSent(userId, workspaceSlug, mode, dispatchKey, reminderId) {
        return this.reminderDispatch.has(dispatchKeyForReminder(userId, workspaceSlug, mode, dispatchKey, reminderId));
    }
    async markSent(userId, workspaceSlug, mode, dispatchKey, reminderId) {
        this.reminderDispatch.add(dispatchKeyForReminder(userId, workspaceSlug, mode, dispatchKey, reminderId));
    }
}
function credentialKey(userId, workspaceSlug, provider) {
    return `${userId}:${workspaceSlug}:${provider}`;
}
function identityKey(provider, identityType, externalId) {
    return `${provider}:${identityType}:${externalId}`;
}
function stateKey(userId, workspaceSlug, conversationKey) {
    return `${userId}:${workspaceSlug}:${conversationKey}`;
}
function dispatchKeyForReminder(userId, workspaceSlug, mode, dispatchKey, reminderId) {
    return `${userId}:${workspaceSlug}:${mode}:${dispatchKey}:${reminderId}`;
}
