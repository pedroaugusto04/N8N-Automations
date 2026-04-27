import crypto from 'node:crypto';

export type KbUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationCredentialRecord = {
  id: string;
  userId: string;
  workspaceSlug: string;
  provider: string;
  status: 'connected' | 'revoked';
  encryptedConfig: unknown;
  publicMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

export type ExternalIdentityRecord = {
  id: string;
  userId: string;
  provider: string;
  externalId: string;
  publicMetadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export abstract class KnowledgeStore {
  abstract migrate(): Promise<void>;
  abstract findUserByEmail(email: string): Promise<KbUser | null>;
  abstract findUserById(id: string): Promise<KbUser | null>;
  abstract createUser(input: { email: string; passwordHash: string; role: string }): Promise<KbUser>;
  abstract listCredentials(userId: string, workspaceSlug: string): Promise<IntegrationCredentialRecord[]>;
  abstract upsertCredential(
    input: Pick<IntegrationCredentialRecord, 'userId' | 'workspaceSlug' | 'provider' | 'status' | 'encryptedConfig' | 'publicMetadata'>,
  ): Promise<IntegrationCredentialRecord>;
  abstract revokeCredential(userId: string, workspaceSlug: string, provider: string): Promise<IntegrationCredentialRecord | null>;
  abstract findCredential(userId: string, workspaceSlug: string, provider: string): Promise<IntegrationCredentialRecord | null>;
  abstract findExternalIdentity(provider: string, externalId: string): Promise<ExternalIdentityRecord | null>;
  abstract upsertExternalIdentity(input: { userId: string; provider: string; externalId: string; publicMetadata: Record<string, unknown> }): Promise<ExternalIdentityRecord>;
}

export class MemoryKnowledgeStore extends KnowledgeStore {
  private users = new Map<string, KbUser>();
  private credentials = new Map<string, IntegrationCredentialRecord>();
  private identities = new Map<string, ExternalIdentityRecord>();

  async migrate() {}

  async findUserByEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    return Array.from(this.users.values()).find((user) => user.email === normalized) || null;
  }

  async findUserById(id: string) {
    return this.users.get(id) || null;
  }

  async createUser(input: { email: string; passwordHash: string; role: string }) {
    const now = new Date().toISOString();
    const user: KbUser = {
      id: crypto.randomUUID(),
      email: input.email.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      role: input.role,
      createdAt: now,
      updatedAt: now,
    };
    this.users.set(user.id, user);
    return user;
  }

  async listCredentials(userId: string, workspaceSlug: string) {
    return Array.from(this.credentials.values()).filter((credential) => credential.userId === userId && credential.workspaceSlug === workspaceSlug);
  }

  async upsertCredential(input: Pick<IntegrationCredentialRecord, 'userId' | 'workspaceSlug' | 'provider' | 'status' | 'encryptedConfig' | 'publicMetadata'>) {
    const key = credentialKey(input.userId, input.workspaceSlug, input.provider);
    const existing = this.credentials.get(key);
    const now = new Date().toISOString();
    const credential: IntegrationCredentialRecord = {
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

  async revokeCredential(userId: string, workspaceSlug: string, provider: string) {
    const key = credentialKey(userId, workspaceSlug, provider);
    const existing = this.credentials.get(key);
    if (!existing) return null;
    const revoked = { ...existing, status: 'revoked' as const, updatedAt: new Date().toISOString(), revokedAt: new Date().toISOString() };
    this.credentials.set(key, revoked);
    return revoked;
  }

  async findCredential(userId: string, workspaceSlug: string, provider: string) {
    return this.credentials.get(credentialKey(userId, workspaceSlug, provider)) || null;
  }

  async findExternalIdentity(provider: string, externalId: string) {
    return this.identities.get(identityKey(provider, externalId)) || null;
  }

  async upsertExternalIdentity(input: { userId: string; provider: string; externalId: string; publicMetadata: Record<string, unknown> }) {
    const key = identityKey(input.provider, input.externalId);
    const existing = this.identities.get(key);
    const now = new Date().toISOString();
    const identity: ExternalIdentityRecord = {
      id: existing?.id || crypto.randomUUID(),
      userId: input.userId,
      provider: input.provider,
      externalId: input.externalId,
      publicMetadata: input.publicMetadata,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    this.identities.set(key, identity);
    return identity;
  }
}

function credentialKey(userId: string, workspaceSlug: string, provider: string): string {
  return `${userId}:${workspaceSlug}:${provider}`;
}

function identityKey(provider: string, externalId: string): string {
  return `${provider}:${externalId}`;
}
