import { z } from 'zod';

export const conversationInputSchema = z.object({
  messageText: z.string().default(''),
  senderId: z.string().min(1),
  groupId: z.string().min(1),
  messageId: z.string().default(''),
  hasMedia: z.boolean().default(false),
  media: z
    .object({
      fileName: z.string().default(''),
      mimeType: z.string().default('application/octet-stream'),
      sizeBytes: z.number().int().nonnegative().default(0),
      dataBase64: z.string().default(''),
    })
    .default({}),
  agentResult: z
    .object({
      extracted: z
        .object({
          rawText: z.string().optional(),
          projectSlug: z.string().optional(),
          kind: z.enum(['note', 'bug', 'summary', 'article', 'daily']).optional(),
          canonicalType: z.enum(['event', 'knowledge', 'decision', 'incident']).optional(),
          importance: z.enum(['low', 'medium', 'high']).optional(),
          tags: z.array(z.string()).optional(),
          reminderDate: z.string().optional(),
          reminderTime: z.string().optional(),
        })
        .default({}),
      missingFields: z.array(z.enum(['projectSlug', 'kind', 'rawText', 'reminderDate', 'reminderTime', 'confirmation'])).default([]),
      nextQuestion: z.string().optional(),
      confidence: z.enum(['high', 'medium', 'low']).default('low'),
    })
    .optional(),
});

export type ConversationInput = z.infer<typeof conversationInputSchema>;

export const conversationStateSchema = z.object({
  phase: z.enum(['idle', 'awaiting_kind', 'awaiting_project', 'awaiting_reminder_date', 'awaiting_reminder_time', 'awaiting_confirmation']),
  rawText: z.string().default(''),
  projectSlug: z.string().default(''),
  kind: z.enum(['note', 'bug', 'summary', 'article', 'daily']).default('note'),
  canonicalType: z.enum(['event', 'knowledge', 'decision', 'incident']).default('event'),
  importance: z.enum(['low', 'medium', 'high']).default('low'),
  tags: z.array(z.string()).default([]),
  reminderDate: z.string().default(''),
  reminderTime: z.string().default(''),
  media: z
    .object({
      fileName: z.string().default(''),
      mimeType: z.string().default('application/octet-stream'),
      sizeBytes: z.number().int().nonnegative().default(0),
      dataBase64: z.string().default(''),
    })
    .default({}),
  updatedAt: z.string().default(''),
});

export type ConversationState = z.infer<typeof conversationStateSchema>;
