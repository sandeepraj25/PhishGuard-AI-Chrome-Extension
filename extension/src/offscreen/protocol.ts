import type { PageScore } from '../lib/pagescore';
import type { RawPageSignals } from '../lib/pagefeatures';

export type OffscreenRequest =
  { target: 'offscreen'; kind: 'page'; raw: RawPageSignals } | { target: 'offscreen'; kind: 'ping' };

export type WorkerReply =
  { id: number; ok: true; page?: PageScore; pong?: boolean } | { id: number; ok: false; error: string };
