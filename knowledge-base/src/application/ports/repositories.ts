import type { ReminderView } from '../models/reminder.models.js';
import type {
  ExternalIdentityRecord,
  IntegrationCredentialRecord,
  KbUser,
  NoteRecord,
  SaveNoteInput,
  SaveProjectInput,
  SaveWorkspaceInput,
  WebhookEventRecord,
  WebhookEventStatus,
} from '../models/repository-records.models.js';
import type { ReviewView } from '../models/review.models.js';
import type { VaultNoteDetail, VaultNoteSummary } from '../models/vault-note.models.js';

export abstract class SchemaMigrator {
  abstract migrate(): Promise<void>;
}

export abstract class UserRepository {
  abstract findUserByEmail(email: string): Promise<KbUser | null>;
  abstract findUserById(id: string): Promise<KbUser | null>;
  abstract createUser(input: { email: string; displayName?: string; passwordHash: string; role: string }): Promise<KbUser>;
}

export abstract class CredentialRepository {
  abstract listCredentials(userId: string, workspaceSlug: string): Promise<IntegrationCredentialRecord[]>;
  abstract upsertCredential(
    input: Pick<IntegrationCredentialRecord, 'userId' | 'workspaceSlug' | 'provider' | 'status' | 'encryptedConfig' | 'publicMetadata'>,
  ): Promise<IntegrationCredentialRecord>;
  abstract revokeCredential(userId: string, workspaceSlug: string, provider: string, encryptedConfig: unknown): Promise<IntegrationCredentialRecord | null>;
  abstract findCredential(userId: string, workspaceSlug: string, provider: string): Promise<IntegrationCredentialRecord | null>;
}

export abstract class ExternalIdentityRepository {
  abstract findExternalIdentity(provider: string, identityType: string, externalId: string): Promise<ExternalIdentityRecord | null>;
  abstract upsertExternalIdentity(input: {
    userId: string;
    workspaceSlug: string;
    provider: string;
    identityType: string;
    externalId: string;
    credentialId?: string | null;
    verifiedAt?: string | null;
    metadata?: Record<string, unknown>;
    publicMetadata: Record<string, unknown>;
  }): Promise<ExternalIdentityRecord>;
}

export abstract class ContentRepository {
  abstract listWorkspaces(userId: string): Promise<SaveWorkspaceInput[]>;
  abstract upsertWorkspace(userId: string, input: SaveWorkspaceInput): Promise<SaveWorkspaceInput>;
  abstract listProjects(userId: string): Promise<SaveProjectInput[]>;
  abstract upsertProject(userId: string, input: SaveProjectInput): Promise<SaveProjectInput>;
  abstract listNotes(userId: string): Promise<NoteRecord[]>;
  abstract getNoteById(userId: string, id: string): Promise<NoteRecord | null>;
  abstract upsertNote(userId: string, input: SaveNoteInput): Promise<NoteRecord>;
}

export abstract class ContentQueryRepository {
  abstract list(userId: string): Promise<VaultNoteSummary[]>;
  abstract getById(userId: string, id: string): Promise<VaultNoteDetail | null>;
  abstract listReviews(userId: string): Promise<ReviewView[]>;
  abstract listReminders(userId: string): Promise<ReminderView[]>;
}

export abstract class WebhookEventRepository {
  abstract recordWebhookEvent(input: {
    provider: string;
    eventType: string;
    status: WebhookEventStatus;
    resolvedUserId?: string | null;
    externalIdentity?: Record<string, unknown>;
    rawHeaders?: Record<string, unknown>;
    rawPayload?: unknown;
    error?: string;
  }): Promise<WebhookEventRecord>;
}
