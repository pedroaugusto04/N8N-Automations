import { BadRequestException } from '@nestjs/common';
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

export type LoginBody = z.infer<typeof loginBodySchema>;
export type SignupBody = z.infer<typeof signupBodySchema>;

export function parseLoginBody(body: unknown): LoginBody {
  const parsed = loginBodySchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('invalid_login_payload');
  return parsed.data;
}

export function parseSignupBody(body: unknown): SignupBody {
  const parsed = signupBodySchema.safeParse(body);
  if (!parsed.success) throw new BadRequestException('invalid_signup_payload');
  return parsed.data;
}
