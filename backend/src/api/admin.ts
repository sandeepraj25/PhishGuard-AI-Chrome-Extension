/**
 * Admin routes (review queue, CT candidates, lead-time export). Bearer token from ADMIN_TOKEN.
 * Reports flow: extension "Report mistake" -> /v1/report (pending) -> reviewer confirms/rejects here
 * -> /v1/admin/reports/export?status=confirmed -> ml/scripts/import_reviews.py -> retraining data.
 */
import { timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Store } from '../db/store';

export const OUR_SOURCES = new Set(['ct']);

function authorized(req: FastifyRequest, token: string): boolean {
  const got = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

const csvCell = (v: unknown) => {
  const s = v instanceof Date ? v.toISOString() : String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: unknown[][]) =>
  [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n';

/** domain, our_first_seen, feed, feed_first_seen — one row per (domain, feed) seen by both. */
export async function leadTimeRows(store: Store): Promise<unknown[][]> {
  type Entry = { ours?: Date; feeds: Map<string, Date> };
  const byDomain = new Map<string, Entry>();
  for (const s of await store.allSightings()) {
    const e: Entry = byDomain.get(s.domain) ?? { feeds: new Map<string, Date>() };
    if (OUR_SOURCES.has(s.source)) {
      if (!e.ours || s.firstSeen < e.ours) e.ours = s.firstSeen;
    } else e.feeds.set(s.source, s.firstSeen);
    byDomain.set(s.domain, e);
  }
  const rows: unknown[][] = [];
  for (const [domain, e] of [...byDomain].sort()) {
    if (!e.ours) continue;
    for (const [feed, at] of e.feeds) rows.push([domain, e.ours, feed, at]);
    if (e.feeds.size === 0) rows.push([domain, e.ours, '', '']); // seen by us, never by a feed (yet)
  }
  return rows;
}

const Review = z.object({ status: z.enum(['confirmed', 'rejected']), label: z.union([z.literal(0), z.literal(1)]) });
const Status = z.enum(['pending', 'confirmed', 'rejected']);

export function adminRoutes(store: Store, token: string) {
  return async (app: FastifyInstance): Promise<void> => {
    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      if (req.url.startsWith('/v1/admin/') && !authorized(req, token))
        return reply.code(401).send({ error: 'unauthorized' });
    });

    app.get('/v1/admin/reports', async (req, reply) => {
      const q = req.query as { status?: string; limit?: string };
      const status = Status.safeParse(q.status ?? 'pending');
      if (!status.success) return reply.code(400).send({ error: 'bad status' });
      return store.listReports(status.data, Math.min(500, Number(q.limit ?? 50)));
    });

    app.post('/v1/admin/reports/:id/review', async (req, reply) => {
      const body = Review.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: body.error.issues[0].message });
      const ok = await store.reviewReport(Number((req.params as { id: string }).id), body.data.status, body.data.label);
      return ok ? { ok } : reply.code(404).send({ error: 'no such report' });
    });

    app.get('/v1/admin/reports/export', async (req, reply) => {
      const status = Status.safeParse((req.query as { status?: string }).status ?? 'confirmed');
      if (!status.success) return reply.code(400).send({ error: 'bad status' });
      const rows = (await store.listReports(status.data, 100_000)).map((r) => [
        r.registeredDomain,
        r.reviewerLabel ?? '',
        r.kind,
        r.score,
        r.reasonIds.join('|'),
        r.modelVersion,
        r.createdAt,
      ]);
      reply.type('text/csv');
      return toCsv(['registered_domain', 'label', 'kind', 'score', 'reason_ids', 'model_version', 'reported_at'], rows);
    });

    app.get('/v1/admin/ct-candidates', async (req) =>
      store.listCtCandidates(Math.min(1000, Number((req.query as { limit?: string }).limit ?? 100))),
    );

    app.get('/v1/admin/leadtime.csv', async (_req, reply) => {
      reply.type('text/csv');
      return toCsv(['domain', 'our_first_seen', 'feed', 'feed_first_seen'], await leadTimeRows(store));
    });
  };
}
