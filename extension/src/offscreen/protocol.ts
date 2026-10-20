import type { PageScore } from '../lib/pagescore';
import type { RawPageSignals } from '../lib/pagefeatures';
import type { VisualRequest, VisualResult } from '../lib/visualscore';

export type OffscreenRequest =
  | { target: 'offscreen'; kind: 'page'; raw: RawPageSignals }
  | { target: 'offscreen'; kind: 'visual'; req: Omit<VisualRequest, 'png'> & { pngDataUrl: string } }
  | { target: 'offscreen'; kind: 'ping' };

export type WorkerReply =
  | { id: number; ok: true; page?: PageScore; visual?: VisualResult; pong?: boolean }
  | { id: number; ok: false; error: string };
