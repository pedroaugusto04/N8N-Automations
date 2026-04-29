import { CredentialRecordStatus } from '../../contracts/enums.js';
function nowIso(value) {
    return value instanceof Date ? value.toISOString() : String(value || new Date().toISOString());
}
function stringArray(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
}
export function userFromRow(row) {
    return {
        id: String(row.id),
        email: String(row.email),
        displayName: String(row.display_name || row.email),
        passwordHash: String(row.password_hash),
        role: String(row.role),
        createdAt: nowIso(row.created_at),
        updatedAt: nowIso(row.updated_at),
    };
}
export function credentialFromRow(row) {
    return {
        id: String(row.id),
        userId: String(row.user_id),
        workspaceSlug: String(row.workspace_slug),
        provider: String(row.provider),
        status: String(row.status) === CredentialRecordStatus.Revoked ? CredentialRecordStatus.Revoked : CredentialRecordStatus.Connected,
        encryptedConfig: row.encrypted_config,
        publicMetadata: (row.public_metadata || {}),
        createdAt: nowIso(row.created_at),
        updatedAt: nowIso(row.updated_at),
        revokedAt: row.revoked_at ? nowIso(row.revoked_at) : null,
    };
}
export function identityFromRow(row) {
    return {
        id: String(row.id),
        userId: String(row.user_id),
        workspaceSlug: String(row.workspace_slug || 'default'),
        provider: String(row.provider),
        identityType: String(row.identity_type || 'external_id'),
        externalId: String(row.external_id),
        credentialId: row.credential_id ? String(row.credential_id) : null,
        verifiedAt: row.verified_at ? nowIso(row.verified_at) : null,
        metadata: (row.metadata || {}),
        publicMetadata: (row.public_metadata || {}),
        createdAt: nowIso(row.created_at),
        updatedAt: nowIso(row.updated_at),
    };
}
export function workspaceFromRow(row) {
    return {
        workspaceSlug: String(row.workspace_slug),
        displayName: String(row.display_name || row.workspace_slug),
        whatsappGroupJid: String(row.whatsapp_group_jid || ''),
        telegramChatId: String(row.telegram_chat_id || ''),
        githubRepos: stringArray(row.github_repos),
        projectSlugs: stringArray(row.project_slugs),
        createdAt: nowIso(row.created_at),
        updatedAt: nowIso(row.updated_at),
    };
}
export function projectFromRow(row) {
    return {
        projectSlug: String(row.project_slug),
        displayName: String(row.display_name || row.project_slug),
        repoFullName: String(row.repo_full_name || ''),
        workspaceSlug: String(row.workspace_slug || ''),
        aliases: stringArray(row.aliases),
        defaultTags: stringArray(row.default_tags),
        enabled: row.enabled !== false,
    };
}
export function noteFromRow(row) {
    return {
        id: String(row.id),
        path: String(row.path || ''),
        type: String(row.type || 'event'),
        title: String(row.title || ''),
        projectSlug: String(row.project_slug || ''),
        workspaceSlug: String(row.workspace_slug || ''),
        status: String(row.status || 'active'),
        tags: stringArray(row.tags),
        occurredAt: String(row.occurred_at || ''),
        sourceChannel: String(row.source_channel || ''),
        summary: String(row.summary || ''),
        markdown: String(row.markdown || ''),
        frontmatter: (row.frontmatter || {}),
        metadata: (row.metadata || {}),
        origin: String(row.origin || 'postgres'),
        source: String(row.source || row.source_channel || ''),
        links: stringArray(row.links),
    };
}
export function webhookEventFromRow(row) {
    return {
        id: String(row.id),
        provider: String(row.provider),
        eventType: String(row.event_type || ''),
        status: row.status,
        resolvedUserId: row.resolved_user_id ? String(row.resolved_user_id) : null,
        externalIdentity: (row.external_identity || {}),
        rawHeaders: (row.raw_headers || {}),
        rawPayload: row.raw_payload || {},
        error: String(row.error || ''),
        createdAt: nowIso(row.created_at),
        updatedAt: nowIso(row.updated_at),
    };
}
