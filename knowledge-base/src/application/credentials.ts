import crypto from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';

import { readEnvironment } from '../adapters/environment.js';
import { KnowledgeStore, type IntegrationCredentialRecord } from './knowledge-store.js';

export const integrationProviders = [
  'telegram',
  'whatsapp',
  'evolution',
  'ai-review',
  'ai-conversation',
  'github',
  'github-app',
  'vault-git',
] as const;

export type IntegrationProvider = (typeof integrationProviders)[number];

export type EncryptedConfig = {
  iv: string;
  authTag: string;
  ciphertext: string;
  keyVersion: number;
};

export type StoredIntegration = {
  provider: IntegrationProvider;
  name: string;
  description: string;
  status: 'connected' | 'missing' | 'revoked';
  workspaceSlug: string;
  publicMetadata: Record<string, unknown>;
  maskedConfig: Record<string, string>;
  updatedAt: string | null;
  revokedAt: string | null;
};

const providerLabels: Record<IntegrationProvider, { name: string; description: string }> = {
  telegram: { name: 'Telegram', description: 'Bot e chat usados para notificacoes e eventos operacionais.' },
  whatsapp: { name: 'WhatsApp', description: 'Conta ou grupo autorizado para conversa e ingestao.' },
  evolution: { name: 'Evolution API', description: 'Instancia Evolution usada como transporte do WhatsApp.' },
  'ai-review': { name: 'AI Review', description: 'Provider, modelo e chave para reviews de codigo.' },
  'ai-conversation': { name: 'AI Conversation', description: 'Provider, modelo e chave para conversa e respostas.' },
  github: { name: 'GitHub Token', description: 'Token pessoal ou fine-grained para leitura de repositorios.' },
  'github-app': { name: 'GitHub App', description: 'App, instalacao e webhook por workspace.' },
  'vault-git': { name: 'Vault Git', description: 'Credenciais de sincronizacao remota do vault.' },
};

function isProvider(value: string): value is IntegrationProvider {
  return integrationProviders.includes(value as IntegrationProvider);
}

function encryptionKey(): Buffer {
  const key = Buffer.from(readEnvironment().credentialsEncryptionKey, 'base64');
  if (key.length !== 32) throw new Error('credentials_encryption_key_must_be_32_bytes_base64');
  return key;
}

export function encryptConfig(config: Record<string, unknown>): EncryptedConfig {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    keyVersion: 1,
  };
}

export function decryptConfig(encrypted: unknown): Record<string, unknown> {
  const payload = encrypted as EncryptedConfig;
  if (!payload?.iv || !payload.authTag || !payload.ciphertext) throw new Error('invalid_encrypted_config');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const cleartext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(cleartext) as Record<string, unknown>;
}

function configKeysFromMetadata(metadata: Record<string, unknown>): string[] {
  return Array.isArray(metadata.configKeys) ? metadata.configKeys.filter((key): key is string => typeof key === 'string') : [];
}

function publicCredential(record: IntegrationCredentialRecord | null, provider: IntegrationProvider, workspaceSlug: string): StoredIntegration {
  const label = providerLabels[provider];
  if (!record) {
    return {
      provider,
      name: label.name,
      description: label.description,
      status: 'missing',
      workspaceSlug,
      publicMetadata: {},
      maskedConfig: {},
      updatedAt: null,
      revokedAt: null,
    };
  }

  return {
    provider,
    name: label.name,
    description: label.description,
    status: record.status === 'connected' && !record.revokedAt ? 'connected' : 'revoked',
    workspaceSlug,
    publicMetadata: record.publicMetadata,
    maskedConfig: Object.fromEntries(configKeysFromMetadata(record.publicMetadata).map((key) => [key, '********'])),
    updatedAt: record.updatedAt,
    revokedAt: record.revokedAt,
  };
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('config_must_be_object');
  return value as Record<string, unknown>;
}

function sanitizePublicMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const metadata = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(metadata).filter(([, entry]) => typeof entry !== 'function'));
}

@Injectable()
export class IntegrationCredentialService {
  constructor(private readonly store: KnowledgeStore) {}

  async list(userId: string, workspaceSlug = 'default') {
    const records = await this.store.listCredentials(userId, workspaceSlug);
    return {
      ok: true as const,
      workspaceSlug,
      integrations: integrationProviders.map((provider) => publicCredential(records.find((record) => record.provider === provider) || null, provider, workspaceSlug)),
    };
  }

  async save(input: {
    userId: string;
    workspaceSlug?: string;
    provider: string;
    config: unknown;
    publicMetadata?: unknown;
    externalIdentities?: unknown;
  }) {
    if (!isProvider(input.provider)) throw new NotFoundException('provider_not_found');
    const workspaceSlug = input.workspaceSlug || 'default';
    const config = normalizeConfig(input.config);
    const publicMetadata = {
      ...sanitizePublicMetadata(input.publicMetadata),
      configKeys: Object.keys(config),
    };
    const record = await this.store.upsertCredential({
      userId: input.userId,
      workspaceSlug,
      provider: input.provider,
      status: 'connected',
      encryptedConfig: encryptConfig(config),
      publicMetadata,
    });

    if (Array.isArray(input.externalIdentities)) {
      for (const identity of input.externalIdentities) {
        if (!identity || typeof identity !== 'object') continue;
        const provider = String((identity as Record<string, unknown>).provider || '').trim();
        const externalId = String((identity as Record<string, unknown>).externalId || '').trim();
        if (!provider || !externalId) continue;
        await this.store.upsertExternalIdentity({ userId: input.userId, provider, externalId, publicMetadata: {} });
      }
    }

    return { ok: true as const, integration: publicCredential(record, input.provider, workspaceSlug) };
  }

  async revoke(userId: string, workspaceSlug: string, provider: string) {
    if (!isProvider(provider)) throw new NotFoundException('provider_not_found');
    const record = await this.store.revokeCredential(userId, workspaceSlug || 'default', provider);
    return { ok: true as const, integration: publicCredential(record, provider, workspaceSlug || 'default') };
  }

  async resolve(input: {
    provider: string;
    workspaceSlug?: string;
    userId?: string;
    externalIdentity?: { provider: string; externalId: string };
    authorization?: string;
  }) {
    const token = input.authorization?.startsWith('Bearer ') ? input.authorization.slice('Bearer '.length) : '';
    if (!readEnvironment().internalServiceToken || token !== readEnvironment().internalServiceToken) {
      throw new UnauthorizedException('invalid_internal_token');
    }
    if (!isProvider(input.provider)) throw new NotFoundException('provider_not_found');
    let userId = input.userId || '';
    if (!userId && input.externalIdentity) {
      const identity = await this.store.findExternalIdentity(input.externalIdentity.provider, input.externalIdentity.externalId);
      userId = identity?.userId || '';
    }
    if (!userId) throw new NotFoundException('identity_not_found');
    const record = await this.store.findCredential(userId, input.workspaceSlug || 'default', input.provider);
    if (!record || record.status !== 'connected' || record.revokedAt) throw new NotFoundException('credential_not_found');
    return {
      ok: true as const,
      userId,
      workspaceSlug: record.workspaceSlug,
      provider: input.provider,
      config: decryptConfig(record.encryptedConfig),
      publicMetadata: record.publicMetadata,
    };
  }
}
