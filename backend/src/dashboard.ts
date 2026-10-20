/** Serves the built Teams dashboard (dashboard/dist) at /dashboard/. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

import { REPO_ROOT } from './config';

export function serveDashboard(dir = process.env.DASHBOARD_DIR ?? resolve(REPO_ROOT, 'dashboard/dist')) {
  return async (app: FastifyInstance): Promise<void> => {
    if (!existsSync(dir)) {
      app.log.warn(`dashboard not built (${dir}); /dashboard disabled`);
      return;
    }
    await app.register(fastifyStatic, { root: dir, prefix: '/dashboard/', index: ['index.html'] });
    app.get('/dashboard', async (_req, reply) => reply.redirect('/dashboard/'));
  };
}
