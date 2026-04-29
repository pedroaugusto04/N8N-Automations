import { z } from 'zod';
export const loginBodySchema = z
    .object({
    email: z.string().trim().email(),
    password: z.string().min(1),
})
    .strict();
export const signupBodySchema = loginBodySchema.extend({
    name: z.string().trim().min(1),
});
