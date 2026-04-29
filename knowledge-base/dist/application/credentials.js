var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import crypto from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { readEnvironment } from '../adapters/environment.js';
import { CredentialRecordStatus, ExternalIdentityProvider, IntegrationProvider, StoredIntegrationStatus, integrationProviderValues, } from '../contracts/enums.js';
import { CredentialRepository, ExternalIdentityRepository } from './ports/repositories.js';
export { IntegrationProvider };
export const integrationProviders = integrationProviderValues;
const providerLabels = {
    [IntegrationProvider.Telegram]: { name: 'Telegram', description: 'Bot e chat usados para notificacoes e eventos operacionais.' },
    [IntegrationProvider.Whatsapp]: { name: 'WhatsApp', description: 'Conta ou grupo autorizado para conversa e ingestao.' },
    [IntegrationProvider.Evolution]: { name: 'Evolution API', description: 'Instancia Evolution usada como transporte do WhatsApp.' },
    [IntegrationProvider.AiReview]: { name: 'AI Review', description: 'Provider, modelo e chave para reviews de codigo.' },
    [IntegrationProvider.AiConversation]: { name: 'AI Conversation', description: 'Provider, modelo e chave para conversa e respostas.' },
    [IntegrationProvider.Github]: { name: 'GitHub Token', description: 'Token pessoal ou fine-grained para leitura de repositorios.' },
    [IntegrationProvider.GithubApp]: { name: 'GitHub App', description: 'App, instalacao e webhook por workspace.' },
};
function isProvider(value) {
    return integrationProviders.includes(value);
}
function encryptionKey() {
    const key = Buffer.from(readEnvironment().credentialsEncryptionKey, 'base64');
    if (key.length !== 32)
        throw new Error('credentials_encryption_key_must_be_32_bytes_base64');
    return key;
}
export function encryptConfig(config) {
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
export function decryptConfig(encrypted) {
    const payload = encrypted;
    if (!payload?.iv || !payload.authTag || !payload.ciphertext)
        throw new Error('invalid_encrypted_config');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
    const cleartext = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    return JSON.parse(cleartext);
}
function configKeysFromMetadata(metadata) {
    return Array.isArray(metadata.configKeys) ? metadata.configKeys.filter((key) => typeof key === 'string') : [];
}
function publicCredential(record, provider, workspaceSlug) {
    const label = providerLabels[provider];
    if (!record) {
        return {
            provider,
            name: label.name,
            description: label.description,
            status: StoredIntegrationStatus.Missing,
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
        status: record.status === CredentialRecordStatus.Connected && !record.revokedAt ? StoredIntegrationStatus.Connected : StoredIntegrationStatus.Revoked,
        workspaceSlug,
        publicMetadata: record.publicMetadata,
        maskedConfig: Object.fromEntries(configKeysFromMetadata(record.publicMetadata).map((key) => [key, '********'])),
        updatedAt: record.updatedAt,
        revokedAt: record.revokedAt,
    };
}
function normalizeConfig(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException('config_must_be_object');
    return value;
}
function sanitizePublicMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const metadata = value;
    return Object.fromEntries(Object.entries(metadata).filter(([key, entry]) => key === 'label' && typeof entry === 'string' && entry.trim().length > 0));
}
const allowedExternalIdentities = {
    [IntegrationProvider.Telegram]: [ExternalIdentityProvider.Telegram],
    [IntegrationProvider.Whatsapp]: [ExternalIdentityProvider.Whatsapp],
    [IntegrationProvider.Evolution]: [ExternalIdentityProvider.Whatsapp],
    [IntegrationProvider.Github]: [ExternalIdentityProvider.Github],
    [IntegrationProvider.GithubApp]: [ExternalIdentityProvider.GithubApp],
};
function canAttachExternalIdentity(provider, identityProvider) {
    return Boolean(allowedExternalIdentities[provider]?.includes(identityProvider));
}
function defaultIdentityType(provider) {
    if (provider === ExternalIdentityProvider.Telegram)
        return 'chat_id';
    if (provider === ExternalIdentityProvider.Whatsapp)
        return 'jid';
    if (provider === ExternalIdentityProvider.GithubApp)
        return 'installation_id';
    if (provider === ExternalIdentityProvider.Github)
        return 'account_id';
    return 'external_id';
}
let IntegrationCredentialService = class IntegrationCredentialService {
    credentials;
    externalIdentities;
    constructor(credentials, externalIdentities = credentials) {
        this.credentials = credentials;
        this.externalIdentities = externalIdentities;
    }
    async list(userId, workspaceSlug = 'default') {
        const records = await this.credentials.listCredentials(userId, workspaceSlug);
        return {
            ok: true,
            workspaceSlug,
            integrations: integrationProviders.map((provider) => publicCredential(records.find((record) => record.provider === provider) || null, provider, workspaceSlug)),
        };
    }
    async save(input) {
        if (!isProvider(input.provider))
            throw new NotFoundException('provider_not_found');
        const workspaceSlug = input.workspaceSlug || 'default';
        const config = normalizeConfig(input.config);
        const publicMetadata = {
            ...sanitizePublicMetadata(input.publicMetadata),
            configKeys: Object.keys(config),
        };
        const record = await this.credentials.upsertCredential({
            userId: input.userId,
            workspaceSlug,
            provider: input.provider,
            status: CredentialRecordStatus.Connected,
            encryptedConfig: encryptConfig(config),
            publicMetadata,
        });
        if (Array.isArray(input.externalIdentities)) {
            for (const identity of input.externalIdentities) {
                if (!identity || typeof identity !== 'object')
                    continue;
                const provider = String(identity.provider || '').trim();
                const identityType = String(identity.identityType || defaultIdentityType(provider)).trim();
                const externalId = String(identity.externalId || '').trim();
                if (!provider || !identityType || !externalId)
                    continue;
                if (!canAttachExternalIdentity(input.provider, provider))
                    throw new BadRequestException('external_identity_not_allowed_for_provider');
                const existing = await this.externalIdentities.findExternalIdentity(provider, identityType, externalId);
                if (existing && existing.userId !== input.userId)
                    throw new ConflictException('external_identity_already_bound');
                await this.externalIdentities.upsertExternalIdentity({
                    userId: input.userId,
                    workspaceSlug,
                    provider,
                    identityType,
                    externalId,
                    credentialId: record.id,
                    metadata: {},
                    publicMetadata: {},
                });
            }
        }
        return { ok: true, integration: publicCredential(record, input.provider, workspaceSlug) };
    }
    async revoke(userId, workspaceSlug, provider) {
        if (!isProvider(provider))
            throw new NotFoundException('provider_not_found');
        const record = await this.credentials.revokeCredential(userId, workspaceSlug || 'default', provider, encryptConfig({ revoked: true }));
        return { ok: true, integration: publicCredential(record, provider, workspaceSlug || 'default') };
    }
    async resolve(input) {
        const token = input.authorization?.startsWith('Bearer ') ? input.authorization.slice('Bearer '.length) : '';
        if (!readEnvironment().internalServiceToken || token !== readEnvironment().internalServiceToken) {
            throw new UnauthorizedException('invalid_internal_token');
        }
        if (!isProvider(input.provider))
            throw new NotFoundException('provider_not_found');
        let userId = input.userId || '';
        if (!userId && input.externalIdentity) {
            const identityType = input.externalIdentity.identityType || defaultIdentityType(input.externalIdentity.provider);
            const identity = await this.externalIdentities.findExternalIdentity(input.externalIdentity.provider, identityType, input.externalIdentity.externalId);
            userId = identity?.userId || '';
        }
        if (!userId)
            throw new NotFoundException('identity_not_found');
        const record = await this.credentials.findCredential(userId, input.workspaceSlug || 'default', input.provider);
        if (!record || record.status !== CredentialRecordStatus.Connected || record.revokedAt)
            throw new NotFoundException('credential_not_found');
        return {
            ok: true,
            userId,
            workspaceSlug: record.workspaceSlug,
            provider: input.provider,
            config: decryptConfig(record.encryptedConfig),
            publicMetadata: record.publicMetadata,
        };
    }
};
IntegrationCredentialService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [CredentialRepository,
        ExternalIdentityRepository])
], IntegrationCredentialService);
export { IntegrationCredentialService };
