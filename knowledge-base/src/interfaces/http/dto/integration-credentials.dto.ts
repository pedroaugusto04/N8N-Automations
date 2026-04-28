import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import { integrationProviders, type IntegrationProvider } from '../../../application/credentials.js';

const workspaceSlugSchema = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9._-]+$/).default('default');
const publicMetadataSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict()
  .default({});

const externalIdentitySchema = z.object({
  provider: z.enum(['telegram', 'whatsapp', 'github', 'github-app']),
  identityType: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9._-]+$/).optional(),
  externalId: z.string().trim().min(1).max(180),
});

const primitiveConfigValueSchema = z.union([z.string().min(1), z.number(), z.boolean()]);
const baseConfigSchema = z
  .record(primitiveConfigValueSchema)
  .refine((config) => Object.keys(config).length > 0, { message: 'config_must_not_be_empty' });

const providerConfigSchemas: Record<IntegrationProvider, z.ZodType<Record<string, string | number | boolean>>> = {
  telegram: baseConfigSchema,
  whatsapp: baseConfigSchema,
  evolution: baseConfigSchema,
  'ai-review': baseConfigSchema,
  'ai-conversation': baseConfigSchema,
  github: baseConfigSchema,
  'github-app': baseConfigSchema,
};

export const saveIntegrationCredentialBodySchema = z
  .object({
    workspaceSlug: workspaceSlugSchema.optional(),
    config: z.unknown(),
    publicMetadata: publicMetadataSchema.optional(),
    externalIdentities: z.array(externalIdentitySchema).max(5).default([]),
  })
  .strict();

export const resolveIntegrationCredentialBodySchema = z
  .object({
    workspaceSlug: workspaceSlugSchema.optional(),
    userId: z.string().uuid().optional(),
    externalIdentity: externalIdentitySchema.optional(),
  })
  .strict()
  .refine((body) => Boolean(body.userId || body.externalIdentity), { message: 'user_or_external_identity_required' });

export type SaveIntegrationCredentialBody = z.infer<typeof saveIntegrationCredentialBodySchema> & {
  provider: IntegrationProvider;
  config: Record<string, string | number | boolean>;
};

export type ResolveIntegrationCredentialBody = z.infer<typeof resolveIntegrationCredentialBodySchema>;

export function parseIntegrationProvider(provider: string): IntegrationProvider {
  const parsed = z.enum(integrationProviders).safeParse(provider);
  if (!parsed.success) throw new BadRequestException('provider_not_supported');
  return parsed.data;
}

export function parseSaveIntegrationCredentialBody(provider: IntegrationProvider, body: unknown): SaveIntegrationCredentialBody {
  const parsedBody = saveIntegrationCredentialBodySchema.safeParse(body);
  if (!parsedBody.success) throw new BadRequestException('invalid_integration_credential_payload');

  const parsedConfig = providerConfigSchemas[provider].safeParse(parsedBody.data.config);
  if (!parsedConfig.success) throw new BadRequestException('invalid_integration_config');

  return {
    ...parsedBody.data,
    provider,
    workspaceSlug: parsedBody.data.workspaceSlug || 'default',
    publicMetadata: parsedBody.data.publicMetadata || {},
    config: parsedConfig.data,
  };
}

export function parseResolveIntegrationCredentialBody(body: unknown): ResolveIntegrationCredentialBody {
  const parsed = resolveIntegrationCredentialBodySchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('invalid_integration_resolution_payload');
  return {
    ...parsed.data,
    workspaceSlug: parsed.data.workspaceSlug || 'default',
  };
}
