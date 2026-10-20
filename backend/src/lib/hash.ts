import { createHash } from 'node:crypto';

export const sha256Hex = (s: string): string => createHash('sha256').update(s.toLowerCase()).digest('hex');
export const prefixOf = (fullHash: string): string => fullHash.slice(0, 8);
export const PREFIX_RE = /^[0-9a-f]{8}$/;
