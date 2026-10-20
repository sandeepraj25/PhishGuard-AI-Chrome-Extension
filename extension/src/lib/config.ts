/** Build-time configuration. VITE_* values are inlined by Vite at build time. */
export const DEFAULT_API_BASE: string = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';
export const EXTENSION_VERSION = '0.1.0';

/** Score bands (spec): 0-30 safe, 31-60 caution, 61+ warning. */
export const SAFE_MAX = 30;
export const CAUTION_MAX = 60;

/** D7: a Bloom hit that cannot be confirmed online scores at least this. */
export const BLOOM_ONLY_FLOOR = 80;
/** "Visited before with no warning" lowers the score by this many points. */
export const SEEN_BEFORE_BONUS = 25;
/** A domain on the user's trusted list never scores above this (unless confirmed known-bad). */
export const TRUSTED_CAP = 5;
