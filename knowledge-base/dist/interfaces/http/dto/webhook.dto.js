import { z } from 'zod';
export const githubPushWebhookBodySchema = z
    .object({
    installation: z
        .object({
        id: z.union([z.string(), z.number()]).optional(),
    })
        .passthrough()
        .optional(),
})
    .passthrough()
    .transform((body) => ({
    ...body,
    installation: body.installation
        ? {
            ...body.installation,
            id: body.installation.id == null ? undefined : String(body.installation.id),
        }
        : undefined,
}));
export const whatsappWebhookBodySchema = z
    .object({
    schemaVersion: z.coerce.number().optional(),
})
    .passthrough();
