/**
 * Teams: devices of an organisation report WARNING EVENTS ONLY (no URLs, no visited domains,
 * no browsing history). Admins read aggregates on the dashboard with a dashboard token.
 */
import { createHash } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from '../config';
import type { Store, WarningEvent } from '../db/store';

const BRAND_NAMES = new Map(
  (
    JSON.parse(readFileSync(resolve(REPO_ROOT, 'shared/brands.json'), 'utf8')) as {
      brands: { id: string; name: string }[];
    }
  ).brands.map((b) => [b.id, b.name.replace(/\s*\(.*\)$/, '')]),
);

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const EventsBody = z.object({
  deviceId: z.string().min(16).max(128), // random id generated on the device; we store only its hash
  label: z.string().max(80).optional(), // set by the org admin via managed policy (e.g. employee id)
  events: z
    .array(
      z.object({
        occurredAt: z.string().datetime(),
        band: z.enum(['caution', 'warning', 'blocked']),
        score: z.number().int().min(0).max(100),
        brand: z
          .string()
          .regex(/^[a-z0-9_-]{1,40}$/)
          .nullable()
          .optional(),
        reasonIds: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(5),
        layers: z.array(z.enum(['url', 'page', 'visual'])).max(3),
        action: z.enum(['left', 'trusted', 'dismissed', 'reported']).nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

export function summarize(events: WarningEvent[], labels: Map<string, string | null>, weeks: string[]) {
  const perUser = new Map<string, number[]>();
  // Every enrolled device gets a row, so "no warnings" is visible too.
  for (const [hash, label] of labels)
    perUser.set(label ?? `device-${hash.slice(0, 6)}`, new Array<number>(weeks.length).fill(0));
  const brands = new Map<string, number>();
  const totals = {
    events: events.length,
    caution: 0,
    warning: 0,
    blocked: 0,
    left: 0,
    trusted: 0,
    dismissed: 0,
    reported: 0,
  };
  const layers = { url: 0, page: 0, visual: 0 };
  for (const e of events) {
    const user = labels.get(e.deviceHash) ?? `device-${e.deviceHash.slice(0, 6)}`;
    const row = perUser.get(user) ?? new Array<number>(weeks.length).fill(0);
    const w = weeks.indexOf(weekStart(e.occurredAt));
    if (w >= 0) row[w]++;
    perUser.set(user, row);
    if (e.brand) brands.set(e.brand, (brands.get(e.brand) ?? 0) + 1);
    totals[e.band]++;
    if (e.action) totals[e.action as 'left']++;
    for (const l of e.layers) layers[l as 'url']++;
  }
  return {
    weeks,
    perUser: [...perUser]
      .map(([user, counts]) => ({ user, counts, total: counts.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total),
    topBrands: [...brands]
      .map(([brand, count]) => ({ brand, name: BRAND_NAMES.get(brand) ?? brand, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    totals,
    layers,
  };
}

export function teamsRoutes(store: Store, now: () => Date = () => new Date()) {
  return async (app: FastifyInstance): Promise<void> => {
    app.post('/v1/teams/events', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
      const orgKey = req.headers['x-org-key'];
      const org = typeof orgKey === 'string' ? await store.orgByKeyHash(sha(orgKey)) : null;
      if (!org) return reply.code(401).send({ error: 'unknown organisation key' });
      const body = EventsBody.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });
      const deviceHash = sha(body.data.deviceId);
      if (!(await store.enrollDevice(org.id, deviceHash, org.seats, body.data.label ?? null))) {
        return reply.code(402).send({ error: 'all seats are in use' });
      }
      await store.insertWarningEvents(
        body.data.events.map((e) => ({
          orgId: org.id,
          deviceHash,
          occurredAt: new Date(e.occurredAt),
          band: e.band,
          score: e.score,
          brand: e.brand ?? null,
          reasonIds: e.reasonIds,
          layers: e.layers,
          action: e.action ?? null,
        })),
      );
      return reply.code(202).send({ accepted: body.data.events.length });
    });

    app.get('/v1/teams/summary', async (req, reply) => {
      const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const org = token ? await store.orgByDashboardHash(sha(token)) : null;
      if (!org) return reply.code(401).send({ error: 'unauthorized' });
      const nWeeks = Math.min(26, Math.max(1, Number((req.query as { weeks?: string }).weeks ?? 8)));
      const weeks: string[] = [];
      const end = new Date(weekStart(now()));
      for (let i = nWeeks - 1; i >= 0; i--)
        weeks.push(new Date(end.getTime() - i * 7 * 86_400_000).toISOString().slice(0, 10));
      const events = await store.warningEvents(org.id, new Date(weeks[0]));
      const labels = await store.deviceLabels(org.id);
      return { org: { name: org.name, seats: org.seats, devices: labels.size }, ...summarize(events, labels, weeks) };
    });
  };
}
