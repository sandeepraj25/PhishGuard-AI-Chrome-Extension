import { z } from 'zod';

export const CheckBody = z.object({
  prefixes: z
    .array(z.string().regex(/^[0-9a-f]{8}$/, 'prefix must be 8 lower-case hex chars (4 bytes)'))
    .min(1)
    .max(20),
});

export const ReportBody = z.object({
  // Registered domain only (no scheme, path or query) — enforced, not just documented.
  registeredDomain: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/, 'registered domain only, no URL'),
  kind: z.enum(['false_positive', 'false_negative']),
  score: z.number().int().min(0).max(100),
  reasonIds: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(10),
  modelVersion: z.string().max(80),
  extensionVersion: z.string().max(20),
  comment: z.string().max(500).optional(),
});
