import { z } from 'zod';
import { conversationInputSchema } from '../../../contracts/conversation.js';
import { ReminderDispatchMode } from '../../../contracts/enums.js';
import { ingestPayloadSchema } from '../../../contracts/ingest.js';
import { onboardingInputSchema } from '../../../contracts/onboarding.js';
export const ingestBodySchema = ingestPayloadSchema;
export const onboardingBodySchema = onboardingInputSchema;
export const conversationBodySchema = conversationInputSchema;
export const workspaceQuerySchema = z.object({
    workspaceSlug: z.string().trim().default('default'),
}).transform((query) => ({
    workspaceSlug: query.workspaceSlug || 'default',
}));
export const reminderDispatchQuerySchema = z.object({
    workspaceSlug: z.string().trim().default('default'),
    mode: z.string().default(ReminderDispatchMode.Daily),
}).transform((query) => ({
    workspaceSlug: query.workspaceSlug || 'default',
    mode: query.mode === ReminderDispatchMode.Exact ? ReminderDispatchMode.Exact : ReminderDispatchMode.Daily,
}));
