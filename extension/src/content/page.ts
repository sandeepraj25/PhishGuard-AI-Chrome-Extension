/**
 * Page signals for Layer 2 (v2). In v1 only the form-action domain is collected; the full DOM
 * feature vector is added in phase v2.
 */
import type { PageSignals } from '../lib/types';

export function formActionHost(field: HTMLInputElement | null, pageUrl: string): string {
  const form = field?.form;
  if (!form) return '';
  const action = form.getAttribute('action');
  if (!action) return new URL(pageUrl).hostname;
  try {
    return new URL(action, pageUrl).hostname;
  } catch {
    return '';
  }
}

export function collectPageSignals(_doc: Document, pageUrl: string, field: HTMLInputElement | null): PageSignals {
  return { features: [], formActionDomain: formActionHost(field, pageUrl) };
}
