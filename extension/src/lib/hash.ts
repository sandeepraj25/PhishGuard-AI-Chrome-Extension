/** SHA-256 helpers for the privacy-preserving known-bad lookup (only a 4-byte prefix is sent). */

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** First 4 bytes (8 hex chars) of SHA-256(registered domain). */
export async function hashPrefix(domain: string): Promise<{ full: string; prefix: string }> {
  const full = await sha256Hex(domain.toLowerCase());
  return { full, prefix: full.slice(0, 8) };
}
