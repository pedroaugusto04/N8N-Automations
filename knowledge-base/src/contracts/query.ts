import { z } from 'zod';

import { slugify } from '../domain/strings.js';

export const queryInputSchema = z
  .object({
    query: z.string().min(1),
    mode: z.enum(['search', 'answer']).default('answer'),
    workspaceSlug: z.string().default(''),
    projectSlug: z.string().default(''),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .transform((input) => ({
    ...input,
    workspaceSlug: slugify(input.workspaceSlug),
    projectSlug: slugify(input.projectSlug),
  }));

export type QueryInput = z.infer<typeof queryInputSchema>;
