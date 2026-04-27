import crypto from 'node:crypto';

import { Injectable } from '@nestjs/common';
import pg from 'pg';

import { readEnvironment } from '../../adapters/environment.js';
import {
  KnowledgeStore,
  type ExternalIdentityRecord,
  type IntegrationCredentialRecord,
  type KbUser,
} from '../../application/knowledge-store.js';

const { Pool } = pg;

type Row = Record<string, unknown>;

function nowIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value || new Date().toISOString());
}

function userFromRow(row: Row): KbUser {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    role: String(row.role),
    createdAt: nowIso(row.created_at),
    updatedAt: nowIso(row.updated_at),
  };
}

function credentialFromRow(row: Row): IntegrationCredentialRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    workspaceSlug: String(row.workspace_slug),
    provider: String(row.provider),
    status: String(row.status) === 'revoked' ? 'revoked' : 'connected',
    encryptedConfig: row.encrypted_config,
    publicMetadata: (row.public_metadata || {}) as Record<string, unknown>,
    createdAt: nowIso(row.created_at),
    updatedAt: nowIso(row.updated_at),
    revokedAt: row.revoked_at ? nowIso(row.revoked_at) : null,
  };
}

function identityFromRow(row: Row): ExternalIdentityRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    provider: String(row.provider),
    externalId: String(row.external_id),
    publicMetadata: (row.public_metadata || {}) as Record<string, unknown>,
    createdAt: nowIso(row.created_at),
    updatedAt: nowIso(row.updated_at),
  };
}

@Injectable()
export class PostgresKnowledgeStore extends KnowledgeStore {
  private pool: pg.Pool | null = null;

  private getPool() {
    if (this.pool) return this.pool;
    const connectionString = readEnvironment().databaseUrl;
    if (!connectionString) throw new Error('KB_DATABASE_URL_not_configured');
    this.pool = new Pool({ connectionString });
    return this.pool;
  }

  async migrate() {
    if (!readEnvironment().databaseUrl) return;
    await this.getPool().query(`
      create table if not exists kb_users (
        id uuid primary key,
        email text not null,
        password_hash text not null,
        role text not null default 'user',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create unique index if not exists kb_users_email_lower_idx on kb_users (lower(email));

      create table if not exists kb_integration_credentials (
        id uuid primary key,
        user_id uuid not null references kb_users(id) on delete cascade,
        workspace_slug text not null,
        provider text not null,
        status text not null default 'connected',
        encrypted_config jsonb not null,
        public_metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        revoked_at timestamptz
      );
      create unique index if not exists kb_integration_credentials_scope_idx
        on kb_integration_credentials (user_id, workspace_slug, provider);

      create table if not exists kb_external_identities (
        id uuid primary key,
        user_id uuid not null references kb_users(id) on delete cascade,
        provider text not null,
        external_id text not null,
        public_metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create unique index if not exists kb_external_identities_provider_external_idx
        on kb_external_identities (provider, external_id);
    `);
  }

  async findUserByEmail(email: string) {
    const result = await this.getPool().query('select * from kb_users where lower(email) = lower($1) limit 1', [email]);
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async findUserById(id: string) {
    const result = await this.getPool().query('select * from kb_users where id = $1 limit 1', [id]);
    return result.rows[0] ? userFromRow(result.rows[0]) : null;
  }

  async createUser(input: { email: string; passwordHash: string; role: string }) {
    const result = await this.getPool().query(
      `insert into kb_users (id, email, password_hash, role)
       values ($1, $2, $3, $4)
       returning *`,
      [crypto.randomUUID(), input.email.trim().toLowerCase(), input.passwordHash, input.role],
    );
    return userFromRow(result.rows[0]);
  }

  async listCredentials(userId: string, workspaceSlug: string) {
    const result = await this.getPool().query(
      'select * from kb_integration_credentials where user_id = $1 and workspace_slug = $2 order by provider',
      [userId, workspaceSlug],
    );
    return result.rows.map(credentialFromRow);
  }

  async upsertCredential(input: Pick<IntegrationCredentialRecord, 'userId' | 'workspaceSlug' | 'provider' | 'status' | 'encryptedConfig' | 'publicMetadata'>) {
    const result = await this.getPool().query(
      `insert into kb_integration_credentials (id, user_id, workspace_slug, provider, status, encrypted_config, public_metadata, revoked_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, null)
       on conflict (user_id, workspace_slug, provider)
       do update set
         status = excluded.status,
         encrypted_config = excluded.encrypted_config,
         public_metadata = excluded.public_metadata,
         updated_at = now(),
         revoked_at = null
       returning *`,
      [
        crypto.randomUUID(),
        input.userId,
        input.workspaceSlug,
        input.provider,
        input.status,
        JSON.stringify(input.encryptedConfig),
        JSON.stringify(input.publicMetadata),
      ],
    );
    return credentialFromRow(result.rows[0]);
  }

  async revokeCredential(userId: string, workspaceSlug: string, provider: string) {
    const result = await this.getPool().query(
      `update kb_integration_credentials
       set status = 'revoked', revoked_at = now(), updated_at = now()
       where user_id = $1 and workspace_slug = $2 and provider = $3
       returning *`,
      [userId, workspaceSlug, provider],
    );
    return result.rows[0] ? credentialFromRow(result.rows[0]) : null;
  }

  async findCredential(userId: string, workspaceSlug: string, provider: string) {
    const result = await this.getPool().query(
      'select * from kb_integration_credentials where user_id = $1 and workspace_slug = $2 and provider = $3 limit 1',
      [userId, workspaceSlug, provider],
    );
    return result.rows[0] ? credentialFromRow(result.rows[0]) : null;
  }

  async findExternalIdentity(provider: string, externalId: string) {
    const result = await this.getPool().query(
      'select * from kb_external_identities where provider = $1 and external_id = $2 limit 1',
      [provider, externalId],
    );
    return result.rows[0] ? identityFromRow(result.rows[0]) : null;
  }

  async upsertExternalIdentity(input: { userId: string; provider: string; externalId: string; publicMetadata: Record<string, unknown> }) {
    const result = await this.getPool().query(
      `insert into kb_external_identities (id, user_id, provider, external_id, public_metadata)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (provider, external_id)
       do update set user_id = excluded.user_id, public_metadata = excluded.public_metadata, updated_at = now()
       returning *`,
      [crypto.randomUUID(), input.userId, input.provider, input.externalId, JSON.stringify(input.publicMetadata)],
    );
    return identityFromRow(result.rows[0]);
  }
}
