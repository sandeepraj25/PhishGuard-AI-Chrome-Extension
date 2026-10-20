/** Page signals for Layer 2: the raw DOM collector shared with training (lib/pagefeatures.ts). */
import { collectRaw, type RawPageSignals } from '../lib/pagefeatures';

export function collectPageSignals(doc: Document, pageUrl: string): RawPageSignals {
  return collectRaw(doc, pageUrl);
}
